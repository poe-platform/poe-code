/** Opt-in same-build oracle. Stock filesystem execution does not qualify a
 * remote filesystem mediator; dependency predictions have separate unit cases. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFFmpegShims } from '../src/shim.js';
import { grammarRevision, nativeReference } from '../src/options.generated.js';
import { runNative } from './runner.js';
import { comparableDiagnostics } from './diagnostics.js';

const b = (value: string) => new TextEncoder().encode(value);
let cwd: string;
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
beforeAll(async () => {
  const executable = nativeReference.executables.ffprobe;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  cwd = await mkdtemp(join(tmpdir(), 'ffprobe-indirect-retention-'));
});
afterAll(async () => { if (cwd) await rm(cwd, { recursive: true, force: true }); });

it.each([
  { name: 'input', option: 'i', missing: false },
  { name: 'output', option: 'o', missing: false },
  { name: 'input missing option file', option: 'i', missing: true },
  { name: 'output missing option file', option: 'o', missing: true },
])('preserves duplicate indirect $name callback timing and file effects', async ({ option, missing }) => {
  const context = { cwd, env, stdin: new Uint8Array() };
  // The unused filename contains a raw byte and has no corresponding file.
  const reset = async () => {
    for (const name of await readdir(cwd)) await rm(join(cwd, name));
    await writeFile(join(cwd, 'retained.json'), 'original sentinel');
    await writeFile(join(cwd, 'duplicate.option'), Uint8Array.from([...b('unused-'), 255, ...b('.resource\0ignored')]));
  };
  const effects = async () => Object.fromEntries(await Promise.all((await readdir(cwd)).map(async name => [name, await readFile(join(cwd, name))])));
  const argv = ['-v', 'error', '-show_entries', 'stream=index', '-of', 'json',
    ...(option === 'i' ? ['-f', 'lavfi', '-i', 'sine=duration=0.01'] : ['-o', 'retained.json']),
    `-/${option}`, missing ? 'absent.option' : 'duplicate.option',
    ...(option === 'o' ? ['-i', 'unreachable.input'] : []),
  ].map(b);
  await reset();
  const native = await runNative(nativeReference.executables.ffprobe.path, argv, context);
  const nativeEffects = await effects();
  const diagnostic = Buffer.from(native.stderr, 'base64').toString();
  expect(native.exitCode).toBe(option === 'i' && !missing ? 0 : 1);
  if (missing) {
    expect(diagnostic).toContain('Error reading the value');
    expect(diagnostic).not.toContain('was already specified');
    expect(native.stdout).toBe('');
  } else {
    expect(diagnostic).toContain('was already specified');
    expect(diagnostic).not.toContain('No such file or directory');
    if (option === 'i') expect(JSON.parse(Buffer.from(native.stdout, 'base64').toString()).streams).toEqual([{ index: 0 }]);
    else expect(native.stdout).toBe('');
  }
  expect(nativeEffects['retained.json'].toString()).toBe('original sentinel');
  expect(nativeEffects).not.toHaveProperty('unreachable.input');
  await reset();
  let observed: typeof native | undefined;
  const shim = createFFmpegShims({ build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
    async run(request) {
      observed = await runNative(request.executable.path, request.argv, request.context);
      return { exitCode: observed.exitCode };
    },
  });
  expect(await shim.ffprobe(argv, context)).toEqual({ exitCode: native.exitCode });
  expect(observed!.stdout).toBe(native.stdout);
  expect(comparableDiagnostics(Buffer.from(observed!.stderr, 'base64'))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(await effects()).toEqual(nativeEffects);
});
