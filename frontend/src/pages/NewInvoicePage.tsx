import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, Mic, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { generateInvoice } from "@/api/invoices"
import { transcribeAudio } from "@/api/voice"

const MAX_CHARS = 2000
const BTN_SIZE = 112 // px — matches w-28 h-28

export default function NewInvoicePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState("")
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)

  // ── Waveform visualizer ──────────────────────────────────────────────────
  function startVisualization(stream: MediaStream) {
    const audioCtx = new AudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64 // 32 frequency bins — enough for smooth bars
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    audioCtxRef.current = audioCtx
    analyserRef.current = analyser

    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    function draw() {
      animFrameRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(dataArray)

      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)

      const barCount = 20
      const gap = 3
      const barWidth = (width - gap * (barCount - 1)) / barCount
      const centerY = height / 2

      ctx.fillStyle = "rgba(255,255,255,0.92)"
      for (let i = 0; i < barCount; i++) {
        const sample = dataArray[Math.floor((i * dataArray.length) / barCount)]
        const barHeight = Math.max(4, (sample / 255) * height * 0.78)
        const x = i * (barWidth + gap)
        const y = centerY - barHeight / 2
        const r = barWidth / 2
        // Rounded bar
        ctx.beginPath()
        ctx.moveTo(x + r, y)
        ctx.arcTo(x + barWidth, y, x + barWidth, y + barHeight, r)
        ctx.arcTo(x + barWidth, y + barHeight, x, y + barHeight, r)
        ctx.arcTo(x, y + barHeight, x, y, r)
        ctx.arcTo(x, y, x + barWidth, y, r)
        ctx.closePath()
        ctx.fill()
      }
    }

    draw()
  }

  function stopVisualization() {
    cancelAnimationFrame(animFrameRef.current)
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    analyserRef.current = null
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current)
      audioCtxRef.current?.close()
    }
  }, [])

  // ── Recording ────────────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const actualMimeType = recorder.mimeType || "audio/webm"
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        stopVisualization()
        const blob = new Blob(chunksRef.current, { type: actualMimeType })
        setTranscribing(true)
        try {
          const transcript = await transcribeAudio(blob)
          if (transcript) {
            setPrompt((prev) => (prev ? `${prev}\n${transcript}` : transcript))
            toast.success("Voice transcribed.")
          }
        } catch {
          toast.error("Transcription failed. Check your Speechmatics API key.")
        } finally {
          setTranscribing(false)
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

  // ── Generate ─────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!prompt.trim()) return
    setLoading(true)
    try {
      const result = await generateInvoice(prompt.trim())
      toast.success(
        `Invoice generated${result.rag_docs_used > 0 ? ` using ${result.rag_docs_used} historical doc(s)` : ""}.`
      )
      navigate("/invoices/editor", { state: { invoice: result.invoice } })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Generation failed."
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Invoice</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Describe the invoice in plain text or record your voice. The AI will generate a structured
          draft based on your description and historical invoice patterns.
        </p>
      </div>

      {/* Mic circle */}
      <div className="flex flex-col items-center gap-2 py-2">
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          disabled={loading || transcribing}
          title={recording ? "Click to stop" : "Click to record"}
          className={[
            "relative w-28 h-28 rounded-full overflow-hidden",
            "flex items-center justify-center",
            "transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
            recording
              ? "bg-red-500 hover:bg-red-600 focus-visible:ring-red-500 shadow-lg shadow-red-200"
              : transcribing
              ? "bg-muted cursor-not-allowed opacity-60"
              : "bg-muted hover:bg-accent focus-visible:ring-primary cursor-pointer",
          ].join(" ")}
        >
          {transcribing ? (
            <Loader2 className="h-9 w-9 animate-spin text-muted-foreground" />
          ) : recording ? (
            <canvas
              ref={canvasRef}
              width={BTN_SIZE}
              height={BTN_SIZE}
              className="absolute inset-0 pointer-events-none"
            />
          ) : (
            <Mic className="h-9 w-9 text-muted-foreground" />
          )}
        </button>
        <p className="text-xs text-muted-foreground h-4">
          {transcribing
            ? "Transcribing…"
            : recording
            ? "Recording — click to stop"
            : "Click to record"}
        </p>
      </div>

      {/* Prompt textarea */}
      <div className="space-y-2">
        <Label htmlFor="prompt">Invoice Description</Label>
        <Textarea
          id="prompt"
          placeholder={`Examples:\n• 10 hours of consulting at $150/hr for Acme Corp\n• Monthly retainer $2,500 for ABC LLC\n• 3 website pages at $800 each for John Smith`}
          rows={8}
          maxLength={MAX_CHARS}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="resize-none"
        />
        <p className={`text-xs text-right ${prompt.length >= MAX_CHARS ? "text-destructive" : "text-muted-foreground"}`}>
          {prompt.length} / {MAX_CHARS}
        </p>
      </div>

      <Button
        onClick={handleGenerate}
        disabled={!prompt.trim() || loading}
        className="w-full"
        size="lg"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Generating…
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Invoice
          </>
        )}
      </Button>
    </div>
  )
}
