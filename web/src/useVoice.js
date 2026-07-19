import { useCallback, useRef, useState } from 'react'
import { transcribe } from './api.js'

const SR = window.SpeechRecognition || window.webkitSpeechRecognition

// One mic pipeline, any target: Web Speech when available, MediaRecorder →
// Wizper as the fallback. The transcript lands raw wherever the caller puts
// it — no LLM rewriting between the user and their own words.
export function useVoice() {
  const [listening, setListening] = useState(false)
  const active = useRef(null) // {speech} | {rec}

  const stop = useCallback(() => {
    const a = active.current
    if (a?.speech) { try { a.speech.stop() } catch { /* already stopped */ } }
    if (a?.rec?.state === 'recording') a.rec.stop()
  }, [])

  const start = useCallback((onDone) => {
    if (active.current) { stop(); return }
    const finish = (text) => {
      active.current = null
      setListening(false)
      onDone(text?.trim() || '')
    }
    const recorderFallback = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
        active.current = { rec }
        const chunks = []
        rec.ondataavailable = (e) => chunks.push(e.data)
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          const fr = new FileReader()
          fr.onload = () => transcribe(fr.result).then((out) => finish(out.text), () => finish(''))
          fr.readAsDataURL(new Blob(chunks, { type: 'audio/webm' }))
        }
        rec.start()
        setListening(true)
        setTimeout(() => rec.state === 'recording' && rec.stop(), 15_000)
      } catch {
        finish('')
      }
    }
    if (SR) {
      const speech = new SR()
      active.current = { speech }
      speech.continuous = true
      speech.interimResults = true
      speech.lang = 'en-US'
      let finalText = ''
      speech.onresult = (e) => {
        for (const r of e.results) if (r.isFinal) finalText += r[0].transcript + ' '
      }
      speech.onend = () => finish(finalText)
      speech.onerror = (e) => {
        speech.onend = null
        if (e.error === 'not-allowed') finish('')
        else recorderFallback() // e.g. network-blocked speech service
      }
      speech.start()
      setListening(true)
    } else {
      recorderFallback()
    }
  }, [stop])

  return { listening, start, stop }
}
