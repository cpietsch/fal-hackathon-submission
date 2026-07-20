import React, { useState } from 'react'

export default function TopBar({ rec, onRecToggle, onSim, onScale, phoneOn, falOn, onPair, onRezero, onDailies }) {
  const [sim, setSim] = useState(false)
  const [scale, setScale] = useState(1)

  return (
    <div className="bar" id="topbar">
      <div className="wordmark">BLOCK<span>ING</span></div>
      <div className="tag">direct, don&apos;t prompt</div>
      <button
        id="recBtn"
        className={rec.on ? 'rec' : ''}
        title="Record the camera move (or use REC on the phone)"
        onClick={onRecToggle}
      ><i /></button>
      <span id="recTime">{rec.on ? `${rec.elapsed.toFixed(1)}s` : '0.0s'}</span>
      <button
        id="simBtn"
        className={sim ? 'active' : ''}
        title="No phone? Fly the camera with WASD + Q/Z up/down + arrow keys"
        onClick={() => { const on = !sim; setSim(on); onSim(on) }}
      >Sim camera</button>
      <div id="scaleRow">
        <span>move ×</span>
        <input
          id="scale" type="range" min="0.25" max="4" step="0.25" value={scale}
          onChange={(e) => { const v = Number(e.target.value); setScale(v); onScale(v) }}
        />
        <b>{scale}</b>
      </div>
      <span className="stat"><i className={`dot ${phoneOn ? 'on' : ''}`} />phone</span>
      <span className="stat"><i className={`dot ${falOn ? 'on' : ''}`} />fal</span>
      <button title="Everything this stage has generated" onClick={onDailies}>🎞 Dailies</button>
      <button onClick={onPair}>Pair phone</button>
      <button title="Re-anchor the phone camera to its start mark" onClick={onRezero}>Re-zero</button>
    </div>
  )
}
