import type { Frame, Vec3 } from '../three/stage'

export type CtrlPt = { t: number; v: number }

function sampleChannel(fs: Frame[], ch: number, t: number) {
  let i = 0
  while (i < fs.length - 2 && fs[i + 1].t < t) i++
  const a = fs[i]
  const b = fs[i + 1]
  const k = Math.min(1, Math.max(0, (t - a.t) / Math.max(1, b.t - a.t)))
  return a.p[ch] + (b.p[ch] - a.p[ch]) * k
}

// control points at the marked moments of the move — endpoints plus local
// peaks/valleys (Premiere-style), not a dense uniform grid
export function initCtrl(base: Frame[], samples = 80): CtrlPt[][] {
  const t1 = base[base.length - 1].t || 1
  return [0, 1, 2].map((ch) => {
    const vs = Array.from({ length: samples }, (_, i) => {
      const t = (i / (samples - 1)) * t1
      return { t, v: sampleChannel(base, ch, t) }
    })
    let min = Infinity
    let max = -Infinity
    for (const p of vs) { min = Math.min(min, p.v); max = Math.max(max, p.v) }
    const span = Math.max(max - min, 0.02)

    // track the last non-zero slope direction so plateau extrema (flat
    // valleys/peaks from key-press moves) are caught too
    const pts: CtrlPt[] = [vs[0]]
    const eps = span * 0.004
    let dir = 0
    let lastMoveIdx = 0
    for (let i = 1; i < samples; i++) {
      const d = vs[i].v - vs[i - 1].v
      const s = Math.abs(d) < eps ? 0 : Math.sign(d)
      if (s === 0) continue
      if (dir !== 0 && s !== dir) {
        // direction flipped — the extremum sits where movement last stopped
        const ext = vs[lastMoveIdx]
        // only keep peaks/valleys that actually stand out from the last kept point
        if (Math.abs(ext.v - pts[pts.length - 1].v) > span * 0.12) pts.push(ext)
      }
      dir = s
      lastMoveIdx = i
    }
    pts.push(vs[samples - 1])
    return pts
  })
}

// uniform Catmull-Rom (Hermite form) through the control points — the
// hand-adjusted curve stays smooth like a bezier, no kinks at the handles
export function splineAt(pts: CtrlPt[], t: number): number {
  if (t <= pts[0].t) return pts[0].v
  if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v
  let i = 0
  while (i < pts.length - 2 && pts[i + 1].t < t) i++
  const p0 = pts[Math.max(0, i - 1)]
  const p1 = pts[i]
  const p2 = pts[i + 1]
  const p3 = pts[Math.min(pts.length - 1, i + 2)]
  const u = (t - p1.t) / Math.max(1e-6, p2.t - p1.t)
  const m1 = (p2.v - p0.v) / 2
  const m2 = (p3.v - p1.v) / 2
  const u2 = u * u
  const u3 = u2 * u
  return (2 * u3 - 3 * u2 + 1) * p1.v + (u3 - 2 * u2 + u) * m1
    + (-2 * u3 + 3 * u2) * p2.v + (u3 - u2) * m2
}

// replace hand-edited channels with the spline through their control points
export function applyCtrl(base: Frame[], ctrl: CtrlPt[][], editedCh: boolean[]): Frame[] {
  return base.map((f) => {
    const p = [...f.p] as Vec3
    for (let ch = 0; ch < 3; ch++) if (editedCh[ch]) p[ch] = splineAt(ctrl[ch], f.t)
    return { ...f, p }
  })
}
