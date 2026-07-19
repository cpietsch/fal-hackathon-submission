import { useEffect, useMemo, useRef, useState } from 'react'
import { smoothFrames, type Take } from '../three/stage'
import { initCtrl, type CtrlPt } from '../lib/curves'

const CURVE_COLORS = ['#e5484d', '#46a758', '#5b8def'] // X Y Z
const CH_NAMES = ['X', 'Y', 'Z']
const PAD = 8

// After-Effects-style channel view of the chosen take. One channel is active
// at a time; its key points are draggable handles — the curve rebuilds as a
// smooth spline through them, so the move can be refined by hand.
export function CurvePanel({ take, onSmooth, onEditPoint, onResetEdits, onCommit }: {
  take: Take
  onSmooth: (v: number) => void
  onEditPoint: (ch: number, idx: number, v: number) => void
  onResetEdits: () => void
  onCommit: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragging = useRef<number | null>(null)

  // stable per-channel scales from the smoothed base (not the edited result),
  // so handles don't rescale under the pointer mid-drag
  const base = useMemo(() => smoothFrames(take.raw, take.smooth), [take.id, take.smooth, take.raw])
  const scales = useMemo(() => [0, 1, 2].map((ch) => {
    let min = Infinity
    let max = -Infinity
    for (const f of base) { min = Math.min(min, f.p[ch]); max = Math.max(max, f.p[ch]) }
    const span = Math.max(max - min, 0.02) * 1.3
    return { mid: (min + max) / 2, span }
  }), [base])
  const defaultCtrl = useMemo(() => initCtrl(base), [base])
  const ctrl: CtrlPt[][] = take.ctrl ?? defaultCtrl

  // default to the most active axis of this take
  const [activeCh, setActiveCh] = useState(0)
  useEffect(() => {
    let best = 0
    let bestSpan = -1
    for (let ch = 0; ch < 3; ch++) {
      let min = Infinity
      let max = -Infinity
      for (const f of base) { min = Math.min(min, f.p[ch]); max = Math.max(max, f.p[ch]) }
      if (max - min > bestSpan) { bestSpan = max - min; best = ch }
    }
    setActiveCh(best)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take.id])

  const t1 = take.frames[take.frames.length - 1]?.t || 1
  const geom = (canvas: HTMLCanvasElement) => {
    const dpr = Math.min(devicePixelRatio, 2)
    const W = canvas.clientWidth * dpr
    const H = canvas.clientHeight * dpr
    const pad = PAD * dpr
    const xPx = (t: number) => (t / t1) * (W - 2 * pad) + pad
    const yPx = (ch: number, v: number) => H / 2 - ((v - scales[ch].mid) / scales[ch].span) * (H - 2 * pad) * 0.9
    const vAt = (ch: number, y: number) => scales[ch].mid - ((y - H / 2) / ((H - 2 * pad) * 0.9)) * scales[ch].span
    return { dpr, W, H, pad, xPx, yPx, vAt }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { dpr, W, H, xPx, yPx } = geom(canvas)
    canvas.width = W
    canvas.height = H
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
    for (let ch = 0; ch < 3; ch++) {
      ctx.globalAlpha = ch === activeCh ? 1 : 0.35
      ctx.strokeStyle = CURVE_COLORS[ch]
      ctx.lineWidth = 1.5 * dpr
      ctx.beginPath()
      for (let i = 0; i < fs.length; i++) {
        const x = xPx(fs[i].t)
        const y = yPx(ch, fs[i].p[ch])
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // handles on the active channel
    for (const p of ctrl[activeCh]) {
      const x = xPx(p.t)
      const y = yPx(activeCh, p.v)
      ctx.beginPath()
      ctx.arc(x, y, 4.5 * dpr, 0, Math.PI * 2)
      ctx.fillStyle = CURVE_COLORS[activeCh]
      ctx.fill()
      ctx.lineWidth = 1.5 * dpr
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take.frames, ctrl, activeCh, scales])

  const hitHandle = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const { dpr, xPx, yPx } = geom(canvas)
    const mx = (e.clientX - rect.left) * dpr
    const my = (e.clientY - rect.top) * dpr
    let best = -1
    let bestD = 12 * dpr
    ctrl[activeCh].forEach((p, i) => {
      const d = Math.hypot(xPx(p.t) - mx, yPx(activeCh, p.v) - my)
      if (d < bestD) { bestD = d; best = i }
    })
    return best
  }

  return (
    <div id="curvePanel">
      <div id="curveHead">
        <span id="curveTitle">MOVEMENT — {take.name.toUpperCase()} · {take.dur.toFixed(1)}S</span>
        <span id="curveLegend">
          {CH_NAMES.map((n, ch) => (
            <button key={n} className={`chBtn c${n.toLowerCase()}${ch === activeCh ? ' on' : ''}`}
              onClick={() => setActiveCh(ch)}>{n}</button>
          ))}
          {take.editedCh?.some(Boolean) && (
            <button className="chBtn" title="Discard hand edits" onClick={onResetEdits}>reset</button>
          )}
        </span>
      </div>
      <canvas
        id="curveCanvas"
        ref={canvasRef}
        onPointerDown={(e) => {
          const idx = hitHandle(e)
          if (idx < 0) return
          dragging.current = idx
          ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const canvas = canvasRef.current!
          if (dragging.current === null) {
            canvas.style.cursor = hitHandle(e) >= 0 ? 'ns-resize' : ''
            return
          }
          const rect = canvas.getBoundingClientRect()
          const { dpr, vAt } = geom(canvas)
          const my = (e.clientY - rect.top) * dpr
          const { mid, span } = scales[activeCh]
          const v = Math.min(mid + span * 0.55, Math.max(mid - span * 0.55, vAt(activeCh, my)))
          onEditPoint(activeCh, dragging.current, v)
        }}
        onPointerUp={(e) => {
          if (dragging.current === null) return
          dragging.current = null
          ;(e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId)
          onCommit()
        }}
      />
      <div id="smoothRow">
        <span>smooth</span>
        <input
          id="smooth" type="range" min="0" max="1" step="0.05"
          value={take.smooth}
          onChange={(e) => onSmooth(Number(e.target.value))}
          onPointerUp={onCommit}
        />
        <b id="smoothVal">{take.smooth.toFixed(2)}</b>
      </div>
    </div>
  )
}
