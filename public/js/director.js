import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// ---------------------------------------------------------------- scene setup
const view = document.getElementById('view')
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
view.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x15171c)
scene.fog = new THREE.Fog(0x15171c, 24, 60)

const hemi = new THREE.HemisphereLight(0xbcc7d6, 0x2a2620, 0.9)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffe8c4, 1.6)
sun.position.set(6, 10, 4)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
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

// ---------------------------------------------------------------- stage objects
const stage = new THREE.Group()
scene.add(stage)

const PALETTE = { actor: 0x8f97a3, prop: 0x8a7a62, wall: 0x565c66 }
let counter = 0

function makeObject(kind) {
  const g = new THREE.Group()
  if (kind === 'actor') {
    // rough humanoid mannequin — the depth silhouette must read "person",
    // a plain capsule gets textured as a literal capsule by VACE
    const m = mat(kind)
    const add = (geo, x, y, z, rz = 0) => {
      const p = new THREE.Mesh(geo, m)
      p.position.set(x, y, z)
      p.rotation.z = rz
      g.add(p)
    }
    add(new THREE.SphereGeometry(0.11, 16, 12), 0, 1.62, 0) // head
    add(new THREE.CapsuleGeometry(0.17, 0.42, 6, 12), 0, 1.18, 0) // torso
    add(new THREE.CapsuleGeometry(0.05, 0.5, 4, 8), -0.27, 1.1, 0, 0.14) // arms
    add(new THREE.CapsuleGeometry(0.05, 0.5, 4, 8), 0.27, 1.1, 0, -0.14)
    add(new THREE.CapsuleGeometry(0.07, 0.72, 4, 8), -0.1, 0.45, 0) // legs
    add(new THREE.CapsuleGeometry(0.07, 0.72, 4, 8), 0.1, 0.45, 0)
    add(new THREE.BoxGeometry(0.06, 0.06, 0.08), 0, 1.62, -0.13) // face marker
    g.children[g.children.length - 1].userData.editorOnly = true // keep out of depth pass
  } else if (kind === 'prop') {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), mat(kind))
    mesh.position.y = 0.45
    g.add(mesh)
  } else {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 0.12), mat(kind))
    mesh.position.y = 1.25
    g.add(mesh)
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true })
  g.userData = { kind, id: ++counter }
  return g
}
function mat(kind) {
  return new THREE.MeshStandardMaterial({ color: PALETTE[kind], roughness: 0.85 })
}

function addObject(kind, x = 0, z = 0) {
  const g = makeObject(kind)
  g.position.set(x, 0, z)
  stage.add(g)
  select(g)
  saveScene()
  return g
}

// ---------------------------------------------------------------- selection & drag
let selected = null
const ray = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
let dragging = false
const dragOffset = new THREE.Vector3()

function select(g) {
  if (selected) setEmissive(selected, 0x000000)
  selected = g
  if (g) setEmissive(g, 0x7a4d00)
}
function setEmissive(g, color) {
  g.traverse((o) => o.isMesh && o.material.emissive.setHex(color))
}

function pointerRay(e) {
  const r = renderer.domElement.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  )
  ray.setFromCamera(ndc, swapped ? filmCam : editorCam)
  return ray
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (inPip(e)) { swapped = !swapped; return }
  if (swapped || simMode) return // edit only from the editor view
  const hits = pointerRay(e).intersectObjects(stage.children, true)
  if (hits.length) {
    let g = hits[0].object
    while (g.parent !== stage) g = g.parent
    select(g)
    const p = new THREE.Vector3()
    pointerRay(e).ray.intersectPlane(groundPlane, p)
    dragOffset.copy(g.position).sub(p)
    dragging = true
    controls.enabled = false
  } else {
    select(null)
  }
})
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging || !selected) return
  const p = new THREE.Vector3()
  if (pointerRay(e).ray.intersectPlane(groundPlane, p)) {
    selected.position.set(
      THREE.MathUtils.clamp(p.x + dragOffset.x, -14, 14), 0,
      THREE.MathUtils.clamp(p.z + dragOffset.z, -14, 14),
    )
  }
})
addEventListener('pointerup', () => {
  if (dragging) saveScene()
  dragging = false
  controls.enabled = true
})

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return
  if (selected && (e.key === 'q' || e.key === 'Q')) { selected.rotation.y += Math.PI / 12; saveScene() }
  if (selected && (e.key === 'e' || e.key === 'E')) { selected.rotation.y -= Math.PI / 12; saveScene() }
  if (selected && (e.key === 'Delete' || e.key === 'Backspace')) {
    stage.remove(selected); select(null); saveScene()
  }
  if (e.key === 'Escape') select(null)
  keys.add(e.code)
})
addEventListener('keyup', (e) => keys.delete(e.code))
const keys = new Set()

