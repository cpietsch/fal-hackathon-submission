import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// ---------------------------------------------------------------- scene setup
const view = document.getElementById('view')
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
// shadows only change when the stage changes — re-render the map on demand,
// not twice per frame (main + PiP pass)
renderer.shadowMap.autoUpdate = false
renderer.shadowMap.needsUpdate = true
view.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x15171c)
scene.fog = new THREE.Fog(0x15171c, 24, 60)

const hemi = new THREE.HemisphereLight(0xbcc7d6, 0x2a2620, 0.9)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffe8c4, 1.6)
sun.position.set(6, 10, 4)
sun.castShadow = true
sun.shadow.mapSize.set(1024, 1024)
sun.shadow.camera.left = sun.shadow.camera.bottom = -16
sun.shadow.camera.right = sun.shadow.camera.top = 16
scene.add(sun)

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.95 }),
)
ground.receiveShadow = true
scene.add(ground)
const grid = new THREE.GridHelper(30, 30, 0x3a3f4a, 0x2b2f37)
scene.add(grid)

// editor camera
const editorCam = new THREE.PerspectiveCamera(50, 1, 0.1, 200)
editorCam.position.set(7, 5.5, 8)
const controls = new OrbitControls(editorCam, renderer.domElement)
controls.target.set(0, 1, 0)
controls.maxPolarAngle = Math.PI / 2 - 0.02
controls.update()

// virtual (film) camera — 16:9, ~32mm feel
export const ANCHOR = { pos: new THREE.Vector3(0, 1.6, 4.2), look: new THREE.Vector3(0, 1.2, 0) }
const filmCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 40)
filmCam.position.copy(ANCHOR.pos)
filmCam.lookAt(ANCHOR.look)
const camHelper = new THREE.CameraHelper(filmCam)
scene.add(camHelper)

// small camera body so the rig is visible while blocking
const camBody = new THREE.Group()
{
  const m = new THREE.MeshStandardMaterial({ color: 0xd7dae0, roughness: 0.4 })
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.3), m)
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 20).rotateX(Math.PI / 2), m)
  lens.position.z = -0.2
  camBody.add(box, lens)
}
scene.add(camBody)

// ---------------------------------------------------------------- the cube
// One centered proxy object. Its meaning lives in a prompt the director
// attaches by clicking it — the depth silhouette stays a cube.
const stage = new THREE.Group()
scene.add(stage)
const cubeGroup = new THREE.Group()
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x8a7a62, roughness: 0.85 }),
)
cube.position.y = 0.5
cube.castShadow = cube.receiveShadow = true
cubeGroup.add(cube)
// invisible, slightly larger hit target — clicks near the cube still count
const hitProxy = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshBasicMaterial())
hitProxy.position.y = 0.5
hitProxy.visible = false
cubeGroup.add(hitProxy)
cubeGroup.userData = { kind: 'prop', id: 1 }
stage.add(cubeGroup)

let objectPrompt = localStorage.getItem('blocking-object-v1') || ''

const icon = (n) => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"/></svg>`

// ---------------------------------------------------------------- cube toolbox
const ray = new THREE.Raycaster()
const cubeBox = document.getElementById('cubeBox')
const cubePrompt = document.getElementById('cubePrompt')

function pointerRay(e) {
  const r = renderer.domElement.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  )
  ray.setFromCamera(ndc, swapped ? filmCam : editorCam)
  return ray
}

let hoveringCube = false
function applyCubeGlow() {
  const open = cubeBox.classList.contains('open')
  cube.material.emissive.setHex(open ? 0x7a4d00 : hoveringCube ? 0x2a1c05 : 0x000000)
}
function setCubeBox(open) {
  cubeBox.classList.toggle('open', open)
  applyCubeGlow()
  if (open) {
    cubePrompt.value = objectPrompt
    positionCubeBox()
    cubePrompt.focus()
  }
}
function positionCubeBox() {
  const w = renderer.domElement.clientWidth
  const h = renderer.domElement.clientHeight
  const v = cube.getWorldPosition(new THREE.Vector3()).setY(1.1).project(swapped ? filmCam : editorCam)
  const x = (v.x + 1) / 2 * w
  const y = (1 - v.y) / 2 * h
  cubeBox.style.left = `${Math.min(w - 270, Math.max(10, x + 28))}px`
  cubeBox.style.top = `${Math.min(h - 190, Math.max(10, y - 70))}px`
}
document.getElementById('cubeOk').onclick = () => {
  objectPrompt = cubePrompt.value.trim()
  localStorage.setItem('blocking-object-v1', objectPrompt)
  setCubeBox(false)
  renderAttachments()
  toast(objectPrompt ? 'Object attached to the main prompt' : 'Object cleared')
}
cubePrompt.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setCubeBox(false)
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('cubeOk').click() }
})

