import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeWindows, codexWindows } from './limits.mjs';

test('Claude windows become percentages', () => {
  expect(claudeWindows({ unifiedWindows: { five_hour: { utilization: 0.16, resetsAt: 10 }, seven_day: { utilization: 0.54, resetsAt: 20 }, bad: {} } })).toEqual([
    { id: 'five_hour', label: '5 hr', usedPercent: 16, resetsAt: 10 },
    { id: 'seven_day', label: 'Weekly', usedPercent: 54, resetsAt: 20 },
  ]);
  expect(claudeWindows(undefined)).toEqual([]);
});

test('Codex windows come from the newest session log that has them', () => {
  const home = mkdtempSync(join(tmpdir(), 'lomra-codex-'));
  const day = join(home, '.codex', 'sessions', '2026', '11', '18');
  mkdirSync(day, { recursive: true });
  const event = (limits) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: limits } });
  writeFileSync(join(day, 'rollout-a.jsonl'), [event({ primary: { used_percent: 10, window_minutes: 10080, resets_at: 5 }, secondary: null })].join('\n'));
  writeFileSync(join(day, 'rollout-b.jsonl'), [event({ primary: { used_percent: 78, window_minutes: 10080, resets_at: 99 }, secondary: { used_percent: 20, window_minutes: 300, resets_at: 50 } }), event(null), 'partial'].join('\n'));
  expect(codexWindows(home)).toEqual([
    { id: '300', label: '5 hr', usedPercent: 20, resetsAt: 50 },
    { id: '10080', label: 'Weekly', usedPercent: 78, resetsAt: 99 },
  ]);
  expect(codexWindows(join(home, 'missing'))).toEqual([]);
});
