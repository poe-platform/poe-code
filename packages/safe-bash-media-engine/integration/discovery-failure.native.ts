/** Opt-in stock filesystem oracle; does not qualify remote filesystem mediation. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNative } from './runner.js';
import { comparableDiagnostics } from './diagnostics.js';

vi.mock('../src/discover.js', () => ({ discover: () => { throw new Error('Predictive grammar unavailable'); } }));
import { createFFmpegShims } from '../src/shim.js';
import { grammarRevision, nativeReference } from '../src/options.generated.js';

let cwd: string;
const encode = (text: string) => new TextEncoder().encode(text);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
beforeAll(async () => {
  for (const executable of Object.values(nativeReference.executables)) {
    expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  }
  cwd = await mkdtemp(join(tmpdir(), 'media-cli-discovery-failure-'));
});
afterAll(async () => { if (cwd) await rm(cwd, { recursive: true, force: true }); });

it.each([
  ['processed PCM stream', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=0.02', '-f', 's16le', 'pipe:1']],
  ['partial file before missing late preset', ['-y', '-f', 'lavfi', '-i', 'sine=duration=0.02', 'first.wav', '-fpre', 'missing.ffpreset', 'second.wav']],
  ['invalid option before missing input', ['-unregistered_option', '-i', 'missing.wav', 'out.wav']],
] as const)('%s survives a discovery failure with native diagnostics and effects', async (name, args) => {
  const context = { cwd, env, stdin: new Uint8Array() };
  const argv = ['-v', 'error', ...args].map(encode);
  const snapshot = async () => {
    const entries = await readdir(cwd);
    return Object.fromEntries(await Promise.all(entries.map(async entry => [entry, await readFile(join(cwd, entry))])));
  };
  const clear = async () => { for (const entry of await readdir(cwd)) await rm(join(cwd, entry)); };
  await clear();
  const native = await runNative(nativeReference.executables.ffmpeg.path, argv, context);
  const effects = await snapshot();
  if (name === 'processed PCM stream') {
    expect(native.exitCode).toBe(0);
    expect(Buffer.from(native.stdout, 'base64').length).toBe(320);
  } else if (name === 'partial file before missing late preset') {
    expect(native.exitCode).not.toBe(0);
    expect(effects).toHaveProperty('first.wav');
    expect(effects).not.toHaveProperty('second.wav');
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain('missing.ffpreset');
  } else {
    expect(native.exitCode).not.toBe(0);
    expect(effects).toEqual({});
    const diagnostics = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostics).toContain('Unrecognized option');
    expect(diagnostics).not.toContain('missing.wav');
  }
  await clear();
  let observed: typeof native | undefined;
  const run = vi.fn(async request => {
    expect(request.discovery.dependencies).toEqual([]);
    observed = await runNative(request.executable.path, request.argv, request.context);
    return { exitCode: observed.exitCode };
  });
  const shim = createFFmpegShims({ build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live', run });
  expect(await shim.ffmpeg(argv, context)).toEqual({ exitCode: native.exitCode });
  expect(run).toHaveBeenCalledTimes(1);
  expect(observed!.stdout).toBe(native.stdout);
  expect(comparableDiagnostics(Buffer.from(observed!.stderr, 'base64'))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(await snapshot()).toEqual(effects);
});
