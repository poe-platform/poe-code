/** Opt-in local stock-filesystem oracle; remote late access needs its own proof. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFFmpegShims, discover, grammarRevision, nativeReference } from '../src/index.js';
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
  root = await mkdtemp(join(tmpdir(), 'media-firequalizer-'));
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function effects(cwd: string) {
  return Object.fromEntries(await Promise.all((await readdir(cwd, { encoding: 'buffer' })).map(async name => [
    name.toString('base64'), (await readFile(Buffer.concat([Buffer.from(cwd + '/'), name]))).toString('base64'),
  ])));
}
const input = ['-v', 'warning', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=0.04'];
const output = ['-f', 's16le', 'out.pcm'];
const cases = [
  ...['dump.txt', '-', 'pipe:3', 'https:local', 'dump%03d.txt', '', 'missing/dump.txt'].map(value => ({
    name: `literal ${value}`, args: [...input, '-af', `firequalizer=gain=0:dumpfile='${value.replaceAll(':', '\\:')}'`, ...output],
    dependency: ['filter-resource', value], failed: false,
  })),
  { name: 'positional', args: [...input, '-af', "firequalizer@eq=0:'entry(0,0)':0.01:5:hann:0:0:0:linlog:dump.txt", ...output], dependency: ['filter-resource', 'dump.txt'], failed: false },
  { name: 'indirection', args: [...input, '-af', 'firequalizer=gain=0:/dumpfile=name.txt', ...output], dependency: ['filter-resource', 'name.txt'], failed: false },
  { name: 'invalid timing', args: [...input, '-af', 'firequalizer=/dumpfile=missing.txt', '-unknown_firequalizer_fixture', ...output], dependency: ['filter-resource', 'missing.txt'], failed: true },
  { name: 'late read failure', args: [...input, '-f', 's16le', 'early.pcm', '-af', 'firequalizer=/dumpfile=missing.txt', ...output], dependency: ['filter-resource', 'missing.txt'], failed: true },
];

it.each(cases)('preserves native files, media bytes, diagnostics and status: $name', async ({ name, args, dependency, failed }) => {
  const argv = args.map(b);
  // Prediction is asserted independently, before either execution.
  const predicted = discover('ffmpeg', argv).dependencies.filter(item => item.role === 'filter-resource');
  expect(predicted.map(item => [item.role, item.value])).toEqual(name === 'invalid timing' ? [] : [[dependency[0], b(dependency[1])]]);
  if (predicted.length) expect(predicted[0].access).toBe(name === 'indirection' || failed ? 'read' : 'write');
  const directory = await mkdtemp(join(root, 'case-'));
  const nativeCwd = join(directory, 'native');
  const shimCwd = join(directory, 'shim');
  for (const cwd of [nativeCwd, shimCwd]) {
    await mkdir(cwd);
    await writeFile(join(cwd, 'name.txt'), 'pipe:3\0ignored');
  }
  const native = await runNative(nativeReference.executables.ffmpeg.path, argv, { cwd: nativeCwd, env, stdin: new Uint8Array() });
  const nativeEffects = await effects(nativeCwd);
  let observed: Awaited<ReturnType<typeof runNative>> | undefined;
  let launches = 0;
  const shim = createFFmpegShims({ build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
    async run(invocation) {
      launches++;
      observed = await runNative(invocation.executable.path, invocation.argv, { cwd: shimCwd, env, stdin: new Uint8Array() });
      return { exitCode: observed.exitCode };
    },
  });
  expect(await shim.ffmpeg(argv, {})).toEqual({ exitCode: native.exitCode });
  expect(launches).toBe(1);
  expect(observed!.stdout).toBe(native.stdout);
  expect(comparableDiagnostics(Buffer.from(observed!.stderr, 'base64'))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(await effects(shimCwd)).toEqual(nativeEffects);
  const diagnostic = Buffer.from(native.stderr, 'base64').toString();
  if (failed) expect(native.exitCode).not.toBe(0);
  else {
    expect(native.exitCode, diagnostic).toBe(0);
    expect(Buffer.from(nativeEffects[Buffer.from('out.pcm').toString('base64')], 'base64').length).toBeGreaterThan(0);
  }
  if (name === 'invalid timing') {
    expect(diagnostic).toContain('Unrecognized option');
    expect(diagnostic).not.toContain('missing.txt');
  }
  if (name === 'late read failure') {
    expect(diagnostic).toContain('missing.txt');
    expect(nativeEffects).toHaveProperty(Buffer.from('early.pcm').toString('base64'));
  }
  if (name === 'literal missing/dump.txt' || name === 'literal ') expect(diagnostic).toContain('dumping failed');
  if (name === 'literal -') expect(native.stdout).toBe('');
  if (name === 'indirection') expect(nativeEffects).toHaveProperty(Buffer.from('pipe:3').toString('base64'));
});