// a click is pointerdown + pointerup without dragging — orbiting the view
// with a drag that starts on the cube must NOT toggle the toolbox
const keys = new Set()
let downAt = null
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = [e.clientX, e.clientY]
})
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1])
  downAt = null
  if (moved > 5) return // that was an orbit drag, not a click
  if (swapped || simMode) { toast('Editing is locked while flying — exit Camera view / Fly controls first'); return }
  const hits = pointerRay(e).intersectObjects(stage.children, true)
  setCubeBox(hits.length > 0)
})
renderer.domElement.addEventListener('pointermove', (e) => {
  if (swapped || simMode) { renderer.domElement.style.cursor = ''; return }
  const overCube = pointerRay(e).intersectObjects(stage.children, true).length > 0
  if (overCube !== hoveringCube) { hoveringCube = overCube; applyCubeGlow() }
  renderer.domElement.style.cursor = overCube ? 'pointer' : ''
})
addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA/.test(e.target.tagName)) return
  if (e.key === 'Escape') setCubeBox(false)
  keys.add(e.code)
})
addEventListener('keyup', (e) => keys.delete(e.code))

// ---------------------------------------------------------------- view swap
let swapped = false // false: editor view · true: through the film camera

function resize() {
  const w = view.clientWidth
  const h = view.clientHeight
  renderer.setSize(w, h)
  editorCam.aspect = w / h
  editorCam.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

// ---------------------------------------------------------------- phone pose intake
const ws = { sock: null, open: false }
const phoneTgl = document.getElementById('phoneTgl')
function setPhoneConn(on) {
  phoneTgl.classList.toggle('on', on)
  document.getElementById('dotPhone').classList.toggle('on', on)
  document.getElementById('phoneState').textContent = on ? 'connected' : 'not connected'
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const s = new WebSocket(`${proto}://${location.host}/ws`)
  ws.sock = s
  s.onopen = () => { ws.open = true; s.send(JSON.stringify({ type: 'hello', role: 'director' })) }
  s.onclose = () => { ws.open = false; setPhoneConn(false); setTimeout(connectWS, 1500) }
  s.onmessage = (ev) => {
    let m
    try { m = JSON.parse(ev.data) } catch { return }
    if (m.type === 'presence') setPhoneConn(m.roles.includes('camera'))
    else if (m.type === 'genState' && generating) {
      setPromptBusy(true, m.status === 'IN_QUEUE'
        ? `In queue${m.position != null ? ` #${m.position}` : ''}…`
        : 'Rendering on fal…')
    }
    else if (m.type === 'pose') onPose(m)
    else if (m.type === 'record') startRecordFlow(m.on)
    else if (m.type === 'rezero') calib.pending = true
  }
}
connectWS()

// Calibration: first pose (or re-zero) maps phone pose -> film camera anchor.
// Yaw-only correction keeps gravity honest; position pinned to the anchor.
const calib = { pending: true, p0: new THREE.Vector3(), yawCorr: new THREE.Quaternion(), ok: false }
const livePose = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fresh: false }

function yawOf(q) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
  return Math.atan2(f.x, f.z)
}

function onPose(m) {
  const p = new THREE.Vector3(...m.p)
  const q = new THREE.Quaternion(...m.q)
  if (calib.pending) {
    calib.p0.copy(p)
    const anchorQ = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(ANCHOR.pos, ANCHOR.look, new THREE.Vector3(0, 1, 0)),
    )
    calib.yawCorr.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawOf(anchorQ) - yawOf(q))
    calib.pending = false
    calib.ok = true
    toast('Camera zeroed — you are at the mark')
  }
  const rel = p.clone().sub(calib.p0).applyQuaternion(calib.yawCorr)
  livePose.p.copy(ANCHOR.pos).add(rel)
  livePose.q.copy(calib.yawCorr).multiply(q)
  livePose.fresh = true
}

document.getElementById('rezeroBtn').onclick = () => { calib.pending = true }

// ---------------------------------------------------------------- sim camera
let simMode = false
const simBtn = document.getElementById('simBtn')
const camViewBtn = document.getElementById('camViewBtn')
function setSim(on) {
  simMode = on
  simBtn.classList.toggle('active', on)
  if (on) toast('Fly: WASD move · Q/Z up/down · arrows look')
}
simBtn.onclick = () => setSim(!simMode)
// camera view = look through the film camera + fly it with the keys
function setSwapped(on) {
  swapped = on
  camViewBtn.classList.toggle('active', on)
  setSim(on)
  if (on) setCubeBox(false)
  else {
    filmCam.aspect = 16 / 9 // restore the film frame for the helper frustum
    filmCam.updateProjectionMatrix()
  }
  updateCurvePanel()
}
camViewBtn.onclick = () => setSwapped(!swapped)

