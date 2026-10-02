/** Source inventory includes disabled filters. Predictions cannot enable them
 * or preempt their native diagnostics. This does not qualify SOFA processing. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFFmpegShims, grammarRevision, nativeReference } from '../src/index.js';
import { runNative } from './runner.js';
import { comparableDiagnostics } from './diagnostics.js';

const b = (value: string) => new TextEncoder().encode(value);
let cwd: string;
beforeAll(async () => {
  const lock = JSON.parse(await readFile(new URL('../metadata/baselines/build-lock.json', import.meta.url), 'utf8'));
  for (const [path, entry] of Object.entries(lock.binaries_and_dylibs) as [string, { sha256: string }][]) {
    expect(createHash('sha256').update(await readFile(path)).digest('hex'), path).toBe(entry.sha256);
  }
  cwd = await mkdtemp(join(tmpdir(), 'media-cli-sofa-'));
});
afterAll(async () => { if (cwd) await rm(cwd, { recursive: true, force: true }); });

it.each([
  ['missing model', ['-af', 'sofalizer=sofa=missing.sofa']],
  ['missing loaded value', ['-af', 'sofalizer=/sofa=missing-name']],
  ['literal descriptor filename', ['-af', "sofalizer=sofa='pipe\\:3'"]],
  ['invalid option timing', ['-af', 'sofalizer=sofa=missing.sofa', '-unknown_sofa_fixture']],
])('retains native timing, streams and file effects for %s', async (name, options) => {
  for (const entry of await readdir(cwd)) await rm(join(cwd, entry));
  const argv = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=0.01', 'early.wav', ...options, 'later.wav'].map(b);
  const context = { cwd, env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' }, stdin: new Uint8Array() };
  const snapshot = async () => Object.fromEntries(await Promise.all((await readdir(cwd)).map(async name => [name, await readFile(join(cwd, name))])));
  const native = await runNative(nativeReference.executables.ffmpeg.path, argv, context);
  const effects = await snapshot();
  expect(native.exitCode).not.toBe(0);
  if (name === 'invalid option timing') {
    expect(effects).toEqual({});
    const diagnostics = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostics).toContain('Unrecognized option');
    expect(diagnostics).not.toContain('missing.sofa');
  }
  for (const name of await readdir(cwd)) await rm(join(cwd, name));
  let observed: typeof native | undefined;
  let calls = 0;
  const shim = createFFmpegShims({ build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
    async run(request) {
      calls++;
      observed = await runNative(request.executable.path, request.argv, request.context);
      return { exitCode: observed.exitCode };
    },
  });
  expect(await shim.ffmpeg(argv, context)).toEqual({ exitCode: native.exitCode });
  expect(calls).toBe(1);
  expect(observed!.stdout).toBe(native.stdout);
  expect(comparableDiagnostics(Buffer.from(observed!.stderr, 'base64'))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(await snapshot()).toEqual(effects);
});
