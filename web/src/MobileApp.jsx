import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Check, Crosshair, Folder, Image as ImageIcon, Mic, Send, Smartphone, Square, Video, X } from 'lucide-react'
import { createMobileEngine } from './mobileEngine.js'
import { cameraLanguage, generateShot, getConfig, uploadRef } from './api.js'
import { useVoice } from './useVoice.js'

const STORE_KEY = 'blocking-mobile-v1'
const DEFAULT_PROMPT = 'A sculptural object on the concrete floor of an empty studio, '
  + 'dramatic side light, haze, cinematic 35mm film'

function loadShot() {
  const shot = { object: '', look: '', refs: [] }
  try { Object.assign(shot, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')) } catch { /* fresh */ }
  return shot
}

export default function MobileApp() {
  const stageRef = useRef(null)
  const engineRef = useRef(null)
  const takeRef = useRef(null)

  const [shot, setShot] = useState(loadShot)
  const [takeMeta, setTakeMeta] = useState(null)
  const [camLang, setCamLang] = useState(null)
  const [mode, setMode] = useState('exact')
  const [detail, setDetail] = useState(true)
  const [motionOn, setMotionOn] = useState(false)
  const [rec, setRec] = useState({ on: false, elapsed: 0 })
  const [countdown, setCountdown] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [queue, setQueue] = useState({ jobs: [], at: 0 })
  const [falOn, setFalOn] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetText, setSheetText] = useState('')
  const [result, setResult] = useState(null)
  const [dailies, setDailies] = useState(null) // null=closed, array=open
  const [toast, setToast] = useState(null)

  const sayRef = useRef(null)
  const say = useCallback((msg, dur) => setToast({ msg, key: Date.now(), dur }), [])
  sayRef.current = say
  const recRef = useRef(false)
  const cdTimer = useRef(0)
  const generatingRef = useRef(false)
  useEffect(() => { recRef.current = rec.on }, [rec.on])
  useEffect(() => { generatingRef.current = generating }, [generating])

  const voice = useVoice()

  const onTakeSaved = useCallback(async (take) => {
    takeRef.current = take
    setTakeMeta({ dur: take.dur })
    setCamLang({ move_name: 'reading the move…' })
    say(`Move captured — ${take.dur.toFixed(1)}s`)
    try {
      setCamLang(await cameraLanguage(take.frames))
    } catch {
      setCamLang({ move_name: 'performed move', camera_prompt: '' })
    }
  }, [say])

  // ---------------------------------------------------------------- engine
  useEffect(() => {
    const engine = createMobileEngine(stageRef.current, {
      onCubeTap: () => setSheetOpen(true),
      onTakeSaved,
      onRecording: setRec,
      onToast: (m) => sayRef.current(m),
    })
    engineRef.current = engine
    return () => engine.dispose()
  }, [onTakeSaved])

  useEffect(() => { engineRef.current?.setCubeFilled(Boolean(shot.object)) }, [shot.object])
  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(shot)) }, [shot])

  // ---------------------------------------------------------------- ws (progress)
  useEffect(() => {
    let closed = false
    let sock
    const connect = () => {
      sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
      sock.onopen = () => sock.send(JSON.stringify({ type: 'hello', role: 'director' }))
      sock.onclose = () => { if (!closed) setTimeout(connect, 1500) }
      sock.onmessage = (ev) => {
        let m
        try { m = JSON.parse(ev.data) } catch { return }
        if (m.type === 'genQueue') setQueue({ jobs: m.jobs, at: Date.now() })
        else if (m.type === 'genDone' && !generatingRef.current) sayRef.current('Shot finished — in Dailies', 4000)
      }
    }
    connect()
    return () => { closed = true; sock?.close() }
  }, [])

  // tick elapsed while a job is in flight
  const [, force] = useState(0)
  useEffect(() => {
    if (!queue.jobs.length) return undefined
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [queue.jobs.length])

  // ---------------------------------------------------------------- config
  useEffect(() => {
    const check = () => getConfig().then((c) => setFalOn(Boolean(c.falKeySet))).catch(() => {})
    check()
    addEventListener('focus', check)
    return () => removeEventListener('focus', check)
  }, [])

  // ---------------------------------------------------------------- motion
  const toggleMotion = useCallback(async () => {
    const next = !motionOn
    if (next && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      try {
        const res = await DeviceOrientationEvent.requestPermission()
        if (res !== 'granted') { say('Motion permission denied'); return }
      } catch { say('Motion unavailable'); return }
    }
    setMotionOn(next)
    engineRef.current?.setMotion(next)
    say(next ? 'Move the phone to aim the shot · tap ⌖ to recenter' : 'Drag to orbit · pinch to push in')
  }, [motionOn, say])

  // ---------------------------------------------------------------- record flow
  const startRecordFlow = useCallback(() => {
    if (recRef.current) { engineRef.current.stopRecording(); return }
    if (cdTimer.current) return
    let n = 3
    const tick = () => {
      if (n === 0) {
        setCountdown(null)
        cdTimer.current = 0
        engineRef.current.startRecording()
        return
      }
      setCountdown(n)
      n--
      cdTimer.current = window.setTimeout(tick, 750)
    }
    tick()
  }, [])

  // ---------------------------------------------------------------- generate
  const composePrompt = useCallback(() => {
    const parts = []
    if (shot.object) parts.push(`Main object: ${shot.object}`)
    if (shot.look) parts.push(shot.look)
    let prompt = parts.join('. ') || DEFAULT_PROMPT
    if (mode === 'beautiful' && camLang?.camera_prompt) prompt += ` Camera: ${camLang.camera_prompt}`
    return prompt
  }, [shot, mode, camLang])

  const generate = useCallback(async () => {
    if (generating) return say('Already generating…')
    const take = takeRef.current
    if (!take) return say('Record a camera move first')
    const prompt = composePrompt()
    setGenerating(true)
    say('Rendering previz…')
    try {
      await new Promise((r) => setTimeout(r, 30))
      const frames = engineRef.current.renderDepthFrames(take)
      say('Sent to fal — this takes a couple of minutes')
      const out = await generateShot({
        frames, prompt, fps: 16, mode, aspect: '9:16',
        detail: mode === 'exact' && detail,
        refs: shot.refs.map((r) => r.url),
      })
      setResult({ control: out.control, url: out.local || out.video?.url, prompt, id: out.id, mode })
    } catch (err) {
      say(`Failed: ${err.message}`, 7000)
    } finally {
      setGenerating(false)
    }
  }, [generating, composePrompt, mode, detail, shot.refs, say])

  const again = useCallback(async () => {
    if (generating || !result?.id) return
    setGenerating(true)
    setResult(null)
    say('New seed rolling — progress below')
    try {
      const out = await generateShot({
        controlOf: result.id, prompt: result.prompt, fps: 16, aspect: '9:16',
        mode: result.mode || 'exact',
        detail: (result.mode || 'exact') === 'exact' && detail,
        refs: shot.refs.map((r) => r.url),
      })
      setResult({ control: out.control, url: out.local || out.video?.url, prompt: result.prompt, id: out.id, mode: result.mode })
    } catch (err) {
      say(`Failed: ${err.message}`, 7000)
    } finally {
      setGenerating(false)
    }
  }, [generating, result, detail, shot.refs, say])

  // ---------------------------------------------------------------- refs
  const fileRef = useRef(null)
  const addFiles = async (files) => {
    for (const f of files) {
      const dataUrl = await new Promise((res) => {
        const fr = new FileReader()
        fr.onload = () => res(fr.result)
        fr.readAsDataURL(f)
      })
      say(`Uploading ${f.name}…`)
      try {
        const out = await uploadRef(dataUrl, f.name)
        setShot((s) => ({ ...s, refs: [...s.refs, { url: out.url, name: f.name }] }))
      } catch (err) { say(`Upload failed: ${err.message}`) }
    }
  }

  const openDailies = useCallback(() => {
    setDailies([])
    fetch('/api/sessions').then((r) => r.json()).then(setDailies).catch(() => setDailies([]))
  }, [])

  const canSend = Boolean(takeMeta) && Boolean(shot.object || shot.look) && !generating && falOn !== false
  const showHint = !shot.object && !takeMeta && !sheetOpen

  return (
    <>
      <div id="stage" ref={stageRef} />
      <div className="scrim top" />
      <div className="scrim bot" />

      {showHint && <div id="hint">Tap the cube to say what it is,<br />then hold ⬤ and move the shot.</div>}

      <div id="topbar">
        <div className="wordmark">BLOCK<span>ING</span></div>
        <div className="grow" />
        <div className="pill"><i className={`dot${falOn ? ' on' : ''}`} />{falOn ? 'fal' : falOn === false ? 'no key' : '…'}</div>
        <button className="iconbtn" title="Dailies" onClick={openDailies}><Folder /></button>
      </div>

      {countdown !== null && <div id="countdown"><b key={countdown}>{countdown}</b></div>}

      {queue.jobs.length > 0 && <GenCard queue={queue} />}

      <div id="dock">
        <div id="chips">
          {shot.object && (
            <div className="chip obj" onClick={() => setSheetOpen(true)}>
              <span className="ico"><Box /></span>
              <span className="txt">{shot.object}</span>
              <span className="x" onClick={(e) => { e.stopPropagation(); setShot((s) => ({ ...s, object: '' })) }}><X /></span>
            </div>
          )}
          {takeMeta && (
            <div className="chip motion" onClick={() => takeRef.current && engineRef.current.playTake(takeRef.current)}>
              <span className="ico"><Video /></span>
              <span className="txt">{camLang?.move_name || 'performed move'} · {takeMeta.dur.toFixed(1)}s</span>
              <span className="x" onClick={(e) => { e.stopPropagation(); takeRef.current = null; setTakeMeta(null); setCamLang(null) }}><X /></span>
            </div>
          )}
          {shot.refs.map((ref) => (
            <div className={`chip${mode === 'beautiful' ? ' inactive' : ''}`} key={ref.url}>
              <img src={ref.url} alt={ref.name} />
              <span className="x" onClick={() => setShot((s) => ({ ...s, refs: s.refs.filter((r) => r !== ref) }))}><X /></span>
            </div>
          ))}
        </div>

        {rec.on && <div id="recStatus">● REC · {rec.elapsed.toFixed(1)}s — tap ⬤ to stop</div>}

        <div id="promptRow">
          <input
            id="lookInput"
            placeholder="Describe the look & atmosphere…"
            value={shot.look}
            onChange={(e) => setShot((s) => ({ ...s, look: e.target.value }))}
          />
          <button className="round" title="Reference image" onClick={() => fileRef.current.click()}><ImageIcon /></button>
          <button
            className={`round${voice.listening ? ' listening' : ''}`} title="Say the look"
            onClick={() => voice.start((t) => (t ? setShot((s) => ({ ...s, look: t })) : say('Didn’t catch that')))}
          >{voice.listening ? <Square /> : <Mic />}</button>
        </div>

        <div id="ctrlRow">
          <div id="modeSeg">
            <button className={mode === 'exact' ? 'active' : ''} onClick={() => setMode('exact')}>Exact</button>
            <button className={mode === 'beautiful' ? 'active' : ''} onClick={() => setMode('beautiful')}>Beautiful</button>
          </div>
          <button
            id="motionBtn" className={motionOn ? 'on' : ''}
            title={motionOn ? 'Switch back to drag' : 'Aim by moving the phone'}
            onClick={toggleMotion}
          ><Smartphone />{motionOn ? 'Drag' : 'Move'}</button>
          {motionOn && (
            <button className="ctrlBtn" title="Recenter the aim" onClick={() => engineRef.current.recenterMotion()}><Crosshair /></button>
          )}
          {mode === 'exact' && (
            <button
              className={`ctrlBtn wide${detail ? ' on' : ''}`}
              title="2-pass detail: turns the cube into a real object (slower, ~2.5× cost)"
              onClick={() => setDetail((d) => !d)}
            >2-pass</button>
          )}
        </div>

        <div id="actionRow">
          <span className="side" />
          <button id="recBtn" className={rec.on ? 'rec' : ''} disabled={countdown !== null} onClick={startRecordFlow}><i /></button>
          <button id="sendBtn" disabled={!canSend} onClick={generate}><Send /></button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }} />

      {sheetOpen && (
        <ObjectSheet
          initial={shot.object}
          voice={voice}
          say={say}
          onClose={() => setSheetOpen(false)}
          onConfirm={(text) => { setShot((s) => ({ ...s, object: text })); setSheetOpen(false); if (text) say('Object attached') }}
        />
      )}

      {result && <ResultView result={result} onAgain={result.mode !== 'coverage' && !generating ? again : null} onClose={() => setResult(null)} />}
      {dailies !== null && <DailiesView items={dailies} onOpen={(it) => { setResult({ control: it.control || it.result, url: it.result, prompt: it.prompt || it.id, id: it.id, mode: it.mode }); setDailies(null) }} onClose={() => setDailies(null)} />}

      <Toast toast={toast} />
    </>
  )
}