const simEuler = new THREE.Euler(0, 0, 0, 'YXZ')
function simTick(dt) {
  const sp = (keys.has('ShiftLeft') ? 3.2 : 1.4) * dt
  const rs = 1.4 * dt
  if (keys.has('ArrowLeft')) simEuler.y += rs
  if (keys.has('ArrowRight')) simEuler.y -= rs
  if (keys.has('ArrowUp')) simEuler.x = Math.min(1.4, simEuler.x + rs)
  if (keys.has('ArrowDown')) simEuler.x = Math.max(-1.4, simEuler.x - rs)
  filmCam.quaternion.setFromEuler(simEuler)
  const dir = new THREE.Vector3()
  if (keys.has('KeyW')) dir.z -= 1
  if (keys.has('KeyS')) dir.z += 1
  if (keys.has('KeyA')) dir.x -= 1
  if (keys.has('KeyD')) dir.x += 1
  dir.applyQuaternion(filmCam.quaternion).setY(0).normalize().multiplyScalar(sp)
  filmCam.position.add(dir)
  if (keys.has('KeyQ')) filmCam.position.y += sp
  if (keys.has('KeyZ')) filmCam.position.y = Math.max(0.1, filmCam.position.y - sp)
}
{
  // start sim euler matching the anchor orientation
  const aq = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(ANCHOR.pos, ANCHOR.look, new THREE.Vector3(0, 1, 0)),
  )
  simEuler.setFromQuaternion(aq)
}

// ---------------------------------------------------------------- takes
const takes = []
let chosenId = null
let recording = false
let recStart = 0
let recFrames = null
let playback = null // {take, t0}

const recBtn = document.getElementById('recBtn')
const recLabel = document.getElementById('recLabel')
const takesEl = document.getElementById('takes')

// record flow: jump into the film camera (the phone is the camera token),
// count down 3-2-1 center screen, then roll until the director stops
const countdownEl = document.getElementById('countdown')
let countdownTimer = 0
function startRecordFlow(on) {
  if (!on) {
    cancelCountdown()
    setRecording(false)
    return
  }
  if (recording || countdownTimer) return
  setSwapped(true)
  recLabel.textContent = 'Get ready…'
  let n = 3
  const tick = () => {
    if (n === 0) {
      countdownEl.classList.remove('show')
      countdownEl.innerHTML = ''
      countdownTimer = 0
      setRecording(true)
      return
    }
    countdownEl.innerHTML = `<b>${n}</b>` // fresh node restarts the pop animation
    countdownEl.classList.add('show')
    n--
    countdownTimer = setTimeout(tick, 800)
  }
  tick()
}
function cancelCountdown() {
  if (!countdownTimer) return
  clearTimeout(countdownTimer)
  countdownTimer = 0
  countdownEl.classList.remove('show')
  countdownEl.innerHTML = ''
  recLabel.textContent = 'Start recording'
  setSwapped(false)
}
recBtn.onclick = () => startRecordFlow(!(recording || countdownTimer))

function setRecording(on) {
  if (on === recording) return
  if (on && playback) return
  recording = on
  recBtn.classList.toggle('rec', on)
  recLabel.textContent = on ? 'Stop · 0.0s' : 'Start recording'
  send({ type: 'recState', on })
  if (on) {
    recStart = performance.now()
    recFrames = []
  } else {
    if (recFrames && recFrames.length > 5) {
      const dur = (performance.now() - recStart) / 1000
      const take = { id: Date.now(), name: `Take ${takes.length + 1}`, dur, raw: recFrames, frames: recFrames, smooth: 0 }
      takes.push(take)
      chosenId = take.id // the fresh take is the motion — analyze it
      renderTakes()
      toast(`${take.name} saved — ${dur.toFixed(1)}s`)
      updateCameraLanguage()
    }
    recFrames = null
    setSwapped(false) // back to the editor with the curve panel up
  }
}

function renderTakes() {
  takesEl.innerHTML = ''
  for (const t of takes) {
    const el = document.createElement('div')
    el.className = 'take' + (t.id === chosenId ? ' chosen' : '')
    el.innerHTML = `<span class="nm">${t.name}</span><span class="dur">${t.dur.toFixed(1)}s</span>`
    const play = document.createElement('button')
    play.innerHTML = icon('play')
    play.title = 'Play this take'
    play.onclick = () => { playback = { take: t, t0: performance.now() } }
    const use = document.createElement('button')
    use.innerHTML = icon('check')
    use.title = 'Use this take as the motion'
    use.onclick = () => { chosenId = t.id; renderTakes(); updateCameraLanguage() }
    const del = document.createElement('button')
    del.innerHTML = icon('x')
    del.title = 'Delete this take'
    del.onclick = () => {
      takes.splice(takes.indexOf(t), 1)
      if (chosenId === t.id) chosenId = takes.length ? takes[takes.length - 1].id : null
      renderTakes()
      updateCameraLanguage()
    }
    el.append(play, use, del)
    takesEl.append(el)
  }
  renderAttachments()
  updateCurvePanel()
}

