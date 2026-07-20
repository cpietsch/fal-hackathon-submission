import React from 'react'
import { Crosshair, Disc, Film, Gamepad2, Smartphone, Video } from 'lucide-react'

// floating side islands: camera controls left, shot controls right

export function CameraIsland({ swapped, onCamView, simMode, onSim, onPair, onRezero }) {
  return (
    <div className="island" id="tools">
      <h3>CAMERA</h3>
      <button
        className={swapped ? 'active' : ''}
        title="See through the film camera (click the PiP works too)"
        onClick={() => onCamView(!swapped)}
      ><Video className="icon" />Camera view</button>
      <button
        className={simMode ? 'active' : ''}
        title="Fly the camera with WASD + Q/Z up/down + arrow keys"
        onClick={() => onSim(!simMode)}
      ><Gamepad2 className="icon" />Fly controls</button>
      <button onClick={onPair}><Smartphone className="icon" />Pair phone</button>
      <button title="Re-anchor the phone camera to its start mark" onClick={onRezero}>
        <Crosshair className="icon" />Re-zero
      </button>
      <div className="hint">click the cube to define<br />the main object</div>
    </div>
  )
}

export function ShotIsland({
  recording, countdown, recSec, onRecord,
  mode, setMode, detail, setDetail, canCoverage, onCoverage,
}) {
  const recLabel = countdown !== null
    ? 'Get ready…'
    : recording ? `Stop · ${recSec.toFixed(1)}s` : 'Start recording'
  return (
    <div className="island" id="shotPanel">
      <h3>SHOT</h3>
      <button
        id="recBtn"
        className={recording ? 'rec' : ''}
        title="Record the camera move as a take (phone or fly controls), up to 30s — or press R"
        onClick={onRecord}
      ><Disc className="icon" /><span>{recLabel}</span></button>
      <div id="modeRow">
        <button
          className={mode === 'exact' ? 'active' : ''}
          title="Depth-constrained (Wan VACE): follows your camera frame-for-frame"
          onClick={() => setMode('exact')}
        >Exact</button>
        <button
          className={mode === 'beautiful' ? 'active' : ''}
          title="Camera language on Seedance 2.0: follows the intent of your move, frontier fidelity"
          onClick={() => setMode('beautiful')}
        >Beautiful</button>
      </div>
      {mode === 'exact' && (
        <label id="detailRow" title="Draft pass → realistic depth read → final pass. Turns the cube into true geometry; ~2.5× cost.">
          <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} />
          2-pass detail
        </label>
      )}
      <button
        id="covBtn"
        disabled={!canCoverage}
        title="Coverage: wide / insert / arc angles from this blocking + an automatic multicam cut"
        onClick={onCoverage}
      ><Film className="icon" /><span>Coverage</span></button>
    </div>
  )
}
