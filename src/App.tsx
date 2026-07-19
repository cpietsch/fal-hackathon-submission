import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Check, Crosshair, Disc, Film, Gamepad2, Image as ImageIcon,
  Mic, Play, Send, Smartphone, Square, Video, X,
} from 'lucide-react'
import { createStage, smoothFrames, type Stage, type Take } from './three/stage'
import { applyCtrl, initCtrl } from './lib/curves'
import { CurvePanel } from './components/CurvePanel'
import { PairModal } from './components/PairModal'
import { ResultModal, type GenResult } from './components/ResultModal'
import { useDictation } from './lib/dictation'

const DEFAULT_PROMPT = 'A single object on the floor of an empty concrete warehouse at night, '
  + 'hard rim lighting through haze, volumetric light shafts, cinematic 35mm film, '
  + 'moody teal and amber color grade'
const PROMPT_PLACEHOLDER = 'Describe the look & atmosphere of the shot…'

type CameraLanguage = { move_name: string; camera_prompt: string }

export default function App() {
  const viewRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Stage | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const [takes, setTakes] = useState<Take[]>([])
  const [chosenId, setChosenId] = useState<number | null>(null)
  const [cameraLanguage, setCameraLanguage] = useState<CameraLanguage | null>(null)
  const [langNonce, setLangNonce] = useState(0)
  const [objectPrompt, setObjectPromptState] = useState(() => localStorage.getItem('blocking-object-v1') || '')
  const [refs, setRefs] = useState<string[]>([])
  const [mainText, setMainText] = useState('')
  const [genMode, setGenMode] = useState<'exact' | 'beautiful'>('exact')
  const [generating, setGenerating] = useState(false)
  const [genStatus, setGenStatus] = useState<string | null>(null)
  const [covStatus, setCovStatus] = useState<string | null>(null)
  const [swapped, setSwapped] = useState(false)
  const [simMode, setSimMode] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recSec, setRecSec] = useState(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [boxOpen, setBoxOpen] = useState(false)
  const [cubeText, setCubeText] = useState('')
  const [phoneConn, setPhoneConn] = useState(false)
  const [falReady, setFalReady] = useState(false)
  const [klingReady, setKlingReady] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [pairOpen, setPairOpen] = useState(false)
  const [result, setResult] = useState<{ out: GenResult; prompt: string } | null>(null)

  // live mirror of state for stage/ws callbacks created on the first render
  const live = useRef({
    takes, chosenId, cameraLanguage, objectPrompt, refs, mainText,
    genMode, generating, recording, boxOpen,
  })
  live.current = {
    takes, chosenId, cameraLanguage, objectPrompt, refs, mainText,
    genMode, generating, recording, boxOpen,
  }

  const toastTimer = useRef(0)
  const toast = useCallback((m: string) => {
    setToastMsg(m)
    clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600)
  }, [])

  const dict = useDictation(toast)

  const setObjectPrompt = useCallback((v: string) => {
    setObjectPromptState(v)
    localStorage.setItem('blocking-object-v1', v)
  }, [])

  // ------------------------------------------------------------ cube toolbox
  const cubeBoxRef = useRef<HTMLDivElement>(null)
  const cubeTextRef = useRef<HTMLTextAreaElement>(null)
  const openCubeBox = useCallback((open: boolean) => {
    setBoxOpen(open)
    stageRef.current?.setCubeGlow(open)
    if (open) {
      setCubeText(live.current.objectPrompt)
      setTimeout(() => cubeTextRef.current?.focus(), 0)
    }
  }, [])
  const confirmCubeBox = useCallback(() => {
    const v = (cubeTextRef.current?.value ?? '').trim()
    setObjectPrompt(v)
    openCubeBox(false)
    toast(v ? 'Object attached to the main prompt' : 'Object cleared')
  }, [openCubeBox, setObjectPrompt, toast])

  // toolbox sticks to the cube while open
  useEffect(() => {
    if (!boxOpen) return
    let raf = 0
    const tick = () => {
      const el = cubeBoxRef.current
      const stage = stageRef.current
      if (el && stage) {
        const [x, y] = stage.cubeScreenPos(1.1)
        el.style.left = `${Math.min(innerWidth - 270, Math.max(10, x + 28))}px`
        el.style.top = `${Math.min(innerHeight - 190, Math.max(10, y - 70))}px`
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [boxOpen])

  // ------------------------------------------------------------ camera view + record flow
  const setSimActive = useCallback((on: boolean) => {
    setSimMode(on)
    stageRef.current?.setSim(on)
    if (on) toast('Fly: WASD move · Q/Z up/down · arrows look')
  }, [toast])

  const enterCamView = useCallback((on: boolean) => {
    setSwapped(on)
    stageRef.current?.setSwapped(on)
    setSimActive(on)
    if (on) openCubeBox(false)
  }, [openCubeBox, setSimActive])

  const wsSend = useCallback((obj: unknown) => {
    const s = wsRef.current
    if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify(obj))
  }, [])

  const cdTimer = useRef(0)
  const stopRec = useCallback(() => {
    if (!live.current.recording) return
    const frames = stageRef.current!.stopRecording()
    setRecording(false)
    wsSend({ type: 'recState', on: false })
    enterCamView(false)
    if (frames.length > 5) {
      const dur = frames[frames.length - 1].t / 1000
      const take: Take = {
        id: Date.now(), name: `Take ${live.current.takes.length + 1}`,
        dur, raw: frames, frames, smooth: 0,
      }
      setTakes((ts) => [...ts, take])
      setChosenId(take.id)
      toast(`${take.name} saved — ${dur.toFixed(1)}s`)
    }
  }, [enterCamView, toast, wsSend])

  // record flow: jump into the film camera (the phone is the camera token),
  // count down 3-2-1 center screen, then roll until the director stops
  const startRecordFlow = useCallback((on: boolean) => {
    if (!on) {
      if (cdTimer.current) {
        clearTimeout(cdTimer.current)
        cdTimer.current = 0
        setCountdown(null)
        enterCamView(false)
        return
      }
      stopRec()
      return
    }
    if (live.current.recording || cdTimer.current) return
    enterCamView(true)
    let n = 3
    const tick = () => {
      if (n === 0) {
        setCountdown(null)
        cdTimer.current = 0
        setRecSec(0)
        setRecording(true)
        stageRef.current!.startRecording()
        wsSend({ type: 'recState', on: true })
        return
      }
      setCountdown(n)
      n--
      cdTimer.current = window.setTimeout(tick, 800)
    }
    tick()
  }, [enterCamView, stopRec, wsSend])
  const recordFlowRef = useRef(startRecordFlow)
  recordFlowRef.current = startRecordFlow
  const stopRecRef = useRef(stopRec)
  stopRecRef.current = stopRec

  // ------------------------------------------------------------ stage lifecycle
  useEffect(() => {
    const stage = createStage(viewRef.current!, {
      onCubeClick: () => openCubeBox(true),
      onEmptyClick: () => openCubeBox(false),
      onLockedClick: () => toast('Editing is locked while flying — exit Camera view / Fly controls first'),
      onHoverCube: () => {},
      onRecTick: (s) => setRecSec(Math.round(s * 10) / 10),
      onRecLimit: () => stopRecRef.current(),
      onCalibrated: () => toast('Camera zeroed — you are at the mark'),
    })
    stageRef.current = stage
    return () => { stage.dispose(); stageRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') openCubeBox(false) }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [openCubeBox])

  // ------------------------------------------------------------ websocket
  useEffect(() => {
    let closed = false
    let sock: WebSocket
    const connect = () => {
      sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
      wsRef.current = sock
      sock.onopen = () => sock.send(JSON.stringify({ type: 'hello', role: 'director' }))
      sock.onclose = () => {
        setPhoneConn(false)
        if (!closed) setTimeout(connect, 1500)
      }
      sock.onmessage = (ev) => {
        let m: any
        try { m = JSON.parse(ev.data) } catch { return }
        if (m.type === 'presence') setPhoneConn(m.roles.includes('camera'))
        else if (m.type === 'genState' && live.current.generating) {
          setGenStatus(m.status === 'IN_QUEUE'
            ? `In queue${m.position != null ? ` #${m.position}` : ''}…`
            : 'Rendering on fal…')
        }
        else if (m.type === 'pose') stageRef.current?.onPhonePose(m)
        else if (m.type === 'record') recordFlowRef.current(m.on)
        else if (m.type === 'rezero') stageRef.current?.rezero()
      }
    }
    connect()
    return () => { closed = true; sock?.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------ config / status pills
  const refreshConfig = useCallback(async (announce: boolean) => {
    let fal = false
    let kling = false
    try {
      const c = await fetch('/api/config').then((r) => r.json())
      fal = Boolean(c.falKeySet)
      kling = Boolean(c.klingKeySet)
    } catch { /* server unreachable — stay off */ }
    setFalReady(fal)
    setKlingReady(kling)
    if (announce) {
      toast(fal
        ? 'fal key loaded — ready to generate'
        : 'FAL_KEY not set — add FAL_KEY=… to a .env file and restart the server')
    }
  }, [toast])
  useEffect(() => { refreshConfig(false) }, [refreshConfig])

  // ------------------------------------------------------------ camera language
  useEffect(() => {
    setCameraLanguage(null)
    const take = live.current.takes.find((t) => t.id === chosenId)
    if (!take) return
    let stale = false
    fetch('/api/camera-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: take.frames }),
    })
      .then(async (r) => ({ ok: r.ok, out: await r.json() }))
      .then(({ ok, out }) => { if (!stale && ok) setCameraLanguage(out) })
      .catch(console.error)
    return () => { stale = true }
  }, [chosenId, langNonce])

  // ------------------------------------------------------------ generate
  const composePrompt = useCallback(() => {
    const parts: string[] = []
    if (live.current.objectPrompt.trim()) parts.push(`Main object: ${live.current.objectPrompt.trim()}`)
    parts.push(live.current.mainText.trim() || DEFAULT_PROMPT)
    return parts.join('. ')
  }, [])

  const generate = useCallback(async (promptOverride?: string) => {
    if (live.current.generating) { toast('Already generating…'); return }
    const take = live.current.takes.find((t) => t.id === live.current.chosenId)
    if (!take) { toast('Record a camera take first — the motion is part of the prompt'); return }
    let prompt = promptOverride || composePrompt()
    if (live.current.genMode === 'beautiful' && live.current.cameraLanguage?.camera_prompt) {
      prompt += ` Camera: ${live.current.cameraLanguage.camera_prompt}`
    }
    setGenerating(true)
    live.current.generating = true
    setGenStatus('Rendering previz…')
    try {
      await new Promise((r) => setTimeout(r, 30)) // let the status paint
      const frames = stageRef.current!.renderDepthFrames(take)
      setGenStatus('Generating… (~1–3 min)')
      toast('Depth previz uploaded — fal is dreaming')
      const resp = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames, prompt, fps: 16, mode: live.current.genMode, refs: live.current.refs }),
      })
      const out = await resp.json()
      if (!resp.ok) throw new Error(out.error || resp.statusText)
      setResult({ out, prompt })
      return out
    } catch (err: any) {
      console.error(err)
      toast(`Generation failed: ${err.message}`)
    } finally {
      setGenerating(false)
      live.current.generating = false
      setGenStatus(null)
    }
  }, [composePrompt, toast])

  const coverage = useCallback(async () => {
    if (live.current.generating) { toast('Already generating…'); return }
    const stage = stageRef.current!
    const rig = stage.coverageRig()
    const basePrompt = composePrompt()
    setGenerating(true)
    live.current.generating = true
    setCovStatus('Rendering rig…')
    try {
      await new Promise((r) => setTimeout(r, 30))
      const renders = rig.map((angle) => ({ angle, frames: stage.renderDepthFramesFrom(angle.poseAt) }))
      setCovStatus(`Generating ${rig.length} angles…`)
      toast(`Coverage: ${rig.map((a) => a.key).join(' · ')}`)
      const results = await Promise.all(renders.map(({ angle, frames }) =>
        fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frames, prompt: `${basePrompt}, ${angle.hint}`, fps: 16 }),
        }).then(async (r) => {
          const out = await r.json()
          if (!r.ok) throw new Error(`${angle.key}: ${out.error || r.statusText}`)
          return { key: angle.key, ...out }
        }),
      ))
      setCovStatus('Cutting…')
      const cut = await fetch('/api/multicut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: results.map((r) => r.id) }),
      }).then((r) => r.json())
      if (cut.error) throw new Error(cut.error)
      setResult({
        out: { control: results[0].control, local: cut.result },
        prompt: `${basePrompt} — multicam cut (${results.length} angles)`,
      })
      toast('Coverage cut ready — every angle is in the dailies too')
    } catch (err: any) {
      console.error(err)
      toast(`Coverage failed: ${err.message}`)
    } finally {
      setGenerating(false)
      live.current.generating = false
      setCovStatus(null)
    }
  }, [composePrompt, toast])

  const doSend = useCallback(() => {
    if (live.current.generating) { toast('Already generating…'); return }
    if (!live.current.takes.find((t) => t.id === live.current.chosenId)) {
      toast('Record a camera take first — the motion is part of the prompt')
      return
    }
    generate()
  }, [generate, toast])

  // ------------------------------------------------------------ curve editing
  // moving the smooth dial resets hand edits (they were sampled from the
  // previous smoothing); dragging a handle keeps the current smoothing
  const applySmooth = useCallback((v: number) => {
    setTakes((ts) => ts.map((t) =>
      t.id === live.current.chosenId
        ? { ...t, smooth: v, frames: smoothFrames(t.raw, v), ctrl: undefined, editedCh: undefined }
        : t,
    ))
  }, [])

  const editPoint = useCallback((ch: number, idx: number, v: number) => {
    setTakes((ts) => ts.map((t) => {
      if (t.id !== live.current.chosenId) return t
      const base = smoothFrames(t.raw, t.smooth)
      const ctrl = t.ctrl ?? initCtrl(base)
      const c2 = ctrl.map((arr, c) => (c === ch ? arr.map((p, i) => (i === idx ? { ...p, v } : p)) : arr))
      const editedCh = [...(t.editedCh ?? [false, false, false])]
      editedCh[ch] = true
      return { ...t, ctrl: c2, editedCh, frames: applyCtrl(base, c2, editedCh) }
    }))
  }, [])

  const resetEdits = useCallback(() => {
    setTakes((ts) => ts.map((t) =>
      t.id === live.current.chosenId
        ? { ...t, ctrl: undefined, editedCh: undefined, frames: smoothFrames(t.raw, t.smooth) }
        : t,
    ))
    setLangNonce((n) => n + 1)
  }, [])

  // ------------------------------------------------------------ refs (images)
  const fileRef = useRef<HTMLInputElement>(null)
  const onFiles = useCallback((files: FileList | null) => {
    if (!files) return
    for (const f of files) {
      const fr = new FileReader()
      fr.onload = () => setRefs((r) => [...r, fr.result as string])
      fr.readAsDataURL(f)
    }
  }, [])

  // ------------------------------------------------------------ debug hooks (scripted tests)
  useEffect(() => {
    ;(window as any).__blocking = {
      takes: () => live.current.takes,
      cubeBoxOpen: () => live.current.boxOpen,
      cubeScreenPos: () => stageRef.current?.cubeScreenPos(),
      objectPrompt: () => live.current.objectPrompt,
      setObject: (s: string) => setObjectPrompt(s),
      composePrompt,
      generate,
      coverage,
      refs: live.current.refs,
      cameraLanguage: () => live.current.cameraLanguage,
      renderDepthFramesFrom: (poseAt: any, n?: number) => stageRef.current?.renderDepthFramesFrom(poseAt, n),
    }
  })

  // ------------------------------------------------------------ render
  const chosenTake = takes.find((t) => t.id === chosenId) ?? null
  const recLabel = countdown !== null
    ? 'Get ready…'
    : recording ? `Stop · ${recSec.toFixed(1)}s` : 'Start recording'
  const hasAttachments = Boolean(objectPrompt) || Boolean(chosenTake) || refs.length > 0

  return (
    <>
      <div id="view" ref={viewRef} />

      <div className="bar" id="topbar">
        <div id="takesWrap">
          {takes.map((t) => (
            <div key={t.id} className={`take${t.id === chosenId ? ' chosen' : ''}`}>
              <span className="nm">{t.name}</span>
              <span className="dur">{t.dur.toFixed(1)}s</span>
              <button title="Play this take" onClick={() => stageRef.current?.playTake(t)}><Play className="icon" /></button>
              <button title="Use this take as the motion" onClick={() => setChosenId(t.id)}><Check className="icon" /></button>
              <button title="Delete this take" onClick={() => {
                setTakes((ts) => ts.filter((x) => x.id !== t.id))
                if (chosenId === t.id) {
                  const rest = takes.filter((x) => x.id !== t.id)
                  setChosenId(rest.length ? rest[rest.length - 1].id : null)
                }
              }}><X className="icon" /></button>
            </div>
          ))}
        </div>
        <button className={`statTgl${phoneConn ? ' on' : ''}`} id="phoneTgl" title="Click to pair your phone"
          onClick={() => setPairOpen(true)}>
          <i className={`dot${phoneConn ? ' on' : ''}`} id="dotPhone" />phone
          <span className="st" id="phoneState">{phoneConn ? 'connected' : 'not connected'}</span>
        </button>
        <button className={`statTgl${falReady ? ' on' : ''}`} id="falTgl" title="Click to re-check the fal key"
          onClick={() => refreshConfig(true)}>
          <i className={`dot${falReady ? ' on' : ''}`} id="dotFal" />fal
          <span className="st" id="falState">{falReady ? 'ready' : 'no key'}</span>
        </button>
        {klingReady && (
          <button className="statTgl on" id="klingTgl" title="Kling key loaded — Beautiful mode runs Kling">
            <i className="dot on" />kling<span className="st">ready</span>
          </button>
        )}
      </div>

      <div className="island" id="tools">
        <h3>CAMERA</h3>
        <button id="camViewBtn" className={swapped ? 'active' : ''}
          title="See through the film camera and fly it with the keys"
          onClick={() => enterCamView(!swapped)}>
          <Video className="icon" />Camera view
        </button>
        <button id="simBtn" className={simMode ? 'active' : ''}
          title="Fly the camera with WASD/QZ + arrow keys"
          onClick={() => setSimActive(!simMode)}>
          <Gamepad2 className="icon" />Fly controls
        </button>
        <button id="pairBtn" onClick={() => setPairOpen(true)}>
          <Smartphone className="icon" />Pair phone
        </button>
        <button id="rezeroBtn" title="Re-anchor the phone camera to its start mark"
          onClick={() => stageRef.current?.rezero()}>
          <Crosshair className="icon" />Re-zero
        </button>
        <div className="hint">click the cube to define<br />the main object</div>
      </div>

      <div className="island" id="shotPanel">
        <h3>SHOT</h3>
        <button id="recBtn" className={recording ? 'rec' : ''}
          title="Record the camera move as a take (phone or fly controls), up to 30s"
          onClick={() => startRecordFlow(!(recording || countdown !== null))}>
          <Disc className="icon" /><span id="recLabel">{recLabel}</span>
        </button>
        <div id="modeRow">
          <button id="modeExact" className={genMode === 'exact' ? 'active' : ''}
            title="Depth-constrained (Wan VACE): follows your camera frame-for-frame"
            onClick={() => setGenMode('exact')}>Exact</button>
          <button id="modeBeautiful" className={genMode === 'beautiful' ? 'active' : ''}
            title="Camera language on a frontier model: follows the intent of your move"
            onClick={() => setGenMode('beautiful')}>Beautiful</button>
        </div>
        <button id="covBtn" style={{ width: '100%', marginTop: 6 }}
          title="Generate wide / insert / arc from this blocking, plus an automatic multicam cut"
          onClick={coverage}>
          <Film className="icon" /><span id="covLabel">{covStatus ?? 'Coverage'}</span>
        </button>
      </div>

      {chosenTake && !swapped && !recording && (
        <CurvePanel
          take={chosenTake}
          onSmooth={applySmooth}
          onEditPoint={editPoint}
          onResetEdits={resetEdits}
          onCommit={() => setLangNonce((n) => n + 1)}
        />
      )}

      <div id="promptBar">
        <div id="attachRow" className={hasAttachments ? 'has' : ''}>
          {objectPrompt && (
            <div className="attach" style={{ cursor: 'pointer' }} onClick={() => openCubeBox(true)}>
              <Box className="icon" /><span className="txt">{objectPrompt}</span>
              <button title="Remove" onClick={(e) => { e.stopPropagation(); setObjectPrompt('') }}><X className="icon" /></button>
            </div>
          )}
          {chosenTake && (
            <div className="attach">
              <Video className="icon" />
              <span className="txt">{cameraLanguage?.move_name ?? `${chosenTake.name} · ${chosenTake.dur.toFixed(1)}s`}</span>
              <button title="Remove" onClick={() => setChosenId(null)}><X className="icon" /></button>
            </div>
          )}
          {refs.map((src, i) => (
            <div key={i} className="attach">
              <img src={src} alt="" />
              <button title="Remove" onClick={() => setRefs((r) => r.filter((_, j) => j !== i))}><X className="icon" /></button>
            </div>
          ))}
        </div>
        <div id="promptRow">
          <input
            id="promptInput" type="text" autoComplete="off" spellCheck={false}
            placeholder={genStatus ?? PROMPT_PLACEHOLDER}
            disabled={generating}
            value={mainText}
            onChange={(e) => setMainText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSend()
              if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
            }}
          />
          <button id="refBtn" title="Add reference images for the shot atmosphere" onClick={() => fileRef.current?.click()}>
            <ImageIcon className="icon" />
          </button>
          <button id="promptMic" className={dict.active === 'main' ? 'listening' : ''} title="Dictate"
            onClick={() => dict.toggle('main', () => live.current.mainText, setMainText)}>
            {dict.active === 'main' ? <Square className="icon" /> : <Mic className="icon" />}
          </button>
          <button id="promptSend" title="Generate the shot" disabled={generating} onClick={doSend}>
            <Send className="icon" />
          </button>
        </div>
        <input ref={fileRef} id="refFile" type="file" accept="image/*" multiple hidden
          onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
      </div>

      {boxOpen && (
        <div id="cubeBox" ref={cubeBoxRef}>
          <h3>MAIN OBJECT</h3>
          <textarea
            id="cubePrompt" ref={cubeTextRef} placeholder="What is this object? Speak or type…"
            value={cubeText}
            onChange={(e) => setCubeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') openCubeBox(false)
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmCubeBox() }
            }}
          />
          <div id="cubeRow">
            <button id="cubeMic" className={dict.active === 'cube' ? 'listening' : ''} title="Dictate"
              onClick={() => dict.toggle('cube', () => cubeTextRef.current?.value ?? '', setCubeText)}>
              {dict.active === 'cube' ? <Square className="icon" /> : <Mic className="icon" />}
            </button>
            <button id="cubeOk" title="Attach to the main prompt" onClick={confirmCubeBox}>
              <Check className="icon" />
            </button>
          </div>
        </div>
      )}

      {countdown !== null && (
        <div id="countdown"><b key={countdown}>{countdown}</b></div>
      )}

      {pairOpen && <PairModal onClose={() => setPairOpen(false)} />}
      {result && <ResultModal out={result.out} prompt={result.prompt} onClose={() => setResult(null)} />}

      <div id="toast" className={toastMsg ? 'show' : ''}>{toastMsg}</div>
    </>
  )
}
