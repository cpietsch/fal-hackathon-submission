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

    const model = DEPTH_MODELS[modelKey] || DEPTH_MODELS['wan22-fun']
    const input = {
      prompt,
      video_url: controlUrl,
      preprocess: false, // we already send a depth video
      match_input_num_frames: true,
      match_input_frames_per_second: true,
      resolution,
      aspect_ratio: '16:9',
    }
    falLog({ event: 'request', id, model, input: { ...input, video_url: controlUrl } })
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
