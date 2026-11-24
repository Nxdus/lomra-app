// @ts-expect-error Bun provides this module at test runtime; Next.js does not load it.
import { expect, test } from "bun:test";
import { validateValue } from "./local-store/validation";
import { changeSdSettings, loadSdSettings, sdSettingsOf, subscribeSdSettings } from "./sd-settings-store";

const setting = (value: unknown) => validateValue("settings", "sd-settings", value);
const canvas = (provenance: unknown) => validateValue("canvas", "default", [{ id: "a", name: "a.png", type: "image/png", lastModified: 1, x: 0, y: 0, width: 1, height: 1, harness: { role: "Output", provenance } }]);

test("saved settings and provenance accept what the engine takes and nothing else; older data stays valid", () => {
  expect(() => setting({})).not.toThrow();
  expect(() => setting({ "sd-turbo": {}, "hf-a-b-123abc": { negativePrompt: "blur", seed: 0, steps: 50, cfg: 7.5, strength: 1 } })).not.toThrow();
  for (const bad of [[], null, { "../x": {} }, { a: { seed: -1 } }, { a: { seed: 2147483648 } }, { a: { seed: 1.5 } }, { a: { steps: 0 } }, { a: { steps: 51 } },
    { a: { cfg: 21 } }, { a: { strength: 1.1 } }, { a: { negativePrompt: "x".repeat(2001) } }, { a: { lora: "x" } }, { a: { toString: 1 } }]) expect(() => setting(bad)).toThrow("Invalid saved state");

  const sd = { seed: 1, steps: 20, cfg: 7 };
  for (const ok of [{ model: "m", prompt: "p" }, { model: "m", prompt: "p", sd }, { model: "m", prompt: "p", sd: { ...sd, strength: 0.5, negativePrompt: "x", image: true, mask: true } }]) expect(() => canvas(ok)).not.toThrow();
  for (const bad of [{}, null, { ...sd, seed: "1" }, { ...sd, steps: 0 }, { ...sd, strength: 2 }, { ...sd, image: 1 }, { ...sd, negativePrompt: 5 }]) expect(() => canvas({ model: "m", prompt: "p", sd: bad })).toThrow("Invalid saved state");

  const chat = (extra: object) => validateValue("chats", "c", { id: "c", title: "t", updatedAt: 1, history: [], models: [], generations: [{ id: "g", category: "picture", model: "sd/x", prompt: "p", status: "Completed", ...extra }] });
  expect(() => chat({})).not.toThrow();
  expect(() => chat({ sd })).not.toThrow();
  expect(() => chat({ sd: { seed: -1 } })).toThrow("Invalid saved state");
});

test("settings are kept per model, load once, save what changed and drop what was reset", async () => {
  const original = globalThis.fetch;
  const saved: unknown[] = [];
  let reads = 0;
  globalThis.fetch = (async (url: unknown, options?: RequestInit) => {
    if (options?.method === "PUT") { saved.push(JSON.parse(String(options.body)).value); return Response.json({}); }
    reads++;
    return Response.json([{ id: "sd-settings", value: { old: { steps: 9 }, turbo: { seed: 1 } } }]);
  }) as typeof fetch;
  let notified = 0;
  const unsubscribe = subscribeSdSettings(() => { notified++; });
  try {
    await Promise.all([loadSdSettings(), loadSdSettings()]);
    expect(reads).toBe(1);
    expect(sdSettingsOf("old")).toEqual({ steps: 9 });
    expect(sdSettingsOf("none")).toBe(sdSettingsOf("none"));
    changeSdSettings("turbo", { seed: undefined, steps: 4, negativePrompt: "" });
    expect(sdSettingsOf("turbo")).toEqual({ steps: 4 });
    changeSdSettings("old", {});
    expect(notified).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(saved).toEqual([{ turbo: { steps: 4 } }]);
  } finally { unsubscribe(); globalThis.fetch = original; }
});
