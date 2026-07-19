import express from 'express'
import http from 'http'
import https from 'https'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import { WebSocketServer } from 'ws'
import QRCode from 'qrcode'
import ffmpegPath from 'ffmpeg-static'
import { fal } from '@fal-ai/client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// Minimal .env loader (KEY=VALUE lines); real env vars win.
const envPath = path.join(root, '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const app = express()
app.use(express.json({ limit: '100mb' }))
app.use(express.static(path.join(root, 'public')))
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')))

app.get('/api/config', (_req, res) => {
  res.json({ falKeySet: Boolean(process.env.FAL_KEY) })
})

// ---------------------------------------------------------------- generation
if (process.env.FAL_KEY) fal.config({ credentials: process.env.FAL_KEY })

const sessionsDir = path.join(root, 'sessions')
fs.mkdirSync(sessionsDir, { recursive: true })
app.use('/sessions', express.static(sessionsDir))

function falLog(entry) {
  fs.appendFileSync(
    path.join(sessionsDir, 'fal-log.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n',
  )
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-800)}`))))
  })
}

// audio: data-URL webm from MediaRecorder -> fal wizper -> transcript
app.post('/api/transcribe', async (req, res) => {
  const { audio } = req.body || {}
  if (!audio) return res.status(400).json({ error: 'no audio' })
  try {
    const buf = Buffer.from(audio.slice(audio.indexOf(',') + 1), 'base64')
    const file = new File([buf], 'direction.webm', { type: 'audio/webm' })
    const audioUrl = await fal.storage.upload(file)
    const { data } = await fal.subscribe('fal-ai/wizper', {
      input: { audio_url: audioUrl, task: 'transcribe', language: 'en' },
    })
    falLog({ event: 'transcribe', text: data?.text })
    res.json({ text: data?.text || '' })
  } catch (err) {
    console.error('[transcribe] FAILED:', err)
    res.status(500).json({ error: String(err?.message || err) })
  }
})

// transcript + blocking summary -> structured shot spec via LLM
const DIRECT_SYS = `You are a film director's assistant on a virtual production stage.
The user speaks a shot direction out loud. The shot's geometry is FIXED by a depth
control video rendered from gray-box proxies; the scene contains exactly what the
BLOCKING line describes. Map the director's words onto those bodies and objects —
never invent extra subjects, never remove them.

Reply with STRICT JSON only (no markdown fences, no commentary):
{"setting": "...", "subjects": "...", "action": "...", "lighting": "...",
 "mood": "...", "style": "...",
 "video_prompt": "one flowing sentence of max 60 words combining all of the above,
 written as a video generation prompt, concrete and visual, ending with cinematic
 style keywords"}
If the director's direction is vague, make bold cinematic choices rather than
staying generic. Never include names of real people or copyrighted characters.`

app.post('/api/direct', async (req, res) => {
  const { transcript, scene } = req.body || {}
  if (!transcript) return res.status(400).json({ error: 'no transcript' })
  try {
    const { data } = await fal.subscribe('openrouter/router', {
      input: {
        model: 'google/gemini-2.5-flash',
        system_prompt: DIRECT_SYS,
        prompt: `BLOCKING: ${scene || 'unknown'}\nDIRECTOR SAYS: ${transcript}`,
        temperature: 0.4,
        max_tokens: 500,
      },
    })
    const raw = (data?.output || '').replace(/^```(json)?|```$/g, '').trim()
    const spec = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    falLog({ event: 'direct', transcript, spec, cost: data?.usage?.cost })
    res.json({ spec })
  } catch (err) {
    console.error('[direct] FAILED:', err)
    res.status(500).json({ error: String(err?.message || err) })
  }
})

// ---- trajectory → cinematographer language --------------------------------
function rotateByQuat(q, v) {
  const [x, y, z, w] = q
  const [vx, vy, vz] = v
  // t = 2 q×v ; v' = v + w t + q×t
  const tx = 2 * (y * vz - z * vy)
  const ty = 2 * (z * vx - x * vz)
  const tz = 2 * (x * vy - y * vx)
  return [
    vx + w * tx + y * tz - z * ty,
    vy + w * ty + z * tx - x * tz,
    vz + w * tz + x * ty - y * tx,
  ]
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const deg = (r) => (r * 180) / Math.PI
const norm180 = (d) => ((d + 540) % 360) - 180

function analyzeTrajectory(frames) {
  const n = frames.length
  const p = frames.map((f) => f.p)
  const q = frames.map((f) => f.q)
  const dur = (frames[n - 1].t - frames[0].t) / 1000
  const fwd = (qq) => rotateByQuat(qq, [0, 0, -1])
  const yawOf = (qq) => { const f = fwd(qq); return Math.atan2(f[0], f[2]) }
  const pitchOf = (qq) => Math.asin(Math.max(-1, Math.min(1, fwd(qq)[1])))

  const f0 = fwd(q[0])
  const r0 = rotateByQuat(q[0], [1, 0, 0])
  const d = [p[n - 1][0] - p[0][0], p[n - 1][1] - p[0][1], p[n - 1][2] - p[0][2]]
  const fh = Math.hypot(f0[0], f0[2]) || 1
  const dolly = dot3(d, [f0[0] / fh, 0, f0[2] / fh]) // + = along look direction (push-in)
  const truck = dot3(d, r0)
  const pedestal = d[1]
  const pan = norm180(deg(yawOf(q[n - 1]) - yawOf(q[0])))
  const tilt = deg(pitchOf(q[n - 1]) - pitchOf(q[0]))

  // orbit around stage center (0, z0) in XZ
  const ang = (pp) => Math.atan2(pp[0], pp[2])
  const orbit = norm180(deg(ang(p[n - 1]) - ang(p[0])))

  // speed profile + shake
  let path = 0
  const speeds = []
  for (let i = 1; i < n; i++) {
    const dt = Math.max(1e-3, (frames[i].t - frames[i - 1].t) / 1000)
    const step = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2])
    path += step
    speeds.push(step / dt)
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1)
  const k = Math.max(1, Math.floor(speeds.length / 5))
  const easeIn = mean(speeds.slice(0, k)) < 0.6 * mean(speeds.slice(k, -k || undefined))
  const easeOut = mean(speeds.slice(-k)) < 0.6 * mean(speeds.slice(k, -k || undefined))
  const smooth = speeds.map((s, i, a) => (i > 0 && i < a.length - 1 ? (a[i - 1] + s + a[i + 1]) / 3 : s))
  const shake = Math.sqrt(mean(speeds.map((s, i) => (s - smooth[i]) ** 2)))

  const r = (v) => Math.round(v * 100) / 100
  return {
    duration_s: r(dur), dolly_m: r(dolly), truck_m: r(truck), pedestal_m: r(pedestal),
    pan_deg: r(pan), tilt_deg: r(tilt), orbit_around_subject_deg: r(orbit),
    path_length_m: r(path), mean_speed_mps: r(mean(speeds)),
    ease_in: easeIn, ease_out: easeOut, handheld_shake: shake > 0.25 ? 'noticeable' : shake > 0.08 ? 'subtle' : 'none',
  }
}

// Signs are resolved to words HERE, deterministically — the LLM only phrases,
// it never interprets numbers (it flipped pan direction once at temp 0.3).
function featureWords(f) {
  const w = []
  if (f.dolly_m > 0.15) w.push(`dolly in ${f.dolly_m}m`)
  else if (f.dolly_m < -0.15) w.push(`dolly out ${-f.dolly_m}m`)
  if (f.truck_m > 0.15) w.push(`truck right ${f.truck_m}m`)
  else if (f.truck_m < -0.15) w.push(`truck left ${-f.truck_m}m`)
  if (f.pedestal_m > 0.15) w.push(`crane up ${f.pedestal_m}m`)
  else if (f.pedestal_m < -0.15) w.push(`crane down ${-f.pedestal_m}m`)
  if (f.pan_deg > 8) w.push(`pan left ${Math.round(f.pan_deg)} degrees`)
  else if (f.pan_deg < -8) w.push(`pan right ${Math.round(-f.pan_deg)} degrees`)
  if (f.tilt_deg > 8) w.push(`tilt up ${Math.round(f.tilt_deg)} degrees`)
  else if (f.tilt_deg < -8) w.push(`tilt down ${Math.round(-f.tilt_deg)} degrees`)
  if (Math.abs(f.orbit_around_subject_deg) > 15 && Math.abs(f.truck_m) > 0.5) {
    w.push(`arc ${f.orbit_around_subject_deg > 0 ? 'left' : 'right'} around the subject`)
  }
  if (!w.length) w.push('locked-off static shot')
  if (f.ease_in) w.push('eases in from a standstill')
  if (f.ease_out) w.push('eases out to a stop')
  if (f.handheld_shake !== 'none') w.push(`${f.handheld_shake} handheld sway`)
  w.push(`total duration ${f.duration_s}s at ${f.mean_speed_mps} m/s`)
  return w
}

const CAM_SYS = `You are a veteran cinematographer. You get factual fragments
describing a performed camera move. Use EXACTLY these facts — never add, drop,
or reverse a direction. Write JSON only:
{"move_name": "2-4 word name", "camera_prompt": "ONE fluent sentence, max 28
words, professional video-prompt camera language (dolly, truck, arc, pan,
crane, push-in, ease). No scene content, no subjects."}`

app.post('/api/camera-language', async (req, res) => {
  const { frames } = req.body || {}
  if (!Array.isArray(frames) || frames.length < 5) return res.status(400).json({ error: 'need frames' })
  try {
    const features = analyzeTrajectory(frames)
    const words = featureWords(features)
    const { data } = await fal.subscribe('openrouter/router', {
      input: {
        model: 'google/gemini-2.5-flash',
        system_prompt: CAM_SYS,
        prompt: words.join('; '),
        temperature: 0.2,
        max_tokens: 200,
      },
    })
    const raw = (data?.output || '').replace(/^```(json)?|```$/g, '').trim()
    const out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    falLog({ event: 'camera-language', features, out, cost: data?.usage?.cost })
    res.json({ features, ...out })
  } catch (err) {
    console.error('[camera-language] FAILED:', err)
    res.status(500).json({ error: String(err?.message || err) })
  }
})

// multicam cut: same timeline, switching angles — session ids in cut order
app.post('/api/multicut', async (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids) || ids.length < 2) return res.status(400).json({ error: 'need >=2 session ids' })
  const clips = ids.map((id) => path.join(sessionsDir, String(id), 'result.mp4'))
  if (!clips.every((c) => fs.existsSync(c))) return res.status(400).json({ error: 'missing result.mp4' })
  try {
    const T = 81 / 16 // shared coverage timeline (s)
    const n = clips.length
    const seg = T / n
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-multicut`
    const dir = path.join(sessionsDir, id)
    fs.mkdirSync(dir, { recursive: true })
    const inputs = clips.flatMap((c) => ['-i', c])
    const trims = clips.map((_, i) =>
      `[${i}:v]trim=start=${(i * seg).toFixed(3)}:end=${((i + 1) * seg).toFixed(3)},setpts=PTS-STARTPTS[v${i}]`).join(';')
    const concat = clips.map((_, i) => `[v${i}]`).join('') + `concat=n=${n}:v=1[out]`
    await runFfmpeg(['-y', ...inputs, '-filter_complex', `${trims};${concat}`, '-map', '[out]',
      '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', path.join(dir, 'result.mp4')])
    fs.copyFileSync(path.join(sessionsDir, String(ids[0]), 'control.mp4'), path.join(dir, 'control.mp4'))
    falLog({ event: 'multicut', id, ids })
    res.json({ id, result: `/sessions/${id}/result.mp4` })
  } catch (err) {
    console.error('[multicut] FAILED:', err)
    res.status(500).json({ error: String(err?.message || err) })
  }
})

// save a client-side recording (previz/take exports, demo captures)
app.post('/api/dev-save', (req, res) => {
  const { name, data } = req.body || {}
  if (!name || !data || !/^[\w.-]+$/.test(name)) return res.status(400).json({ error: 'bad name/data' })
  const dir = path.join(sessionsDir, 'exports')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'))
  res.json({ saved: `/sessions/exports/${name}` })
})

// list generated sessions for the gallery
app.get('/api/sessions', (_req, res) => {
  const log = fs.existsSync(path.join(sessionsDir, 'fal-log.jsonl'))
    ? fs.readFileSync(path.join(sessionsDir, 'fal-log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    : []
  const prompts = Object.fromEntries(log.filter((e) => e.event === 'request').map((e) => [e.id, e.input?.prompt]))
  const out = fs.readdirSync(sessionsDir)
    .filter((d) => fs.existsSync(path.join(sessionsDir, d, 'result.mp4')))
    .sort()
    .reverse()
    .map((d) => ({ id: d, control: `/sessions/${d}/control.mp4`, result: `/sessions/${d}/result.mp4`, prompt: prompts[d] || '' }))
  res.json(out)
})

// frames: array of data-URL PNGs (the depth-rendered take), fps: control fps
const DEPTH_MODELS = {
  'wan22-fun': 'fal-ai/wan-22-vace-fun-a14b/depth',
  'wan21': 'fal-ai/wan-vace-14b/depth',
}

app.post('/api/generate', async (req, res) => {
  const { frames, prompt, fps = 16, resolution = '480p', modelKey = 'wan22-fun' } = req.body || {}
  if (!process.env.FAL_KEY) return res.status(400).json({ error: 'FAL_KEY not set' })
  if (!Array.isArray(frames) || frames.length < 2) return res.status(400).json({ error: 'no frames' })
  if (!prompt) return res.status(400).json({ error: 'no prompt' })

  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(sessionsDir, id)
  fs.mkdirSync(dir, { recursive: true })
  const mode = req.body.mode === 'beautiful' ? 'beautiful' : 'exact'
  try {
    frames.forEach((f, i) => {
      fs.writeFileSync(path.join(dir, `f_${String(i).padStart(4, '0')}.png`),
        Buffer.from(f.slice(f.indexOf(',') + 1), 'base64'))
    })
    const controlPath = path.join(dir, 'control.mp4')
    await runFfmpeg(['-y', '-framerate', String(fps), '-i', path.join(dir, 'f_%04d.png'),
      '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '18', controlPath])

    const file = new File([fs.readFileSync(controlPath)], 'control.mp4', { type: 'video/mp4' })
    const controlUrl = await fal.storage.upload(file)

    // exact: depth-constrained VACE. beautiful: camera language in the prompt
    // on a frontier model — follows intent, not geometry.
    const model = mode === 'beautiful'
      ? 'bytedance/seedance-2.0/fast/text-to-video'
      : DEPTH_MODELS[modelKey] || DEPTH_MODELS['wan22-fun']
    const input = mode === 'beautiful'
      ? { prompt, resolution: '720p', duration: '5', aspect_ratio: '16:9', generate_audio: false }
      : {
          prompt,
          video_url: controlUrl,
          preprocess: false, // we already send a depth video
          match_input_num_frames: true,
          match_input_frames_per_second: true,
          resolution,
          aspect_ratio: '16:9',
        }
    // Optional second depth pass (Christopher's insight): primitive-proxy depth
    // maps 1:1 into stiff, generic bodies. Bootstrap instead: cheap draft pass
    // (mannequins become real coated humans + an invented environment), read
    // realistic depth back off the draft, and constrain the final pass with
    // THAT — trajectory preserved, silhouettes now human, scene depth rich.
    if (mode === 'exact' && req.body.detail) {
      broadcastAll({ type: 'genState', status: 'DETAIL', label: 'Draft pass…' })
      console.log(`[gen ${id}] detail: draft pass`)
      const draft = await fal.subscribe(model, {
        input: { ...input, resolution: '480p' },
        onQueueUpdate: (u) => broadcastAll({ type: 'genState', status: u.status, position: u.queue_position ?? null, label: `Draft: ${u.status}` }),
      })
      falLog({ event: 'detail-draft', id, requestId: draft.requestId, video: draft.data?.video?.url })
      fs.writeFileSync(path.join(dir, 'draft.mp4'),
        Buffer.from(await (await fetch(draft.data.video.url)).arrayBuffer()))

      broadcastAll({ type: 'genState', status: 'DETAIL', label: 'Reading realistic depth…' })
      console.log(`[gen ${id}] detail: depth-anything`)
      const da = await fal.subscribe('fal-ai/depth-anything-video', {
        input: { video_url: draft.data.video.url, model: 'VDA-Large', colormap: 'grayscale', resolution: 'auto' },
      })
      falLog({ event: 'detail-depth', id, requestId: da.requestId, video: da.data?.video?.url })
      fs.writeFileSync(path.join(dir, 'depth-enriched.mp4'),
        Buffer.from(await (await fetch(da.data.video.url)).arrayBuffer()))
      input.video_url = da.data.video.url
      input.resolution = '720p' // the detail pass should finish sharp
      input.video_quality = 'maximum'
      broadcastAll({ type: 'genState', status: 'DETAIL', label: 'Final pass…' })
    }

    falLog({ event: 'request', id, model, input: { ...input } })
    console.log(`[gen ${id}] ${frames.length} frames -> ${model}`)

    const t0 = Date.now()
    const { data, requestId } = await fal.subscribe(model, {
      input,
      logs: true,
      onQueueUpdate: (u) => {
        console.log(`[gen ${id}] ${u.status}`)
        broadcastAll({ type: 'genState', status: u.status, position: u.queue_position ?? null })
      },
    })
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    falLog({ event: 'result', id, requestId, secs, video: data?.video?.url, seed: data?.seed })
    console.log(`[gen ${id}] done in ${secs}s: ${data?.video?.url}`)

    // keep a local copy next to the control video
    if (data?.video?.url) {
      const buf = Buffer.from(await (await fetch(data.video.url)).arrayBuffer())
      fs.writeFileSync(path.join(dir, 'result.mp4'), buf)
    }
    res.json({ id, requestId, video: data?.video, local: `/sessions/${id}/result.mp4`, control: `/sessions/${id}/control.mp4` })
  } catch (err) {
    falLog({ event: 'error', id, error: String(err) })
    console.error(`[gen ${id}] FAILED:`, err)
    res.status(500).json({ error: String(err?.message || err) })
  }
})

app.get('/qr.svg', async (req, res) => {
  const text = String(req.query.u || '')
  if (!text) return res.status(400).send('missing ?u=')
  res.type('image/svg+xml').send(await QRCode.toString(text, { type: 'svg', margin: 1, width: 512 }))
})

// --- WebSocket relay, single session: every message goes to all other peers.
// Clients send {type:'hello', role:'director'|'camera'} first; 'type' must be
// the first JSON key so the hot pose path can skip parsing.
const peers = new Set()

function attachWss(server) {
  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws) => {
    peers.add(ws)
    ws.role = '?'
    ws.on('message', (data) => {
      const str = data.toString()
      if (str.startsWith('{"type":"hello"')) {
        try { ws.role = JSON.parse(str).role || '?' } catch { /* ignore */ }
        broadcastPresence()
        return
      }
      for (const p of peers) if (p !== ws && p.readyState === 1) p.send(str)
    })
    ws.on('close', () => { peers.delete(ws); broadcastPresence() })
    ws.on('error', () => { /* close handler cleans up */ })
  })
}

function broadcastPresence() {
  broadcastAll({ type: 'presence', roles: [...peers].map((p) => p.role) })
}

function broadcastAll(obj) {
  const msg = JSON.stringify(obj)
  for (const p of peers) if (p.readyState === 1) p.send(msg)
}

const HTTP_PORT = Number(process.env.PORT || 8000)
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443)

const httpServer = http.createServer(app)
httpServer.requestTimeout = 0 // generation requests can run for minutes
attachWss(httpServer)
httpServer.listen(HTTP_PORT, '0.0.0.0', () => printUrls('http', HTTP_PORT))

const keyPath = path.join(root, 'certs/key.pem')
const certPath = path.join(root, 'certs/cert.pem')
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const httpsServer = https.createServer(
    { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
    app,
  )
  httpsServer.requestTimeout = 0
  attachWss(httpsServer)
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => printUrls('https', HTTPS_PORT))
}

function printUrls(proto, port) {
  const addrs = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
  console.log(`[blocking] ${proto} listening on 0.0.0.0:${port}`)
  for (const a of addrs) console.log(`           ${proto}://${a}:${port}`)
  console.log(`           FAL_KEY: ${process.env.FAL_KEY ? 'set' : 'NOT SET'}`)
}
