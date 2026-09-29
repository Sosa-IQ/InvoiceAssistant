import api from "./client"
import { recordingToWav } from "@/lib/wav"

export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData()
  try {
    form.append("audio", await recordingToWav(blob), "recording.wav")
  } catch {
    // Browser couldn't decode its own recording; send it as-is with a matching extension.
    const mimeBase = blob.type.split(";")[0]
    const ext = mimeBase.includes("ogg") ? "ogg" : mimeBase.includes("mp4") ? "mp4" : "webm"
    form.append("audio", blob, `recording.${ext}`)
  }
  const { data } = await api.post<{ transcript: string }>("/api/voice/transcribe", form)
  return data.transcript
}
