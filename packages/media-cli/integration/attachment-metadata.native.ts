/** Opt-in same-build attachment/file differential, independent of prediction.
 * A local binding does not qualify a remote filesystem or descriptor bridge. */
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
const payload = Uint8Array.from([0, 255, 128, 10, 13, 65]);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent',
  PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
let directory: string;
let fixture: Uint8Array;
beforeAll(async () => {
  const executable = nativeReference.executables.ffmpeg;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  directory = await mkdtemp(join(tmpdir(), 'attachment-metadata-'));
  await writeFile(join(directory, 'source.bin'), payload);
  const seed = await runNative(executable.path, ['-v', 'error', '-f', 'lavfi', '-i',
    'color=size=16x16:duration=0.04', '-c:v', 'ffv1', '-attach', 'source.bin',
    '-metadata:s:t', 'mimetype=application/octet-stream', '-metadata:s:t',
    'filename=restored.bin', 'attachments.mkv'].map(b), { cwd: directory, env, stdin: new Uint8Array() });
  expect(seed.exitCode, Buffer.from(seed.stderr, 'base64').toString()).toBe(0);
  fixture = await readFile(join(directory, 'attachments.mkv'));
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function reset() {
  for (const name of await readdir(directory)) await rm(join(directory, name), { force: true });
  await writeFile(join(directory, 'attachments.mkv'), fixture);
  await writeFile(join(directory, 'name.option'), Uint8Array.from([0, 255]));
}
async function files() {
  const result: Record<string, string> = {};
  for (const name of await readdir(directory)) result[name] = (await readFile(join(directory, name))).toString('base64');
  return result;
}

it.each(['dump_attachment', 'dump_attachment:t', 'dump_attachment:t:0', '/dump_attachment', '/dump_attachment:t:0'])(
  'matches native extraction bytes and complete file effects for empty %s', async option => {
    const indirect = option.startsWith('/');
    const unsuffixed = !option.includes(':');
    const argv = ['-v', 'error', `-${option}`, indirect ? 'name.option' : '', '-i', 'attachments.mkv', '-f', 'null', '-'].map(b);
    // Predict independently, before observing the native metadata/filename.
    const plan = discover('ffmpeg', argv);
    expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
      ...(indirect ? [['option-file', b('name.option')]] : []),
      ['input', b('attachments.mkv')], ['output', b('-')],
    ]);
    expect(plan.deferred).toContainEqual({ index: 2, reason: 'stream-metadata' });
    const context = { cwd: directory, env, stdin: new Uint8Array() };
    await reset();
    const native = await runNative(nativeReference.executables.ffmpeg.path, argv, context);
    expect(native.exitCode).toBe(unsuffixed ? 234 : 0);
    const expected = await files();
    if (unsuffixed) {
      // Without a selector native tries the video stream first; it has no
      // filename tag. Prediction must neither supply a name nor skip a stream.
      expect(Buffer.from(native.stderr, 'base64').toString()).toContain("No filename specified and no 'filename' tag");
      expect(expected).not.toHaveProperty('restored.bin');
    } else expect(expected['restored.bin']).toBe(Buffer.from(payload).toString('base64'));
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
  },
);
