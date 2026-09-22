/** Opt-in pinned-host differential; does not qualify remote late-access mediation. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFFmpegShims, grammarRevision, nativeReference } from '../src/index.js';
import { runNative } from './runner.js';
import { comparableDiagnostics } from './diagnostics.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
const input = ['-f', 'lavfi', '-i', 'testsrc2=size=32x32:rate=25:duration=0.08'];
let directory: string;

beforeAll(async () => {
  const lock = JSON.parse(await readFile(new URL('../metadata/baselines/build-lock.json', import.meta.url), 'utf8'));
  for (const [path, entry] of Object.entries(lock.binaries_and_dylibs) as [string, { sha256: string }][]) {
    expect(createHash('sha256').update(await readFile(path)).digest('hex'), path).toBe(entry.sha256);
  }
  directory = await mkdtemp(join(tmpdir(), 'vmafmotion-native-'));
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function reset(): Promise<void> {
  for (const name of await readdir(directory)) await rm(join(directory, name), { recursive: true, force: true });
  await writeFile(join(directory, '-'), 'dash sentinel');
  await writeFile(join(directory, 'destination.txt'), '雪\nmotion%02d.txt\0ignored.txt');
}
async function effects(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of await readdir(directory)) result[name] = (await readFile(join(directory, name))).toString('base64');
  return result;
}

const cases: { name: string; args: string[]; status: 'success' | 'failure'; file?: string; stdout?: boolean; partial?: boolean }[] = [
  { name: 'explicit statistics', args: [...input, '-vf', 'vmafmotion=stats_file=motion.txt', '-f', 'null', '-'], status: 'success', file: 'motion.txt' },
  { name: 'positional statistics', args: [...input, '-vf', 'vmafmotion=motion.txt', '-f', 'null', '-'], status: 'success', file: 'motion.txt' },
  { name: 'stdout special case', args: [...input, '-vf', 'vmafmotion=stats_file=-', '-f', 'null', '-'], status: 'success', stdout: true },
  { name: 'literal descriptor filename', args: [...input, '-vf', "vmafmotion=stats_file='pipe\\:3'", '-f', 'null', '-'], status: 'success', file: 'pipe:3' },
  { name: 'literal protocol and percent filename', args: [...input, '-vf', "vmafmotion=stats_file='https\\:motion%02d.txt'", '-f', 'null', '-'], status: 'success', file: 'https:motion%02d.txt' },
  { name: 'slash-loaded destination', args: [...input, '-vf', 'vmafmotion=/stats_file=destination.txt', '-f', 'null', '-'], status: 'success', file: '雪\nmotion%02d.txt' },
  { name: 'unset optional statistics', args: [...input, '-vf', 'vmafmotion', '-f', 'null', '-'], status: 'success' },
  { name: 'empty statistics filename', args: [...input, '-vf', 'vmafmotion=stats_file=', '-f', 'null', '-'], status: 'failure' },
  { name: 'missing option file', args: [...input, '-vf', 'vmafmotion=/stats_file=missing.txt', '-f', 'null', '-'], status: 'failure' },
  { name: 'missing late destination', args: [...input, '-vf', 'vmafmotion=stats_file=missing/motion.txt', '-f', 'null', '-'], status: 'failure' },
  { name: 'native-invalid option before missing destination', args: ['-unknown-motion-option', ...input, '-vf', 'vmafmotion=stats_file=missing/motion.txt', '-f', 'null', '-'], status: 'failure' },
  { name: 'partial output before late filter failure', args: [...input, '-f', 'rawvideo', 'early.rgb', '-vf', 'vmafmotion=stats_file=missing/motion.txt', '-f', 'rawvideo', 'later.rgb'], status: 'failure', partial: true },
];

it.each(cases)('vmafmotion native differential: $name', async test => {
  const argv = ['-hide_banner', '-loglevel', 'error', '-y', '-filter_threads', '1', ...test.args].map(b);
  const context = { cwd: directory, env, stdin: new Uint8Array() };
  await reset();
  const native = await runNative(nativeReference.executables.ffmpeg.path, argv, context);
  const nativeEffects = await effects();
  expect(native.exitCode === 0).toBe(test.status === 'success');
  if (test.file) expect(Buffer.from(nativeEffects[test.file], 'base64').toString()).toContain('n:1 motion:');
  if (test.stdout) {
    expect(Buffer.from(native.stdout, 'base64').toString()).toContain('n:1 motion:');
    expect(Buffer.from(nativeEffects['-'], 'base64').toString()).toBe('dash sentinel');
  } else expect(native.stdout).toBe('');
  if (test.partial) expect(nativeEffects).toHaveProperty('early.rgb');
  if (test.name === 'native-invalid option before missing destination') {
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain('Unrecognized option');
    expect(Buffer.from(native.stderr, 'base64').toString()).not.toContain('missing/motion.txt');
  }
  await reset();
  let observed: Awaited<ReturnType<typeof runNative>> | undefined;
  const shims = createFFmpegShims<typeof context>({
    build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
    async run(request) {
      observed = await runNative(request.executable.path, request.argv, request.context);
      return { exitCode: observed.exitCode };
    },
  });
  expect((await shims.ffmpeg(argv, context)).exitCode).toBe(native.exitCode);
  expect(observed!.stdout).toBe(native.stdout);
  expect(comparableDiagnostics(Buffer.from(observed!.stderr, 'base64'))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(await effects()).toEqual(nativeEffects);
});
