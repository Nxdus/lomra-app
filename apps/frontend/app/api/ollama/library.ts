import { validOllamaName } from "./ollama";

export const LIBRARY_URL = "https://ollama.com/library";
const MAX_SUGGESTIONS = 800;

const htmlEntities: Record<string, string> = { amp: "&", lt: "<", gt: ">", "#39": "'", "#34": '"' };

export function parseModelDetails(html: string, family: string) {
  const description = /<meta\s+name="description"\s+content="([^"]*)"/.exec(html)?.[1]
    .trim().replace(/&(amp|lt|gt|#39|#34);/g, (_, entity: string) => htmlEntities[entity]) ?? "";
  const sizes: Record<string, string> = Object.create(null);

  // The mobile tag rows put the download size between two bullets.
  for (const [, name, row] of html.matchAll(/<a\s+href="\/library\/([^"]+)"\s+class="md:hidden\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (!name.startsWith(`${family}:`) || !validOllamaName(name)) continue;
    const size = /•\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)\s*•/i.exec(row);
    if (size) sizes[name] = `${size[1]} ${size[2].toUpperCase()}`;
  }

  return { description, sizes };
}

/**
 * Model names Lomra can use, read from the public ollama.com/library page (Ollama has no JSON API
 * for it): only models that can call tools, as `name` and `name:size`, in the page's order.
 * Cloud-hosted models are skipped because they need an Ollama account.
 */
export function parseLibrary(html: string) {
  const names: string[] = [];
  for (const block of html.split("<li").slice(1)) {
    const name = /href="\/library\/([a-z0-9._-]+)"/.exec(block)?.[1];
    if (!name || !validOllamaName(name)) continue;
    const badges = [...block.matchAll(/<span\s+class="inline-flex[^"]*?(bg-indigo-50|bg-cyan-50|bg-\[#ddf4ff\])[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g)]
      .map(([, kind, text]) => ({ kind, text }));
    const capabilities = badges.filter(({ kind }) => kind !== "bg-[#ddf4ff]").map(({ text }) => text);
    if (!capabilities.includes("tools") || capabilities.includes("cloud")) continue;
    const sizes = badges.filter(({ kind, text }) => kind === "bg-[#ddf4ff]" && /^[a-z0-9.]{1,16}$/.test(text) && !text.includes("cloud")).map(({ text }) => text);
    names.push(name, ...sizes.map((size) => `${name}:${size}`));
  }
  return [...new Set(names)].filter(validOllamaName).slice(0, MAX_SUGGESTIONS);
}
