import React, { useEffect, useRef } from 'react'

export default function ResultModal({ result, onClose, onAgain }) {
  const controlRef = useRef(null)
  const resultRef = useRef(null)

  // keep the loops in lockstep so the trajectory match stays visible
  useEffect(() => {
    const vc = controlRef.current
    const vr = resultRef.current
    Promise.all([vc.play(), vr.play()]).catch(() => {})
    const t = setInterval(() => {
      if (vc.paused || !vc.duration || !vr.duration) return
      if (Math.abs(vc.currentTime - vr.currentTime) > 0.12) vr.currentTime = vc.currentTime
    }, 500)
    return () => clearInterval(t)
  }, [result])

  const remote = result.url && !result.url.startsWith('/')
  return (
    <div className="modal" style={{ zIndex: 25 }} onClick={onClose}>
      <div id="resultCard" onClick={(e) => e.stopPropagation()}>
        <div className="vids">
          <figure>
            <figcaption>PREVIZ — YOUR PERFORMED TAKE</figcaption>
            <video ref={controlRef} src={result.control} muted loop playsInline />
          </figure>
          <figure>
            <figcaption>GENERATED — SAME CAMERA MOVE</figcaption>
            <video ref={resultRef} src={result.url} muted loop playsInline />
          </figure>
        </div>
        <div className="foot">
          <span>{result.prompt.slice(0, 90)}{result.prompt.length > 90 ? '…' : ''}</span>
          {onAgain && <button title="Same performed take, new seed" onClick={onAgain}>↻ Again</button>}
          {result.url && (
            <a href={result.url} download target={remote ? '_blank' : undefined} rel={remote ? 'noreferrer' : undefined}>
              <button>Download</button>
            </a>
          )}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
