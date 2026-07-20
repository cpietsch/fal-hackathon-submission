import React, { useEffect, useState } from 'react'

// Every generation this stage has produced, newest first — hover to play,
// click to reopen side-by-side with its previz.
export default function DailiesDrawer({ onClose, onOpen }) {
  const [items, setItems] = useState(null)

  useEffect(() => {
    fetch('/api/sessions').then((r) => r.json()).then(setItems).catch(() => setItems([]))
  }, [])

  return (
    <div className="drawerWrap" onClick={onClose}>
      <div id="dailies" onClick={(e) => e.stopPropagation()}>
        <h3>DAILIES</h3>
        {items === null && <p className="dim">loading…</p>}
        {items?.length === 0 && <p className="dim">Nothing yet — send your first shot.</p>}
        {items?.map((it) => (
          <div className="daily" key={it.id} onClick={() => onOpen(it)}>
            <video
              src={it.result} muted loop playsInline preload="metadata"
              onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
              onMouseLeave={(e) => e.currentTarget.pause()}
            />
            <div className="meta">
              <span className={`badge ${it.mode}`}>{it.mode}</span>
              <span className="p" title={it.prompt}>{it.prompt || it.id}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
