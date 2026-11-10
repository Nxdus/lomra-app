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
  if (file.size > 25 * 1024 * 1024) {
    return Response.json({ message: "Audio must be at most 25 MB" }, { status: 413 });
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(310_000)]);
  try {
    const response = await fetch(new URL("/transcriptions", process.env.BACKEND_URL ?? "http://127.0.0.1:3001"), {
      method: "POST", body, signal,
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return Response.json({ message: "Transcription service unavailable" }, { status: signal.aborted ? 504 : 502 });
  }
}
