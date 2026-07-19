# Blocking

**Direct AI video like a director, not a prompt engineer.**

Text is a poor language for cinematography. Blocking gives directors back
their native tools — **space, voice, and movement**:

1. **Block** the scene by arranging humanoid proxies on a 3D gray-box stage.
2. **Speak** the shot out loud; speech-to-text + an LLM turn the direction
   into a structured shot spec. There is no prompt box.
3. **Perform** the camera with your Android phone — WebXR streams its 6DoF
   pose live, so you walk a dolly, arc, or crane with your body. Record
   takes, keep the best.
4. **Generate**: the chosen take renders as a depth-map video that
   *constrains* generation (Wan VACE depth on [fal](https://fal.ai)) — the
   output provably follows your camera trajectory and staging, shown
   side-by-side with your previz.

Built solo during the fal x Sequoia 72-Hour Video Hack (July 2026).

## Beyond the single shot

- **Exact / Beautiful** — two generation dials for one performance. *Exact*
  constrains a depth model (Wan VACE) with your rendered take: frame-for-frame
  obedience. *Beautiful* analyzes the take's 6DoF trajectory into numeric
  features (dolly/truck/pan/orbit/easing/shake — signs resolved to words in
  code, never by the LLM), phrases them as one cinematographer sentence, and
  injects it into a frontier model (Seedance 2.0): intent-level obedience,
  frontier fidelity.
- **Coverage** — one blocking, a whole multicam rig: wide, over-the-shoulder,
  insert, and a slow arc are derived automatically from the scene geometry,
  each generated from its own depth render of the *same* timeline, then
  auto-edited into a multicam cut. Coverage and b-roll without re-performing
  a single take — and with structural continuity, because every angle watches
  the same 3D truth.

## Why depth conditioning matters

Every prompt-driven video tool treats camera direction as a suggestion.
Blocking renders the performed take as MiDaS-style inverse-depth frames and
sends them with `preprocess: false` — the model receives the scene's actual
geometry per frame and cannot ignore it. The same mechanism makes the
blocking authoritative: a crate placed between two actors *is* between them
in the output. (Lesson learned on the way: depth silhouettes are taken
literally — capsule proxies generate literal capsules, so the actor proxies
are rough humanoid mannequins.)

## Architecture

```
Desktop (three.js)                    Server (node)                fal
┌─────────────────────┐   WebSocket   ┌──────────────┐
│ gray-box stage      │◄─────────────►│ ws relay     │
│ blocking editor     │               │              │
│ takes: rec/play     │   pose 60Hz   │              │◄── phone (Android
│ PiP film camera     │◄──────────────│              │    Chrome, WebXR
│ depth renderer      │               │              │    immersive-ar,
│ voice capture       │               │              │    6DoF pose)
└─────────┬───────────┘               └──────┬───────┘
          │ 81 depth PNGs + shot spec        │
          └──────────────► /api/generate ────┤ ffmpeg → depth.mp4
                           /api/direct  ─────┼─► openrouter/router (shot spec)
                           /api/transcribe ──┼─► wizper (STT fallback)
                                             └─► wan-22-vace-fun-a14b/depth
                                                 (preprocess: false)
```

- **Pose calibration**: yaw-only correction anchors the phone's start pose to
  the camera mark — gravity stays honest, drift re-zeroes on demand. A move
  scale dial turns room-scale steps into crane moves.
- **Takes are data**: each take is a timestamped 6DoF pose stream, resampled
  to 81 frames at 16fps for the control video.
- **Voice → spec**: Web Speech API (or MediaRecorder → Wizper) → Gemini
  Flash via fal's OpenRouter endpoint → structured spec (setting, subjects,
  action, lighting, mood, style) shown as chips, assembled into the final
  video prompt. ~$0.0007 per direction.
- Every fal call is appended to `sessions/fal-log.jsonl`.

## Run

```sh
npm install
npm run cert     # self-signed TLS — WebXR requires a secure context
FAL_KEY=... npm start
```

Desktop: `http://<host>:8000` · Phone: **Pair phone** → scan the QR with
Android Chrome (accept the certificate warning on the https URL, or allowlist
the http origin in `chrome://flags/#unsafely-treat-insecure-origin-as-secure`).

No phone handy? **Sim camera** flies the rig with WASD + arrows so the whole
loop works from a desk.
