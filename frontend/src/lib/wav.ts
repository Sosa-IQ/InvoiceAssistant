/** Speech needs no more than 16 kHz mono; it keeps a 3-minute clip under 6 MB. */
export const WAV_SAMPLE_RATE = 16_000

/** Encode mono samples in [-1, 1] as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2
  const view = new DataView(new ArrayBuffer(44 + dataBytes))
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeText(0, "RIFF")
  view.setUint32(4, 36 + dataBytes, true)
  writeText(8, "WAVE")
  writeText(12, "fmt ")
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeText(36, "data")
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([view.buffer], { type: "audio/wav" })
}

/**
 * Convert a browser recording (WebM in Chrome, Ogg in Firefox, MP4 in Safari) to
 * 16 kHz mono WAV. Each browser can decode its own recordings, and WAV is accepted
 * by the transcription API everywhere, so voice works the same in every browser.
 */
export async function recordingToWav(recording: Blob): Promise<Blob> {
  const decodeContext = new AudioContext()
  try {
    const decoded = await decodeContext.decodeAudioData(await recording.arrayBuffer())
    const frames = Math.max(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE))
    // Rendering through an offline context resamples to 16 kHz and mixes down to mono.
    const offline = new OfflineAudioContext(1, frames, WAV_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return encodeWav(rendered.getChannelData(0), WAV_SAMPLE_RATE)
  } finally {
    void decodeContext.close()
  }
}
