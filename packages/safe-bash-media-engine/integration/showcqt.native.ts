/** Opt-in same-build processing checks; local access does not qualify remote IO. */
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

it.each([
  { name: 'axis image', axis: 'axis.ppm' },
  { name: 'indirect axis image', axis: 'axis.ppm', indirect: true },
  { name: 'raw byte missing image', axis: 'axis.ppm', raw: true, missing: true },
  { name: 'missing image falls back', axis: 'missing.ppm', missing: true },
  { name: 'invalid option precedes image read', axis: 'missing.ppm', invalid: true },
])('compares showcqt pixels, diagnostics and effects: $name', async sample => {
  const executable = nativeReference.executables.ffmpeg;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  const cwd = await mkdtemp(join(tmpdir(), 'media-showcqt-'));
  const filename = sample.raw ? Uint8Array.from([255, ...b('.ppm')]) : b(sample.axis);
  const filter = Buffer.concat([
    Buffer.from('[0:a]showcqt=size=64x32:bar_h=8:axis_h=8:sono_h=16:count=1:fcount=1:'),
    Buffer.from(sample.indirect ? '/axisfile=axis.option' : 'axisfile='),
    ...(sample.indirect ? [] : [Buffer.from(filename)]), Buffer.from('[v]'),
  ]);
  const argv = ['-y', '-v', 'warning', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.2', '-filter_complex'].map(b);
  argv.push(filter, ...['-map', '[v]', '-frames:v', '1', '-c:v', 'rawvideo', '-threads:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'out.rgb'].map(b));
  if (sample.invalid) argv.push(b('-unknown_showcqt_fixture'));
  expect(discover('ffmpeg', argv).dependencies.filter(item => item.role === 'filter-resource').map(item => item.value)).toEqual([
    sample.indirect ? b('axis.option') : filename,
  ]);
  const reset = async () => {
    for (const entry of await readdir(cwd, { encoding: 'buffer' })) await rm(Buffer.concat([Buffer.from(cwd + '/'), entry]));
    await writeFile(join(cwd, 'axis.ppm'),
      Buffer.concat([Buffer.from('P6\n1 1\n255\n'), Buffer.from([255, 0, 255])]));
    await writeFile(join(cwd, 'axis.option'), 'axis.ppm\0ignored.ppm');
    await writeFile(join(cwd, 'out.rgb'), 'sentinel');
  };
  const effects = async () => Object.fromEntries(await Promise.all((await readdir(cwd, { encoding: 'buffer' })).map(async name => [
    name.toString('base64'), await readFile(Buffer.concat([Buffer.from(cwd + '/'), name])),
  ])));
  const context = { cwd, env, stdin: new Uint8Array() };
  try {
    await reset();
    const native = await runNative(executable.path, argv, context);
    const expected = await effects();
    const output = expected[Buffer.from('out.rgb').toString('base64')];
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    if (sample.invalid) {
      expect(native.exitCode).not.toBe(0);
      expect(output).toEqual(Buffer.from('sentinel'));
      expect(diagnostic).not.toContain('loading axis image failed');
    } else {
      expect(native.exitCode).toBe(0);
      expect(output).toHaveLength(64 * 32 * 3);
      if (sample.missing) {
        expect(diagnostic).toContain('loading axis image failed');
        if (sample.raw) expect(Buffer.from(native.stderr, 'base64').includes(Buffer.from(filename))).toBe(true);
      }
      else {
        // The image occupies the middle axis band; this asserts processing,
        // independently of comparing two runs with the same arguments.
        expect(output.subarray(64 * 8 * 3, 64 * 16 * 3)).toEqual(Buffer.from(Array(64 * 8).fill([255, 0, 255]).flat()));
        expect(diagnostic).not.toContain('loading axis image failed');
      }
    }
    await reset();
    let calls = 0;
    let observed: Awaited<ReturnType<typeof runNative>> | undefined;
    const shim = createFFmpegShims<typeof context>({
      build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
      async run(request) {
        calls++;
        observed = await runNative(request.executable.path, request.argv, request.context);
        return { exitCode: observed.exitCode };
      },
    });
    expect(await shim.ffmpeg(argv, context)).toEqual({ exitCode: native.exitCode });
    expect(calls).toBe(1);
    expect(observed!.stdout).toBe(native.stdout);
    expect(comparableDiagnostics(Buffer.from(observed!.stderr, 'base64'))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
    expect(await effects()).toEqual(expected);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
