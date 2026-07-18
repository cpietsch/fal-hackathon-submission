# Blocking

**Direct AI video like a director, not a prompt engineer.**
Block the scene on a gray-box stage, speak your intent, and perform the camera
move with your phone in your hand — then AI generates the shot, following your
exact camera trajectory.

Built during the fal x Sequoia 72-Hour Video Hack (July 2026).

## How it works

1. **Block** — arrange actor/prop proxies on a three.js stage in the browser.
2. **Speak** — describe the shot out loud; an LLM turns it into a structured shot spec.
3. **Perform** — your Android phone becomes the camera: WebXR streams its 6DoF
   pose live, so you dolly, arc, and crane by physically moving. Record takes,
   keep the best.
4. **Generate** — the chosen take renders as a depth-map video and drives
   depth-conditioned video generation (Wan VACE on [fal](https://fal.ai)), so
   the output provably follows your performed camera move and blocking.

## Run

```sh
npm install
npm run cert   # self-signed TLS (WebXR needs a secure context)
FAL_KEY=... npm start
```

Open `http://<host>:8000` on the desktop, then **Pair phone** and scan the QR
with Android Chrome (accept the certificate warning on the https URL).

## Status

Hackathon work in progress — single-shot loop first, polish over breadth.
