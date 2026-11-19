import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TAIL_BYTES = 512 * 1024;
const MAX_FILES = 6;

const windowLabel = (minutes) => minutes === 300 ? '5 hr' : minutes === 10080 ? 'Weekly' : minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`;

/** Usage windows (5 hr, weekly) as the Claude CLI reports them in a `rate_limit_event`. Percentages are 0-100. */
export function claudeWindows(info) {
  const labels = { five_hour: '5 hr', seven_day: 'Weekly' };
  return Object.entries(info?.unifiedWindows ?? {})
    .filter(([, window]) => Number.isFinite(window?.utilization) && Number.isFinite(window?.resetsAt))
    .map(([id, window]) => ({ id, label: labels[id] ?? id.replaceAll('_', ' '), usedPercent: Math.min(100, Math.max(0, window.utilization * 100)), resetsAt: window.resetsAt }));
}

function newest(dir) {
  try {
    return readdirSync(dir).sort().reverse();
  } catch {
    return [];
  }
}

function rolloutFiles(root) {
  const files = [];
  for (const year of newest(root)) {
    for (const month of newest(join(root, year))) {
      for (const day of newest(join(root, year, month))) {
        for (const name of newest(join(root, year, month, day))) {
          if (name.endsWith('.jsonl')) files.push(join(root, year, month, day, name));
          if (files.length >= MAX_FILES) return files;
        }
      }
    }
  }
  return files;
}

function lastRateLimits(file) {
  const size = statSync(file).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const buffer = Buffer.alloc(size - start);
  const handle = openSync(file, 'r');
  try { readSync(handle, buffer, 0, buffer.length, start); } finally { closeSync(handle); }
  const lines = buffer.toString('utf8').split(String.fromCharCode(10));
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!lines[index].includes('"rate_limits"')) continue;
    try {
      const limits = JSON.parse(lines[index])?.payload?.rate_limits;
      if (limits?.primary || limits?.secondary) return limits;
    } catch { /* a partial first line of the tail */ }
  }
}

/** Codex records its usage windows in its session logs, so they can be read without making a request. */
export function codexWindows(home = homedir()) {
  for (const file of rolloutFiles(join(home, '.codex', 'sessions'))) {
    let limits;
    try { limits = lastRateLimits(file); } catch { continue; }
    if (!limits) continue;
    return [limits.primary, limits.secondary]
      .filter((window) => Number.isFinite(window?.used_percent) && Number.isFinite(window?.resets_at) && Number.isFinite(window?.window_minutes))
      .map((window) => ({ id: `${window.window_minutes}`, label: windowLabel(window.window_minutes), usedPercent: Math.min(100, Math.max(0, window.used_percent)), resetsAt: window.resets_at }))
      .sort((a, b) => Number(a.id) - Number(b.id));
  }
  return [];
}

/** Live Claude usage for the account Claude Code is signed in to (read-only call with its local token). Empty if unavailable. */
export async function claudeLiveWindows(home = homedir(), fetchImpl = fetch) {
  try {
    const token = JSON.parse(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8'))?.claudeAiOauth?.accessToken;
    if (!token) return [];
    const response = await fetchImpl('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    const data = await response.json();
    return [['five_hour', '5 hr'], ['seven_day', 'Weekly']]
      .map(([id, label]) => ({ id, label, usedPercent: Number(data?.[id]?.utilization), resetsAt: Date.parse(data?.[id]?.resets_at) / 1000 }))
      .filter((window) => Number.isFinite(window.usedPercent) && Number.isFinite(window.resetsAt))
      .map((window) => ({ ...window, usedPercent: Math.min(100, Math.max(0, window.usedPercent)) }));
  } catch {
    return [];
  }
}
