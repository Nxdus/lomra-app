import type { SdSettings } from "./sd-settings";
import { getSetting, saveSetting } from "./settings";

const none: SdSettings = {};
const listeners = new Set<() => void>();
let models: Record<string, SdSettings> = {};
let lastSeed: number | undefined;
let loading: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

const notify = () => listeners.forEach((listener) => listener());

export function subscribeSdSettings(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const sdSettingsOf = (model: string) => models[model] ?? none;
/** The seed of the last local picture made since the app started. */
export const lastSdSeed = () => lastSeed;
export function rememberSdSeed(seed: number) { lastSeed = seed; notify(); }

/** Reads the saved settings once; every local picture waits for this so a saved setting is never skipped. */
export function loadSdSettings() {
  loading ??= getSetting<Record<string, SdSettings>>("sd-settings").then(
    (saved) => { models = { ...saved, ...models }; notify(); },
    (cause) => { loading = undefined; throw cause; },
  );
  return loading;
}

/** Changes a model's settings at once and saves them shortly after; a missing value means the model's default. */
export function changeSdSettings(model: string, settings: SdSettings, onError: (cause: unknown) => void = () => {}) {
  const kept = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined && value !== "")) as SdSettings;
  models = { ...models, [model]: kept };
  notify();
  clearTimeout(timer);
  timer = setTimeout(() => {
    loadSdSettings()
      .then(() => saveSetting("sd-settings", Object.fromEntries(Object.entries(models).filter(([, value]) => Object.keys(value).length))))
      .catch(onError);
  }, 400);
}
