export function PairModal({ onClose }: { onClose: () => void }) {
  const host = location.hostname
  const httpsUrl = `https://${host}:8443/phone.html`
  const httpUrl = `http://${host}:8000/phone.html`
  return (
    <div className="modal" onClick={onClose}>
      <div id="pairCard" onClick={(e) => e.stopPropagation()}>
        <b>Pair your phone</b>
        <img src={`/qr.svg?u=${encodeURIComponent(httpsUrl)}`} alt="QR code" />
        <div className="url">{httpsUrl}</div>
        <div className="url">{httpUrl}</div>
        <p>
          Android Chrome needs a <b>secure context</b> for AR: open the <b>https</b> URL and accept the
          certificate warning — or add the http URL to <i>chrome://flags/#unsafely-treat-insecure-origin-as-secure</i>.
        </p>
        <button style={{ width: '100%' }} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
