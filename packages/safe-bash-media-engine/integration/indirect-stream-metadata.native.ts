/** Opt-in same-build differential. Local native I/O does not qualify remote
 * late-access mediation; prediction is asserted separately before execution. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover } from '../src/discover.js';
import { createFFmpegShims } from '../src/shim.js';
import { grammarRevision, nativeReference } from '../src/options.generated.js';
import { comparableDiagnostics } from './diagnostics.js';
import { runNative } from './runner.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
let cwd: string;
beforeAll(async () => {
  const executable = nativeReference.executables.ffmpeg;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  cwd = await mkdtemp(join(tmpdir(), 'indirect-stream-metadata-'));
});
afterAll(async () => { if (cwd) await rm(cwd, { recursive: true, force: true }); });

it.each([
  { name: 'optional and negative maps', missing: false, invalid: false },
  { name: 'missing late map file preserves first output', missing: true, invalid: false },
  { name: 'unknown option precedes missing map file', missing: true, invalid: true },
])('preserves native $name', async ({ missing, invalid }) => {
  const argv = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=sample_rate=8000:duration=0.02',
    '-c:a', 'pcm_s16le', '-f', 's16le', 'early.pcm',
    '-/map', missing ? 'absent.option' : 'optional.option', '-/map', 'negative.option',
    '-c:a:0', 'pcm_s16le', '-f', 's16le', 'later.pcm',
    ...(invalid ? ['-unknown_indirect_map_fixture'] : []),
  ].map(b);
  const plan = discover('ffmpeg', argv);
  expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
    ['output', b('early.pcm')], ['option-file', b(missing ? 'absent.option' : 'optional.option')],
    ['option-file', b('negative.option')], ['output', b('later.pcm')],
  ]);
  expect(plan.deferred.filter(item => item.reason === 'stream-metadata').map(item => item.index)).toEqual([7, 12, 14, 16]);
  const reset = async () => {
    for (const name of await readdir(cwd)) await rm(join(cwd, name));
    await writeFile(join(cwd, 'optional.option'), '0:a?');
    await writeFile(join(cwd, 'negative.option'), '-0:v?');
  };
  const effects = async () => Object.fromEntries(await Promise.all((await readdir(cwd)).map(async name => [name, await readFile(join(cwd, name))])));
  const context = { cwd, env, stdin: new Uint8Array() };
  await reset();
  const native = await runNative(nativeReference.executables.ffmpeg.path, argv, context);
  const nativeEffects = await effects();
  expect(native.exitCode === 0).toBe(!missing);
  if (invalid) expect(nativeEffects).not.toHaveProperty('early.pcm');
  else expect(nativeEffects).toHaveProperty('early.pcm');
  if (missing) expect(nativeEffects).not.toHaveProperty('later.pcm');
  else expect(nativeEffects['early.pcm']).toEqual(nativeEffects['later.pcm']);
  await reset();
  const run = vi.fn(async invocation => {
    const result = await runNative(invocation.executable.path, invocation.argv, context);
    return result;
  });
  const result = await createFFmpegShims({ build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live', run }).ffmpeg(argv, context);
  expect(run).toHaveBeenCalledOnce();
  expect(result.exitCode).toBe(native.exitCode);
  const shimNative = await run.mock.results[0].value;
  expect(comparableDiagnostics(Buffer.from(shimNative.stderr, 'base64')))
    .toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(shimNative.stdout).toBe(native.stdout);
  expect(await effects()).toEqual(nativeEffects);
});
