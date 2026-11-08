/** Opt-in native error-stage differential. Backend processing success requires
 * a separately provisioned model/backend profile; this does not qualify it. */
import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFFmpegShims, discover, grammarRevision, nativeReference } from '../src/index.js';
import { comparableDiagnostics } from './diagnostics.js';
import { runNative } from './runner.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };

it.each([false, true])('preserves native DNN failure and output effects with early invalid option: %s', async invalid => {
  const executable = nativeReference.executables.ffmpeg;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  const argv = ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=16x16:duration=0.1',
    '-vf', "dnn_detect=model=missing.xml:labels='pipe\\:3'", '-c:v', 'rawvideo', '-f', 'nut', 'out.nut',
    ...(invalid ? ['-unknown_dnn_fixture'] : [])].map(b);
  expect(discover('ffmpeg', argv).dependencies.map(item => [item.value, item.kind])).toEqual([
    [b('missing.xml'), 'resource-lookup'], [b('pipe:3'), 'path'], [b('out.nut'), 'path'],
  ]);
  const cwd = await mkdtemp(join(tmpdir(), 'media-dnn-'));
  const context = { cwd, env, stdin: new Uint8Array() };
  const effects = async () => Object.fromEntries(await Promise.all((await readdir(cwd)).map(async name => [name, await readFile(join(cwd, name))])));
  try {
    await writeFile(join(cwd, 'out.nut'), 'sentinel');
    const native = await runNative(executable.path, argv, context);
    const expected = await effects();
    expect(native.exitCode).not.toBe(0);
    if (invalid) {
      expect(expected['out.nut']).toEqual(Buffer.from('sentinel'));
      expect(Buffer.from(native.stderr, 'base64').toString()).not.toContain('missing.xml');
    }
    await writeFile(join(cwd, 'out.nut'), 'sentinel');
    let observed: Awaited<ReturnType<typeof runNative>> | undefined;
    let calls = 0;
    const shim = createFFmpegShims<typeof context>({ build: nativeReference.id, grammarRevision,
      argv: 'bytes', lateAccess: 'complete', effects: 'live', async run(request) {
        calls++;
        observed = await runNative(request.executable.path, request.argv, request.context);
        return { exitCode: observed.exitCode };
      } });
    expect(await shim.ffmpeg(argv, context)).toEqual({ exitCode: native.exitCode });
    expect(calls).toBe(1);
    expect(observed!.stdout).toBe(native.stdout);
    expect(comparableDiagnostics(Buffer.from(observed!.stderr, 'base64'))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
    expect(await effects()).toEqual(expected);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
