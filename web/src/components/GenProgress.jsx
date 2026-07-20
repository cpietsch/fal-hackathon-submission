import React, { useEffect, useState } from 'react'

// floating generation status cards, one per in-flight job across all tabs:
// phase, fal queue position, elapsed time, indeterminate sweep bar
// (fal doesn't report percentages)
export default function GenStack({ queue }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!queue.jobs.length) return undefined
    const i = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(i)
  }, [queue.jobs.length])

  if (!queue.jobs.length) return null
  const drift = (Date.now() - queue.at) / 1000
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <div id="genStack">
      {queue.jobs.map((j) => {
        const failed = j.status === 'FAILED'
        return (
          <div className={`genProgress${failed ? ' failed' : ''}`} key={j.id} title={j.prompt}>
            <div className="row">
              <i className="pulse" />
              <span>{failed ? 'Failed' : j.label || (j.status === 'IN_QUEUE' ? 'In queue' : 'Rendering on fal…')}</span>
              {!failed && j.position != null && <span className="queue">#{j.position}</span>}
              <span className="elapsed">{fmt(j.secs + drift)}</span>
            </div>
            <div className="track"><div className="fill" /></div>
          </div>
        )
      })}
    </div>
  )
}
