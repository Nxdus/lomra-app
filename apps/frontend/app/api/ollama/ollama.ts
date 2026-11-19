import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@/lib/local-store/data-dir";
import { defaultOllamaUrl, parseOllamaUrl } from "@/lib/ollama-url";

/** The Ollama server: the address saved in Settings, else OLLAMA_URL, else this computer. */
export async function ollamaUrl() {
  try {
    const saved: unknown = JSON.parse(await readFile(join(dataDir(), "settings", "ollama-url.json"), "utf8"));
    const url = typeof saved === "string" ? parseOllamaUrl(saved) : undefined;
    if (url) return url;
  } catch { /* Not set. */ }
  return parseOllamaUrl(process.env.OLLAMA_URL ?? "") ?? defaultOllamaUrl;
}

/** Model IDs of this provider are `ollama/<name>`, like `google-ai/<name>` for Google. */
export const OLLAMA_PREFIX = "ollama/";

export const validOllamaName = (name: unknown): name is string =>
  typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(name) && !name.includes("..");

export const OLLAMA_OFFLINE = "Cannot reach Ollama. Start it, or check the server address in Settings.";

/** Maps an Ollama error response to a short message the user can act on. */
export async function ollamaErrorMessage(response: Response) {
  let detail = "";
  try {
    const result: unknown = await response.json();
    const error = result && typeof result === "object" && "error" in result ? result.error : undefined;
    detail = typeof error === "string" ? error : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  } catch { /* The body is optional. */ }
  if (/does not support tools/i.test(detail)) return "This local model cannot call tools. Choose a model that supports tools, such as Qwen 3 or Llama 3.2.";
  if (response.status === 404 || /not found/i.test(detail)) return "This model is not installed in Ollama. Install it in Settings first.";
  if (/requires more (system )?memory/i.test(detail)) return "This computer does not have enough memory for this model. Choose a smaller one.";
  return "Ollama could not complete the request";
}
