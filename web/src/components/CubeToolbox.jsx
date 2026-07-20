import React, { useEffect, useRef, useState } from 'react'
import { Check, Mic, Square } from 'lucide-react'
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
        boxRef.current.style.left = `${Math.min(innerWidth - 270, Math.max(10, p.x + 28))}px`
        boxRef.current.style.top = `${Math.min(innerHeight - 190, Math.max(10, p.y - 70))}px`
      }
      raf = requestAnimationFrame(track)
    }
    track()
    return () => cancelAnimationFrame(raf)
  }, [open, anchor])

  if (!open) return null
  return (
    <div id="cubeBox" ref={boxRef}>
      <h3>MAIN OBJECT</h3>
      <textarea
        ref={inputRef}
        value={text}
        placeholder="What is this object? Speak or type…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onConfirm(text.trim()) }
          if (e.key === 'Escape') onClose()
        }}
      />
      <div id="cubeRow">
        <button
          id="cubeMic"
          className={voice.listening ? 'listening' : ''}
          title="Dictate"
          onClick={() => voice.start((t) => (t ? setText(t) : say('Didn’t catch that — mic blocked or silent')))}
        >{voice.listening ? <Square className="icon" /> : <Mic className="icon" />}</button>
        <button id="cubeOk" title="Attach to the main prompt" onClick={() => onConfirm(text.trim())}>
          <Check className="icon" />
        </button>
      </div>
    </div>
  )
}
