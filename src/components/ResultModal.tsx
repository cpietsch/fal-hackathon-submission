import { useEffect, useRef } from 'react'

export type GenResult = { control: string; local?: string; video?: { url: string } }

export function ResultModal({ out, prompt, onClose }: { out: GenResult; prompt: string; onClose: () => void }) {
  const controlRef = useRef<HTMLVideoElement>(null)
  const resultRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const vc = controlRef.current!
    const vr = resultRef.current!
    Promise.all([vc.play(), vr.play()]).catch(() => {})
    // keep the loops in lockstep so the trajectory match stays visible
    const timer = setInterval(() => {
      if (vc.paused || !vc.duration || !vr.duration) return
      if (Math.abs(vc.currentTime - vr.currentTime) > 0.12) vr.currentTime = vc.currentTime
    }, 500)
    return () => clearInterval(timer)
  }, [out])

  const resultSrc = out.local || out.video?.url
  return (
    <div className="modal" style={{ zIndex: 25 }}>
      <div id="resultCard">
        <div className="vids">
          <figure>
            <figcaption>PREVIZ — YOUR PERFORMED TAKE</figcaption>
            <video ref={controlRef} src={out.control} muted loop playsInline />
          </figure>
          <figure>
            <figcaption>GENERATED — SAME CAMERA MOVE</figcaption>
            <video ref={resultRef} src={resultSrc} muted loop playsInline />
          </figure>
        </div>
        <div className="foot">
          <span>{prompt.slice(0, 90)}{prompt.length > 90 ? '…' : ''}</span>
          <a href={resultSrc || '#'} download><button>Download</button></a>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