// scene persistence (objects only)
function saveScene() {
  const objs = stage.children.map((g) => ({
    kind: g.userData.kind, x: g.position.x, z: g.position.z, ry: g.rotation.y,
  }))
  localStorage.setItem('blocking-scene-v1', JSON.stringify(objs))
}
function loadScene() {
  try {
    const objs = JSON.parse(localStorage.getItem('blocking-scene-v1') || 'null')
    if (!objs || !objs.length) throw 0
    for (const o of objs) {
      const g = makeObject(o.kind)
      g.position.set(o.x, 0, o.z)
      g.rotation.y = o.ry
      stage.add(g)
    }
  } catch {
    // default scene: two actors facing each other, a prop between
    addObject('actor', -1.1, 0).rotation.y = -Math.PI / 2
    addObject('actor', 1.1, 0).rotation.y = Math.PI / 2
    addObject('prop', 0, -1.6)
    select(null)
    saveScene()
  }
}
loadScene()

// ---------------------------------------------------------------- PiP views
let swapped = false // false: editor main + film PiP · true: film main + editor PiP
function pipRect() {
  const w = renderer.domElement.clientWidth
  const h = renderer.domElement.clientHeight
  const pw = Math.round(Math.min(360, w * 0.28))
  const ph = Math.round(pw * 9 / 16)
  return { x: w - pw - 14, y: h - ph - 76, w: pw, h: ph } // CSS px, from top-left
}
function inPip(e) {
  const r = renderer.domElement.getBoundingClientRect()
  const p = pipRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h
}

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
const dotPhone = document.getElementById('dotPhone')

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const s = new WebSocket(`${proto}://${location.host}/ws`)
  ws.sock = s
  s.onopen = () => { ws.open = true; s.send(JSON.stringify({ type: 'hello', role: 'director' })) }
  s.onclose = () => { ws.open = false; dotPhone.classList.remove('on'); setTimeout(connectWS, 1500) }
  s.onmessage = (ev) => {
    let m
    try { m = JSON.parse(ev.data) } catch { return }
    if (m.type === 'presence') dotPhone.classList.toggle('on', m.roles.includes('camera'))
    else if (m.type === 'genState' && generating) {
      genBtn.textContent = m.status === 'IN_QUEUE'
        ? `In queue${m.position != null ? ` #${m.position}` : ''}…`
        : 'Rendering on fal…'
    }
    else if (m.type === 'pose') onPose(m)
    else if (m.type === 'record') setRecording(m.on)
    else if (m.type === 'rezero') calib.pending = true
  }
}
connectWS()

// Calibration: first pose (or re-zero) maps phone pose -> film camera anchor.
// Yaw-only correction keeps gravity honest; position pinned to the anchor.
const calib = { pending: true, p0: new THREE.Vector3(), yawCorr: new THREE.Quaternion(), ok: false }
let moveScale = 1
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
  const rel = p.clone().sub(calib.p0).applyQuaternion(calib.yawCorr).multiplyScalar(moveScale)
  livePose.p.copy(ANCHOR.pos).add(rel)
  livePose.q.copy(calib.yawCorr).multiply(q)
  livePose.fresh = true
}

document.getElementById('rezeroBtn').onclick = () => { calib.pending = true }
const scaleEl = document.getElementById('scale')
scaleEl.oninput = () => {
  moveScale = Number(scaleEl.value)
  document.getElementById('scaleVal').textContent = String(moveScale)
}

// ---------------------------------------------------------------- sim camera
let simMode = false
const simBtn = document.getElementById('simBtn')
simBtn.onclick = () => {
  simMode = !simMode
  simBtn.classList.toggle('active', simMode)
  if (simMode) toast('Sim: WASD move · QZ up/down · arrows look')
}
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
const recTime = document.getElementById('recTime')
const takesEl = document.getElementById('takes')
recBtn.onclick = () => setRecording(!recording)

