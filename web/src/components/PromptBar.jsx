import React, { useRef } from 'react'
import { useVoice } from '../useVoice.js'
import { uploadRef } from '../api.js'

// The main prompt, ChatGPT-style: attachments (object, motion, reference
// stills) + one look line + send. Below, the live generation queue.
export default function PromptBar({
  shot, setShot, takeMeta, camLang, onPlayTake, onClearTake, onEditObject,
  mode, setMode, detail, setDetail, canSend, canCoverage, generating, onSend, onCoverage, queue, say,
}) {
  const fileRef = useRef(null)
  const voice = useVoice()

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
      } catch (err) {
        say(`Upload failed: ${err.message}`)
      }
    }
  }

  return (
    <div id="promptBar">
      <div id="chips">
        {shot.object && (
          <span className="chip obj" title="The object — click to edit" onClick={onEditObject}>
            <span className="ico">⬛</span>
            <span className="txt">{shot.object}</span>
            <span className="x" onClick={(e) => { e.stopPropagation(); setShot((s) => ({ ...s, object: '' })) }}>✕</span>
          </span>
        )}
        {takeMeta && (
          <span
            className="chip motion"
            title={camLang?.camera_prompt || 'The performed camera move — click to replay'}
            onClick={onPlayTake}
          >
            <span className="ico">📷</span>
            <span className="txt">{camLang?.move_name || 'performed move'} · {takeMeta.dur.toFixed(1)}s</span>
            <span className="x" onClick={(e) => { e.stopPropagation(); onClearTake() }}>✕</span>
          </span>
        )}
        {shot.refs.map((ref) => (
          <span
            className={`chip ref${mode === 'beautiful' ? ' inactive' : ''}`}
            key={ref.url}
            title={mode === 'beautiful' ? `${ref.name} — references only apply in Exact mode` : ref.name}
          >
            <img src={ref.url} alt={ref.name} />
            <span className="x" onClick={() => setShot((s) => ({ ...s, refs: s.refs.filter((r) => r !== ref) }))}>✕</span>
          </span>
        ))}
      </div>
      <div className="inrow">
        <button
          className={`iconbtn ${voice.listening ? 'listening' : ''}`}
          title="Say the look"
          onClick={() => voice.start((t) => (t ? setShot((s) => ({ ...s, look: t })) : say('Didn’t catch that — mic blocked or silent')))}
        >{voice.listening ? '●' : '🎙'}</button>
        <input
          id="lookInput"
          value={shot.look}
          placeholder="Describe the shot look & atmosphere…"
          onChange={(e) => setShot((s) => ({ ...s, look: e.target.value }))}
        />
        <button className="iconbtn" title="Add reference images for the atmosphere" onClick={() => fileRef.current.click()}>🖼</button>
        <input
          ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
          onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }}
        />
        <div id="modeRow">
          <button
            className={mode === 'exact' ? 'active' : ''}
            title="Depth-constrained (Wan VACE): follows your camera frame-for-frame"
            onClick={() => setMode('exact')}
          >Exact</button>
          <button
            className={mode === 'beautiful' ? 'active' : ''}
            title="Camera language on Seedance 2.0: follows the intent of your move, frontier fidelity"
            onClick={() => setMode('beautiful')}
          >Beautiful</button>
        </div>
        <button
          className="iconbtn"
          disabled={!canCoverage}
          title="Coverage: wide / insert / arc angles from this blocking + an automatic multicam cut"
          onClick={onCoverage}
        >🎥</button>
        <button id="sendBtn" disabled={!canSend} title="Needs a recorded move + the object or a look line (and a FAL_KEY on the server)" onClick={onSend}>➤</button>
      </div>
      <div id="subRow">
        {mode === 'exact' && (
          <label title="Draft pass → realistic depth read → final pass. Turns the cube into true geometry; ~2.5× cost.">
            <input type="checkbox" id="detailChk" checked={detail} onChange={(e) => setDetail(e.target.checked)} />
            2-pass detail
          </label>
        )}
        <QueueLine queue={queue} generating={generating} />
      </div>
    </div>
  )
}

function QueueLine({ queue, generating }) {
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  if (!queue.jobs.length) {
    return <span id="hint">{generating ? 'Rendering previz…' : 'click the cube · record a move · send'}</span>
  }
  const drift = (Date.now() - queue.at) / 1000
  return (
    <span id="hint">
      {queue.jobs.map((j) => (
        <span className={`job${j.status === 'FAILED' ? ' failed' : ''}`} key={j.id} title={j.prompt}>
          {j.status === 'FAILED' ? '✖' : j.mode === 'beautiful' ? '✨' : '🎯'} {j.label || j.status}
          {j.position != null ? ` #${j.position}` : ''} · {fmt(j.secs + drift)}
        </span>
      ))}
    </span>
  )
}