function GenCard({ queue }) {
  const j = queue.jobs[0]
  const drift = (Date.now() - queue.at) / 1000
  const s = Math.max(0, Math.floor(j.secs + drift))
  const failed = j.status === 'FAILED'
  return (
    <div id="gen" className={failed ? 'failed' : ''}>
      <div className="row">
        <i className="pulse" />
        <span>{failed ? 'Failed' : j.label || (j.status === 'IN_QUEUE' ? 'In queue' : 'Rendering on fal…')}</span>
        {!failed && j.position != null && <span className="q">#{j.position}</span>}
        <span className="el">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
      </div>
      <div className="track"><div className="fill" /></div>
    </div>
  )
}

function ObjectSheet({ initial, voice, say, onClose, onConfirm }) {
  const [text, setText] = useState(initial)
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheetCard" onClick={(e) => e.stopPropagation()}>
        <h3>WHAT IS THIS OBJECT?</h3>
        <textarea
          autoFocus value={text}
          placeholder="e.g. a vintage red motorcycle, chrome tank, worn leather seat"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row">
          <button
            className={`round${voice.listening ? ' listening' : ''}`}
            onClick={() => voice.start((t) => (t ? setText(t) : say('Didn’t catch that')))}
          >{voice.listening ? <Square /> : <Mic />}</button>
          <button className="ok" onClick={() => onConfirm(text.trim())}>Attach to shot</button>
        </div>
      </div>
    </div>
  )
}

