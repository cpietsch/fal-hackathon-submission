import { useEffect, useState } from 'react'

// floating generation status: phase, queue position and elapsed time,
// with an indeterminate sweep bar (fal doesn't report percentages)
export function GenProgress({ label, queuePos, t0 }: { label: string; queuePos: number | null; t0: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(i)
  }, [])

  const s = Math.max(0, Math.floor((Date.now() - t0) / 1000))
  const elapsed = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div id="genProgress">
      <div className="row">
        <i className="pulse" />
        <span>{label}</span>
        {queuePos != null && <span className="queue">queue #{queuePos}</span>}
        <span className="elapsed">{elapsed}</span>
      </div>
      <div className="track"><div className="fill" /></div>
    </div>
  )
}
