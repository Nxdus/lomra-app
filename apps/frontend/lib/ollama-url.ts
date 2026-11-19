export const defaultOllamaUrl = "http://127.0.0.1:11434";

/** The origin of an Ollama server address (http or https, no login, no path), or undefined if it is not one. */
export function parseOllamaUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** True when the server runs on another machine, so this app cannot start or stop it. */
export function isRemoteOllama(value: string) {
  const host = new URL(value).hostname;
  return !["127.0.0.1", "localhost", "[::1]"].includes(host);
}
