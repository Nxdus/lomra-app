export async function falErrorMessage(response: Response, action: string, key: string) {
  let body: unknown;
  try {
    body = await response.json();
  } catch { /* Non-JSON provider errors still include the HTTP status. */ }
  const detail = providerErrorDetail(body, key);
  return `Fal ${action} failed (HTTP ${response.status})${detail ? `: ${detail}` : ". Check the request in the Fal dashboard for details."}`;
}

export function providerErrorDetail(body: unknown, key: string) {
  const result = body as { detail?: unknown; error?: unknown; message?: unknown } | null;
  const value = result?.detail ?? result?.error ?? result?.message;
  let detail = typeof value === "string" ? value : Array.isArray(value)
    ? value.map(item => typeof item?.msg === "string" ? item.msg : "").filter(Boolean).join("; ")
    : typeof (value as { message?: unknown })?.message === "string" ? (value as { message: string }).message : "";
  // Never expose echoed credentials, signed URLs, or inline model contents.
  for (const secret of [key, ...key.split(":")]) {
    if (secret) detail = detail.split(secret).join("[redacted]");
  }
  return detail.replace(/data:[^\s"'<>]+/gi, "[inline file]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
    .replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 500);
}
