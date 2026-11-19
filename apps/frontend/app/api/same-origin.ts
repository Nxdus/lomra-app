/** True when a browser request comes from this app's own origin (or has no Origin header). */
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const url = new URL(request.url);
  // Next can report localhost in the URL even when Electron uses 127.0.0.1.
  const host = request.headers.get("host") ?? url.host;
  return origin === `${url.protocol}//${host}`;
}
