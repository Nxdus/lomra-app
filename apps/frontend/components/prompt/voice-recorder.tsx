"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { RefreshCwIcon, LoaderCircleIcon, SquareIcon, XIcon } from "lucide-react";
import { Tip } from "@/components/tip";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { useSpeechModel } from "@/hooks/use-speech-model";
import { useSpeechDownload } from "./speech-download";
import { toWav } from "./wav";
import type { MicVAD } from "@ricky0123/vad-web";

export function VoiceRecorder({ onCancel, onTranscribed }: {
  onCancel: () => void;
  onTranscribed: (text: string) => void;
}) {
  const { model } = useSpeechModel();
  const { ask: askDownload, dialog: downloadDialog } = useSpeechDownload();
  const canvas = useRef<HTMLCanvasElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audio = useRef<Blob | null>(null);
  const upload = useRef<AbortController | null>(null);
  const [status, setStatus] = useState("Requesting microphone access…");
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // A microphone failure returns to chat. Transcription failures keep the recording.
  const leave = useEffectEvent(onCancel);
  useEffect(() => {
    if (!error) return;
    toast.add({ title: status, type: "error" });
    if (!audioUrl) leave();
  }, [audioUrl, error, status]);

  async function transcribe() {
    if (!audio.current || upload.current) return;
    if (!audio.current.size || audio.current.size > 25 * 1024 * 1024) {
      setError(true);
      setStatus("Record audio between 1 byte and 25 MB. Cancel and try again.");
      return;
    }
    const controller = new AbortController();
    upload.current = controller;
    setTranscribing(true);
    setError(false);
    setStatus("Transcribing audio…");
    try {
      const body = new FormData();
      body.append("file", await toWav(audio.current), "recording.wav");
      if (model) body.append("model", model);
      const response = await fetch("/api/transcriptions", {
        method: "POST", body, signal: controller.signal,
      });
      if (!response.ok) {
        const failure: unknown = await response.json().catch(() => null);
        const message = failure && typeof failure === "object" && "message" in failure ? failure.message : undefined;
        if (response.status === 409 && failure && typeof failure === "object" && "code" in failure && failure.code === "model-missing") {
          const started = await askDownload(model);
          if (controller.signal.aborted) return;
          if (started) toast.add({ title: "The speech model is downloading.", description: "Retry transcription after the download finishes." });
          setStatus(started ? "Retry transcription after the download finishes." : "Transcription canceled.");
          return;
        }
        throw new Error(typeof message === "string" ? `${message}. Try again.` : "Could not transcribe audio. Try again.");
      }
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string") {
        throw new Error("Invalid transcription response. Try again.");
      }
      const text = result.text.trim();
      if (!text) throw new Error("No speech found. Cancel and record again.");
      if (!controller.signal.aborted) onTranscribed(text);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(true);
      setStatus(cause instanceof Error ? cause.message : "Could not transcribe audio. Try again.");
    } finally {
      if (!controller.signal.aborted) {
        upload.current = null;
        setTranscribing(false);
      }
    }
  }

  const transcribeOnStop = useEffectEvent(transcribe);

  useEffect(() => {
    let disposed = false;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let frame = 0;
    let url: string | undefined;
    let detector: MicVAD | undefined;
    let inputReleased = false;
    let speechDetected = false;
    let recordingFailed = false;

    function releaseInput() {
      inputReleased = true;
      cancelAnimationFrame(frame);
      if (detector) {
        void detector.destroy().catch(console.error);
        detector = undefined;
      }
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") void context.close();
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
          throw new Error("unsupported");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
        });
        if (disposed) { releaseInput(); return; }

        context = new AudioContext();
        await context.resume();
        if (disposed) { releaseInput(); return; }
        setStatus("Preparing speech detection…");
        const { MicVAD } = await import("@ricky0123/vad-web");
        if (disposed) { releaseInput(); return; }
        detector = await MicVAD.new({
          model: "v5",
          audioContext: context,
          baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/",
          onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/",
          getStream: async () => stream!,
          pauseStream: async () => {},
          resumeStream: async () => stream!,
          onFrameProcessed: ({ isSpeech }) => {
            if (!inputReleased) speechDetected = isSpeech >= (speechDetected ? 0.35 : 0.6);
          },
        });
        if (disposed) { releaseInput(); return; }
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(stream).connect(analyser);
        const silentOutput = context.createGain();
        silentOutput.gain.value = 0;
        analyser.connect(silentOutput);
        silentOutput.connect(context.destination);
        const samples = new Uint8Array(analyser.fftSize);
        const sampleInterval = 80;
        const levels = new Array<number>(160).fill(2);
        let lastSampleTime = performance.now();
        const chunks: BlobPart[] = [];
        const activeRecorder = new MediaRecorder(stream);
        recorder.current = activeRecorder;
        activeRecorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        activeRecorder.onstop = () => {
          releaseInput();
          if (disposed || recordingFailed) return;
          audio.current = new Blob(chunks, { type: activeRecorder.mimeType });
          url = URL.createObjectURL(audio.current);
          setAudioUrl(url);
          setRecording(false);
          void transcribeOnStop();
        };
        activeRecorder.onerror = () => {
          recordingFailed = true;
          releaseInput();
          if (disposed) return;
          setError(true);
          setRecording(false);
          setStatus("Recording failed. Cancel and try again.");
        };
        activeRecorder.start();
        setRecording(true);
        setStatus("Recording audio");

        function draw(timestamp: number) {
          frame = requestAnimationFrame(draw);
          const surface = canvas.current;
          const drawing = surface?.getContext("2d");
          if (!surface || !drawing) return;
          const elapsed = timestamp - lastSampleTime;
          if (elapsed >= sampleInterval) {
            analyser.getByteTimeDomainData(samples);
            const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
            const height = speechDetected ? Math.max(2, Math.min(30, Math.sqrt(rms) * 100)) : 2;
            const steps = Math.min(levels.length, Math.floor(elapsed / sampleInterval));
            levels.splice(0, steps);
            levels.push(...new Array<number>(steps).fill(height));
            lastSampleTime = timestamp - elapsed % sampleInterval;
          }
          drawing.clearRect(0, 0, surface.width, surface.height);
          drawing.fillStyle = getComputedStyle(surface).color;
          const spacing = surface.width / levels.length;
          const offset = (timestamp - lastSampleTime) / sampleInterval * spacing;
          for (let i = 0; i < levels.length; i++) {
            const height = levels[i];
            drawing.fillRect(i * spacing - offset, (surface.height - height) / 2, 2, height);
          }
        }
        frame = requestAnimationFrame(draw);
      } catch (cause) {
        releaseInput();
        if (disposed) return;
        setError(true);
        setStatus(cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone access denied. Allow access and try again."
          : "Could not start recording. Check your microphone and connection, then try again.");
      }
    }

    void start();
    return () => {
      disposed = true;
      upload.current?.abort();
      upload.current = null;
      audio.current = null;
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
      recorder.current = null;
      releaseInput();
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  return (
    <>
      <Tip label="Cancel recording"><Button variant="secondary" size="icon-sm" aria-label="Cancel recording" onClick={onCancel}>
        <XIcon />
      </Button></Tip>
      <span className={!error && !transcribing && (recording || audioUrl) ? "sr-only" : "min-w-0 flex-1 text-xs text-muted-foreground"} role="status">
        {status}
      </span>
      {!transcribing && (audioUrl
        ? <audio aria-label="Recorded audio" controls src={audioUrl} className="h-8 min-w-0 flex-1" />
        : <canvas ref={canvas} width={640} height={32} aria-hidden="true" className={recording ? "h-8 min-w-0 flex-1 text-muted-foreground" : "hidden"} />)}
      <Tip label="Stop recording"><Button variant="secondary" size="icon-sm" aria-label="Stop recording" disabled={!recording} onClick={() => recorder.current?.stop()}>
        <SquareIcon fill="currentColor" strokeWidth={0} />
      </Button></Tip>
      <Tip label={transcribing ? "Transcribing audio" : "Retry transcription"}><Button size="icon-sm" disabled={!audioUrl || transcribing} aria-label={transcribing ? "Transcribing audio" : "Retry transcription"} onClick={() => void transcribe()}>
        {transcribing ? <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" /> : <RefreshCwIcon aria-hidden="true" />}
      </Button></Tip>
      {downloadDialog}
    </>
  );
}
