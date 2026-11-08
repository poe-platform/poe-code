/** Opt-in stock filesystem differential of the public engine adapter.
 * The local oracle is not remote filesystem/transfer qualification. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryFileSystem, Shell, createCommandArguments } from 'poe-code/safe-bash';
import { discover, mediaCommands, nativeReference, type Discovery, type MediaEngineRequest, type Tool } from '../src/index.js';
import { comparableDiagnostics } from './diagnostics.js';
import { runNative } from './runner.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
let cwd: string;
beforeAll(async () => {
  for (const executable of Object.values(nativeReference.executables)) {
    expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  }
  cwd = await mkdtemp(join(tmpdir(), 'media-engine-discovery-'));
});
afterAll(async () => { if (cwd) await rm(cwd, { recursive: true, force: true }); });

it.each([
  ['ffmpeg', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=0.02', '-f', 's16le', 'pipe:1'], [['output', 'pipe:1']]],
  ['ffprobe', ['-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-show_entries', 'stream=codec_type', '-of', 'json'], []],
  ['ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=duration=0.02', 'first.wav', '-fpre', 'missing.ffpreset', 'second.wav'], [['output', 'first.wav'], ['preset', 'missing.ffpreset'], ['output', 'second.wav']]],
] as const)('%s engine preserves native streams and partial effects: %j', async (tool, args, dependencies) => {
  const argv = ['-v', 'error', ...args].map(b);
  // Prediction is checked independently, before any native or adapter launch.
  expect(discover(tool, argv).dependencies.map(item => [item.role, item.value])).toEqual(
    dependencies.map(([role, value]) => [role, b(value)]),
  );
  const clear = async () => { for (const name of await readdir(cwd)) await rm(join(cwd, name)); };
  const effects = async () => Object.fromEntries(await Promise.all((await readdir(cwd)).map(async name => [name, await readFile(join(cwd, name))])));
  await clear();
  const native = await runNative(nativeReference.executables[tool].path, argv, { cwd, env, stdin: new Uint8Array() });
  const nativeEffects = await effects();
  if (args.some(value => value === 'missing.ffpreset')) {
    expect(native.exitCode).not.toBe(0);
    expect(nativeEffects).toHaveProperty('first.wav');
    expect(nativeEffects).not.toHaveProperty('second.wav');
  } else {
    expect(native.exitCode).toBe(0);
    expect(Buffer.from(native.stdout, 'base64').length).toBeGreaterThan(0);
  }
  await clear();
  const execute = vi.fn(async (request: MediaEngineRequest) => {
    expect(request.args).toEqual(argv);
    expect((request.discovery as Discovery).dependencies.map(item => [item.role, item.value])).toEqual(
      dependencies.map(([role, value]) => [role, b(value)]),
    );
    const result = await runNative(nativeReference.executables[request.command as Tool].path, request.args, { cwd, env, stdin: new Uint8Array() });
    await request.stdout.write(Buffer.from(result.stdout, 'base64'));
    await request.stderr.write(Buffer.from(result.stderr, 'base64'));
    return { exitCode: result.exitCode };
  });
  const shell = new Shell({ fs: new MemoryFileSystem(), env }).use(mediaCommands({ engine: { execute } }));
  const argumentValues = createCommandArguments([]).withValues(argv);
  shell.commands.register({ name: 'invoke-engine', execute(context) {
    return context.invoke!(tool, argumentValues.args, { argumentValues });
  } });
  try {
    const result = await shell.exec('invoke-engine');
    expect(execute).toHaveBeenCalledOnce();
    expect(result.exitCode).toBe(native.exitCode);
    expect(Buffer.from(result.stdoutBytes)).toEqual(Buffer.from(native.stdout, 'base64'));
    expect(comparableDiagnostics(result.stderrBytes)).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
    expect(await effects()).toEqual(nativeEffects);
  } finally { await shell.dispose(); }
});
