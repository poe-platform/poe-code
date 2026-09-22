/** Opt-in same-build stock filesystem oracle, not remote bridge qualification. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFFmpegShims } from '../src/shim.js';
import { discover } from '../src/discover.js';
import { grammarRevision, nativeReference } from '../src/options.generated.js';
import { comparableDiagnostics } from './diagnostics.js';
import { runNative } from './runner.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
let cwd: string;
beforeAll(async () => {
  for (const executable of Object.values(nativeReference.executables)) {
    expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  }
  cwd = await mkdtemp(join(tmpdir(), 'media-filter-assignments-'));
});
afterAll(async () => { if (cwd) await rm(cwd, { recursive: true, force: true }); });

it.each([
  { tool: 'ffmpeg' as const, graph: 'lut3d=file=missing.cube:file=selected.cube', paths: ['selected.cube'], success: true },
  { tool: 'ffmpeg' as const, graph: 'lut3d=file=missing.cube:/file=first.option:/file=selected.option', paths: ['first.option', 'selected.option'], success: true },
  { tool: 'ffmpeg' as const, graph: 'lut3d=/file=first.option:/file=selected.option:file=selected.cube', paths: ['first.option', 'selected.option', 'selected.cube'], success: true },
  { tool: 'ffmpeg' as const, graph: 'lut3d=/file=missing.option:file=selected.cube', paths: ['missing.option', 'selected.cube'], success: false },
  { tool: 'ffmpeg' as const, graph: 'lut3d=file=selected.cube:file=missing.cube', paths: ['missing.cube'], success: false },
  { tool: 'ffprobe' as const, graph: 'lut3d=file=missing.cube:file=selected.cube', paths: ['selected.cube'], success: true },
])('$tool preserves native assignment effects for $graph', async ({ tool, graph, paths, success }) => {
  const args = tool === 'ffmpeg'
    ? ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=16x16:d=0.04', '-frames:v', '1', '-f', 'rawvideo', 'early.rgb', '-vf', graph, '-frames:v', '1', '-f', 'rawvideo', 'out.rgb']
    : ['-v', 'error', '-f', 'lavfi', '-i', `color=c=red:s=16x16,${graph}`, '-read_intervals', '%+#1', '-show_frames', '-of', 'json'];
  const argv = args.map(b);
  // Hand-authored resource expectations precede and do not come from the oracle.
  expect(discover(tool, argv).dependencies.filter(item => item.role === 'filter-resource').map(item => item.value)).toEqual(paths.map(b));
  const reset = async () => {
    for (const name of await readdir(cwd)) await rm(join(cwd, name));
    await writeFile(join(cwd, 'selected.cube'), 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
    await writeFile(join(cwd, 'first.option'), 'missing.cube');
    await writeFile(join(cwd, 'selected.option'), 'selected.cube\0ignored');
    await writeFile(join(cwd, 'early.rgb'), 'early sentinel');
    await writeFile(join(cwd, 'out.rgb'), 'output sentinel');
  };
  const effects = async () => Object.fromEntries(await Promise.all((await readdir(cwd)).map(async name => [name, await readFile(join(cwd, name))])));
  const context = { cwd, env, stdin: new Uint8Array() };
  await reset();
  const native = await runNative(nativeReference.executables[tool].path, argv, context);
  expect(native.exitCode === 0).toBe(success);
  const nativeEffects = await effects();
  if (success && tool === 'ffmpeg') {
    // LUT negotiation selects RGB24; the unfiltered output remains YUV420P.
    expect(nativeEffects['out.rgb']).toEqual(Buffer.from(Array.from({ length: 16 * 16 }, () => [254, 0, 0]).flat()));
    expect(nativeEffects['early.rgb'].length).toBe(16 * 16 * 3 / 2);
  }
  if (success && tool === 'ffprobe') expect(JSON.parse(Buffer.from(native.stdout, 'base64').toString()).frames).toHaveLength(1);
  if (graph.includes('missing.option')) {
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain('missing.option');
    expect(nativeEffects['early.rgb'].length).toBe(0);
    expect(nativeEffects['out.rgb']).toEqual(Buffer.from('output sentinel'));
  }
  await reset();
  let observed: typeof native | undefined;
  let launches = 0;
  const shim = createFFmpegShims({
    build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
    async run(request) {
      launches++;
      expect(request.argv).toEqual(argv);
      observed = await runNative(request.executable.path, request.argv, request.context);
      return { exitCode: observed.exitCode };
    },
  });
  expect(await shim[tool](argv, context)).toEqual({ exitCode: native.exitCode });
  expect(launches).toBe(1);
  expect(observed!.stdout).toBe(native.stdout);
  expect(comparableDiagnostics(Buffer.from(observed!.stderr, 'base64'))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(await effects()).toEqual(nativeEffects);
});
