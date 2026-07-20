import React from 'react'

// brand + live status pills; the working controls live in the side islands
export default function TopBar({ phoneOn, falOn, onPair, onFalCheck }) {
  return (
    <div className="bar" id="topbar">
      <div className="wordmark">BLOCK<span>ING</span></div>
      <div className="tag">direct, don&apos;t prompt</div>
      <button className={`statTgl${phoneOn ? ' on' : ''}`} title="Click to pair your phone" onClick={onPair}>
        <i className={`dot${phoneOn ? ' on' : ''}`} />phone
        <span className="st">{phoneOn ? 'connected' : 'not connected'}</span>
      </button>
      <button className={`statTgl${falOn ? ' on' : ''}`} title="Click to re-check the fal key" onClick={onFalCheck}>
        <i className={`dot${falOn ? ' on' : ''}`} />fal
        <span className="st">{falOn ? 'ready' : falOn === false ? 'no key' : 'checking…'}</span>
      </button>
    </div>
  )
}
