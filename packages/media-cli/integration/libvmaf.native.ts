/** Opt-in local same-build differentials; remote late-access mediation needs
 * its own qualification. No native process is used for predictive discovery. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFFmpegShims, discover, grammarRevision, nativeReference, type Tool } from '../src/index.js';
import { runNative } from './runner.js';
import { comparableDiagnostics } from './diagnostics.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
let root: string;
beforeAll(async () => {
  const lock = JSON.parse(await readFile(new URL('../metadata/baselines/build-lock.json', import.meta.url), 'utf8'));
  for (const [path, entry] of Object.entries(lock.binaries_and_dylibs) as [string, { sha256: string }][]) {
    expect(createHash('sha256').update(await readFile(path)).digest('hex'), path).toBe(entry.sha256);
  }
  root = await mkdtemp(join(tmpdir(), 'media-cli-libvmaf-'));
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function effects(cwd: string) {
  const files: Record<string, string> = {};
  for (const name of await readdir(cwd, { encoding: 'buffer' })) {
    files[name.toString('base64')] = (await readFile(Buffer.concat([Buffer.from(cwd + '/'), name]))).toString('base64');
  }
  return files;
}

const input = ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=25:duration=0.08'];
const output = ['-c:v', 'rawvideo', '-threads:v', '1', '-f', 'rawvideo', 'out.yuv'];
const graph = (log: string) => `split[a][b];[a][b]libvmaf=${log}:log_fmt=csv:n_threads=1`;
interface Case {
  name: string;
  args: (string | Uint8Array)[];
  tool?: Tool;
  predicted?: string | Uint8Array;
  log?: string;
  invalid?: boolean;
  partial?: boolean;
}
const cases: Case[] = [
  ...['metrics.csv', '-', 'pipe:3', 'https:local', 'metrics%03d.csv'].map(log => ({
    name: 'literal ' + log, log, predicted: log, args: [...input, '-filter_complex', graph(`log_path='${log.replaceAll(':', '\\:')}'`), ...output],
  })),
  { name: 'positional', log: 'metrics.csv', predicted: 'metrics.csv', args: [...input, '-filter_complex', 'split[a][b];[a][b]libvmaf@quality=metrics.csv:csv:mean:1:1', ...output] },
  { name: 'unset', args: [...input, '-filter_complex', 'split[a][b];[a][b]libvmaf=n_threads=1', ...output] },
  { name: 'empty', predicted: '', args: [...input, '-filter_complex', graph('log_path='), ...output] },
  { name: 'missing log parent', predicted: 'missing/metrics.csv', args: [...input, '-filter_complex', graph('log_path=missing/metrics.csv'), ...output] },
  { name: 'slash-loaded literal log', log: 'pipe:3', args: [...input, '-filter_complex', graph('/log_path=log-name.txt'), ...output] },
  { name: 'raw bytes', predicted: Uint8Array.from([255, ...b('.csv')]), args: [...input, '-filter_complex', Uint8Array.from([...b('split[a][b];[a][b]libvmaf=log_path='), 255, ...b('.csv:log_fmt=csv:n_threads=1')]), ...output] },
  { name: 'native invalid before missing indirect log', invalid: true, args: [...input, '-filter_complex', graph('/log_path=missing.txt'), '-unknown_libvmaf_fixture', ...output] },
  { name: 'missing later preset retains early output', invalid: true, partial: true, predicted: 'metrics.csv', args: [...input, '-filter_complex', graph('log_path=metrics.csv'), '-map', '0:v', '-c:v', 'rawvideo', '-threads:v', '1', '-f', 'rawvideo', 'early.yuv', '-fpre', 'missing.ffpreset', ...output] },
  { name: 'ffprobe lavfi', tool: 'ffprobe', log: 'metrics.csv', predicted: 'metrics.csv', args: ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=25:duration=0.08,' + graph('log_path=metrics.csv'), '-show_frames', '-show_entries', 'frame=width,height', '-of', 'json'] },
];

it.each(cases)('whole shim preserves libvmaf processing, channels and file effects: $name', async ({ name, args, tool = 'ffmpeg', predicted, log, invalid, partial }) => {
  const directory = await mkdtemp(join(root, 'case-'));
  const nativeCwd = join(directory, 'native');
  const shimCwd = join(directory, 'shim');
  for (const cwd of [nativeCwd, shimCwd]) {
    await mkdir(cwd);
    await writeFile(join(cwd, 'log-name.txt'), 'pipe:3\0ignored.csv');
  }
  const argv = args.map(value => typeof value === 'string' ? b(value) : value);
  // Predictions are checked before either launch, independently of actual file
  // effects. A native-valid spelling absent from prediction still reaches run.
  const plan = discover(tool, argv);
  const writes = plan.dependencies.filter(dependency => dependency.role === 'filter-resource' && dependency.access === 'write');
  expect(writes.map(dependency => dependency.value)).toEqual(predicted === undefined ? [] : [typeof predicted === 'string' ? b(predicted) : predicted]);
  for (const write of writes) expect(write).toMatchObject({ kind: 'path', literal: true, stage: 'runtime' });
  const native = await runNative(nativeReference.executables[tool].path, argv, { cwd: nativeCwd, env, stdin: new Uint8Array() });
  const expectedFiles = await effects(nativeCwd);
  let actual: Awaited<ReturnType<typeof runNative>> | undefined;
  let launches = 0;
  const shim = createFFmpegShims({
    build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
    async run(invocation) {
      launches++;
      expect(invocation.argv).toEqual(argv);
      actual = await runNative(invocation.executable.path, invocation.argv, { cwd: shimCwd, env, stdin: new Uint8Array() });
      return { exitCode: actual.exitCode };
    },
  });
  expect(await shim[tool](argv, {})).toEqual({ exitCode: native.exitCode });
  expect(launches).toBe(1);
  expect(actual?.stdout).toBe(native.stdout);
  expect(comparableDiagnostics(Buffer.from(actual!.stderr, 'base64')))
    .toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(await effects(shimCwd)).toEqual(expectedFiles);
  if (invalid) expect(native.exitCode).not.toBe(0);
  else {
    expect(native.exitCode, Buffer.from(native.stderr, 'base64').toString()).toBe(0);
    if (tool === 'ffmpeg') expect(Buffer.from(expectedFiles[Buffer.from('out.yuv').toString('base64')], 'base64')).toHaveLength(64 * 64 * 3 / 2 * 2);
    else expect(JSON.parse(Buffer.from(native.stdout, 'base64').toString()).frames).toEqual([{ width: 64, height: 64 }, { width: 64, height: 64 }]);
  }
  // CSV retains deterministic per-frame metrics. JSON/XML include native FPS
  // timing, so they are not substituted or normalized to claim byte equality.
  if (log) expect(Buffer.from(expectedFiles[Buffer.from(log).toString('base64')], 'base64').toString()).toContain('vmaf');
  if (partial) expect(expectedFiles[Buffer.from('early.yuv').toString('base64')]).toBe('');
  if (name.startsWith('native invalid')) {
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain('unknown_libvmaf_fixture');
    expect(diagnostic).not.toContain('missing.txt');
    expect(expectedFiles).not.toHaveProperty(Buffer.from('out.yuv').toString('base64'));
  }
});
