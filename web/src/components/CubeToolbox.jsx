import React, { useEffect, useRef, useState } from 'react'
import { useVoice } from '../useVoice.js'

// The toolbox that sticks to the cube: describe the subject by voice or
// text, confirm, and it docks into the main prompt as the object attachment.
export default function CubeToolbox({ open, initial, anchor, onConfirm }) {
  const boxRef = useRef(null)
  const inputRef = useRef(null)
  const [text, setText] = useState(initial)
  const voice = useVoice()

  useEffect(() => { if (open) { setText(initial); inputRef.current?.focus() } }, [open, initial])

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
      />
      <div className="row">
        <button
          className={`iconbtn ${voice.listening ? 'listening' : ''}`}
          title="Say it"
          onClick={() => voice.start((t) => t && setText(t))}
        >{voice.listening ? '●' : '🎙'}</button>
        <button id="objOk" onClick={() => onConfirm(text.trim())}>✓ Add to shot</button>
      </div>
    </div>
  )
}
