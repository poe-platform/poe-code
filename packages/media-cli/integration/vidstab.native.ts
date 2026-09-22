/** The pinned build disables vidstab. These cases qualify native rejection
 * timing, not stabilization processing or remote filesystem mediation. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFFmpegShims, discover, grammarRevision, nativeReference, type Tool } from '../src/index.js';
import { runNative } from './runner.js';
import { comparableDiagnostics } from './diagnostics.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
let cwd: string;
beforeAll(async () => {
  const lock = JSON.parse(await readFile(new URL('../metadata/baselines/build-lock.json', import.meta.url), 'utf8'));
  for (const [path, entry] of Object.entries(lock.binaries_and_dylibs) as [string, { sha256: string }][]) {
    expect(createHash('sha256').update(await readFile(path)).digest('hex'), path).toBe(entry.sha256);
  }
  cwd = await mkdtemp(join(tmpdir(), 'media-vidstab-'));
});
afterAll(async () => { if (cwd) await rm(cwd, { recursive: true, force: true }); });

it.each([
  ['default reader', 'vidstabtransform', 'transforms.trf', 'read'],
  ['default writer', 'vidstabdetect=accuracy=5', 'transforms.trf', 'write'],
  ['literal dash', 'vidstabtransform=input=-', '-', 'read'],
  ['empty writer', 'vidstabdetect=result=', '', 'write'],
  ['loaded reader', 'vidstabtransform=/input=missing-name', 'missing-name', 'read'],
  ['literal percent writer', 'vidstabdetect=result=motion%02d.trf', 'motion%02d.trf', 'write'],
])('keeps stock diagnostics and effects for %s', async (_name, filter, filename, access) => {
  for (const tool of ['ffmpeg', 'ffprobe'] as const) {
    const args = tool === 'ffmpeg'
      ? ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=16x16:duration=0.04', '-vf', filter, '-f', 'null', '-']
      : ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=16x16:duration=0.04,${filter}`, '-show_frames'];
    const argv = args.map(b);
    const predictions = discover(tool, argv).dependencies.filter(item => item.role === 'filter-resource');
    expect(predictions.map(item => [item.value, item.access])).toEqual([[b(filename), access]]);
    await differential(tool, argv, 'No such filter');
  }
});

it('keeps invalid CLI options ahead of filter reads and effects', async () => {
  const argv = ['-v', 'error', '-vf', 'vidstabtransform=/input=missing-name', '-unknown_vidstab_fixture', '-i', 'missing-input', 'out.mkv'].map(b);
  expect(discover('ffmpeg', argv).dependencies).toEqual([]);
  await differential('ffmpeg', argv, 'Unrecognized option');
});

async function differential(tool: Tool, argv: Uint8Array[], diagnostic: string) {
  const context = { cwd, env, stdin: new Uint8Array() };
  const native = await runNative(nativeReference.executables[tool].path, argv, context);
  expect(native.exitCode).not.toBe(0);
  expect(Buffer.from(native.stderr, 'base64').toString()).toContain(diagnostic);
  expect(await readdir(cwd)).toEqual([]);
  let observed: typeof native | undefined;
  let calls = 0;
  const shims = createFFmpegShims({ build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
    async run(request) {
      calls++;
      observed = await runNative(request.executable.path, request.argv, request.context);
      return { exitCode: observed.exitCode };
    },
  });
  expect(await shims[tool](argv, context)).toEqual({ exitCode: native.exitCode });
  expect(calls).toBe(1);
  expect(observed!.stdout).toBe(native.stdout);
  expect(comparableDiagnostics(Buffer.from(observed!.stderr, 'base64'))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(await readdir(cwd)).toEqual([]);
}
