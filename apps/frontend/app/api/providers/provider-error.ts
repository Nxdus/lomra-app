export async function falErrorMessage(response: Response, action: string, key: string) {
  let detail = "";
  try {
    const body = await response.json();
    const value = body?.detail ?? body?.error ?? body?.message;
    detail = typeof value === "string" ? value : Array.isArray(value)
      ? value.map(item => typeof item?.msg === "string" ? item.msg : "").filter(Boolean).join("; ")
      : typeof value?.message === "string" ? value.message : "";
  } catch { /* Non-JSON provider errors still include the HTTP status. */ }
  // Never expose echoed credentials, signed URLs, or inline model contents.
  for (const secret of [key, ...key.split(":")]) {
    if (secret) detail = detail.split(secret).join("[redacted]");
  }
  detail = detail.replace(/data:[^\s"'<>]+/gi, "[inline file]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
    .replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 500);
  return `Fal ${action} failed (HTTP ${response.status})${detail ? `: ${detail}` : ". Check the request in the Fal dashboard for details."}`;
}