function setRecording(on) {
  if (on === recording) return
  if (on && playback) return
  recording = on
  recBtn.classList.toggle('rec', on)
  send({ type: 'recState', on })
  if (on) {
    recStart = performance.now()
    recFrames = []
  } else if (recFrames && recFrames.length > 5) {
    const dur = (performance.now() - recStart) / 1000
    const take = { id: Date.now(), name: `Take ${takes.length + 1}`, dur, frames: recFrames }
    takes.push(take)
    if (chosenId === null) chosenId = take.id
    recFrames = null
    renderTakes()
    toast(`${take.name} saved — ${dur.toFixed(1)}s`)
    if (chosenId === take.id) updateCameraLanguage()
  }
}

function renderTakes() {
  takesEl.innerHTML = ''
  for (const t of takes) {
    const el = document.createElement('div')
    el.className = 'take' + (t.id === chosenId ? ' chosen' : '')
    el.innerHTML = `<span class="nm">${t.name}</span><span class="dur">${t.dur.toFixed(1)}s</span>`
    const play = document.createElement('button')
    play.textContent = '▶'
    play.onclick = () => { playback = { take: t, t0: performance.now() } }
    const use = document.createElement('button')
    use.textContent = '✓'
    use.title = 'Use this take for generation'
    use.onclick = () => { chosenId = t.id; renderTakes(); updateCameraLanguage() }
    const del = document.createElement('button')
    del.textContent = '✕'
    del.onclick = () => {
      takes.splice(takes.indexOf(t), 1)
      if (chosenId === t.id) chosenId = takes.length ? takes[takes.length - 1].id : null
      renderTakes()
    }
    el.append(play, use, del)
    takesEl.append(el)
  }
  document.getElementById('genBtn').disabled = chosenId === null
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

// ---------------------------------------------------------------- depth render + generate
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
  }
  scene.fog = null
  scene.background = new THREE.Color(0x000000)
  grid.visible = camHelper.visible = camBody.visible = false
  const editorOnly = []
  stage.traverse((o) => { if (o.userData?.editorOnly && o.visible) { o.visible = false; editorOnly.push(o) } })
  scene.overrideMaterial = depthMat

  const frames = []
  for (let i = 0; i < n; i++) {
    poseAt(i / (n - 1), cam2)
    cam2.updateMatrixWorld()
    r2.render(scene, cam2)
    frames.push(cv.toDataURL('image/png'))
  }

  scene.overrideMaterial = null
  editorOnly.forEach((o) => { o.visible = true })
  scene.fog = restore.fog
  scene.background = restore.bg
  grid.visible = restore.grid
  camHelper.visible = restore.helper
  camBody.visible = restore.body
  r2.dispose()
  return frames
}

function renderDepthFrames(take, n = 81) {
  return renderDepthFramesFrom((u, cam) => samplePose(take, u * take.dur, cam), n)
}

const DEFAULT_PROMPT = 'Two figures in long dark coats stand facing each other in an empty concrete '
  + 'warehouse at night, a wooden crate between them, hard rim lighting through haze, '
  + 'volumetric light shafts, cinematic 35mm film, moody teal and amber color grade'
let shotSpec = { prompt: '' }

