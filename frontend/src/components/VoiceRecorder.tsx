import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Mic } from "lucide-react"
import { toast } from "sonner"
import { transcribeAudio } from "@/api/voice"
import { USAGE_QUERY_KEY } from "@/hooks/useAiAllowance"

const BTN_SIZE = 112 // px — matches w-28 h-28

type VoiceRecorderProps = {
  /** Receives each transcript; callers usually append it to a text box. */
  onTranscript: (text: string) => void
  /** Reports recording or transcribing, so callers can disable competing actions. */
  onBusyChange?: (busy: boolean) => void
  disabled?: boolean
}

/**
 * The shared "tap to talk" control: a large mic button that shows a live waveform while
 * recording, then sends the clip for transcription.
 */
export function VoiceRecorder({ onTranscript, onBusyChange, disabled = false }: VoiceRecorderProps) {
  const queryClient = useQueryClient()
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const animFrameRef = useRef<number>(0)
  const onTranscriptRef = useRef(onTranscript)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  useEffect(() => {
    onBusyChange?.(recording || transcribing)
  }, [onBusyChange, recording, transcribing])

  function startVisualization(stream: MediaStream) {
    const audioCtx = new AudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64 // 32 frequency bins — enough for smooth bars
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    audioCtxRef.current = audioCtx
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    function draw() {
      animFrameRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(dataArray)
      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      if (!canvas || !ctx) return

      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)
      // Symmetric bars: louder low frequencies (voice) sit at the center, mirrored outward.
      const halfCount = 10
      const barCount = halfCount * 2
      const gap = 3
      const barWidth = (width - gap * (barCount - 1)) / barCount
      const centerY = height / 2
      ctx.fillStyle = "rgba(255,255,255,0.92)"

      const drawBar = (x: number, barHeight: number) => {
        const y = centerY - barHeight / 2
        const r = barWidth / 2
        ctx.beginPath()
        ctx.moveTo(x + r, y)
        ctx.arcTo(x + barWidth, y, x + barWidth, y + barHeight, r)
        ctx.arcTo(x + barWidth, y + barHeight, x, y + barHeight, r)
        ctx.arcTo(x, y + barHeight, x, y, r)
        ctx.arcTo(x, y, x + barWidth, y, r)
        ctx.closePath()
        ctx.fill()
      }

      for (let i = 0; i < halfCount; i++) {
        const sample = dataArray[Math.floor((i * dataArray.length) / halfCount)]
        const barHeight = Math.max(4, (sample / 255) * height * 0.78)
        drawBar((halfCount + i) * (barWidth + gap), barHeight)
        drawBar((halfCount - 1 - i) * (barWidth + gap), barHeight)
      }
    }

    draw()
  }

  function stopVisualization() {
    cancelAnimationFrame(animFrameRef.current)
    void audioCtxRef.current?.close()
    audioCtxRef.current = null
  }

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop()
      mediaRecorderRef.current = null
      cancelAnimationFrame(animFrameRef.current)
      void audioCtxRef.current?.close()
    }
  }, [])

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const mimeType = recorder.mimeType || "audio/webm"
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        stopVisualization()
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setTranscribing(true)
        try {
          const transcript = await transcribeAudio(blob)
          if (transcript) {
            onTranscriptRef.current(transcript)
            toast.success("Voice transcribed.")
          }
        } catch {
          toast.error("Transcription failed")
        } finally {
          setTranscribing(false)
          // Refresh usage so the paused-voice panel appears once the allowance runs out.
          void queryClient.invalidateQueries({ queryKey: USAGE_QUERY_KEY })
        }
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setRecording(true)
      startVisualization(stream)
    } catch {
      toast.error("Microphone access denied.")
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        disabled={disabled || transcribing}
        title={recording ? "Click to stop" : "Click to record"}
        aria-label={recording ? "Stop recording" : "Start voice recording"}
        className={[
          "relative h-28 w-28 overflow-hidden rounded-full",
          "flex items-center justify-center",
          "transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          recording
            ? "bg-red-500 shadow-lg shadow-red-200 hover:bg-red-600 focus-visible:ring-red-500"
            : transcribing
              ? "cursor-not-allowed bg-muted opacity-60"
              : "cursor-pointer bg-[#ff6b55] text-white shadow-md hover:bg-[#eb5945] focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60",
        ].join(" ")}
      >
        {transcribing ? (
          <Loader2 className="h-9 w-9 animate-spin text-muted-foreground" />
        ) : recording ? (
          <canvas ref={canvasRef} width={BTN_SIZE} height={BTN_SIZE} className="pointer-events-none absolute inset-0" />
        ) : (
          <Mic className="h-9 w-9 text-white" />
        )}
      </button>
      <p className="h-4 text-xs text-muted-foreground">
        {transcribing ? "Transcribing…" : recording ? "Recording — click to stop" : "Click to record"}
      </p>
    </div>
  )
}
