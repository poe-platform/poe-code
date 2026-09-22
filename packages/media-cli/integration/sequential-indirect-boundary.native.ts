/** Opt-in pinned stock differential; remote late-access qualification is separate. */
import { beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover } from '../src/discover.js';
import { createFFmpegShims } from '../src/shim.js';
import { grammarRevision, nativeReference } from '../src/options.generated.js';
import { comparableDiagnostics } from './diagnostics.js';
import { runNative } from './runner.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };

beforeAll(async () => {
  const executable = nativeReference.executables.ffprobe;
  expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
});

it.each([false, true])('retains indirect option error timing and unopened effects (missing=%s)', async missing => {
  const argv = ['-v', 'error', '-o', 'retained.json', '-/future_private_option',
    'value.option', '-i', 'late-missing.wav', '-o', 'late.json'].map(b);
  // Independent predictions precede either execution; no later resource is
  // acquired to compensate for an unregistered option application.
  expect(discover('ffprobe', argv).dependencies.map(item => [item.role, item.value])).toEqual([
    ['output', b('retained.json')], ['option-file', b('value.option')],
  ]);
  const root = await mkdtemp(join(tmpdir(), 'media-indirect-boundary-'));
  try {
    const outcomes = [];
    for (const mode of ['native', 'shim']) {
      const cwd = join(root, mode);
      await mkdir(cwd);
      await writeFile(join(cwd, 'retained.json'), 'original sentinel');
      if (!missing) await writeFile(join(cwd, 'value.option'), '123');
      const context = { cwd, env, stdin: new Uint8Array() };
      let observed: Awaited<ReturnType<typeof runNative>> | undefined;
      if (mode === 'native') observed = await runNative(nativeReference.executables.ffprobe.path, argv, context);
      else {
        let calls = 0;
        const shim = createFFmpegShims<typeof context>({ build: nativeReference.id, grammarRevision,
          argv: 'bytes', lateAccess: 'complete', effects: 'live', async run(request) {
            calls++;
            observed = await runNative(request.executable.path, request.argv, request.context);
            return { exitCode: observed.exitCode };
          } });
        expect(await shim.ffprobe(argv, context)).toEqual({ exitCode: observed!.exitCode });
        expect(calls).toBe(1);
      }
      const files = Object.fromEntries(await Promise.all((await readdir(cwd)).map(async name =>
        [name, (await readFile(join(cwd, name))).toString('base64')])));
      outcomes.push({ ...observed!, stderr: comparableDiagnostics(Buffer.from(observed!.stderr, 'base64')), files });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0].exitCode).toBe(1);
    expect(outcomes[0].stdout).toBe('');
    expect(outcomes[0].files['retained.json']).toBe(Buffer.from('original sentinel').toString('base64'));
    expect(outcomes[0].files).not.toHaveProperty('late.json');
    expect(outcomes[0].stderr.toString()).not.toContain('late-missing.wav');
    expect(outcomes[0].stderr.toString()).toContain(missing ? 'Error reading the value' : 'Option not found');
  } finally { await rm(root, { recursive: true, force: true }); }
});
