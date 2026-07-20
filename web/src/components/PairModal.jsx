import React, { useEffect, useState } from 'react'
import { getConfig } from '../api.js'

export default function PairModal({ onClose }) {
  const [cfg, setCfg] = useState(null)
  useEffect(() => { getConfig().then(setCfg).catch(() => setCfg({})) }, [])

  // a QR pointing at localhost is useless to a phone. Prefer addresses a
  // phone can plausibly reach: Tailscale (100.64/10), then LAN 192.168/172,
  // then the rest — enumeration order puts VM-internal 10.x first otherwise.
  const rank = (h) => (h.startsWith('100.') ? 0 : h.startsWith('192.168.') || h.startsWith('172.') ? 1 : 2)
  const hosts = (cfg?.hosts || []).slice().sort((a, b) => rank(a) - rank(b))
  const local = ['localhost', '127.0.0.1'].includes(location.hostname)
  const host = local ? (hosts[0] || location.hostname) : location.hostname
  const httpsUrl = `https://${host}:${cfg?.httpsPort || 8443}/phone.html`
  const httpUrl = `http://${host}:${cfg?.httpPort || 8000}/phone.html`
  const alts = hosts.filter((h) => h !== host)

  return (
    <div className="modal" onClick={onClose}>
      <div id="pairCard" onClick={(e) => e.stopPropagation()}>
        <b>Pair your phone</b>
        {cfg && <img src={`/qr.svg?u=${encodeURIComponent(httpsUrl)}`} alt="QR code" />}
        <div className="url">{httpsUrl}</div>
        <div className="url">{httpUrl}</div>
        {alts.length > 0 && (
          <div className="url" style={{ opacity: 0.55 }}>
            other interfaces: {alts.map((h) => `https://${h}:${cfg?.httpsPort || 8443}/phone.html`).join(' · ')}
          </div>
        )}
        <p>
          Android Chrome needs a <b>secure context</b> for AR: open the <b>https</b> URL and accept
          the certificate warning — or add the http URL to
          <i> chrome://flags/#unsafely-treat-insecure-origin-as-secure</i>.
        </p>
        <button style={{ width: '100%' }} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