function ResultView({ result, onAgain, onClose }) {
  const controlRef = useRef(null)
  const resultRef = useRef(null)
  useEffect(() => {
    const vc = controlRef.current
    const vr = resultRef.current
    Promise.all([vc?.play(), vr?.play()]).catch(() => {})
  }, [result])
  const remote = result.url && !result.url.startsWith('/')
  return (
    <div className="full">
      <div className="head"><h3>GENERATED</h3><button className="iconbtn" onClick={onClose}><X /></button></div>
      <div className="body">
        <figure>
          <figcaption>GENERATED — YOUR SHOT</figcaption>
          <video ref={resultRef} src={result.url} muted loop playsInline />
        </figure>
        <figure>
          <figcaption>PREVIZ — THE MOVE YOU PERFORMED</figcaption>
          <video ref={controlRef} src={result.control} muted loop playsInline />
        </figure>
      </div>
      <div className="foot">
        {onAgain && <button onClick={onAgain}>↻ Again</button>}
        {result.url && <a className="primary" href={result.url} download target={remote ? '_blank' : undefined} rel="noreferrer" style={{ flex: 1, height: 48, borderRadius: 12, display: 'grid', placeItems: 'center', fontWeight: 700, color: '#191307', background: 'var(--accent)' }}>Save</a>}
      </div>
    </div>
  )
}

function DailiesView({ items, onOpen, onClose }) {
  return (
    <div className="full">
      <div className="head"><h3>DAILIES</h3><button className="iconbtn" onClick={onClose}><X /></button></div>
      <div className="body">
        {items === null && <div className="empty">loading…</div>}
        {items?.length === 0 && <div className="empty">Nothing yet — perform your first shot.</div>}
        {items?.map((it) => (
          <div className="daily" key={it.id} onClick={() => onOpen(it)}>
            <video src={it.result} muted loop playsInline preload="metadata"
              onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} />
            <div className="meta">
              <span className={`badge ${it.mode}`}>{it.mode}</span>
              <span className="p">{it.prompt || it.id}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
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
