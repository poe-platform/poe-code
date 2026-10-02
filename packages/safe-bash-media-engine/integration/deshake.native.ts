/** Opt-in stock-native controls. Local native access is complete; this does not
 * qualify any remote filesystem provider or replace its late-access driver. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFFmpegShims, grammarRevision, nativeReference } from '../src/index.js';
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
  root = await mkdtemp(join(tmpdir(), 'media-cli-deshake-'));
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
const output = ['-c:v', 'rawvideo', '-threads:v', '1', '-flags:v', '+bitexact', '-fflags', '+bitexact', '-f', 'rawvideo', 'out.yuv'];
const cases: { name: string; args: (string | Uint8Array)[]; log?: string | Uint8Array; failed?: boolean; partial?: boolean }[] = [
  ...['motion.csv', '-', 'pipe:3', 'https:local', 'motion%03d.csv'].map(log => ({
    name: 'literal ' + log, log, args: [...input, '-vf', `deshake=filename='${log.replaceAll(':', '\\:')}'`, ...output],
  })),
  { name: 'positional', log: 'motion.csv', args: [...input, '-vf', 'deshake@motion=-1:-1:-1:-1:16:16:mirror:8:125:exhaustive:motion.csv:0', ...output] },
  { name: 'empty optional log', args: [...input, '-vf', 'deshake=filename=', ...output] },
  { name: 'missing log parent is native successful processing', args: [...input, '-vf', 'deshake=filename=missing/motion.csv', ...output] },
  { name: 'slash-loaded literal filename', log: 'pipe:3', args: [...input, '-vf', 'deshake=/filename=log-name.txt', ...output] },
  { name: 'raw log bytes', log: Uint8Array.from([255, 46, 99, 115, 118]), args: [...input, '-vf', Uint8Array.from([...b('deshake=filename='), 255, ...b('.csv')]), ...output] },
  { name: 'invalid option before missing indirect log', failed: true, args: [...input, '-vf', 'deshake=/filename=missing.txt', '-unknown_deshake_fixture', ...output] },
  { name: 'missing late indirect log retains early output', failed: true, partial: true, args: [...input, '-f', 'rawvideo', '-c:v', 'rawvideo', '-threads:v', '1', 'early.yuv', '-vf', 'deshake=/filename=missing.txt', ...output] },
];

it.each(cases)('whole shim preserves native processing, diagnostics and file effects: $name', async ({ name, args, log, failed, partial }) => {
  const directory = await mkdtemp(join(root, 'case-'));
  const nativeCwd = join(directory, 'native');
  const shimCwd = join(directory, 'shim');
  for (const cwd of [nativeCwd, shimCwd]) {
    await mkdir(cwd);
    await writeFile(join(cwd, 'log-name.txt'), 'pipe:3\0ignored.csv');
  }
  const argv = args.map(value => typeof value === 'string' ? b(value) : value);
  const native = await runNative(nativeReference.executables.ffmpeg.path, argv, { cwd: nativeCwd, env, stdin: new Uint8Array() });
  const expectedFiles = await effects(nativeCwd);
  let actual: Awaited<ReturnType<typeof runNative>> | undefined;
  let launches = 0;
  const shim = createFFmpegShims({
    build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
    async run(invocation) {
      launches++;
      actual = await runNative(invocation.executable.path, invocation.argv, { cwd: shimCwd, env, stdin: new Uint8Array() });
      return { exitCode: actual.exitCode };
    },
  });
  expect(await shim.ffmpeg(argv, {})).toEqual({ exitCode: native.exitCode });
  expect(launches).toBe(1);
  expect(actual?.exitCode).toBe(native.exitCode);
  expect(actual?.stdout).toBe(native.stdout);
  // Preserve both raw results. Compare only log-prefix ASLR pointers under the
  // existing field-level rule; filenames and all diagnostic payloads stay raw.
  expect(comparableDiagnostics(Buffer.from(actual!.stderr, 'base64')))
    .toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(await effects(shimCwd)).toEqual(expectedFiles);
  if (failed) expect(native.exitCode).not.toBe(0);
  else {
    expect(native.exitCode, Buffer.from(native.stderr, 'base64').toString()).toBe(0);
    expect(Buffer.from(expectedFiles[Buffer.from('out.yuv').toString('base64')], 'base64')).toHaveLength(64 * 64 * 3 / 2 * 2);
  }
  if (log && name !== 'raw log bytes') {
    const key = Buffer.from(typeof log === 'string' ? b(log) : log).toString('base64');
    expect(Buffer.from(expectedFiles[key], 'base64').toString()).toContain('Ori x, Avg x, Fin x');
  }
  // The pinned macOS filesystem refuses this invalid UTF-8 creation; deshake
  // ignores the failed fopen. That native behavior must not become a JS error.
  if (name === 'raw log bytes') expect(expectedFiles).not.toHaveProperty(Buffer.from(log as Uint8Array).toString('base64'));
  if (partial) expect(expectedFiles[Buffer.from('early.yuv').toString('base64')]).toBe('');
  if (name.startsWith('invalid option')) {
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain('unknown_deshake_fixture');
    expect(diagnostic).not.toContain('missing.txt');
    expect(expectedFiles).not.toHaveProperty(Buffer.from('out.yuv').toString('base64'));
  }
});