function samplePose(take, tSec, cam) {
  const fs = take.frames
  const ms = Math.min(tSec * 1000, fs[fs.length - 1].t)
  let i = 0
  while (i < fs.length - 2 && fs[i + 1].t < ms) i++
  const a = fs[i]
  const b = fs[i + 1]
  const k = THREE.MathUtils.clamp((ms - a.t) / Math.max(1, b.t - a.t), 0, 1)
  cam.position.fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p), k)
  const qa = new THREE.Quaternion().fromArray(a.q)
  const qb = new THREE.Quaternion().fromArray(b.q)
  cam.quaternion.copy(qa.slerp(qb, k))
}

function playbackTick() {
  const { take, t0 } = playback
  const t = (performance.now() - t0) / 1000
  if (t >= take.dur || t * 1000 >= take.frames[take.frames.length - 1].t) { playback = null; return }
  samplePose(take, t, filmCam)
}

// ---------------------------------------------------------------- movement curves
// After-Effects-style channel view of the chosen take (position X/Y/Z over
// time) with a smoothing dial — refine the performed move without re-doing it
const curvePanel = document.getElementById('curvePanel')
const curveCanvas = document.getElementById('curveCanvas')
const smoothEl = document.getElementById('smooth')

function smoothFrames(raw, s) {
  const out = raw.map((f) => ({ t: f.t, p: [...f.p], q: [...f.q] }))
  if (!s) return out
  const win = Math.max(1, Math.round(s * 14)) // frames each side, ~0.25s at full strength
  for (let i = 0; i < raw.length; i++) {
    const a = Math.max(0, i - win)
    const b = Math.min(raw.length - 1, i + win)
    const p = [0, 0, 0]
    const q = [0, 0, 0, 0]
    for (let j = a; j <= b; j++) {
      for (let k = 0; k < 3; k++) p[k] += raw[j].p[k]
      // keep quaternions in the same hemisphere before averaging
      const dot = raw[j].q[0] * raw[i].q[0] + raw[j].q[1] * raw[i].q[1]
        + raw[j].q[2] * raw[i].q[2] + raw[j].q[3] * raw[i].q[3]
      const sgn = dot < 0 ? -1 : 1
      for (let k = 0; k < 4; k++) q[k] += sgn * raw[j].q[k]
    }
    const n = b - a + 1
    out[i].p = p.map((v) => v / n)
    const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1
    out[i].q = q.map((v) => v / len)
  }
  return out
}

