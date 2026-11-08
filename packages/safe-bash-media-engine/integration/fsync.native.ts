/** Opt-in stock frame-map processing differential. Local filesystem access
 * does not qualify a remote driver's transfer or late-access mediation. */
import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryFileSystem, Shell, createCommandArguments } from 'poe-code/safe-bash';
import { discover, mediaCommands, nativeReference, type MediaEngineRequest, type Tool } from '../src/index.js';
import { comparableDiagnostics } from './diagnostics.js';
import { runNative } from './runner.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
const input = ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=16x16:rate=25:duration=0.08'];
const output = ['-c:v', 'rawvideo', '-threads:v', '1', '-f', 'rawvideo'];

it.each([
  { name: 'positional', filter: 'fsync=frames.map', expected: ['frames.map', 'out.raw'], success: true },
  { name: 'alias', filter: 'fsync=file=missing.map:f=frames.map', expected: ['frames.map', 'out.raw'], success: true },
  { name: 'indirect', filter: 'fsync=/f=name.option', expected: ['name.option', 'out.raw'], success: true },
  { name: 'file protocol', filter: "fsync=f='file\\:frames.map'", expected: ['file:frames.map', 'out.raw'], success: true },
  { name: 'literal dash', filter: 'fsync=f=-', expected: ['-', 'out.raw'], success: true },
  { name: 'missing late map', filter: 'fsync=f=missing.map', expected: ['missing.map', 'out.raw'], success: false },
  { name: 'invalid option timing', filter: 'fsync=f=missing.map', expected: ['missing.map', 'out.raw'], success: false, invalid: true },
])('compares public shell shim bytes, status and partial outputs: $name', async sample => {
  const executable = nativeReference.executables.ffmpeg;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  const argv = [...input, ...output, 'early.raw', '-vf', sample.filter, ...output, 'out.raw',
    ...(sample.invalid ? ['-unknown_fsync_fixture'] : [])].map(b);
  // Independent predictions and actual pixel/effect checks prevent argv-only
  // parity from being mistaken for frame-map processing correctness.
  expect(discover('ffmpeg', argv).dependencies.map(item => item.value)).toEqual(['early.raw', ...sample.expected].map(b));
  const cwd = await mkdtemp(join(tmpdir(), 'media-fsync-'));
  const map = '0 0 1/25\n0 1 1/25\n1 2 1/25\n';
  const reset = async () => {
    for (const name of await readdir(cwd)) await rm(join(cwd, name));
    await writeFile(join(cwd, 'frames.map'), map);
    await writeFile(join(cwd, '-'), map);
    await writeFile(join(cwd, 'name.option'), 'frames.map\0ignored.map');
    await writeFile(join(cwd, 'out.raw'), 'sentinel');
  };
  const effects = async () => Object.fromEntries(await Promise.all((await readdir(cwd)).map(async name => [name, await readFile(join(cwd, name))])));
  try {
    await reset();
    const native = await runNative(executable.path, argv, { cwd, env, stdin: new Uint8Array() });
    const expected = await effects();
    expect(native.exitCode === 0).toBe(sample.success);
    if (sample.success) {
      const frameBytes = 16 * 16 * 3 / 2;
      expect(expected['early.raw']).toHaveLength(frameBytes * 2);
      expect(expected['out.raw']).toEqual(Buffer.concat([
        expected['early.raw'].subarray(0, frameBytes), expected['early.raw'],
      ]));
      expect(expected['out.raw']).toHaveLength(frameBytes * 3);
    } else if (sample.invalid) {
      expect(expected['out.raw']).toEqual(Buffer.from('sentinel'));
      expect(expected).not.toHaveProperty('early.raw');
      expect(Buffer.from(native.stderr, 'base64').toString()).not.toContain('missing.map');
    } else {
      expect(expected['early.raw']).toHaveLength(0);
      expect(expected['out.raw']).toEqual(Buffer.from('sentinel'));
    }
    await reset();
    let calls = 0;
    const execute = async (request: MediaEngineRequest) => {
      calls++;
      expect(request.args).toEqual(argv);
      const result = await runNative(nativeReference.executables[request.command as Tool].path, request.args, { cwd, env, stdin: new Uint8Array() });
      await request.stdout.write(Buffer.from(result.stdout, 'base64'));
      await request.stderr.write(Buffer.from(result.stderr, 'base64'));
      return { exitCode: result.exitCode };
    };
    const shell = new Shell({ fs: new MemoryFileSystem(), env }).use(mediaCommands({ engine: { execute } }));
    const argumentValues = createCommandArguments([]).withValues(argv);
    shell.commands.register({ name: 'invoke-fsync', execute(context) {
      return context.invoke!('ffmpeg', argumentValues.args, { argumentValues });
    } });
    try {
      const result = await shell.exec('invoke-fsync');
      expect(calls).toBe(1);
      expect(result.exitCode).toBe(native.exitCode);
      expect(Buffer.from(result.stdoutBytes)).toEqual(Buffer.from(native.stdout, 'base64'));
      expect(comparableDiagnostics(result.stderrBytes)).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
      expect(await effects()).toEqual(expected);
    } finally { await shell.dispose(); }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
