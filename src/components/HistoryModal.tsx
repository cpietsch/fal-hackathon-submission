import { useEffect, useState } from 'react'

type Session = { id: string; control: string; result: string; prompt: string }

// every generated shot of this project, newest first — previz next to result
export function HistoryModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Session[] | null>(null)

  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((list: Session[]) => setItems([...list].sort((a, b) => b.id.localeCompare(a.id))))
      .catch(() => setItems([]))
  }, [])

  return (
    <div className="modal" onClick={onClose}>
      <div id="historyCard" onClick={(e) => e.stopPropagation()}>
        <div id="historyHead">
          <h3>GENERATED SHOTS</h3>
          <button onClick={onClose}>Close</button>
        </div>
        {items === null && <p className="histEmpty">Loading…</p>}
        {items?.length === 0 && <p className="histEmpty">Nothing generated yet — record a take and hit send.</p>}
        {items && items.length > 0 && (
          <div id="histGrid">
            {items.map((s) => (
              <div key={s.id} className="histItem">
                <div className="vids">
                  <video src={s.control} muted loop autoPlay playsInline />
                  <video src={s.result} muted loop autoPlay playsInline />
                </div>
                <div className="meta">
                  <span className="txt">{s.prompt ? s.prompt.slice(0, 140) + (s.prompt.length > 140 ? '…' : '') : '(no prompt logged)'}</span>
                  <a href={s.result} download><button>Download</button></a>
                </div>
                <div className="hid">{s.id}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
