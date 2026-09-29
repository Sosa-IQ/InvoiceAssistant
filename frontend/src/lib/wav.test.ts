import { describe, expect, it } from "vitest"
import { encodeWav } from "./wav"

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM WAV the transcription API accepts", async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2])
    const wav = encodeWav(samples, 16_000)
    const view = new DataView(await wav.arrayBuffer())
    const tag = (offset: number) => String.fromCharCode(...new Uint8Array(view.buffer, offset, 4))

    expect(wav.type).toBe("audio/wav")
    expect(view.byteLength).toBe(44 + samples.length * 2)
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"])
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(samples.length * 2)
    // Out-of-range samples are clipped rather than wrapped.
    expect(view.getInt16(44 + 5 * 2, true)).toBe(0x7fff)
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-0x8000)
  })
})