const CURVE_COLORS = ['#e5484d', '#46a758', '#5b8def'] // X Y Z
function drawCurves(take) {
  const dpr = Math.min(devicePixelRatio, 2)
  const W = curveCanvas.clientWidth * dpr
  const H = curveCanvas.clientHeight * dpr
  curveCanvas.width = W
  curveCanvas.height = H
  const ctx = curveCanvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)

  // grid
  ctx.strokeStyle = '#1e222a'
  ctx.lineWidth = 1
  for (let gy = 1; gy < 4; gy++) {
    ctx.beginPath()
    ctx.moveTo(0, H * gy / 4)
    ctx.lineTo(W, H * gy / 4)
    ctx.stroke()
  }

  const fs = take.frames
  const t1 = fs[fs.length - 1].t || 1
  const pad = 8 * dpr
  for (let ch = 0; ch < 3; ch++) {
    let min = Infinity
    let max = -Infinity
    for (const f of fs) { min = Math.min(min, f.p[ch]); max = Math.max(max, f.p[ch]) }
    const span = Math.max(max - min, 0.02) // flat channels stay centered
    const mid = (min + max) / 2
    ctx.strokeStyle = CURVE_COLORS[ch]
    ctx.lineWidth = 1.5 * dpr
    ctx.beginPath()
    for (let i = 0; i < fs.length; i++) {
      const x = (fs[i].t / t1) * (W - 2 * pad) + pad
      const y = H / 2 - ((fs[i].p[ch] - mid) / span) * (H - 2 * pad) * 0.9
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

function updateCurvePanel() {
  const take = takes.find((t) => t.id === chosenId)
  const show = Boolean(take) && !swapped && !recording
  curvePanel.classList.toggle('show', show)
  if (!show) return
  document.getElementById('curveTitle').textContent = `MOVEMENT — ${take.name.toUpperCase()} · ${take.dur.toFixed(1)}S`
  smoothEl.value = String(take.smooth)
  document.getElementById('smoothVal').textContent = take.smooth.toFixed(2)
  drawCurves(take)
}

smoothEl.oninput = () => {
  const take = takes.find((t) => t.id === chosenId)
  if (!take) return
  take.smooth = Number(smoothEl.value)
  take.frames = smoothFrames(take.raw, take.smooth)
  document.getElementById('smoothVal').textContent = take.smooth.toFixed(2)
  drawCurves(take)
}
smoothEl.onchange = () => updateCameraLanguage() // re-read the refined move

// the performed move, translated to cinematographer language — shown on the
// motion attachment and injected into the prompt in Beautiful mode
let cameraLanguage = null
async function updateCameraLanguage() {
  const take = takes.find((t) => t.id === chosenId)
  cameraLanguage = null
  renderAttachments()
  if (!take) return
  const forId = chosenId
  try {
    const r = await fetch('/api/camera-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: take.frames }),
    })
    const out = await r.json()
    if (!r.ok) throw new Error(out.error || r.statusText)
    if (chosenId === forId) { cameraLanguage = out; renderAttachments() }
  } catch (err) {
    console.error(err)
  }
}

// ---------------------------------------------------------------- depth render
const depthMat = new THREE.ShaderMaterial({
  uniforms: { uNear: { value: 1.0 }, uFar: { value: 25 } },
  vertexShader: `varying float vZ;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uNear; uniform float uFar; varying float vZ;
    void main() {
      float inv = (1.0 / max(vZ, 0.001) - 1.0 / uFar) / (1.0 / uNear - 1.0 / uFar);
      // gamma lift toward the MiDaS-like tonal range depth-conditioned models expect
      gl_FragColor = vec4(vec3(pow(clamp(inv, 0.0, 1.0), 0.5)), 1.0);
    }`,
})

// MiDaS-style inverse depth (white = near) rendered from a pose sampler,
// exactly `n` frames (VACE minimum is 81). poseAt(u, cam) poses the camera
// for normalized time u ∈ [0,1].
function renderDepthFramesFrom(poseAt, n = 81) {
  const W = 832
  const H = 480
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const r2 = new THREE.WebGLRenderer({ canvas: cv, antialias: true })
  r2.setPixelRatio(1)
  r2.setSize(W, H, false)
  const cam2 = new THREE.PerspectiveCamera(filmCam.fov, W / H, 0.05, 60)

  const restore = {
    fog: scene.fog, bg: scene.background,
    grid: grid.visible, helper: camHelper.visible, body: camBody.visible,
    emissive: cube.material.emissive.getHex(),
  }
  scene.fog = null
  scene.background = new THREE.Color(0x000000)
  grid.visible = camHelper.visible = camBody.visible = false
  cube.material.emissive.setHex(0x000000)
  scene.overrideMaterial = depthMat

  const frames = []
  for (let i = 0; i < n; i++) {
    poseAt(i / (n - 1), cam2)
    cam2.updateMatrixWorld()
    r2.render(scene, cam2)
    frames.push(cv.toDataURL('image/png'))
  }

  scene.overrideMaterial = null
  scene.fog = restore.fog
  scene.background = restore.bg
  grid.visible = restore.grid
  camHelper.visible = restore.helper
  camBody.visible = restore.body
  cube.material.emissive.setHex(restore.emissive)
  r2.dispose()
  return frames
}

function renderDepthFrames(take, n = 81) {
  return renderDepthFramesFrom((u, cam) => samplePose(take, u * take.dur, cam), n)
}

// ---------------------------------------------------------------- main prompt bar
const promptInput = document.getElementById('promptInput')
const promptMic = document.getElementById('promptMic')
const promptSend = document.getElementById('promptSend')
const attachRow = document.getElementById('attachRow')
const refFile = document.getElementById('refFile')
const PROMPT_PLACEHOLDER = 'Describe the look & atmosphere of the shot…'
const DEFAULT_PROMPT = 'A single object on the floor of an empty concrete warehouse at night, '
  + 'hard rim lighting through haze, volumetric light shafts, cinematic 35mm film, '
  + 'moody teal and amber color grade'
const refs = [] // reference images as data URLs

function chipEl(iconName, text, onRemove, onClick) {
  const c = document.createElement('div')
  c.className = 'attach'
  c.innerHTML = `${icon(iconName)}<span class="txt"></span>`
  c.querySelector('.txt').textContent = text
  if (onClick) {
    c.style.cursor = 'pointer'
    c.onclick = onClick
  }
  const x = document.createElement('button')
  x.innerHTML = icon('x')
  x.title = 'Remove'
  x.onclick = (e) => { e.stopPropagation(); onRemove() }
  c.append(x)
  return c
}

// the prompt is assembled from attachments, like images in a chat composer:
// [object] + [motion take] + [reference images] + the typed look
function renderAttachments() {
  attachRow.innerHTML = ''
  if (objectPrompt) {
    attachRow.append(chipEl('box', objectPrompt,
      () => { objectPrompt = ''; localStorage.setItem('blocking-object-v1', ''); renderAttachments() },
      () => setCubeBox(true)))
  }
  const take = takes.find((t) => t.id === chosenId)
  if (take) {
    const label = cameraLanguage?.move_name || `${take.name} · ${take.dur.toFixed(1)}s`
    attachRow.append(chipEl('video', label,
      () => { chosenId = null; renderTakes() }))
  }
  for (let i = 0; i < refs.length; i++) {
    const c = document.createElement('div')
    c.className = 'attach'
    const img = document.createElement('img')
    img.src = refs[i]
    const x = document.createElement('button')
    x.innerHTML = icon('x')
    x.title = 'Remove'
    x.onclick = () => { refs.splice(i, 1); renderAttachments() }
    c.append(img, x)
    attachRow.append(c)
  }
  attachRow.classList.toggle('has', attachRow.children.length > 0)
}

document.getElementById('refBtn').onclick = () => refFile.click()
refFile.onchange = () => {
  for (const f of refFile.files) {
    const fr = new FileReader()
    fr.onload = () => { refs.push(fr.result); renderAttachments() }
    fr.readAsDataURL(f)
  }
  refFile.value = ''
}

function setPromptBusy(on, label = 'Working…') {
  promptInput.disabled = on
  promptInput.placeholder = on ? label : PROMPT_PLACEHOLDER
  promptSend.disabled = on
}

function doSend() {
  if (generating) return toast('Already generating…')
  if (!takes.find((t) => t.id === chosenId)) {
    return toast('Record a camera take first — the motion is part of the prompt')
  }
  generate()
}
promptSend.onclick = doSend
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSend()
  if (e.key === 'Escape') promptInput.blur()
})

