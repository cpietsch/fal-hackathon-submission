import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// The imperative heart of Blocking: three.js stage, phone pose intake,
// takes, depth rendering. React owns every piece of DOM around it and talks
// to this engine through the returned API + the handlers it passes in.
//
// handlers: onCubeClick(), onBlankClick(), onTakeSaved(take),
//           onPresence(bool), onGenQueue(jobs), onRecording({on, elapsed})

export const ANCHOR = { pos: new THREE.Vector3(0, 1.5, 3.6), look: new THREE.Vector3(0, 0.7, 0) }

export function createEngine(container, handlers = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x15171c)
  scene.fog = new THREE.Fog(0x15171c, 24, 60)

  scene.add(new THREE.HemisphereLight(0xbcc7d6, 0x2a2620, 0.9))
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

  const editorCam = new THREE.PerspectiveCamera(50, 1, 0.1, 200)
  editorCam.position.set(5, 4, 6)
  const controls = new OrbitControls(editorCam, renderer.domElement)
  controls.target.set(0, 0.8, 0)
  controls.maxPolarAngle = Math.PI / 2 - 0.02
  controls.update()

  const filmCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 40)
  filmCam.position.copy(ANCHOR.pos)
  filmCam.lookAt(ANCHOR.look)
  const camHelper = new THREE.CameraHelper(filmCam)
  scene.add(camHelper)

  const camBody = new THREE.Group()
  {
    const m = new THREE.MeshStandardMaterial({ color: 0xd7dae0, roughness: 0.4 })
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.3), m)
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 20).rotateX(Math.PI / 2), m)
    lens.position.z = -0.2
    camBody.add(box, lens)
  }
  scene.add(camBody)

  // ---- the cube: single subject container, silhouette = depth proxy ----
  const stage = new THREE.Group()
  scene.add(stage)
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x8f97a3, roughness: 0.8, emissive: 0xe8a33d, emissiveIntensity: 0 }),
  )
  cube.position.y = 0.6
  cube.castShadow = cube.receiveShadow = true
  cube.userData.kind = 'prop'
  stage.add(cube)
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.55 }),
  )
  edges.userData.editorOnly = true // keep out of the depth pass
  cube.add(edges)

  let cubeFilled = false
  let toolboxOpen = false
  edges.visible = true // the undefined cube advertises itself

  // ---------------------------------------------------------- pointer input
  let swapped = false
  const ray = new THREE.Raycaster()

  function pipRect() {
    const w = renderer.domElement.clientWidth
    const h = renderer.domElement.clientHeight
    // fit between the prompt bar (bottom 130) and the vertically-centered
    // SHOT island (~island bottom h/2+110) — on laptop-height windows the
    // PiP shrinks instead of hiding under the island
    const maxPh = Math.max(120, h / 2 - 240)
    const pw = Math.round(Math.min(360, w * 0.28, maxPh * 16 / 9))
    const ph = Math.round(pw * 9 / 16)
    return { x: w - pw - 14, y: h - ph - 130, w: pw, h: ph } // CSS px, from top-left
  }
  function inPip(e) {
    const r = renderer.domElement.getBoundingClientRect()
    const p = pipRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h
  }

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (inPip(e)) { swapped = !swapped; handlers.onSwapped?.(swapped); return }
    const r = renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    )
    ray.setFromCamera(ndc, swapped ? filmCam : editorCam)
    if (ray.intersectObject(cube, false).length) handlers.onCubeClick?.()
    else handlers.onBlankClick?.()
  })

  const keys = new Set()
  const onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    if (e.code === 'KeyR' && !e.repeat) handlers.onRecordKey?.()
    keys.add(e.code)
  }
  const onKeyUp = (e) => keys.delete(e.code)
  addEventListener('keydown', onKeyDown)
  addEventListener('keyup', onKeyUp)

  function resize() {
    const w = container.clientWidth
    const h = container.clientHeight
    renderer.setSize(w, h)
    editorCam.aspect = w / h
    editorCam.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()

  // ------------------------------------------------------ phone pose intake
  let disposed = false
  const ws = { sock: null, open: false }
  function connectWS() {
    if (disposed) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const s = new WebSocket(`${proto}://${location.host}/ws`)
    ws.sock = s
    s.onopen = () => { ws.open = true; s.send(JSON.stringify({ type: 'hello', role: 'director' })) }
    s.onclose = () => { ws.open = false; handlers.onPresence?.(false); setTimeout(connectWS, 1500) }
    s.onmessage = (ev) => {
      let m
      try { m = JSON.parse(ev.data) } catch { return }
      if (m.type === 'presence') {
        const camOn = m.roles.includes('camera')
        handlers.onPresence?.(camOn)
        // heal REC desync for a (re)joining phone. Only the tab that is
        // actually recording answers — a second idle director tab would
        // otherwise stomp the phone's REC state with its own stale false.
        if (camOn && recording) wsSend({ type: 'recState', on: true })
      }
      else if (m.type === 'genQueue') handlers.onGenQueue?.(m.jobs)
      else if (m.type === 'genDone') handlers.onGenDone?.(m)
      else if (m.type === 'pose') onPose(m)
      // record requests go through the app's countdown flow when present
      else if (m.type === 'record') (handlers.onRecordRequest ?? setRecording)(m.on)
      else if (m.type === 'camStart') handlers.onCamStart?.()
      else if (m.type === 'camEnd') handlers.onCamEnd?.()
      else if (m.type === 'recState') applyRecState(m.on) // another director tab's truth
      else if (m.type === 'rezero') rezero()
    }
  }
  connectWS()
  function wsSend(obj) { if (ws.open) ws.sock.send(JSON.stringify(obj)) }

  // Calibration: first pose (or re-zero) maps phone pose -> film camera anchor.
  // Yaw-only correction keeps gravity honest; position pinned to the anchor.
  const calib = { pending: true, p0: new THREE.Vector3(), yawCorr: new THREE.Quaternion() }
  // ignored while recording — a mid-take re-zero would teleport the camera
  // and write a jump-cut into the take
  function rezero() { if (!recording) calib.pending = true }
  // room-scale steps read small on the virtual set — amplify (tuned on-device)
  let moveScale = 5
  const livePose = { p: new THREE.Vector3(), q: new THREE.Quaternion(), at: -Infinity }

  const yawOf = (q) => {
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
    }
    const rel = p.clone().sub(calib.p0).applyQuaternion(calib.yawCorr).multiplyScalar(moveScale)
    livePose.p.copy(ANCHOR.pos).add(rel)
    livePose.q.copy(calib.yawCorr).multiply(q)
    livePose.at = performance.now()
  }

  // ------------------------------------------------------------- sim camera
  let simMode = false
  const simEuler = new THREE.Euler(0, 0, 0, 'YXZ')
  {
    const aq = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(ANCHOR.pos, ANCHOR.look, new THREE.Vector3(0, 1, 0)),
    )
    simEuler.setFromQuaternion(aq)
  }
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

  // ------------------------------------------------------------------ takes
  let takeCount = 0
  let recording = false
  let recStart = 0
  let recFrames = null
  let playback = null // {take, t0}

  // another director tab started/stopped the take — mirror its state
  // locally without re-emitting (setRecording would broadcast again)
  function applyRecState(on) {
    if (on === recording) return
    recording = on
    if (on) {
      recStart = performance.now()
      recFrames = []
    } else {
      recFrames = null // the tab that ran the take owns it
    }
    handlers.onRecording?.({ on, elapsed: 0 })
  }

  function setRecording(on) {
    if (on === recording) return
    if (on) playback = null // rolling a take always wins over a replay
    recording = on
    wsSend({ type: 'recState', on })
    if (on) {
      recStart = performance.now()
      recFrames = []
      handlers.onRecording?.({ on: true, elapsed: 0 })
    } else {
      handlers.onRecording?.({ on: false, elapsed: 0 })
      if (recFrames && recFrames.length > 5) {
        const dur = (performance.now() - recStart) / 1000
        const take = { id: Date.now(), name: `Take ${++takeCount}`, dur, frames: recFrames }
        recFrames = null
        handlers.onTakeSaved?.(take)
      } else if (recFrames) {
        recFrames = null
        handlers.onToast?.('Take too short — hold REC while you move')
      }
    }
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

  // -------------------------------------------------- depth render (control)
  const depthMat = new THREE.ShaderMaterial({
    uniforms: { uNear: { value: 1.0 }, uFar: { value: 25 } },
    vertexShader: `varying float vZ;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uNear; uniform float uFar; varying float vZ;
      void main() {
        float inv = (1.0 / max(vZ, 0.001) - 1.0 / uFar) / (1.0 / uNear - 1.0 / uFar);
        // gamma lift toward the MiDaS-like tonal range depth models expect
        gl_FragColor = vec4(vec3(pow(clamp(inv, 0.0, 1.0), 0.5)), 1.0);
      }`,
  })

  // MiDaS-style inverse depth (white = near), exactly n frames (VACE min 81).
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

  const renderDepthFrames = (take, n = 81) =>
    renderDepthFramesFrom((u, cam) => samplePose(take, u * take.dur, cam), n)

  // ------------------------------------------- coverage rig (script feature)
  function coverageRig() {
    const c = cube.position.clone().setY(1.1)
    const perp = new THREE.Vector3(0, 0, 1)
    const span = 2
    const push = (from, dir, amt, look) => (u, cam) => {
      cam.position.copy(from).addScaledVector(dir, amt * u)
      cam.lookAt(look)
    }
    const wideFrom = c.clone().addScaledVector(perp, span * 1.4 + 2.6).setY(1.7)
    const wideDir = c.clone().sub(wideFrom).setY(0).normalize()
    const t = cube.position.clone().setY(0.5)
    const insFrom = t.clone().addScaledVector(perp, 2.4).setX(0.5).setY(1.15)
    const insDir = t.clone().sub(insFrom).normalize()
    const r = span * 0.9 + 1.8
    const a0 = Math.atan2(perp.x, perp.z) - 0.35
    return [
      { key: 'wide', hint: 'wide establishing shot', poseAt: push(wideFrom, wideDir, 0.4, c) },
      { key: 'insert', hint: 'medium close-up on the object, softly lit detail, shallow depth of field', poseAt: push(insFrom, insDir, 0.3, t) },
      {
        key: 'orbit', hint: 'slow cinematic arc, b-roll',
        poseAt: (u, cam) => {
          const a = a0 + u * 0.28
          cam.position.set(c.x + Math.sin(a) * r, 1.45, c.z + Math.cos(a) * r)
          cam.lookAt(c)
        },
      },
    ]
  }

  // ------------------------------------------------------------ render loop
  const cubeTop = new THREE.Vector3()
  let last = performance.now()
  let lastRecEmit = 0
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now

    // a live phone pose outranks the fly keys; a phone that stopped
    // streaming hands the camera back to them
    const phoneLive = now - livePose.at < 500
    if (playback) playbackTick()
    else if (phoneLive) {
      filmCam.position.lerp(livePose.p, 0.6)
      filmCam.quaternion.slerp(livePose.q, 0.6)
    }
    else if (simMode) simTick(dt)

    camBody.position.copy(filmCam.position)
    camBody.quaternion.copy(filmCam.quaternion)
    filmCam.updateMatrixWorld()
    camHelper.update()

    // the cube invites a click until it knows what it is
    cube.material.emissiveIntensity = toolboxOpen ? 0.35
      : cubeFilled ? 0 : 0.1 + 0.08 * Math.sin(now / 400)

    if (recording && recFrames) {
      recFrames.push({ t: now - recStart, p: filmCam.position.toArray(), q: filmCam.quaternion.toArray() })
      if (now - lastRecEmit > 100) {
        lastRecEmit = now
        handlers.onRecording?.({ on: true, elapsed: (now - recStart) / 1000 })
      }
      if (now - recStart > 30_000) { // safety stop
        setRecording(false)
        handlers.onToast?.('Recording auto-stopped at 30s')
      }
    }

    const w = renderer.domElement.clientWidth
    const h = renderer.domElement.clientHeight
    const pip = pipRect()

    const mainCam = swapped ? filmCam : editorCam
    const pipCam = swapped ? editorCam : filmCam

    // main pass — setViewport/setScissor take CSS px (three.js applies the
    // pixel ratio itself; scaling here too breaks hit-testing on HiDPI)
    camHelper.visible = camBody.visible = mainCam === editorCam
    if (mainCam === filmCam) { filmCam.aspect = w / h; filmCam.updateProjectionMatrix() }
    renderer.setViewport(0, 0, w, h)
    renderer.setScissorTest(false)
    renderer.render(scene, mainCam)

    // PiP pass (scissor coords are from bottom-left)
    camHelper.visible = camBody.visible = pipCam === editorCam
    if (pipCam === filmCam) { filmCam.aspect = pip.w / pip.h; filmCam.updateProjectionMatrix() }
    const py = h - pip.y - pip.h
    renderer.setViewport(pip.x, py, pip.w, pip.h)
    renderer.setScissor(pip.x, py, pip.w, pip.h)
    renderer.setScissorTest(true)
    renderer.render(scene, pipCam)
  })

  return {
    // state the UI pushes down
    setCubeFilled: (v) => { cubeFilled = v; edges.visible = !v },
    setToolboxOpen: (v) => { toolboxOpen = v },
    setMoveScale: (v) => { moveScale = v },
    setSim: (v) => { simMode = v },
    setSwapped: (v) => { swapped = v },
    isSwapped: () => swapped,
    rezero,
    setRecording,
    toggleRecording: () => setRecording(!recording),
    playTake: (take) => { playback = { take, t0: performance.now() } },
    // where the cube's toolbox should anchor, in CSS px
    projectCubeTop: () => {
      cubeTop.set(0, 1.45, 0).project(swapped ? filmCam : editorCam)
      const w = renderer.domElement.clientWidth
      const h = renderer.domElement.clientHeight
      return { x: (cubeTop.x * 0.5 + 0.5) * w, y: (-cubeTop.y * 0.5 + 0.5) * h }
    },
    // the cube's top-front corner, for the pinned "+" affordance
    projectCubeCorner: () => {
      cubeTop.set(0.6, 1.26, 0.6).project(swapped ? filmCam : editorCam)
      const w = renderer.domElement.clientWidth
      const h = renderer.domElement.clientHeight
      return { x: (cubeTop.x * 0.5 + 0.5) * w, y: (-cubeTop.y * 0.5 + 0.5) * h }
    },
    renderDepthFrames,
    renderDepthFramesFrom,
    coverageRig,
    wsSend,
    dispose: () => {
      disposed = true
      renderer.setAnimationLoop(null)
      removeEventListener('resize', resize)
      removeEventListener('keydown', onKeyDown)
      removeEventListener('keyup', onKeyUp)
      ws.sock?.close()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
