import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]
export type Frame = { t: number; p: Vec3; q: Quat }
export type Take = {
  id: number; name: string; dur: number
  raw: Frame[]; frames: Frame[]; smooth: number
  // hand-edited curve: control points per channel + which channels are edited
  ctrl?: { t: number; v: number }[][]
  editedCh?: boolean[]
}
export type CoverageAngle = { key: string; hint: string; poseAt: (u: number, cam: THREE.PerspectiveCamera) => void }

export type StageCallbacks = {
  onCubeClick: () => void
  onEmptyClick: () => void
  onLockedClick: () => void
  onHoverCube: (hover: boolean) => void
  onRecTick: (seconds: number) => void
  onRecLimit: () => void
  onCalibrated: () => void
}

export const ANCHOR = { pos: new THREE.Vector3(0, 1.6, 4.2), look: new THREE.Vector3(0, 1.2, 0) }

export function samplePose(take: Take, tSec: number, cam: THREE.Object3D) {
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

// windowed average over the raw frames — positions averaged, quaternions
// hemisphere-aligned before blending
export function smoothFrames(raw: Frame[], s: number): Frame[] {
  const out: Frame[] = raw.map((f) => ({ t: f.t, p: [...f.p] as Vec3, q: [...f.q] as Quat }))
  if (!s) return out
  const win = Math.max(1, Math.round(s * 14))
  for (let i = 0; i < raw.length; i++) {
    const a = Math.max(0, i - win)
    const b = Math.min(raw.length - 1, i + win)
    const p = [0, 0, 0]
    const q = [0, 0, 0, 0]
    for (let j = a; j <= b; j++) {
      for (let k = 0; k < 3; k++) p[k] += raw[j].p[k]
      const dot = raw[j].q[0] * raw[i].q[0] + raw[j].q[1] * raw[i].q[1]
        + raw[j].q[2] * raw[i].q[2] + raw[j].q[3] * raw[i].q[3]
      const sgn = dot < 0 ? -1 : 1
      for (let k = 0; k < 4; k++) q[k] += sgn * raw[j].q[k]
    }
    const n = b - a + 1
    out[i].p = p.map((v) => v / n) as Vec3
    const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1
    out[i].q = q.map((v) => v / len) as Quat
  }
  return out
}

export type Stage = ReturnType<typeof createStage>

export function createStage(container: HTMLElement, cb: StageCallbacks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  // shadows only change when the stage changes — render the map once
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x15171c)
  scene.fog = new THREE.Fog(0x15171c, 24, 60)

  scene.add(new THREE.HemisphereLight(0xbcc7d6, 0x2a2620, 0.9))
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

  const editorCam = new THREE.PerspectiveCamera(50, 1, 0.1, 200)
  editorCam.position.set(7, 5.5, 8)
  const controls = new OrbitControls(editorCam, renderer.domElement)
  controls.target.set(0, 1, 0)
  controls.maxPolarAngle = Math.PI / 2 - 0.02
  controls.update()

  // virtual (film) camera — 16:9, ~32mm feel
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

  // ---- the cube: one centered proxy object
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
  // orange edge outline while the cube has no prompt yet — "define me"
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
    new THREE.LineBasicMaterial({ color: 0xe8a33d }),
  )
  outline.position.y = 0.5
  outline.visible = false
  outline.raycast = () => {} // lines have a fat raycast threshold — keep picking exact
  cubeGroup.add(outline)
  cubeGroup.userData = { kind: 'prop', id: 1 }
  stage.add(cubeGroup)

  // ---- state
  let swapped = false
  let simMode = false
  let recording = false
  let recStart = 0
  let recFrames: Frame[] | null = null
  let playback: { take: Take; t0: number } | null = null
  let hoveringCube = false
  let glowOpen = false
  const keys = new Set<string>()
  const livePose = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fresh: false, at: 0 }
  const calib = { pending: true, p0: new THREE.Vector3(), yawCorr: new THREE.Quaternion() }

  function applyCubeGlow() {
    ;(cube.material as THREE.MeshStandardMaterial).emissive.setHex(
      glowOpen ? 0x7a4d00 : hoveringCube ? 0x2a1c05 : 0x000000,
    )
  }

  // ---- picking: a click is down+up without dragging (orbit must not toggle)
  const ray = new THREE.Raycaster()
  function pointerRay(e: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    )
    ray.setFromCamera(ndc, swapped ? filmCam : editorCam)
    return ray
  }
  let downAt: [number, number] | null = null
  const onDown = (e: PointerEvent) => { downAt = [e.clientX, e.clientY] }
  const onUp = (e: PointerEvent) => {
    if (!downAt) return
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1])
    downAt = null
    if (moved > 5) return
    if (swapped || simMode) { cb.onLockedClick(); return }
    const hits = pointerRay(e).intersectObjects(stage.children, true)
    hits.length ? cb.onCubeClick() : cb.onEmptyClick()
  }
  const onMove = (e: PointerEvent) => {
    if (swapped || simMode) { renderer.domElement.style.cursor = ''; return }
    const over = pointerRay(e).intersectObjects(stage.children, true).length > 0
    if (over !== hoveringCube) {
      hoveringCube = over
      applyCubeGlow()
      cb.onHoverCube(over)
    }
    renderer.domElement.style.cursor = over ? 'pointer' : ''
  }
  renderer.domElement.addEventListener('pointerdown', onDown)
  renderer.domElement.addEventListener('pointerup', onUp)
  renderer.domElement.addEventListener('pointermove', onMove)

  const onKeyDown = (e: KeyboardEvent) => {
    if (/INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)) return
    keys.add(e.code)
  }
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code)
  addEventListener('keydown', onKeyDown)
  addEventListener('keyup', onKeyUp)

  // ---- fly controls
  const simEuler = new THREE.Euler(0, 0, 0, 'YXZ')
  {
    const aq = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(ANCHOR.pos, ANCHOR.look, new THREE.Vector3(0, 1, 0)),
    )
    simEuler.setFromQuaternion(aq)
  }
  function simTick(dt: number) {
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

  // ---- phone pose intake: first pose (or re-zero) maps phone -> anchor
  function yawOf(q: THREE.Quaternion) {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
    return Math.atan2(f.x, f.z)
  }
  function onPhonePose(m: { p: Vec3; q: Quat }) {
    const p = new THREE.Vector3(...m.p)
    const q = new THREE.Quaternion(...m.q)
    if (calib.pending) {
      calib.p0.copy(p)
      const anchorQ = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(ANCHOR.pos, ANCHOR.look, new THREE.Vector3(0, 1, 0)),
      )
      calib.yawCorr.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawOf(anchorQ) - yawOf(q))
      calib.pending = false
      cb.onCalibrated()
    }
    // real-world phone motion amplified onto the virtual set — 1m walked
    // moves the film camera 5m, so small rooms still yield real moves
    const MOVE_SCALE = 5
    const rel = p.clone().sub(calib.p0).applyQuaternion(calib.yawCorr).multiplyScalar(MOVE_SCALE)
    livePose.p.copy(ANCHOR.pos).add(rel)
    livePose.q.copy(calib.yawCorr).multiply(q)
    livePose.fresh = true
    livePose.at = performance.now()
  }

  // ---- resize
  function resize() {
    const w = container.clientWidth
    const h = container.clientHeight
    renderer.setSize(w, h)
    editorCam.aspect = w / h
    editorCam.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()

  // ---- depth render: MiDaS-style inverse depth (white = near), exactly n
  // frames (VACE minimum is 81); poseAt(u, cam) poses the camera for u ∈ [0,1]
  const depthMat = new THREE.ShaderMaterial({
    uniforms: { uNear: { value: 1.0 }, uFar: { value: 25 } },
    vertexShader: `varying float vZ;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uNear; uniform float uFar; varying float vZ;
      void main() {
        float inv = (1.0 / max(vZ, 0.001) - 1.0 / uFar) / (1.0 / uNear - 1.0 / uFar);
        gl_FragColor = vec4(vec3(pow(clamp(inv, 0.0, 1.0), 0.5)), 1.0);
      }`,
  })
  function renderDepthFramesFrom(poseAt: (u: number, cam: THREE.PerspectiveCamera) => void, n = 81): string[] {
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
      grid: grid.visible, helper: camHelper.visible, body: camBody.visible, outline: outline.visible,
    }
    scene.fog = null
    scene.background = new THREE.Color(0x000000)
    grid.visible = camHelper.visible = camBody.visible = outline.visible = false
    const mat = cube.material as THREE.MeshStandardMaterial
    const emissive = mat.emissive.getHex()
    mat.emissive.setHex(0x000000)
    scene.overrideMaterial = depthMat

    const frames: string[] = []
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
    outline.visible = restore.outline
    mat.emissive.setHex(emissive)
    r2.dispose()
    return frames
  }

  // ---- coverage rig derived from the blocking (cube-centered)
  function coverageRig(): CoverageAngle[] {
    const c = new THREE.Vector3(0, 1.1, 0)
    const perp = new THREE.Vector3(0, 0, 1)
    const axis = new THREE.Vector3(1, 0, 0)
    const span = 2
    const push = (from: THREE.Vector3, dir: THREE.Vector3, amt: number, look: THREE.Vector3) =>
      (u: number, cam: THREE.PerspectiveCamera) => {
        cam.position.copy(from).addScaledVector(dir, amt * u)
        cam.lookAt(look)
      }
    const angles: CoverageAngle[] = []
    const wideFrom = c.clone().addScaledVector(perp, span * 1.4 + 2.6).setY(1.7)
    const wideDir = c.clone().sub(wideFrom).setY(0).normalize()
    angles.push({ key: 'wide', hint: 'wide establishing shot', poseAt: push(wideFrom, wideDir, 0.4, c) })
    const t = new THREE.Vector3(0, 0.5, 0)
    const insFrom = t.clone().addScaledVector(perp, 2.4).addScaledVector(axis, 0.5).setY(1.15)
    const insDir = t.clone().sub(insFrom).normalize()
    angles.push({ key: 'insert', hint: 'medium close-up on the object, softly lit detail, shallow depth of field', poseAt: push(insFrom, insDir, 0.3, t) })
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
    return angles
  }

  // ---- render loop
  let last = performance.now()
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now

    // a live-streaming phone owns the camera; fly keys are the fallback
    const phoneLive = livePose.fresh && now - livePose.at < 500
    if (playback) {
      const t = (now - playback.t0) / 1000
      const fs = playback.take.frames
      if (t >= playback.take.dur || t * 1000 >= fs[fs.length - 1].t) playback = null
      else samplePose(playback.take, t, filmCam)
    } else if (phoneLive) {
      filmCam.position.lerp(livePose.p, 0.6)
      filmCam.quaternion.slerp(livePose.q, 0.6)
    } else if (simMode) simTick(dt)

    camBody.position.copy(filmCam.position)
    camBody.quaternion.copy(filmCam.quaternion)
    filmCam.updateMatrixWorld()
    camHelper.update()

    if (recording && recFrames) {
      recFrames.push({
        t: now - recStart,
        p: filmCam.position.toArray() as Vec3,
        q: filmCam.quaternion.toArray() as Quat,
      })
      cb.onRecTick((now - recStart) / 1000)
      if (now - recStart > 30_000) cb.onRecLimit() // safety stop
    }

    const w = renderer.domElement.clientWidth
    const h = renderer.domElement.clientHeight
    // viewport takes CSS pixels; three.js applies the pixel ratio itself
    camHelper.visible = camBody.visible = !swapped
    if (swapped) { filmCam.aspect = w / h; filmCam.updateProjectionMatrix() }
    renderer.setViewport(0, 0, w, h)
    renderer.render(scene, swapped ? filmCam : editorCam)
  })

  return {
    setSwapped(on: boolean) {
      swapped = on
      if (!on) {
        filmCam.aspect = 16 / 9 // restore the film frame for the helper frustum
        filmCam.updateProjectionMatrix()
      }
    },
    setSim(on: boolean) { simMode = on },
    setCubeGlow(open: boolean) { glowOpen = open; applyCubeGlow() },
    setCubeOutline(on: boolean) { outline.visible = on },
    cornerScreenPos(): [number, number] {
      // top front-right corner of the cube, nudged slightly outward
      const v = new THREE.Vector3(0.53, 1.06, 0.53).project(swapped ? filmCam : editorCam)
      return [
        Math.round((v.x + 1) / 2 * renderer.domElement.clientWidth),
        Math.round((1 - v.y) / 2 * renderer.domElement.clientHeight),
      ]
    },
    startRecording() { recording = true; recStart = performance.now(); recFrames = [] },
    stopRecording(): Frame[] {
      recording = false
      const f = recFrames ?? []
      recFrames = null
      return f
    },
    isPlaying: () => Boolean(playback),
    playTake(take: Take) { playback = { take, t0: performance.now() } },
    onPhonePose,
    rezero() { calib.pending = true },
    cubeScreenPos(yLift = 0.5): [number, number] {
      const v = cube.getWorldPosition(new THREE.Vector3()).setY(yLift).project(swapped ? filmCam : editorCam)
      return [
        Math.round((v.x + 1) / 2 * renderer.domElement.clientWidth),
        Math.round((1 - v.y) / 2 * renderer.domElement.clientHeight),
      ]
    },
    renderDepthFramesFrom,
    renderDepthFrames(take: Take, n = 81) {
      return renderDepthFramesFrom((u, cam) => samplePose(take, u * take.dur, cam), n)
    },
    coverageRig,
    dispose() {
      renderer.setAnimationLoop(null)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointermove', onMove)
      removeEventListener('keydown', onKeyDown)
      removeEventListener('keyup', onKeyUp)
      removeEventListener('resize', resize)
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
