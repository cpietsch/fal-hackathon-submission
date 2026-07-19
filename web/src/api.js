async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const out = await r.json()
  if (!r.ok) throw new Error(out.error || r.statusText)
  return out
}

export const getConfig = () => fetch('/api/config').then((r) => r.json())
export const cameraLanguage = (frames) => post('/api/camera-language', { frames })
export const uploadRef = (image, name) => post('/api/upload-ref', { image, name })
export const generateShot = (body) => post('/api/generate', body)
export const multicut = (ids) => post('/api/multicut', { ids })
export const transcribe = (audio) => post('/api/transcribe', { audio })