// ---------------------------------------------------------------- dictation (both mics)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition
let dictation = null // { micEl, target, speech? }
let mediaRec = null

function setDictUI(on) {
  if (!dictation) return
  dictation.micEl.classList.toggle('listening', on)
  dictation.micEl.innerHTML = icon(on ? 'square' : 'mic')
}
function stopDictation() {
  if (dictation?.speech) { try { dictation.speech.stop() } catch { /* already stopped */ } }
  if (mediaRec?.state === 'recording') mediaRec.stop()
}
function toggleDictation(micEl, target) {
  if (dictation) { stopDictation(); return }
  if (SR) startSpeechRec(micEl, target)
  else recorderFallback(micEl, target)
}
function startSpeechRec(micEl, target) {
  const speech = new SR()
  dictation = { micEl, target, speech }
  speech.continuous = true
  speech.interimResults = true
  speech.lang = 'en-US'
  const base = target.value ? target.value.replace(/\s*$/, ' ') : ''
  let finalText = ''
  speech.onresult = (e) => {
    let interim = ''
    for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript + ' ') : (interim += r[0].transcript))
    target.value = (base + finalText + interim).trimStart() // live transcript
  }
  speech.onend = () => { setDictUI(false); dictation = null }
  speech.onerror = (e2) => {
    speech.onend = null
    setDictUI(false)
    dictation = null
    if (e2.error === 'not-allowed') toast('Mic permission denied')
    else recorderFallback(micEl, target) // e.g. network-blocked speech service
  }
  speech.start()
  setDictUI(true)
}
async function recorderFallback(micEl, target) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    dictation = { micEl, target }
    const chunks = []
    mediaRec.ondataavailable = (e) => chunks.push(e.data)
    mediaRec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setDictUI(false)
      dictation = null
      const fr = new FileReader()
      fr.onload = async () => {
        const r = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: fr.result }),
        })
        const out = await r.json()
        if (r.ok && out.text) target.value = (target.value ? target.value + ' ' : '') + out.text
        else toast('Heard nothing — try again')
      }
      fr.readAsDataURL(new Blob(chunks, { type: 'audio/webm' }))
    }
    mediaRec.start()
    setDictUI(true)
    setTimeout(() => mediaRec?.state === 'recording' && mediaRec.stop(), 15_000)
  } catch {
    toast('No microphone available')
  }
}
promptMic.onclick = () => toggleDictation(promptMic, promptInput)
const cubeMic = document.getElementById('cubeMic')
cubeMic.onclick = () => toggleDictation(cubeMic, cubePrompt)

// ---------------------------------------------------------------- generate
function composePrompt() {
  const parts = []
  if (objectPrompt.trim()) parts.push(`Main object: ${objectPrompt.trim()}`)
  parts.push(promptInput.value.trim() || DEFAULT_PROMPT)
  return parts.join('. ')
}

let generating = false
let genMode = 'exact'
for (const [id, m] of [['modeExact', 'exact'], ['modeBeautiful', 'beautiful']]) {
  document.getElementById(id).onclick = () => {
    genMode = m
    document.getElementById('modeExact').classList.toggle('active', m === 'exact')
    document.getElementById('modeBeautiful').classList.toggle('active', m === 'beautiful')
  }
}

