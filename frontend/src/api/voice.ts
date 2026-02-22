import api from "./client"

export async function transcribeAudio(blob: Blob): Promise<string> {
  // Derive extension from the blob's actual MIME type so the filename matches the content
  const mimeBase = blob.type.split(";")[0]  // strip ";codecs=opus" etc.
  const ext = mimeBase.includes("ogg") ? "ogg" : mimeBase.includes("mp4") ? "mp4" : "webm"
  const form = new FormData()
  form.append("audio", blob, `recording.${ext}`)
  const { data } = await api.post<{ transcript: string }>("/api/voice/transcribe", form)
  return data.transcript
}
