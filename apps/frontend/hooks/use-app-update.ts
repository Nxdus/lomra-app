"use client";

import { useEffect, useSyncExternalStore } from "react";
import { desktopApp, type UpdateInfo } from "@/lib/desktop";

export type AppUpdateStatus = "idle" | "downloading" | "installing" | "error";

export type AppUpdateState = {
  version: string | null | undefined;
  info: UpdateInfo | null;
  checking: boolean;
  status: AppUpdateStatus;
  progress: { received: number; total: number } | null;
  error: string | null;
  dismissed: boolean;
  minimized: boolean;
};

const initialState: AppUpdateState = {
  version: undefined,
  info: null,
  checking: false,
  status: "idle",
  progress: null,
  error: null,
  dismissed: false,
  minimized: false,
};

let state: AppUpdateState = initialState;
const listeners = new Set<() => void>();
let initialized = false;
let sessionCheck: Promise<void> | null = null;
let canceling = false;

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<AppUpdateState>) {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

function getServerSnapshot() {
  return initialState;
}

async function check(force = false) {
  const api = desktopApp();
  if (!api) {
    setState({ version: null, checking: false });
    return;
  }
  if (!force && sessionCheck) return sessionCheck;

  const run = (async () => {
    setState({ checking: true });
    try {
      const next = await api.checkUpdate(force);
      setState({
        info: next,
        version: next.current ? next.current.replace(/^v/i, "") : state.version,
        checking: false,
      });
    } catch {
      setState({ checking: false });
    }
  })();

  if (!force) sessionCheck = run;
  return run;
}

function init() {
  if (initialized) return;
  initialized = true;
  const api = desktopApp();
  if (!api) {
    setState({ version: null });
    return;
  }

  api.onUpdateProgress?.((next) => {
    setState({ progress: next });
  });

  void api.version().then(
    (value) => { setState({ version: value.replace(/^v/i, "") }); },
    () => { setState({ version: null }); },
  );

  void check(false);
}

async function install() {
  const api = desktopApp();
  if (!api?.installUpdate || state.status === "downloading" || state.status === "installing") return;
  canceling = false;
  setState({
    status: "downloading",
    error: null,
    dismissed: false,
    minimized: false,
    progress: { received: 0, total: state.info?.assetSize ?? 0 },
  });
  try {
    const result = await api.installUpdate();
    if (result.ok) {
      setState({ status: "installing", minimized: false });
      return;
    }
    if (canceling || result.error === "Update canceled.") {
      setState({ status: "idle", progress: null, error: null, dismissed: true, minimized: false });
      return;
    }
    setState({
      status: "error",
      progress: null,
      error: result.error ?? "Could not install the update.",
      minimized: false,
    });
  } catch (error) {
    if (canceling) {
      setState({ status: "idle", progress: null, error: null, dismissed: true, minimized: false });
      return;
    }
    setState({
      status: "error",
      progress: null,
      error: error instanceof Error ? error.message : "Could not install the update.",
      minimized: false,
    });
  }
}

async function cancel() {
  const api = desktopApp();
  if (!api?.cancelUpdate) return;
  canceling = true;
  await api.cancelUpdate();
}

function dismiss() {
  if (state.status === "error") {
    setState({ status: "idle", error: null, dismissed: true, minimized: false });
    return;
  }
  setState({ dismissed: true });
}

function minimize() {
  setState({ minimized: true });
}

async function openRelease(url: string) {
  const api = desktopApp();
  if (!api) return false;
  try {
    return await api.openRelease(url);
  } catch {
    return false;
  }
}

export function useAppUpdate() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    init();
  }, []);

  return {
    ...snapshot,
    check,
    install,
    cancel,
    dismiss,
    minimize,
    openRelease,
  };
}