async function generate(promptOverride) {
  if (generating) return toast('Already generating…')
  const take = takes.find((t) => t.id === chosenId)
  if (!take) return toast('Record and choose a take first')
  let prompt = promptOverride || composePrompt()
  if (genMode === 'beautiful' && cameraLanguage?.camera_prompt) prompt += ` Camera: ${cameraLanguage.camera_prompt}`
  generating = true
  setPromptBusy(true, 'Rendering previz…')
  try {
    await new Promise((r) => setTimeout(r, 30)) // let the label paint
    const frames = renderDepthFrames(take)
    setPromptBusy(true, 'Generating… (~1–3 min)')
    toast('Depth previz uploaded — fal is dreaming')
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames, prompt, fps: 16, mode: genMode, refs }),
    })
    const out = await resp.json()
    if (!resp.ok) throw new Error(out.error || resp.statusText)
    showResult(out, prompt)
    return out
  } catch (err) {
    console.error(err)
    toast(`Generation failed: ${err.message}`)
  } finally {
    generating = false
    setPromptBusy(false)
  }
}

let syncTimer = 0
function showResult(out, prompt) {
  const vc = document.getElementById('vidControl')
  const vr = document.getElementById('vidResult')
  vc.src = out.control
  vr.src = out.local || out.video?.url
  // keep the loops in lockstep so the trajectory match stays visible
  clearInterval(syncTimer)
  syncTimer = setInterval(() => {
    if (vc.paused || !vc.duration || !vr.duration) return
    if (Math.abs(vc.currentTime - vr.currentTime) > 0.12) vr.currentTime = vc.currentTime
  }, 500)
  document.getElementById('resultInfo').textContent = prompt.slice(0, 90) + (prompt.length > 90 ? '…' : '')
  const dl = document.getElementById('resultDl')
  dl.href = out.local || out.video?.url || '#'
  document.getElementById('resultModal').classList.add('open')
  Promise.all([vc.play(), vr.play()]).catch(() => {})
}

// ---------------------------------------------------------------- coverage (multicam)
// One scene, several cameras derived from the blocking — every angle renders
// the same 3D truth, so the coverage set is geometrically consistent.
function coverageRig() {
  const actors = stage.children.filter((g) => g.userData.kind === 'actor')
  const props = stage.children.filter((g) => g.userData.kind === 'prop')
  if (!stage.children.length) return []

  const c = new THREE.Vector3()
  stage.children.forEach((g) => c.add(g.position))
  c.divideScalar(stage.children.length)
  c.y = 1.1

  let axis = new THREE.Vector3(1, 0, 0)
  if (actors.length >= 2) {
    axis = actors[1].position.clone().sub(actors[0].position).setY(0).normalize()
  }
  const perp = new THREE.Vector3(-axis.z, 0, axis.x)
  if (perp.z < 0) perp.negate() // shoot from the "front" side

  let span = 2
  stage.children.forEach((g) => { span = Math.max(span, g.position.distanceTo(c) * 2) })

  const push = (from, dir, amt, look) => (u, cam) => {
    cam.position.copy(from).addScaledVector(dir, amt * u)
    cam.lookAt(look)
  }
  const angles = []

  const wideFrom = c.clone().addScaledVector(perp, span * 1.4 + 2.6).setY(1.7)
  const wideDir = c.clone().sub(wideFrom).setY(0).normalize()
  angles.push({ key: 'wide', hint: 'wide establishing shot', poseAt: push(wideFrom, wideDir, 0.4, c) })

  if (props.length) {
    const t = props[0].position.clone().setY(0.5)
    const insFrom = t.clone().addScaledVector(perp, 2.4).addScaledVector(axis, 0.5).setY(1.15)
    const insDir = t.clone().sub(insFrom).normalize()
    angles.push({ key: 'insert', hint: 'medium close-up on the object, softly lit detail, shallow depth of field', poseAt: push(insFrom, insDir, 0.3, t) })
  }
  { // slow-arc b-roll
    const r = span * 0.9 + 1.8
    const a0 = Math.atan2(perp.x, perp.z) - 0.35
    angles.push({
      key: 'orbit', hint: 'slow cinematic arc, b-roll',
      poseAt: (u, cam) => {
        const a = a0 + u * 0.28
        cam.position.set(c.x + Math.sin(a) * r, 1.45, c.z + Math.cos(a) * r)
        cam.lookAt(c)
      },
    })
  }
  return angles
}

