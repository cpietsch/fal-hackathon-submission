import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Folder, Plus } from 'lucide-react'
import { createEngine } from './engine.js'
import { cameraLanguage, generateShot, getConfig, multicut } from './api.js'
import TopBar from './components/TopBar.jsx'
import { CameraIsland, ShotIsland } from './components/Islands.jsx'
import CubeToolbox from './components/CubeToolbox.jsx'
import PromptBar from './components/PromptBar.jsx'
import GenStack from './components/GenProgress.jsx'
import PairModal from './components/PairModal.jsx'
import ResultModal from './components/ResultModal.jsx'
import DailiesDrawer from './components/DailiesDrawer.jsx'

const STORE_KEY = 'blocking-min-v1'
const DEFAULT_PROMPT = 'A sculptural object on the concrete floor of an empty studio, '
  + 'dramatic side light, haze, cinematic 35mm film'

function loadShot() {
  const shot = { object: '', look: '', refs: [] }
  try { Object.assign(shot, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')) } catch { /* fresh */ }
  return shot
}

export default function App() {
  const stageRef = useRef(null)
  const engineRef = useRef(null)
  const takeRef = useRef(null) // full frames stay out of React state

  const [shot, setShot] = useState(loadShot)
  const [takeMeta, setTakeMeta] = useState(null) // {dur}
  const [camLang, setCamLang] = useState(null)
  const [queue, setQueue] = useState({ jobs: [], at: 0 })
  const [phoneOn, setPhoneOn] = useState(false)
  const [falOn, setFalOn] = useState(null) // null = unknown (config not fetched yet)
  const [rec, setRec] = useState({ on: false, elapsed: 0 })
  const [countdown, setCountdown] = useState(null)
  const [swapped, setSwapped] = useState(false)
  const [simMode, setSimMode] = useState(false)
  const [mode, setMode] = useState('exact')
  const [detail, setDetail] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [boxOpen, setBoxOpen] = useState(false)
  const [pairOpen, setPairOpen] = useState(false)
  const [dailiesOpen, setDailiesOpen] = useState(false)
  const [result, setResult] = useState(null) // {control, url, prompt, id, mode}
  const [toast, setToast] = useState(null) // {msg, key, dur}

  const say = useCallback((msg, dur) => setToast({ msg, key: Date.now(), dur }), [])
  const generatingRef = useRef(false)
  useEffect(() => { generatingRef.current = generating }, [generating])

  const onTakeSaved = useCallback(async (take) => {
    takeRef.current = take
    setTakeMeta({ dur: take.dur })
    setCamLang({ move_name: 'reading the move…' })
    say(`Move captured — ${take.dur.toFixed(1)}s`)
    try {
      setCamLang(await cameraLanguage(take.frames))
    } catch (err) {
      console.error(err)
      setCamLang({ move_name: 'performed move', camera_prompt: '' })
      say('Couldn’t read the move into camera language — Beautiful mode won’t hear it', 6000)
    }
  }, [say])

  // ---------------------------------------------------- record flow (3-2-1)
  const cdTimer = useRef(0)
  const recRef = useRef(false)
  useEffect(() => { recRef.current = rec.on }, [rec.on])

  // camera view brings the fly keys along — with no phone streaming you can
  // still perform the move; a live phone pose outranks the keys anyway
  const enterCamView = useCallback((on) => {
    setSwapped(on)
    engineRef.current?.setSwapped(on)
    setSimMode(on)
    engineRef.current?.setSim(on)
  }, [])

  const startRecordFlow = useCallback((on) => {
    if (!on) {
      if (cdTimer.current) { // cancel a pending countdown
        clearTimeout(cdTimer.current)
        cdTimer.current = 0
        setCountdown(null)
        engineRef.current?.wsSend({ type: 'countdown', on: false })
        enterCamView(false)
        return
      }
      engineRef.current?.setRecording(false)
      enterCamView(false)
      return
    }
    if (recRef.current || cdTimer.current) return
    enterCamView(true)
    engineRef.current?.wsSend({ type: 'countdown', on: true }) // phone HUD mirrors it
    let n = 3
    const tick = () => {
      if (n === 0) {
        setCountdown(null)
        cdTimer.current = 0
        engineRef.current?.setRecording(true)
        return
      }
      setCountdown(n)
      n--
      cdTimer.current = window.setTimeout(tick, 800)
    }
    tick()
  }, [enterCamView])
  const flowRef = useRef(startRecordFlow)
  flowRef.current = startRecordFlow

  useEffect(() => {
    const engine = createEngine(stageRef.current, {
      onCubeClick: () => setBoxOpen(true),
      onBlankClick: () => setBoxOpen(false),
      onTakeSaved,
      onPresence: setPhoneOn,
      onGenQueue: (jobs) => setQueue({ jobs, at: Date.now() }),
      onRecording: (r) => { setRec(r); if (!r.on) enterCamView(false) },
      onSwapped: setSwapped,
      onRecordKey: () => flowRef.current(!(recRef.current || cdTimer.current)),
      onRecordRequest: (on) => flowRef.current(on),
      onCamStart: () => flowRef.current(true), // phone START = roll a take
      onCamEnd: () => flowRef.current(false),
      onToast: say,
      // a tab that refreshed mid-generation (or never started one) still
      // learns where finished work landed
      onGenDone: () => { if (!generatingRef.current) say('Shot finished — it’s in Dailies', 5000) },
    })
    engineRef.current = engine
    // a transient config failure must not permanently disable Send —
    // keep falOn unknown (null) and retry when the tab regains focus
    const fetchConfig = () => getConfig().then((c) => setFalOn(Boolean(c.falKeySet))).catch(() => {})
    fetchConfig()
    addEventListener('focus', fetchConfig)
    return () => { removeEventListener('focus', fetchConfig); engine.dispose() }
  }, [onTakeSaved, say])

  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(shot)) }, [shot])
  useEffect(() => { engineRef.current?.setCubeFilled(Boolean(shot.object)) }, [shot.object])
  useEffect(() => { engineRef.current?.setToolboxOpen(boxOpen) }, [boxOpen])

  const refreshFal = useCallback(() => {
    getConfig()
      .then((c) => {
        setFalOn(Boolean(c.falKeySet))
        say(c.falKeySet
          ? 'fal key loaded — ready to generate'
          : 'FAL_KEY not set — add FAL_KEY=… to .env and restart the server')
      })
      .catch(() => say('Server unreachable'))
  }, [say])

  const composePrompt = useCallback(() => {
    const parts = []
    if (shot.object) parts.push(`Main object: ${shot.object}`)
    if (shot.look) parts.push(shot.look)
    let prompt = parts.join('. ') || DEFAULT_PROMPT
    if (mode === 'beautiful' && camLang?.camera_prompt) prompt += ` Camera: ${camLang.camera_prompt}`
    return prompt
  }, [shot, mode, camLang])

  const generate = useCallback(async (promptOverride) => {
    if (generating) return say('Already generating…')
    const take = takeRef.current
    if (!take) return say('Record a camera move first — the motion is part of the prompt')
    const prompt = promptOverride || composePrompt()
    setGenerating(true)
    try {
      await new Promise((r) => setTimeout(r, 30)) // let the UI paint
      const frames = engineRef.current.renderDepthFrames(take)
      say('Depth previz uploaded — fal is dreaming')
      const out = await generateShot({
        frames, prompt, fps: 16, mode,
        detail: mode === 'exact' && detail,
        refs: shot.refs.map((r) => r.url),
      })
      setResult({ control: out.control, url: out.local || out.video?.url, prompt, id: out.id, mode })
      return out
    } catch (err) {
      console.error(err)
      say(`Generation failed: ${err.message}`, 8000)
      return null
    } finally {
      setGenerating(false)
    }
  }, [generating, composePrompt, mode, detail, shot.refs, say])

  // "Again": same performed take (server reuses the uploaded control), new seed
  const again = useCallback(async () => {
    if (generating) return say('Already generating…')
    if (!result?.id) return null
    setGenerating(true)
    setResult(null) // hand off to the progress card; the new result reopens the modal
    say('New seed rolling — progress in the corner')
    try {
      const out = await generateShot({
        controlOf: result.id, prompt: result.prompt, fps: 16,
        mode: result.mode || 'exact',
        detail: (result.mode || 'exact') === 'exact' && detail,
        refs: shot.refs.map((r) => r.url),
      })
      setResult({ control: out.control, url: out.local || out.video?.url, prompt: result.prompt, id: out.id, mode: result.mode })
      return out
    } catch (err) {
      console.error(err)
      say(`Generation failed: ${err.message}`, 8000)
      return null
    } finally {
      setGenerating(false)
    }
  }, [generating, result, detail, shot.refs, say])

  // coverage: wide/insert/orbit derived from the cube + auto multicam cut
  const coverage = useCallback(async () => {
    if (generating) return say('Already generating…')
    if (!shot.object && !shot.look) return say('Tell the cube what it is first')
    const engine = engineRef.current
    const rig = engine.coverageRig()
    const basePrompt = composePrompt()
    setGenerating(true)
    try {
      say(`Coverage: ${rig.map((a) => a.key).join(' · ')} — rendering previz…`)
      const renders = []
      for (const angle of rig) {
        // yield to the compositor between angles: each render is ~2s of
        // blocking WebGL readbacks, and the toast has to actually paint
        await new Promise((r) => setTimeout(r, 50))
        renders.push({ angle, frames: engine.renderDepthFramesFrom(angle.poseAt) })
      }
      const results = await Promise.all(renders.map(({ angle, frames }) =>
        generateShot({ frames, prompt: `${basePrompt}, ${angle.hint}`, fps: 16, refs: shot.refs.map((r) => r.url) })
          .then((out) => ({ key: angle.key, ...out }))))
      const cut = await multicut(results.map((r) => r.id))
      setResult({ control: results[0].control, url: cut.result, prompt: `${basePrompt} — multicam cut`, id: cut.id, mode: 'coverage' })
      return { results, cut }
    } catch (err) {
      console.error(err)
      say(`Coverage failed: ${err.message}`, 8000)
      return null
    } finally {
      setGenerating(false)
    }
  }, [generating, composePrompt, shot.object, shot.look, shot.refs, say])

  // scripting/debug hook (also used by headless tests)
  useEffect(() => {
    window.__blocking = {
      engine: engineRef.current,
      shot,
      setShot: (s) => setShot((prev) => ({ ...prev, ...s })),
      addTake: (frames) => onTakeSaved({ id: Date.now(), name: 'Take', dur: frames[frames.length - 1].t / 1000, frames }),
      cameraLanguage: () => camLang,
      generate,
      coverage,
      again,
      result: () => result,
      queue: () => queue.jobs,
      recordFlow: startRecordFlow,
    }
  })

  // Escape backs out of whatever is top-most
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (result) setResult(null)
      else if (dailiesOpen) setDailiesOpen(false)
      else if (pairOpen) setPairOpen(false)
      else if (boxOpen) setBoxOpen(false)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [result, dailiesOpen, pairOpen, boxOpen])

  // the undefined cube advertises itself: pinned "+" at its top corner
  const showPlus = !shot.object && !boxOpen && !swapped
  const plusRef = useRef(null)
  useEffect(() => {
    if (!showPlus) return undefined
    let raf
    const track = () => {
      const el = plusRef.current
      const p = engineRef.current?.projectCubeCorner()
      if (el && p) {
        el.style.left = `${p.x - 13}px`
        el.style.top = `${p.y - 13}px`
      }
      raf = requestAnimationFrame(track)
    }
    track()
    return () => cancelAnimationFrame(raf)
  }, [showPlus])

  // falOn === false blocks (server confirmed no key); null (unknown) allows —
  // the server would answer with a clear error anyway
  const canSend = Boolean(takeMeta) && Boolean(shot.object || shot.look) && !generating && falOn !== false

  return (
    <>
      <div id="view" ref={stageRef} />
      <TopBar phoneOn={phoneOn} falOn={falOn} onPair={() => setPairOpen(true)} onFalCheck={refreshFal} />
      <CameraIsland
        swapped={swapped}
        onCamView={(on) => enterCamView(on)}
        simMode={simMode}
        onSim={(on) => {
          setSimMode(on)
          engineRef.current.setSim(on)
          if (on) say('Fly: WASD move · Q/Z up/down · arrows look')
        }}
        onPair={() => setPairOpen(true)}
        onRezero={() => engineRef.current.rezero()}
      />
      <ShotIsland
        recording={rec.on}
        countdown={countdown}
        recSec={rec.elapsed}
        onRecord={() => startRecordFlow(!(rec.on || cdTimer.current))}
        mode={mode}
        setMode={setMode}
        detail={detail}
        setDetail={setDetail}
        canCoverage={Boolean(shot.object || shot.look) && !generating && falOn !== false}
        onCoverage={() => coverage()}
      />
      <CubeToolbox
        open={boxOpen}
        initial={shot.object}
        anchor={() => engineRef.current?.projectCubeTop()}
        onClose={() => setBoxOpen(false)}
        say={say}
        onConfirm={(text) => {
          setShot((s) => ({ ...s, object: text }))
          setBoxOpen(false)
          say(text ? 'Object attached to the main prompt' : 'Object cleared')
        }}
      />
      {showPlus && (
        <button id="cubePlus" ref={plusRef} title="Define the main object" onClick={() => setBoxOpen(true)}>
          <Plus className="icon" />
        </button>
      )}
      <GenStack queue={queue} />
      <PromptBar
        shot={shot}
        setShot={setShot}
        takeMeta={takeMeta}
        camLang={camLang}
        onPlayTake={() => takeRef.current && engineRef.current.playTake(takeRef.current)}
        onClearTake={() => { takeRef.current = null; setTakeMeta(null); setCamLang(null) }}
        onEditObject={() => setBoxOpen(true)}
        mode={mode}
        canSend={canSend}
        generating={generating}
        onSend={() => generate()}
        say={say}
      />
      {countdown !== null && <div id="countdown"><b key={countdown}>{countdown}</b></div>}
      <button id="historyBtn" title="Dailies — everything this stage has generated" onClick={() => setDailiesOpen(true)}>
        <Folder className="icon" />
      </button>
      {pairOpen && <PairModal onClose={() => setPairOpen(false)} />}
      {dailiesOpen && (
        <DailiesDrawer
          onClose={() => setDailiesOpen(false)}
          onOpen={(it) => {
            setResult({ control: it.control || it.result, url: it.result, prompt: it.prompt || it.id, id: it.id, mode: it.mode })
            setDailiesOpen(false)
          }}
        />
      )}
      {result && (
        <ResultModal
          result={result}
          onClose={() => setResult(null)}
          onAgain={result.id && result.mode !== 'coverage' && !generating ? again : null}
        />
      )}
      <Toast toast={toast} />
    </>
  )
}

function Toast({ toast }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!toast) return undefined
    setVisible(true)
    const t = setTimeout(() => setVisible(false), toast.dur || 2600)
    return () => clearTimeout(t)
  }, [toast])
  return <div id="toast" className={visible ? 'show' : ''}>{toast?.msg}</div>
}
