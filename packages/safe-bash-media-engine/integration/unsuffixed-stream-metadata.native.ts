/** Opt-in pinned local differential. Remote late-access qualification is separate. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover } from '../src/discover.js';
import { createFFmpegShims } from '../src/shim.js';
import { grammarRevision, nativeReference } from '../src/options.generated.js';
import { runNative } from './runner.js';
import { comparableDiagnostics } from './diagnostics.js';

const b = (value: string) => new TextEncoder().encode(value);
let directory: string;
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent',
  PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
beforeAll(async () => {
  const executable = nativeReference.executables.ffmpeg;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  directory = await mkdtemp(join(tmpdir(), 'unsuffixed-stream-'));
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function reset() {
  for (const name of await readdir(directory)) await rm(join(directory, name));
  await writeFile(join(directory, 'stats.option'), 'stats.txt\0ignored');
}
async function files() {
  return Object.fromEntries(await Promise.all((await readdir(directory)).map(async name =>
    [name, (await readFile(join(directory, name))).toString('base64')])));
}

it.each([
  { indirect: false, missing: false }, { indirect: true, missing: false },
  { indirect: false, missing: true }, { indirect: true, missing: true },
])('preserves unsuffixed statistics and output effects %j', async ({ indirect, missing }) => {
  const laterStats = missing ? 'missing/late-stats.txt' : 'later-stats.txt';
  const argv = ['-v', 'error', '-y', '-f', 'lavfi', '-i',
    'sine=sample_rate=8000:duration=0.02', indirect ? '-/stats_enc_pre' : '-stats_enc_pre',
    indirect ? 'stats.option' : 'stats.txt', '-c', 'pcm_s16le', 'first.wav',
    '-stats_enc_pre', laterStats, '-c', 'pcm_s16le', 'second.wav'].map(b);
  // Independent predictions precede processing and must not open any file.
  const plan = discover('ffmpeg', argv);
  expect(plan.dependencies.map(item => [item.role, item.value, item.access])).toEqual([
    [indirect ? 'option-file' : 'sidecar', b(indirect ? 'stats.option' : 'stats.txt'), indirect ? 'read' : 'write'],
    ['output', b('first.wav'), 'write'], ['sidecar', b(laterStats), 'write'],
    ['output', b('second.wav'), 'write'],
  ]);
  expect(plan.deferred.filter(item => item.reason === 'stream-metadata').map(item => item.index)).toEqual([7, 9, 12, 14]);
  const context = { cwd: directory, env, stdin: new Uint8Array() };
  await reset();
  const native = await runNative(nativeReference.executables.ffmpeg.path, argv, context);
  const expected = await files();
  expect(expected).toHaveProperty('stats.txt');
  expect(expected).toHaveProperty('first.wav');
  if (missing) {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain(laterStats);
  } else {
    expect(native.exitCode).toBe(0);
    expect(Buffer.from(expected['stats.txt'], 'base64').length).toBeGreaterThan(0);
    expect(Buffer.from(expected['first.wav'], 'base64').length).toBeGreaterThan(44);
    expect(expected['first.wav']).toBe(expected['second.wav']);
    expect(Buffer.from(expected['stats.txt'], 'base64').toString()).toBe('0 0 0 0\n');
    expect(Buffer.from(expected[laterStats], 'base64').toString()).toBe('1 0 0 0\n');
  }
  await reset();
  const run = vi.fn(async invocation => {
    expect(invocation.argv).toEqual(argv);
    return runNative(invocation.executable.path, invocation.argv, invocation.context);
  });
  const result = await createFFmpegShims({ build: nativeReference.id, grammarRevision,
    argv: 'bytes', lateAccess: 'complete', effects: 'live', run }).ffmpeg(argv, context);
  expect(run).toHaveBeenCalledOnce();
  const actual = await run.mock.results[0].value;
  expect(result.exitCode).toBe(native.exitCode);
  expect(actual.stdout).toBe(native.stdout);
  expect(comparableDiagnostics(Buffer.from(actual.stderr, 'base64')))
    .toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(await files()).toEqual(expected);
});
