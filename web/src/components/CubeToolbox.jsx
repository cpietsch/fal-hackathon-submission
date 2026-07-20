import React, { useEffect, useRef, useState } from 'react'
import { useVoice } from '../useVoice.js'

// The toolbox that sticks to the cube: describe the subject by voice or
// text, confirm, and it docks into the main prompt as the object attachment.
export default function CubeToolbox({ open, initial, anchor, onConfirm, onClose, say }) {
  const boxRef = useRef(null)
  const inputRef = useRef(null)
  const [text, setText] = useState(initial)
  const voice = useVoice()

  // the draft survives a click-away; it only resets when the saved object changes
  useEffect(() => { setText(initial) }, [initial])
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  // follow the cube's projected screen position while open
  useEffect(() => {
    if (!open) return undefined
    let raf
    const track = () => {
      const p = anchor()
      if (p && boxRef.current) {
        const w = window.innerWidth
        boxRef.current.style.left = `${Math.max(140, Math.min(w - 140, p.x))}px`
        boxRef.current.style.top = `${Math.max(70, p.y)}px`
      }
      raf = requestAnimationFrame(track)
    }
    track()
    return () => cancelAnimationFrame(raf)
  }, [open, anchor])

  if (!open) return null
  return (
    <div id="cubeBox" ref={boxRef}>
      <h3>THE OBJECT</h3>
      <textarea
        id="objInput"
        ref={inputRef}
        value={text}
        placeholder="What lives inside the cube? Say or type it — e.g. “a vintage red motorcycle, chrome gleaming”"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onConfirm(text.trim()) }
          if (e.key === 'Escape') onClose()
        }}
      />
      <div className="row">
        <button
          className={`iconbtn ${voice.listening ? 'listening' : ''}`}
          title="Say it"
          onClick={() => voice.start((t) => (t ? setText(t) : say('Didn’t catch that — mic blocked or silent')))}
        >{voice.listening ? '●' : '🎙'}</button>
        <button id="objOk" onClick={() => onConfirm(text.trim())}>✓ Add to shot</button>
      </div>
    </div>
  )
}
