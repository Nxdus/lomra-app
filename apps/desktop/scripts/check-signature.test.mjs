import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const windows = process.platform === 'win32' && process.arch === 'x64';
const script = join(import.meta.dir, 'check-signature.ps1');
// A dependency with an unsigned binary and one that Microsoft ships with an embedded signature.
const binaries = join(import.meta.dir, '..', 'node_modules', '@lydell', 'node-pty-win32-x64', 'prebuilds', 'win32-x64');
const unsigned = join(binaries, 'conpty.node');
const signed = join(binaries, 'conpty', 'OpenConsole.exe');
const dir = mkdtempSync(join(tmpdir(), 'lomra-signature-'));
const tampered = join(dir, 'tampered.exe');
const summary = join(dir, 'summary.md');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function check(file, setting) {
  // PowerShell 7 exports a module path that Windows PowerShell cannot use.
  const { PSModulePath, WINDOWS_SIGNING, ...env } = process.env;
  if (setting !== undefined) env.WINDOWS_SIGNING = setting;
  const { status, stdout, stderr } = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', file], {
    env: { ...env, GITHUB_STEP_SUMMARY: summary }, encoding: 'utf8', windowsHide: true,
  });
  return { status, output: `${stdout}${stderr}` };
}

describe.skipIf(!windows)('check-signature.ps1', () => {
  test('passes an unsigned installer when signing is not configured', () => {
    for (const setting of [undefined, '', 'false']) {
      const { status, output } = check(unsigned, setting);
      expect(output).toContain('Signing configured: False');
      expect(output).toContain('::notice::');
      expect(status).toBe(0);
    }
    expect(readFileSync(summary, 'utf8')).toContain('Installer signature');
  }, 60_000);

  test('fails an unsigned installer when signing is configured', () => {
    const { status, output } = check(unsigned, 'true');
    expect(output).toContain('::error::Signing is configured');
    expect(status).toBe(1);
  }, 30_000);

  test('passes an installer with a valid embedded signature', () => {
    for (const setting of [undefined, 'true']) {
      const { status, output } = check(signed, setting);
      expect(output).toContain('Authenticode status: Valid');
      expect(output).toContain('Timestamp: present');
      expect(status).toBe(0);
    }
  }, 60_000);

  test('fails a file changed after signing only when signing is configured', () => {
    copyFileSync(signed, tampered);
    const bytes = readFileSync(tampered);
    bytes[0x2000] ^= 0xff;
    writeFileSync(tampered, bytes);
    expect(check(tampered, 'true')).toMatchObject({ status: 1, output: expect.stringContaining('HashMismatch') });
    expect(check(tampered).status).toBe(0);
  }, 60_000);

  test('refuses a catalog signature, a missing file and an unknown setting', () => {
    const catalog = check(join(process.env.SystemRoot, 'System32', 'notepad.exe'), 'true');
    expect(catalog.status).toBe(1);
    expect(check(join(dir, 'missing.exe')).status).toBe(1);
    expect(check(signed, 'yes')).toMatchObject({ status: 1, output: expect.stringContaining('WINDOWS_SIGNING must be') });
  }, 60_000);
});