async function coverage() {
  if (generating) return toast('Already generating…')
  const rig = coverageRig()
  if (!rig.length) return toast('Nothing on stage to cover')
  const basePrompt = composePrompt()
  generating = true
  const covLabel = document.getElementById('covLabel')
  covLabel.textContent = 'Rendering rig…'
  try {
    await new Promise((r) => setTimeout(r, 30))
    const renders = rig.map((angle) => ({ angle, frames: renderDepthFramesFrom(angle.poseAt) }))
    covLabel.textContent = `Generating ${rig.length} angles…`
    toast(`Coverage: ${rig.map((a) => a.key).join(' · ')}`)
    const results = await Promise.all(renders.map(({ angle, frames }) =>
      fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames, prompt: `${basePrompt}, ${angle.hint}`, fps: 16 }),
      }).then(async (r) => {
        const out = await r.json()
        if (!r.ok) throw new Error(`${angle.key}: ${out.error || r.statusText}`)
        return { key: angle.key, ...out }
      }),
    ))
    covLabel.textContent = 'Cutting…'
    const cut = await fetch('/api/multicut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: results.map((r) => r.id) }),
    }).then((r) => r.json())
    if (cut.error) throw new Error(cut.error)
    showResult({ control: results[0].control, local: cut.result }, `${basePrompt} — multicam cut (${results.length} angles)`)
    toast('Coverage cut ready — every angle is in the dailies too')
    return { results, cut }
  } catch (err) {
    console.error(err)
    toast(`Coverage failed: ${err.message}`)
  } finally {
    generating = false
    covLabel.textContent = 'Coverage'
  }
}
document.getElementById('covBtn').onclick = () => coverage()

// ---------------------------------------------------------------- UI chrome
function send(obj) { if (ws.open) ws.sock.send(JSON.stringify(obj)) }

const pairModal = document.getElementById('pairModal')
window.pairModal = pairModal
document.getElementById('pairBtn').onclick = () => {
  const host = location.hostname
  const httpsUrl = `https://${host}:8443/phone.html`
  const httpUrl = `http://${host}:8000/phone.html`
  document.getElementById('qrImg').src = `/qr.svg?u=${encodeURIComponent(httpsUrl)}`
  document.getElementById('urlHttps').textContent = httpsUrl
  document.getElementById('urlHttp').textContent = httpUrl
  pairModal.classList.add('open')
}

const falTgl = document.getElementById('falTgl')
async function refreshFal(announce) {
  let on = false
  try {
    const c = await fetch('/api/config').then((r) => r.json())
    on = Boolean(c.falKeySet)
  } catch { /* server unreachable — stay off */ }
  falTgl.classList.toggle('on', on)
  document.getElementById('dotFal').classList.toggle('on', on)
  document.getElementById('falState').textContent = on ? 'ready' : 'no key'
  if (announce) {
    toast(on
      ? 'fal key loaded — ready to generate'
      : 'FAL_KEY not set — add FAL_KEY=… to a .env file and restart the server')
  }
  return on
}
refreshFal(false)
falTgl.onclick = () => refreshFal(true)
phoneTgl.onclick = () => document.getElementById('pairBtn').click()

let toastTimer = 0
function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600)
}

// scripting/debug hook
window.__blocking = {
  generate, coverage, coverageRig, renderDepthFrames, renderDepthFramesFrom,
  takes: () => takes, cameraLanguage: () => cameraLanguage, updateCameraLanguage,
  showResult, refs,
  objectPrompt: () => objectPrompt,
  setObject: (s) => { objectPrompt = s; localStorage.setItem('blocking-object-v1', s); renderAttachments() },
  cubeBoxOpen: () => cubeBox.classList.contains('open'),
  cubeScreenPos: () => {
    const v = cube.getWorldPosition(new THREE.Vector3()).setY(0.5).project(swapped ? filmCam : editorCam)
    return [Math.round((v.x + 1) / 2 * renderer.domElement.clientWidth),
      Math.round((1 - v.y) / 2 * renderer.domElement.clientHeight)]
  },
  composePrompt,
}

renderAttachments()

// ---------------------------------------------------------------- render loop
let last = performance.now()
renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now

  if (playback) playbackTick()
  else if (simMode) simTick(dt)
  else if (livePose.fresh) {
    filmCam.position.lerp(livePose.p, 0.6)
    filmCam.quaternion.slerp(livePose.q, 0.6)
  }

  camBody.position.copy(filmCam.position)
  camBody.quaternion.copy(filmCam.quaternion)
  filmCam.updateMatrixWorld()
  camHelper.update()

  if (cubeBox.classList.contains('open')) positionCubeBox()

  if (recording && recFrames) {
    recFrames.push({ t: now - recStart, p: filmCam.position.toArray(), q: filmCam.quaternion.toArray() })
    recLabel.textContent = `Stop · ${((now - recStart) / 1000).toFixed(1)}s`
    if (now - recStart > 30_000) setRecording(false) // safety stop
  }

  const w = renderer.domElement.clientWidth
  const h = renderer.domElement.clientHeight

  // single pass — viewport takes CSS pixels; three.js applies the pixel
  // ratio itself (passing device pixels double-scales on retina)
  camHelper.visible = camBody.visible = !swapped
  if (swapped) { filmCam.aspect = w / h; filmCam.updateProjectionMatrix() }
  renderer.setViewport(0, 0, w, h)
  renderer.render(scene, swapped ? filmCam : editorCam)
})
