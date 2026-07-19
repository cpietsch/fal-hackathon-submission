# Blocking

Hold the camera, don't describe it.

Text is a poor language for cinematography. Nobody types "dolly in 1.4m,
easing in from a standstill with subtle handheld sway" — but every director
can *walk* that move. Blocking makes your phone the film camera and hands
your real movement over to the AI model.

Built during the fal x Sequoia 72-Hour Video Hack (July 2026).

## The flow

1. Define the object. A single gray cube stands centered on a 3D
   gray-box stage. While undefined it carries an orange outline and a +
   pinned to its corner — click it and say (voice or text) what it *is*:
   *"a rusty 1950s jukebox with glowing neon rims."* The description attaches
   to the main prompt as a chip, like an image in a chat composer.
2. Perform the camera. Pair your Android phone via QR (WebXR,
   immersive-ar). The moment you tap START on the phone, the desktop
   jumps into the film camera, counts down 3-2-1 center screen, and your
   phone's 6DoF pose *is* the camera — streamed at ~60 Hz over WebSocket,
   amplified 5× so a living room becomes a film set. Stop the take from
   either side; no phone around, fly with WASD instead.
3. Refine the move. Takes land as browser-style tabs in the top bar. An
   After-Effects-style curve panel shows the position channels over time:
   a smooth dial irons out handheld jitter, and draggable bezier handles sit
   exactly on the move's peaks and valleys for hand adjustments.
4. Compose & generate. The performed trajectory is measured in code —
   dolly/truck/pedestal distances, pan/tilt/orbit angles, easing, shake —
   and phrased as one deterministic DP sentence (*"Dolly in 1.37m, easing in
   from a standstill with subtle handheld sway, at 0.75 m/s."*). Object chip
   + motion chip + reference images + your atmosphere text compose into a
   single prompt. One send → Kling (via fal) executes the shot; a live
   card shows queue position and elapsed time; the result plays side by side
   with your previz. Every shot lands in the history (folder button, bottom
   left).

## Why it matters

Every prompt-driven tool treats camera direction as a suggestion typed from
memory. Blocking captures the direction *as a performance*: the trajectory
is measured, not described, and the sign of every number is resolved in code
— the LLM never guesses whether the camera moved left or right. The model
receives your actual intent, phrased in its native language.

## Architecture

Desktop (React + TS + Vite)        Server (node/express)        fal
┌──────────────────────────┐  WS   ┌──────────────┐
│ three.js stage (stage.ts)│◄─────►│ ws relay     │◄── phone (Android
│ takes / curves / chips   │ pose  │ ffmpeg previz│    Chrome, WebXR,
│ prompt composer          │ 60Hz  │ sessions     │    phone.html)
└────────────┬─────────────┘       └──────┬───────┘
             │ 81 previz frames + prompt  │
             └──────────────►─────────────┴──► Kling (video)
                                               wizper (speech→text)
                                               LLM (camera language)
- src/ — the desktop app: React 18 + TypeScript, imperative three.js
  engine isolated in src/three/stage.ts
- server/index.js — express + WebSocket relay + fal calls + ffmpeg previz
- public/phone.html — standalone WebXR camera controller (runs on the phone)

## Run it

npm install
cp .env.example .env        # add your FAL_KEY
npm run cert                # one-time: self-signed TLS for the phone (WebXR needs https)
npm run build && npm start  # → http://localhost:8000  (https :8443 for the phone)
# dev with hot reload: npm run dev  → http://localhost:5173
Pair the phone via the QR dialog, accept the self-signed certificate,
tap START, and walk your shot.
