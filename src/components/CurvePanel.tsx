import { useEffect, useRef } from 'react'
import type { Take } from '../three/stage'

const CURVE_COLORS = ['#e5484d', '#46a758', '#5b8def'] // X Y Z

// After-Effects-style channel view of the chosen take (position X/Y/Z over
// time) with a smoothing dial — refine the performed move without re-doing it
export function CurvePanel({ take, onSmooth, onSmoothCommit }: {
  take: Take
  onSmooth: (v: number) => void
  onSmoothCommit: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(devicePixelRatio, 2)
    const W = (canvas.width = canvas.clientWidth * dpr)
    const H = (canvas.height = canvas.clientHeight * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, W, H)

    ctx.strokeStyle = '#1e222a'
    ctx.lineWidth = 1
    for (let gy = 1; gy < 4; gy++) {
      ctx.beginPath()
      ctx.moveTo(0, (H * gy) / 4)
      ctx.lineTo(W, (H * gy) / 4)
      ctx.stroke()
    }

    const fs = take.frames
    if (fs.length < 2) return
    const t1 = fs[fs.length - 1].t || 1
    const pad = 8 * dpr
    for (let ch = 0; ch < 3; ch++) {
      let min = Infinity
      let max = -Infinity
      for (const f of fs) { min = Math.min(min, f.p[ch]); max = Math.max(max, f.p[ch]) }
      const span = Math.max(max - min, 0.02) // flat channels stay centered
      const mid = (min + max) / 2
      ctx.strokeStyle = CURVE_COLORS[ch]
      ctx.lineWidth = 1.5 * dpr
      ctx.beginPath()
      for (let i = 0; i < fs.length; i++) {
        const x = (fs[i].t / t1) * (W - 2 * pad) + pad
        const y = H / 2 - ((fs[i].p[ch] - mid) / span) * (H - 2 * pad) * 0.9
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }, [take, take.frames])

  return (
    <div id="curvePanel">
      <div id="curveHead">
        <span id="curveTitle">MOVEMENT — {take.name.toUpperCase()} · {take.dur.toFixed(1)}S</span>
        <span id="curveLegend"><i className="cx">X</i><i className="cy">Y</i><i className="cz">Z</i></span>
      </div>
      <canvas id="curveCanvas" ref={canvasRef} />
      <div id="smoothRow">
        <span>smooth</span>
        <input
          id="smooth" type="range" min="0" max="1" step="0.05"
          value={take.smooth}
          onChange={(e) => onSmooth(Number(e.target.value))}
          onPointerUp={onSmoothCommit}
        />
        <b id="smoothVal">{take.smooth.toFixed(2)}</b>
      </div>
    </div>
  )
}