const genBtn = document.getElementById('genBtn')
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
  let prompt = promptOverride || shotSpec.prompt || DEFAULT_PROMPT
  if (genMode === 'beautiful' && shotSpec.camera) prompt += ` Camera: ${shotSpec.camera}`
  generating = true
  genBtn.textContent = 'Rendering previz…'
  try {
    await new Promise((r) => setTimeout(r, 30)) // let the label paint
    const frames = renderDepthFrames(take)
    genBtn.textContent = 'Generating… (~1–3 min)'
    toast('Depth previz uploaded — fal is dreaming')
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames, prompt, fps: 16, mode: genMode }),
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
    genBtn.textContent = 'Generate'
  }
}
genBtn.onclick = () => generate()

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

  if (actors.length >= 2) {
    const a = actors[0].position
    const b = actors[1].position
    const back = a.clone().sub(b).setY(0).normalize()
    const otsFrom = a.clone().addScaledVector(back, 0.65).addScaledVector(perp, 0.6).setY(1.72)
    const look = b.clone().setY(1.42)
    const otsDir = look.clone().sub(otsFrom).setY(0).normalize()
    angles.push({ key: 'ots', hint: 'over-the-shoulder shot, shallow depth of field', poseAt: push(otsFrom, otsDir, 0.18, look) })
  }
  if (props.length) {
    const t = props[0].position.clone().setY(0.5)
    const insFrom = t.clone().addScaledVector(perp, 2.4).addScaledVector(axis, 0.5).setY(1.15)
    const insDir = t.clone().sub(insFrom).normalize()
    angles.push({ key: 'insert', hint: 'medium close-up on the object, shallow depth of field', poseAt: push(insFrom, insDir, 0.3, t) })
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
  const basePrompt = shotSpec.prompt || DEFAULT_PROMPT
  generating = true
  const covBtn = document.getElementById('covBtn')
  covBtn.textContent = 'Rendering rig…'
  try {
    await new Promise((r) => setTimeout(r, 30))
    const renders = rig.map((angle) => ({ angle, frames: renderDepthFramesFrom(angle.poseAt) }))
    covBtn.textContent = `Generating ${rig.length} angles…`
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
    covBtn.textContent = 'Cutting…'
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
    covBtn.textContent = '🎥 Coverage'
  }
}

// ---------------------------------------------------------------- voice direction
const micBtn = document.getElementById('micBtn')
const specChips = document.getElementById('specChips')
let listening = false
let mediaRec = null

function sceneSummary() {
  const by = (k) => stage.children.filter((g) => g.userData.kind === k)
  const actors = by('actor')
  let s = `${actors.length} actor(s)`
  if (actors.length === 2) {
    s += `, ${actors[0].position.distanceTo(actors[1].position).toFixed(1)}m apart`
  }
  s += `, ${by('prop').length} prop(s), ${by('wall').length} wall(s).`
  s += ' Camera starts ~4m back at eye height, moving as the depth video shows.'
  return s
}

async function onTranscript(text) {
  if (!text || !text.trim()) { toast('Heard nothing — try again'); return }
  micBtn.textContent = '🎬 Parsing direction…'
  toast(`You said: “${text.trim().slice(0, 80)}”`)
  try {
    const r = await fetch('/api/direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: text, scene: sceneSummary() }),
    })
    const out = await r.json()
    if (!r.ok) throw new Error(out.error || r.statusText)
    applySpec(out.spec)
  } catch (err) {
    toast(`Direction failed: ${err.message}`)
  } finally {
    micBtn.textContent = '🎙 Speak the shot'
  }
}

function applySpec(spec) {
  shotSpec = { ...spec, prompt: spec.video_prompt || '' }
  specChips.innerHTML = ''
  for (const k of ['setting', 'subjects', 'action', 'lighting', 'mood', 'style']) {
    if (!spec[k]) continue
    const c = document.createElement('span')
    c.className = 'chip'
    c.title = k
    c.textContent = spec[k]
    specChips.append(c)
  }
  toast('Shot spec ready — choose a take and Generate')
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition
micBtn.onclick = () => {
  if (listening) { stopVoice(); return }
  if (SR) startSpeechRec()
  else startRecorderFallback()
}

let speech = null
function startSpeechRec() {
  speech = new SR()
  speech.continuous = true
  speech.interimResults = true
  speech.lang = 'en-US'
  let finalText = ''
  speech.onresult = (e) => {
    let interim = ''
    for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript + ' ') : (interim += r[0].transcript))
    micBtn.textContent = '● ' + (finalText + interim || 'listening…').slice(-26)
  }
  speech.onend = () => { setListening(false); onTranscript(finalText) }
  speech.onerror = (e) => {
    speech.onend = null
    setListening(false)
    if (e.error === 'not-allowed') toast('Mic permission denied')
    else startRecorderFallback() // e.g. network-blocked speech service
  }
  speech.start()
  setListening(true)
}

async function startRecorderFallback() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    const chunks = []
    mediaRec.ondataavailable = (e) => chunks.push(e.data)
    mediaRec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setListening(false)
      micBtn.textContent = '🎬 Transcribing…'
      const fr = new FileReader()
      fr.onload = async () => {
        const r = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: fr.result }),
        })
        const out = await r.json()
        onTranscript(r.ok ? out.text : '')
      }
      fr.readAsDataURL(new Blob(chunks, { type: 'audio/webm' }))
    }
    mediaRec.start()
    setListening(true)
    setTimeout(() => mediaRec?.state === 'recording' && mediaRec.stop(), 15_000)
  } catch {
    toast('No microphone available')
  }
}

