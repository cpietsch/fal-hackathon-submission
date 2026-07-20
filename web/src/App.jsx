import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createEngine } from './engine.js'
import { cameraLanguage, generateShot, getConfig, multicut } from './api.js'
import TopBar from './components/TopBar.jsx'
import CubeToolbox from './components/CubeToolbox.jsx'
import PromptBar from './components/PromptBar.jsx'
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
  const [mode, setMode] = useState('exact')
  const [detail, setDetail] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [boxOpen, setBoxOpen] = useState(false)
  const [pairOpen, setPairOpen] = useState(false)
  const [dailiesOpen, setDailiesOpen] = useState(false)
  const [result, setResult] = useState(null) // {control, url, prompt, id, mode}
  const [toast, setToast] = useState(null) // {msg, key}
  const [, setTick] = useState(0) // re-render for queue elapsed seconds

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

  useEffect(() => {
    const engine = createEngine(stageRef.current, {
      onCubeClick: () => setBoxOpen(true),
      onBlankClick: () => setBoxOpen(false),
      onTakeSaved,
      onPresence: setPhoneOn,
      onGenQueue: (jobs) => setQueue({ jobs, at: Date.now() }),
      onRecording: setRec,
      onRecordKey: () => engineRef.current?.toggleRecording(),
      onToast: say,
      // a tab that refreshed mid-generation (or never started one) still
      // learns where finished work landed
      onGenDone: (m) => { if (!generatingRef.current) say('Shot finished — it’s in Dailies', 5000) },
    })
    engineRef.current = engine
    // a transient config failure must not permanently disable Send —
    // keep falOn unknown (null) and retry when the tab regains focus
    const fetchConfig = () => getConfig().then((c) => setFalOn(Boolean(c.falKeySet))).catch(() => {})
    fetchConfig()
    addEventListener('focus', fetchConfig)
    return () => { removeEventListener('focus', fetchConfig); engine.dispose() }
  }, [onTakeSaved])

  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(shot)) }, [shot])
  useEffect(() => { engineRef.current?.setCubeFilled(Boolean(shot.object)) }, [shot.object])
  useEffect(() => { engineRef.current?.setToolboxOpen(boxOpen) }, [boxOpen])

  // tick once a second while jobs are in flight so elapsed times count up
  useEffect(() => {
    if (!queue.jobs.length) return undefined
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [queue.jobs.length])

  const composePrompt = useCallback(() => {
    const parts = []
    if (shot.object) parts.push(shot.object)
    if (shot.look) parts.push(shot.look)
    let prompt = parts.join('. ') || DEFAULT_PROMPT
    if (mode === 'beautiful' && camLang?.camera_prompt) prompt += ` Camera: ${camLang.camera_prompt}`
    return prompt
  }, [shot, mode, camLang])

  const generate = useCallback(async (promptOverride) => {
    if (generating) return say('Already generating…')
    const take = takeRef.current
    if (!take) return say('Record a camera move first')
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
    setResult(null) // hand off to the queue line; the new result reopens the modal
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

  // falOn === false blocks (server confirmed no key); null (unknown) allows —
  // the server would answer with a clear error anyway
  const canSend = Boolean(takeMeta) && Boolean(shot.object || shot.look) && !generating && falOn !== false

  return (
    <>
      <div id="view" ref={stageRef} />
      <TopBar
        rec={rec}
        onRecToggle={() => engineRef.current.toggleRecording()}
        onSim={(on) => { engineRef.current.setSim(on); if (on) say('Sim: WASD move · QZ up/down · arrows look') }}
        onScale={(v) => engineRef.current.setMoveScale(v)}
        phoneOn={phoneOn}
        falOn={falOn}
        onPair={() => setPairOpen(true)}
        onRezero={() => engineRef.current.rezero()}
        onDailies={() => setDailiesOpen(true)}
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
          if (text) say('Object added to the shot')
        }}
      />
      <PromptBar
        shot={shot}
        setShot={setShot}
        takeMeta={takeMeta}
        camLang={camLang}
        onPlayTake={() => takeRef.current && engineRef.current.playTake(takeRef.current)}
        onClearTake={() => { takeRef.current = null; setTakeMeta(null); setCamLang(null) }}
        onEditObject={() => setBoxOpen(true)}
        mode={mode}
        setMode={setMode}
        detail={detail}
        setDetail={setDetail}
        canSend={canSend}
        canCoverage={Boolean(shot.object || shot.look) && !generating && falOn !== false}
        generating={generating}
        onSend={() => generate()}
        onCoverage={() => coverage()}
        queue={queue}
        say={say}
      />
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
