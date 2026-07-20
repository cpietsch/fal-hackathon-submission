# Blocking

**Direct AI video like a director, not a prompt engineer.**

Text is a poor language for cinematography. Blocking gives directors back
their native tools — **space, voice, and movement** — around one radically
simple stage: **a single cube**.

1. **Tell the cube what it is.** Click it; a toolbox sticks to it. Say or
   type the subject ("a vintage red motorcycle, chrome tank"). Confirm, and
   it docks into the main prompt as an attachment — like an image in a chat.
2. **Perform the camera.** Your Android phone streams 6DoF over WebXR: walk
   a dolly, arc, or crane around the cube with your body. The move is
   analyzed into cinematographer language and docks in as a **motion
   attachment** ("Dolly In Ease · 5.0s").
3. **Set the look.** One line of atmosphere in the prompt bar — spoken or
   typed — plus optional **reference images** for the shot's mood.
4. **Send.** The take renders as a depth-map video that *constrains*
   generation (Wan VACE depth on [fal](https://fal.ai)) — the output provably
   follows your camera trajectory — and lands side-by-side with your previz.

Built solo during the fal x Sequoia 72-Hour Video Hack (July 2026).

## The prompt bar is the product

There is no prompt engineering, but there *is* one honest prompt — assembled
from attachments the way a chat message collects images:

```
[⬛ object — from the cube] [📷 motion — from your body] [🖼 refs]
 └ look & atmosphere line ................................. [Exact|Beautiful] [➤]
```

Each attachment is its own small system prompt with its own author: the cube
holds the subject, your body writes the motion, the stills carry the mood.

## An MVP loop, not just a demo

- **Dailies** — every generation lands in a drawer (🎞 in the top bar):
  hover to play, click to reopen side-by-side with its previz, download.
- **↻ Again** — same performed take, new seed. The server reuses the
  already-uploaded control video, so iterating on a shot costs seconds,
  not another performance.
- **🎥 Coverage** — wide, insert, and slow-arc angles derived from the
  blocking, generated in parallel from the same 3D timeline, auto-edited
  into a multicam cut.
- **A live queue** — every in-flight job (from any open tab) shows in the
  prompt bar with its stage, fal queue position, and elapsed time; failures
  stay visible instead of vanishing.

## Two dials, one performance

- **Exact** — the performed take renders as MiDaS-style inverse-depth frames
  sent with `preprocess: false`: the model receives the scene's actual
  per-frame geometry and cannot ignore it. **2-pass detail** (default on)
  fixes the primitive-proxy problem: a cheap draft pass turns the cube into
  the real object, `depth-anything-video` reads *realistic* depth off the
  draft, and the final 720p pass is constrained by that — your trajectory,
  true silhouettes.
- **Beautiful** — the take's 6DoF trajectory is decomposed into numeric
  features (dolly/truck/pan/orbit/easing/shake — signs resolved to words in
  code, never by the LLM), phrased as one cinematographer sentence, and
  injected into a frontier model (Seedance 2.0): intent-level obedience,
  frontier fidelity.

## Architecture

```
Desktop (React + three.js)            Server (node)                fal
┌─────────────────────┐   WebSocket   ┌──────────────┐
│ the cube (subject)  │◄─────────────►│ ws relay     │
│ cube toolbox        │               │              │
│ prompt bar + chips  │   pose 60Hz   │              │◄── phone (Android
│ PiP film camera     │◄──────────────│              │    Chrome, WebXR
│ depth renderer      │               │              │    immersive-ar,
│ voice capture       │               │              │    6DoF pose)
└─────────┬───────────┘               └──────┬───────┘
          │ 81 depth PNGs + assembled prompt │
          └──────────────► /api/generate ────┤ ffmpeg → depth.mp4
                           /api/camera-language ─► openrouter/router
                           /api/transcribe ──┼─► wizper (STT fallback)
                           /api/upload-ref ──┼─► fal storage (ref stills)
                                             └─► wan-22-vace-fun-a14b/depth
                                                 (preprocess: false,
                                                  ref_image_urls,
                                                  2-pass via
                                                  depth-anything-video)
```

- **Pose calibration**: yaw-only correction anchors the phone's start pose to
  the camera mark — gravity stays honest, drift re-zeroes on demand. A move
  scale dial turns room-scale steps into crane moves.
- **Takes are data**: a take is a timestamped 6DoF pose stream, resampled to
  81 frames at 16fps for the control video. The latest take *is* the motion
  attachment; re-record to replace it, click the chip to replay it.
- **Voice is raw**: transcripts (Web Speech API, or MediaRecorder → Wizper)
  land directly in the field you spoke into — you confirm, no LLM rewriting
  between you and your own words.
- Every fal call is appended to `sessions/fal-log.jsonl`.

## Run

```sh
npm install
npm run build    # vite-builds the React director app into web/dist
npm run cert     # self-signed TLS — WebXR requires a secure context
FAL_KEY=... npm start
```

The director app is React (Vite) in `web/`; the three.js stage lives in
`web/src/engine.js` as an imperative engine the components drive. The phone
capture page (`public/phone.html`) stays deliberately build-free. During UI
work, `npm run dev` serves the app with hot reload, proxying API + WebSocket
to a running `npm start`.

Desktop: `http://<host>:8000` · Phone: **Pair phone** → scan the QR with
Android Chrome (accept the certificate warning on the https URL, or allowlist
the http origin in `chrome://flags/#unsafely-treat-insecure-origin-as-secure`).

No phone handy? **Sim camera** flies the rig with WASD + arrows so the whole
loop works from a desk.
