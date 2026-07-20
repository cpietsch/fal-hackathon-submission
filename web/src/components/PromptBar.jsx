import React, { useRef } from 'react'
import { Box, Image as ImageIcon, Mic, Send, Square, Video, X } from 'lucide-react'
import { useVoice } from '../useVoice.js'
import { uploadRef } from '../api.js'

// The main prompt, ChatGPT-style: attachment chips (object, motion,
// reference stills) above one look line with circular icon buttons.
export default function PromptBar({
  shot, setShot, takeMeta, camLang, onPlayTake, onClearTake, onEditObject,
  mode, canSend, generating, onSend, say,
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

  const hasAttachments = Boolean(shot.object) || Boolean(takeMeta) || shot.refs.length > 0

  return (
    <div id="promptBar">
      <div id="attachRow" className={hasAttachments ? 'has' : ''}>
        {shot.object && (
          <div className="attach" data-click title="The object — click to edit" onClick={onEditObject}>
            <Box className="icon" /><span className="txt">{shot.object}</span>
            <button title="Remove" onClick={(e) => { e.stopPropagation(); setShot((s) => ({ ...s, object: '' })) }}>
              <X className="icon" />
            </button>
          </div>
        )}
        {takeMeta && (
          <div
            className="attach motion" data-click
            title={camLang?.camera_prompt || 'The performed camera move — click to replay'}
            onClick={onPlayTake}
          >
            <Video className="icon" />
            <span className="txt">{camLang?.move_name || 'performed move'} · {takeMeta.dur.toFixed(1)}s</span>
            <button title="Remove" onClick={(e) => { e.stopPropagation(); onClearTake() }}><X className="icon" /></button>
          </div>
        )}
        {shot.refs.map((ref) => (
          <div
            className={`attach${mode === 'beautiful' ? ' inactive' : ''}`}
            key={ref.url}
            title={mode === 'beautiful' ? `${ref.name} — references only apply in Exact mode` : ref.name}
          >
            <img src={ref.url} alt={ref.name} />
            <button title="Remove" onClick={() => setShot((s) => ({ ...s, refs: s.refs.filter((r) => r !== ref) }))}>
              <X className="icon" />
            </button>
          </div>
        ))}
      </div>
      <div id="promptRow">
        <input
          id="promptInput" type="text" autoComplete="off" spellCheck={false}
          placeholder="Describe the look & atmosphere of the shot…"
          value={shot.look}
          onChange={(e) => setShot((s) => ({ ...s, look: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSend) onSend()
            if (e.key === 'Escape') e.target.blur()
          }}
        />
        <button id="refBtn" title="Add reference images for the shot atmosphere" onClick={() => fileRef.current.click()}>
          <ImageIcon className="icon" />
        </button>
        <button
          id="promptMic"
          className={voice.listening ? 'listening' : ''}
          title="Say the look"
          onClick={() => voice.start((t) => (t ? setShot((s) => ({ ...s, look: t })) : say('Didn’t catch that — mic blocked or silent')))}
        >{voice.listening ? <Square className="icon" /> : <Mic className="icon" />}</button>
        <button
          id="promptSend"
          disabled={!canSend}
          title="Generate the shot (needs a recorded move + the object or a look line)"
          onClick={onSend}
        ><Send className="icon" /></button>
      </div>
      <input
        ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }}
      />
    </div>
  )
}
