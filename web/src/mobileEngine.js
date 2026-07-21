import * as THREE from 'three'

// A single-view three.js studio sized for a phone: the film camera IS the
// only camera. You perform it by dragging (orbit + pinch-dolly) or by moving
// the phone (device orientation adds pan/tilt). The live view is the exact
// 16:9 frame that gets generated, and the recorded pose stream renders to the
// same MiDaS-style depth video the desktop app produces.
//
// handlers: onCubeTap(), onRecording({on, elapsed}), onTakeSaved(take),
//           onToast(msg)

const TARGET = new THREE.Vector3(0, 0.7, 0)

export function createMobileEngine(container, handlers = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.touchAction = 'none'

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x15171c)
  scene.fog = new THREE.Fog(0x15171c, 20, 55)

  scene.add(new THREE.HemisphereLight(0xbcc7d6, 0x2a2620, 0.9))
  const sun = new THREE.DirectionalLight(0xffe8c4, 1.6)
  sun.position.set(5, 9, 4)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = sun.shadow.camera.bottom = -12
  sun.shadow.camera.right = sun.shadow.camera.top = 12
  scene.add(sun)

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(24, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.95 }),
  )
  ground.receiveShadow = true
  scene.add(ground)
  const grid = new THREE.GridHelper(24, 24, 0x3a3f4a, 0x2b2f37)
  scene.add(grid)

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x8f97a3, roughness: 0.8, emissive: 0xe8a33d, emissiveIntensity: 0 }),
  )
  cube.position.y = 0.6
  cube.castShadow = cube.receiveShadow = true
  scene.add(cube)
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.55 }),
  )
  edges.userData.editorOnly = true // stays out of the depth pass
  cube.add(edges)
  let cubeFilled = false

  // film camera — portrait 9:16 (a phone shoots vertical); the on-screen
  // viewport is letterboxed to exactly this frame so it's WYSIWYG
  const ASPECT = 9 / 16
  const cam = new THREE.PerspectiveCamera(52, ASPECT, 0.05, 60)

  // the centered 9:16 band inside the (portrait-ish) canvas, in CSS px
  function bandRect() {
    const w = renderer.domElement.clientWidth
    const h = renderer.domElement.clientHeight
    const bw = Math.min(w, h * ASPECT)
    const bh = bw / ASPECT
    return { x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh }
  }

  // ---- orbit state (dragging), plus a device-orientation offset (motion) ----
  const orbit = { az: 0, el: 0.26, dist: 4.6 }
  const motion = { on: false, az0: null, el0: null, az: 0, el: 0 }

  function applyCamera() {
    const az = orbit.az + motion.az
    const el = THREE.MathUtils.clamp(orbit.el + motion.el, -0.25, 1.35)
    const d = orbit.dist
    cam.position.set(
      TARGET.x + d * Math.cos(el) * Math.sin(az),
      TARGET.y + d * Math.sin(el),
      TARGET.z + d * Math.cos(el) * Math.cos(az),
    )
    cam.lookAt(TARGET)
  }
  applyCamera()

  // ---------------------------------------------------------------- touch
  const pointers = new Map()
  let pinchDist0 = 0
  let orbitDist0 = 0
  let downAt = 0
  let moved = 0
  const el = renderer.domElement

  const dist2 = () => {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture?.(e.pointerId) } catch { /* no active pointer */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 1) { downAt = performance.now(); moved = 0 }
    if (pointers.size === 2) { pinchDist0 = dist2(); orbitDist0 = orbit.dist }
  })
  el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    moved += Math.abs(dx) + Math.abs(dy)
    if (pointers.size === 1 && !motion.on) {
      const k = 0.005
      orbit.az -= dx * k
      orbit.el = THREE.MathUtils.clamp(orbit.el + dy * k, -0.15, 1.3)
      applyCamera()
    } else if (pointers.size === 2) {
      const s = dist2() / Math.max(1, pinchDist0)
      orbit.dist = THREE.MathUtils.clamp(orbitDist0 / s, 1.8, 8)
      applyCamera()
    }
  })
  const onUp = (e) => {
    const wasTap = pointers.size === 1 && moved < 10 && performance.now() - downAt < 300
    pointers.delete(e.pointerId)
    if (wasTap) tapAt(e.clientX, e.clientY)
  }
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId))

  const ray = new THREE.Raycaster()
  function tapAt(cx, cy) {
    const r = el.getBoundingClientRect()
    const b = bandRect()
    const rx = cx - r.left - b.x
    const ry = cy - r.top - b.y
    if (rx < 0 || ry < 0 || rx > b.w || ry > b.h) return // tapped a letterbox bar
    const ndc = new THREE.Vector2((rx / b.w) * 2 - 1, -((ry / b.h) * 2 - 1))
    ray.setFromCamera(ndc, cam)
    if (ray.intersectObject(cube, false).length) handlers.onCubeTap?.()
  }

  // ------------------------------------------------ device-orientation motion
  let orientHandler = null
  function setMotion(on) {
    if (on === motion.on) return // idempotent — never stack listeners
    motion.on = on
    if (on) {
      motion.az0 = motion.el0 = null
      orientHandler = (ev) => {
        if (ev.alpha == null) return
        if (motion.az0 == null) { motion.az0 = ev.alpha; motion.el0 = ev.beta }
        // turning the phone left/right pans; tilting it up/down tilts
        motion.az = THREE.MathUtils.degToRad(shortestDeg(ev.alpha - motion.az0))
        motion.el = THREE.MathUtils.degToRad(-(ev.beta - motion.el0)) * 0.8
        applyCamera()
      }
      addEventListener('deviceorientation', orientHandler)
    } else if (orientHandler) {
      removeEventListener('deviceorientation', orientHandler)
      orientHandler = null
      motion.az = motion.el = 0
      applyCamera()
    }
  }
  function recenterMotion() { motion.az0 = motion.el0 = null }
  const shortestDeg = (d) => ((d + 540) % 360) - 180

  // ---------------------------------------------------------------- takes
  let recording = false
  let recStart = 0
  let recFrames = null
  let takeCount = 0
  let playback = null // {take, t0}

  function startRecording() {
    if (recording) return
    playback = null
    recording = true
    recStart = performance.now()
    recFrames = []
    handlers.onRecording?.({ on: true, elapsed: 0 })
  }
  function stopRecording() {
    if (!recording) return
    recording = false
    handlers.onRecording?.({ on: false, elapsed: 0 })
    const frames = recFrames
    recFrames = null
    if (frames && frames.length > 5) {
      const dur = frames[frames.length - 1].t / 1000
      const take = { id: Date.now(), name: `Take ${++takeCount}`, dur, frames }
      handlers.onTakeSaved?.(take)
    } else {
      handlers.onToast?.('Too short — hold while you move the shot')
    }
  }

  function samplePose(take, tSec, c) {
    const fs = take.frames
    const ms = Math.min(tSec * 1000, fs[fs.length - 1].t)
    let i = 0
    while (i < fs.length - 2 && fs[i + 1].t < ms) i++
    const a = fs[i]
    const b = fs[i + 1]
    const k = THREE.MathUtils.clamp((ms - a.t) / Math.max(1, b.t - a.t), 0, 1)
    c.position.fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p), k)
    const qa = new THREE.Quaternion().fromArray(a.q)
    const qb = new THREE.Quaternion().fromArray(b.q)
    c.quaternion.copy(qa.slerp(qb, k))
  }
  function playTake(take) { playback = { take, t0: performance.now() } }

  // ------------------------------------------------ depth render (control)
  const depthMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `varying float vZ;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vZ;
      void main() {
        float inv = (1.0 / max(vZ, 0.001) - 1.0 / 25.0) / (1.0 / 1.0 - 1.0 / 25.0);
        gl_FragColor = vec4(vec3(pow(clamp(inv, 0.0, 1.0), 0.5)), 1.0);
      }`,
  })

  // one offscreen renderer, reused across shots — a fresh WebGLRenderer per
  // Send leaks a GL context and Chrome evicts the (oldest) live studio one
  const DW = 480 // portrait 9:16 control video → portrait generation
  const DH = 854
  let depthR = null
  let depthCam = null
  function ensureDepthRenderer() {
    if (depthR) return
    const cv = document.createElement('canvas')
    cv.width = DW
    cv.height = DH
    depthR = new THREE.WebGLRenderer({ canvas: cv, antialias: true })
    depthR.setPixelRatio(1)
    depthR.setSize(DW, DH, false)
    depthCam = new THREE.PerspectiveCamera(cam.fov, DW / DH, 0.05, 60)
  }

  function renderDepthFrames(take, n = 81) {
    ensureDepthRenderer()
    const cv = depthR.domElement
    const savedFog = scene.fog
    const savedBg = scene.background
    const frames = []
    try {
      scene.fog = null
      scene.background = new THREE.Color(0x000000)
      grid.visible = false
      edges.visible = false
      scene.overrideMaterial = depthMat
      for (let i = 0; i < n; i++) {
        samplePose(take, (i / (n - 1)) * take.dur, depthCam)
        depthCam.updateMatrixWorld()
        depthR.render(scene, depthCam)
        frames.push(cv.toDataURL('image/png'))
      }
    } finally {
      // always hand the shared scene back to the live view intact
      scene.overrideMaterial = null
      scene.fog = savedFog
      scene.background = savedBg
      grid.visible = true
      edges.visible = !cubeFilled
    }
    return frames
  }

  // ---------------------------------------------------------------- resize
  function resize() {
    renderer.setSize(container.clientWidth, container.clientHeight)
    cam.aspect = ASPECT // fixed 9:16 — the band, not the screen, defines the frame
    cam.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()

  // ---------------------------------------------------------------- loop
  let recTick = 0
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    if (playback) {
      const t = (now - playback.t0) / 1000
      if (t >= playback.take.dur) playback = null
      else samplePose(playback.take, t, cam)
    }
    if (recording && recFrames) {
      recFrames.push({ t: now - recStart, p: cam.position.toArray(), q: cam.quaternion.toArray() })
      if (now - recTick > 100) {
        recTick = now
        handlers.onRecording?.({ on: true, elapsed: (now - recStart) / 1000 })
      }
      if (now - recStart > 30_000) { stopRecording(); handlers.onToast?.('Auto-stopped at 30s') }
    }
    cube.material.emissiveIntensity = cubeFilled ? 0 : 0.1 + 0.08 * Math.sin(now / 400)

    // black out the letterbox, then render the scene only inside the 9:16 band
    const w = renderer.domElement.clientWidth
    const h = renderer.domElement.clientHeight
    const b = bandRect()
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, w, h)
    renderer.setClearColor(0x000000, 1)
    renderer.clear()
    const yb = h - b.y - b.h // three.js viewport origin is bottom-left
    renderer.setViewport(b.x, yb, b.w, b.h)
    renderer.setScissor(b.x, yb, b.w, b.h)
    renderer.setScissorTest(true)
    renderer.render(scene, cam)
  })

  return {
    setCubeFilled: (v) => { cubeFilled = v; edges.visible = !v },
    setMotion,
    recenterMotion,
    isRecording: () => recording,
    startRecording,
    stopRecording,
    renderDepthFrames,
    playTake,
    resetView: () => { orbit.az = 0; orbit.el = 0.26; orbit.dist = 4.6; motion.az = motion.el = 0; applyCamera() },
    dispose: () => {
      renderer.setAnimationLoop(null)
      removeEventListener('resize', resize)
      if (orientHandler) removeEventListener('deviceorientation', orientHandler)
      if (depthR) { depthR.forceContextLoss?.(); depthR.dispose() }
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
