import { useRef, useState } from 'react'

// one dictation session at a time, streaming into whichever field owns it —
// Web Speech API when available, MediaRecorder + /api/transcribe fallback
export function useDictation(toast: (m: string) => void) {
  const [active, setActive] = useState<string | null>(null)
  const session = useRef<{ speech?: any; rec?: MediaRecorder } | null>(null)

  function stop() {
    if (session.current?.speech) { try { session.current.speech.stop() } catch { /* already stopped */ } }
    if (session.current?.rec?.state === 'recording') session.current.rec.stop()
  }

  async function recorderFallback(id: string, get: () => string, set: (v: string) => void) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      session.current = { rec }
      setActive(id)
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => chunks.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        session.current = null
        setActive(null)
        const fr = new FileReader()
        fr.onload = async () => {
          const r = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio: fr.result }),
          })
          const out = await r.json()
          if (r.ok && out.text) set(get() ? `${get()} ${out.text}` : out.text)
          else toast('Heard nothing — try again')
        }
        fr.readAsDataURL(new Blob(chunks, { type: 'audio/webm' }))
      }
      rec.start()
      setTimeout(() => rec.state === 'recording' && rec.stop(), 15_000)
    } catch {
      toast('No microphone available')
    }
  }

  function toggle(id: string, get: () => string, set: (v: string) => void) {
    if (session.current) { stop(); return }
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { recorderFallback(id, get, set); return }
    const speech = new SR()
    session.current = { speech }
    speech.continuous = true
    speech.interimResults = true
    speech.lang = 'en-US'
    const base = get() ? `${get().replace(/\s*$/, '')} ` : ''
    let finalText = ''
    speech.onresult = (e: any) => {
      let interim = ''
      for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript + ' ') : (interim += r[0].transcript))
      set((base + finalText + interim).trimStart()) // live transcript
    }
    speech.onend = () => { session.current = null; setActive(null) }
    speech.onerror = (e2: any) => {
      speech.onend = null
      session.current = null
      setActive(null)
      if (e2.error === 'not-allowed') toast('Mic permission denied')
      else recorderFallback(id, get, set) // e.g. network-blocked speech service
    }
    speech.start()
    setActive(id)
  }

  return { active, toggle }
}
