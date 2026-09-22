/** Opt-in pinned stock-native differential. Local file access does not qualify
 * remote transfer or its late-access driver. Prediction is checked separately. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFFmpegShims, discover, grammarRevision, nativeReference } from '../src/index.js';
import { comparableDiagnostics } from './diagnostics.js';
import { runNative } from './runner.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
let root: string;
let cover: Uint8Array;
beforeAll(async () => {
  const executable = nativeReference.executables.ffmpeg;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  root = await mkdtemp(join(tmpdir(), 'media-rectangle-'));
  const fixture = await runNative(executable.path, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:size=16x16', '-frames:v', '1', '-c:v', 'mjpeg', '-threads:v', '1', '-pix_fmt', 'yuvj420p', 'cover.jpg'].map(b), { cwd: root, env, stdin: new Uint8Array() });
  expect(fixture.exitCode, Buffer.from(fixture.stderr, 'base64').toString()).toBe(0);
  cover = await readFile(join(root, 'cover.jpg'));
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function effects(cwd: string) {
  return Object.fromEntries(await Promise.all((await readdir(cwd)).map(async name => [name, await readFile(join(cwd, name))])));
}

it.each([
  ['named object', 'find_rect=object=object.pgm:mipmaps=1', ['object.pgm'], false, false],
  ['positional object', 'find_rect=object.pgm:0.5:1', ['object.pgm'], false, false],
  ['named cover', 'cover_rect=cover=cover.jpg:mode=cover', ['cover.jpg'], false, false],
  ['positional cover', 'cover_rect=cover.jpg:cover', ['cover.jpg'], false, false],
  ['loaded object', 'find_rect=/object=name.txt:mipmaps=1', ['name.txt'], false, false],
  ['loaded cover', 'cover_rect=/cover=cover-name.txt:mode=cover', ['cover-name.txt'], false, false],
  ['late missing bitmap', 'find_rect=object=missing.pgm:mipmaps=1', ['missing.pgm'], true, false],
  ['late missing loaded bitmap', 'find_rect=/object=missing-name.txt:mipmaps=1', ['missing-name.txt'], true, true],
  ['native invalid option timing', 'find_rect=/object=missing-option.txt', [], true, false],
] as const)('preserves native processing, diagnostics and effects: %s', async (name, filter, predicted, failed, partial) => {
  const directory = await mkdtemp(join(root, 'case-'));
  const nativeCwd = join(directory, 'native');
  const shimCwd = join(directory, 'shim');
  for (const cwd of [nativeCwd, shimCwd]) {
    await mkdir(cwd);
    await writeFile(join(cwd, 'object.pgm'), Buffer.concat([Buffer.from('P5\n16 16\n255\n'), Buffer.alloc(256, 128)]));
    await writeFile(join(cwd, 'cover.jpg'), cover);
    await writeFile(join(cwd, 'name.txt'), 'object.pgm\0ignored.pgm');
    await writeFile(join(cwd, 'cover-name.txt'), 'cover.jpg\0ignored.jpg');
    await writeFile(join(cwd, 'missing-name.txt'), 'missing.pgm');
  }
  const output = ['-c:v', 'rawvideo', '-threads:v', '1', '-flags:v', '+bitexact', '-fflags', '+bitexact', '-f', 'rawvideo'];
  const argv = ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=25:duration=0.08',
    ...(partial ? [...output, 'early.yuv'] : []), '-vf', filter,
    ...(name === 'native invalid option timing' ? ['-unknown_rectangle_fixture'] : []), ...output, 'out.yuv'].map(b);
  expect(discover('ffmpeg', argv).dependencies.filter(item => item.role === 'filter-resource').map(item => item.value)).toEqual(predicted.map(b));
  const native = await runNative(nativeReference.executables.ffmpeg.path, argv, { cwd: nativeCwd, env, stdin: new Uint8Array() });
  const expected = await effects(nativeCwd);
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
  expect(await effects(shimCwd)).toEqual(expected);
  if (failed) expect(native.exitCode).not.toBe(0);
  else {
    expect(native.exitCode, Buffer.from(native.stderr, 'base64').toString()).toBe(0);
    expect(expected['out.yuv']).toHaveLength(64 * 64 * 3 / 2 * 2);
  }
  if (partial) expect(expected).toHaveProperty('early.yuv');
  if (name === 'native invalid option timing') {
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain('unknown_rectangle_fixture');
    expect(Buffer.from(native.stderr, 'base64').toString()).not.toContain('missing-option.txt');
    expect(expected).not.toHaveProperty('out.yuv');
  }
});