function stopVoice() {
  if (speech) { try { speech.stop() } catch { /* already stopped */ } speech = null }
  if (mediaRec?.state === 'recording') mediaRec.stop()
}

function setListening(on) {
  listening = on
  micBtn.classList.toggle('listening', on)
  if (on) micBtn.textContent = '● listening… (tap to stop)'
  else if (!on && micBtn.textContent.startsWith('●')) micBtn.textContent = '🎙 Speak the shot'
}

// the performed move, translated to cinematographer language (for prompt-
// driven models and as a readable label for the director)
let cameraLanguage = null
async function updateCameraLanguage() {
  const take = takes.find((t) => t.id === chosenId)
  const chip = document.getElementById('camChip')
  if (!take) { chip.style.display = 'none'; return }
  chip.style.display = 'inline-block'
  chip.textContent = '📷 reading the move…'
  try {
    const r = await fetch('/api/camera-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: take.frames }),
    })
    const out = await r.json()
    if (!r.ok) throw new Error(out.error || r.statusText)
    cameraLanguage = out
    chip.textContent = `📷 ${out.move_name}`
    chip.title = out.camera_prompt
    shotSpec.camera = out.camera_prompt
  } catch (err) {
    chip.textContent = '📷 (unreadable move)'
    console.error(err)
  }
}

// scripting/debug hook
window.__blocking = {
  generate, renderDepthFrames, takes: () => takes,
  setSpec: (s) => { shotSpec = s }, onTranscript, sceneSummary, showResult,
  cameraLanguage: () => cameraLanguage, updateCameraLanguage, coverage, coverageRig,
  renderDepthFramesFrom,
}
document.getElementById('covBtn').onclick = () => coverage()

// ---------------------------------------------------------------- UI chrome
function send(obj) { if (ws.open) ws.sock.send(JSON.stringify(obj)) }

document.getElementById('addActor').onclick = () => addObject('actor', rnd(2), rnd(2))
document.getElementById('addProp').onclick = () => addObject('prop', rnd(3), rnd(3))
document.getElementById('addWall').onclick = () => addObject('wall', rnd(4), -3)
const rnd = (r) => (Math.random() - 0.5) * r

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

fetch('/api/config').then((r) => r.json()).then((c) => {
  document.getElementById('dotFal').classList.toggle('on', c.falKeySet)
})

let toastTimer = 0
function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600)
}

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

  if (recording && recFrames) {
    recFrames.push({ t: now - recStart, p: filmCam.position.toArray(), q: filmCam.quaternion.toArray() })
    recTime.textContent = `${((now - recStart) / 1000).toFixed(1)}s`
    if (now - recStart > 30_000) setRecording(false) // safety stop
  } else {
    recTime.textContent = playback ? '▶' : '0.0s'
  }

  const w = renderer.domElement.clientWidth
  const h = renderer.domElement.clientHeight
  const pip = pipRect()
  const dpr = renderer.getPixelRatio()

  const mainCam = swapped ? filmCam : editorCam
  const pipCam = swapped ? editorCam : filmCam

  // main pass
  camHelper.visible = camBody.visible = mainCam === editorCam
  if (mainCam === filmCam) { filmCam.aspect = w / h; filmCam.updateProjectionMatrix() }
  renderer.setViewport(0, 0, w * dpr, h * dpr)
  renderer.setScissorTest(false)
  renderer.render(scene, mainCam)

  // PiP pass (scissor coords are from bottom-left)
  camHelper.visible = camBody.visible = pipCam === editorCam
  if (pipCam === filmCam) { filmCam.aspect = pip.w / pip.h; filmCam.updateProjectionMatrix() }
  const py = h - pip.y - pip.h
  renderer.setViewport(pip.x * dpr, py * dpr, pip.w * dpr, pip.h * dpr)
  renderer.setScissor(pip.x * dpr, py * dpr, pip.w * dpr, pip.h * dpr)
  renderer.setScissorTest(true)
  renderer.render(scene, pipCam)
})
