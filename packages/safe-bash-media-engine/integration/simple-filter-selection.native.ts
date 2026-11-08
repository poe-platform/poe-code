/** Opt-in local oracle; this does not qualify a remote namespace bridge. */
import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { discover } from '../src/discover.js';
import { createFFmpegShims } from '../src/shim.js';
import { grammarRevision, nativeReference } from '../src/options.generated.js';
import { runNative } from './runner.js';
import { comparableDiagnostics } from './diagnostics.js';

const b = (value: string) => new TextEncoder().encode(value);
const context = { cwd: '/', stdin: new Uint8Array(), env: {
  LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1',
} };
beforeAll(async () => {
  const executable = nativeReference.executables.ffmpeg;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
});

it.each([
  ['-vf', 'lut3d=file=/nonexistent/unused.cube', '-vf', 'null'],
  ['-vf', 'lut3d=file=/nonexistent/unused.cube', '-filter:v', 'null'],
  ['-filter:v', 'lut3d=file=/nonexistent/unused.cube', '-vf', 'null'],
  ['-filter:v:0', 'lut3d=file=/nonexistent/unused.cube', '-filter:v:0', 'null'],
  ['-af', 'arnndn=m=/nonexistent/unused.rnnn', '-filter:a', 'anull'],
  // Arbitrary observed file contents are never parsed as a replaced graph.
  ['-/vf', fileURLToPath(import.meta.url), '-vf', 'null'],
  ['-/vf', '/nonexistent/discarded.graph', '-vf', 'null'],
])('preserves native replacement without reading an unused simple filter resource: %j', async (...options) => {
  const audio = options[0] === '-af';
  const argv = ['-v', 'warning', '-f', 'lavfi', '-i', audio ? 'anullsrc=r=8000:cl=mono' : 'testsrc2=size=16x16',
    ...options, audio ? '-frames:a' : '-frames:v', '1', '-f', audio ? 's16le' : 'rawvideo', 'pipe:1'].map(b);
  // First establish native validity despite the absent initialization resource.
  const native = await runNative(nativeReference.executables.ffmpeg.path, argv, context);
  const indirect = options[0] === '-/vf';
  const missing = options[1] === '/nonexistent/discarded.graph';
  expect(native.exitCode === 0).toBe(!missing);
  expect(Buffer.from(native.stdout, 'base64').length > 0).toBe(!missing);
  // Independently specified dependency prediction, before shim execution.
  expect(discover('ffmpeg', argv).dependencies.map(dependency => [dependency.value, dependency.access])).toEqual([
    ...(indirect ? [[b(options[1]), 'read']] : []),
    [b('pipe:1'), 'write'],
  ]);
  if (indirect) expect(discover('ffmpeg', argv).dependencies[0]).toMatchObject({
    role: 'option-file', optionReader: { discardValue: true },
  });
  let observed: Awaited<ReturnType<typeof runNative>> | undefined;
  const shim = createFFmpegShims<typeof context>({ build: nativeReference.id, grammarRevision, argv: 'bytes',
    lateAccess: 'complete', effects: 'live', async run(invocation) {
      observed = await runNative(invocation.executable.path, invocation.argv, invocation.context);
      return { exitCode: observed.exitCode };
    } }).ffmpeg;
  expect(await shim(argv, context)).toEqual({ exitCode: native.exitCode });
  expect(observed!.stdout).toBe(native.stdout);
  expect(comparableDiagnostics(Buffer.from(observed!.stderr, 'base64'))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
});
