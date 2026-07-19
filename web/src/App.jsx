import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createEngine } from './engine.js'
import { cameraLanguage, generateShot, getConfig, multicut } from './api.js'
import TopBar from './components/TopBar.jsx'
import CubeToolbox from './components/CubeToolbox.jsx'
import PromptBar from './components/PromptBar.jsx'
import PairModal from './components/PairModal.jsx'
import ResultModal from './components/ResultModal.jsx'

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
  const [falOn, setFalOn] = useState(false)
  const [rec, setRec] = useState({ on: false, elapsed: 0 })
  const [mode, setMode] = useState('exact')
  const [detail, setDetail] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [boxOpen, setBoxOpen] = useState(false)
  const [pairOpen, setPairOpen] = useState(false)
  const [result, setResult] = useState(null) // {control, url, prompt}
  const [toast, setToast] = useState(null) // {msg, key}
  const [, setTick] = useState(0) // re-render for queue elapsed seconds

  const say = useCallback((msg) => setToast({ msg, key: Date.now() }), [])

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
    })
    engineRef.current = engine
    getConfig().then((c) => setFalOn(Boolean(c.falKeySet))).catch(() => {})
    return () => engine.dispose()
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
      setResult({ control: out.control, url: out.local || out.video?.url, prompt })
      return out
    } catch (err) {
      console.error(err)
      say(`Generation failed: ${err.message}`)
      return null
    } finally {
      setGenerating(false)
    }
  }, [generating, composePrompt, mode, detail, shot.refs, say])

  // coverage stays a scripting feature: wide/insert/orbit from the cube
  const coverage = useCallback(async () => {
    const engine = engineRef.current
    const rig = engine.coverageRig()
    const basePrompt = composePrompt()
    const renders = rig.map((angle) => ({ angle, frames: engine.renderDepthFramesFrom(angle.poseAt) }))
    say(`Coverage: ${rig.map((a) => a.key).join(' · ')}`)
    const results = await Promise.all(renders.map(({ angle, frames }) =>
      generateShot({ frames, prompt: `${basePrompt}, ${angle.hint}`, fps: 16, refs: shot.refs.map((r) => r.url) })
        .then((out) => ({ key: angle.key, ...out }))))
    const cut = await multicut(results.map((r) => r.id))
    setResult({ control: results[0].control, url: cut.result, prompt: `${basePrompt} — multicam cut` })
    return { results, cut }
  }, [composePrompt, shot.refs, say])

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
      queue: () => queue.jobs,
    }
  })

  const canSend = Boolean(takeMeta) && Boolean(shot.object || shot.look) && !generating

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
      />
      <CubeToolbox
        open={boxOpen}
        initial={shot.object}
        anchor={() => engineRef.current?.projectCubeTop()}
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
        generating={generating}
        onSend={() => generate()}
        queue={queue}
        say={say}
      />
      {pairOpen && <PairModal onClose={() => setPairOpen(false)} />}
      {result && <ResultModal result={result} onClose={() => setResult(null)} />}
      <Toast toast={toast} />
    </>
  )
}

function Toast({ toast }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!toast) return undefined
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 2600)
    return () => clearTimeout(t)
  }, [toast])
  return <div id="toast" className={visible ? 'show' : ''}>{toast?.msg}</div>
}
