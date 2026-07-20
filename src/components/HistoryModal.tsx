import { useEffect, useState } from 'react'

type Session = { id: string; control: string; result: string; prompt: string }

function Item({ s, hero }: { s: Session; hero?: boolean }) {
  return (
    <div className={`histItem${hero ? ' hero' : ''}`}>
      {hero && <span className="latest">LATEST</span>}
      <div className="vids">
        <video src={s.control} muted loop autoPlay playsInline />
        <video src={s.result} muted loop autoPlay playsInline />
      </div>
      <div className="meta">
        <span className="txt">{s.prompt ? s.prompt.slice(0, hero ? 220 : 140) + (s.prompt.length > (hero ? 220 : 140) ? '…' : '') : '(no prompt logged)'}</span>
        <a href={s.result} download><button>Download</button></a>
      </div>
      <div className="hid">{s.id}</div>
    </div>
  )
}

// every generated shot of this project, newest first — the freshest one sits
// alone in a bigger hero row, the rest follow in a grid below
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
          <div id="histScroll">
            <Item s={items[0]} hero />
            {items.length > 1 && (
              <div id="histGrid">
                {items.slice(1).map((s) => <Item key={s.id} s={s} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
