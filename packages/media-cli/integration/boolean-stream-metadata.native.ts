/** Opt-in pinned native stream differential; independent dependency assertions
 * do not qualify remote late-access or filesystem transfer. */
import { beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { discover } from '../src/discover.js';
import { createFFmpegShims } from '../src/shim.js';
import { grammarRevision, nativeReference } from '../src/options.generated.js';
import { runNative } from './runner.js';
import { comparableDiagnostics } from './diagnostics.js';

const b = (value: string) => new TextEncoder().encode(value);
beforeAll(async () => {
  const executable = nativeReference.executables.ffmpeg;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
});

it.each(['autorotate:v:0', 'noautorotate:v:0', 'no/autorotate:v:0', 'autorotate:v:invalid'])(
  'preserves native selection, bytes and validation timing for %s', async name => {
    const argv = ['-v', 'error', `-${name}`, '-f', 'lavfi', '-i',
      'testsrc2=size=16x16:duration=0.04', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'].map(b);
    const plan = discover('ffmpeg', argv);
    expect(plan.dependencies.map(item => [item.role, item.value, item.kind])).toEqual([
      ['output', b('pipe:1'), 'descriptor'],
    ]);
    expect(plan.deferred).toContainEqual({ index: 2, reason: 'stream-metadata' });
    const context = { cwd: tmpdir(), stdin: new Uint8Array(), env: {
      LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1',
    } };
    const native = await runNative(nativeReference.executables.ffmpeg.path, argv, context);
    expect(native.exitCode === 0).toBe(!name.endsWith('invalid'));
    if (native.exitCode === 0) expect(Buffer.from(native.stdout, 'base64')).toHaveLength(384);
    const run = vi.fn(async invocation => {
      expect(invocation.argv).toEqual(argv);
      return runNative(invocation.executable.path, invocation.argv, context);
    });
    const result = await createFFmpegShims({ build: nativeReference.id, grammarRevision,
      argv: 'bytes', lateAccess: 'complete', effects: 'live', run }).ffmpeg(argv, context);
    expect(run).toHaveBeenCalledOnce();
    expect(result.exitCode).toBe(native.exitCode);
    const actual = await run.mock.results[0].value;
    expect(actual.stdout).toBe(native.stdout);
    expect(comparableDiagnostics(Buffer.from(actual.stderr, 'base64')))
      .toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  },
);
