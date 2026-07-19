import React, { useEffect, useRef } from 'react'

export default function ResultModal({ result, onClose }) {
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

  return (
    <div className="modal" style={{ zIndex: 25 }}>
      <div id="resultCard">
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
          <a href={result.url || '#'} download><button>Download</button></a>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
