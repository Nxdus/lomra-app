const MAX_AUDIO = 25 * 1024 * 1024;

export async function POST(request: Request) {
  let body: FormData;
  try {
    body = await request.formData();
  } catch {
    return Response.json({ message: "Expected an audio file upload" }, { status: 400 });
  }
  const file = body.get("file");
  if (!(file instanceof File) || !file.size) {
    return Response.json({ message: "Audio file is required" }, { status: 400 });
  }
  if (file.size > MAX_AUDIO) {
    return Response.json({ message: "Audio must be at most 25 MB" }, { status: 413 });
  }
  if (!/^(audio\/|video\/webm$|application\/ogg$)/.test(file.type)) {
    return Response.json({ message: "Unsupported audio type" }, { status: 400 });
  }
  const url = new URL("/asr", process.env.WHISPER_URL ?? "http://127.0.0.1:9000");
  url.searchParams.set("task", "transcribe");
  url.searchParams.set("output", "json");
  // Which bundled desktop model to use; other Whisper servers ignore it.
  const model = body.get("model");
  if (typeof model === "string" && /^[a-z0-9-]{1,32}$/.test(model)) url.searchParams.set("model", model);
  // Omitting language lets Whisper detect it and preserve the original language.
  const upload = new FormData();
  upload.append("audio_file", file, "audio");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(300_000)]);
  try {
    const response = await fetch(url, { method: "POST", body: upload, signal });
    // The bundled desktop model answers 409 until the user agrees to download it, then 503 while it downloads and loads.
    if (response.status === 409) return Response.json({ message: "The speech model is not downloaded", code: "model-missing" }, { status: 409 });
    if (response.status === 503) return Response.json({ message: "Speech recognition is still starting. The model is downloading or loading" }, { status: 503 });
    if (!response.ok) return Response.json({ message: "Whisper could not transcribe the audio" }, { status: 502 });
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string") {
      return Response.json({ message: "Whisper returned an invalid transcription" }, { status: 502 });
    }
    return Response.json({ text: result.text, language: "language" in result && typeof result.language === "string" ? result.language : undefined });
  } catch {
    return Response.json({ message: signal.aborted ? "Whisper transcription timed out" : "Whisper is unavailable or returned an invalid response" }, { status: signal.aborted ? 504 : 502 });
  }
}
