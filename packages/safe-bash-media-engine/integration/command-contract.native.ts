/** Opt-in pinned stock oracle. Local filesystem access does not qualify a
 * remote driver's transfer, authentication or complete late-access mediation. */
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
const raw = Uint8Array.of(255, 128, 46, 110, 117, 116);
const input = ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=16x16:rate=10:duration=0.5'];
const output = ['-c:v', 'rawvideo', '-threads:v', '1', '-flags:v', '+bitexact', '-fflags', '+bitexact', '-f', 'nut'];
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
beforeAll(async () => {
  for (const tool of ['ffmpeg', 'ffprobe'] as const) {
    const executable = nativeReference.executables[tool];
    expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  }
});

const cases = [
  { name: 'tee literal dash and stdout pipe', args: [...input, '-map', '0:v', ...output, '-f', 'tee', '[f=nut]-|[f=nut]pipe:1'], paths: ['-', 'pipe:1'] },
  { name: 'unsuffixed codec dictionary', args: ['-threads', '1', '-thread_type', 'slice', ...input, ...output, 'out.nut'], paths: ['out.nut'] },
  { name: 'input seek', args: ['-ss', '0.1', ...input, ...output, 'out.nut'], paths: ['out.nut'] },
  { name: 'output seek', args: [...input, '-ss', '0.1', ...output, 'out.nut'], paths: ['out.nut'] },
  { name: 'multiple outputs and codecs', args: [...input, '-map', '0:v?', ...output, 'first.nut', '-map', '0', '-map', '-0:a', '-c:v', 'ffv1', '-threads:v', '1', '-flags:v', '+bitexact', '-fflags', '+bitexact', 'second.nut'], paths: ['first.nut', 'second.nut'] },
  { name: 'duplicate overwrite flags', args: ['-y', '-n', '-y', ...input, ...output, 'out.nut'], paths: ['out.nut'] },
  { name: 'empty output argument', args: [...input, ...output, ''], paths: [''] },
  { name: 'raw output bytes', args: [...input, ...output, raw], paths: [raw] },
  { name: 'leading dash output', args: [...input, ...output, '--', '-out.nut'], paths: ['-out.nut'] },
  { name: 'shell-expanded metadata', args: [...input, '-metadata', 'title=two words $HOME *.wav', ...output, 'out.nut'], paths: ['out.nut'] },
  { name: 'missing late resource after early output', args: [...input, ...output, 'early.nut', '-vf', 'lut3d=file=missing.cube', ...output, 'out.nut'], paths: ['early.nut', 'missing.cube', 'out.nut'] },
  { name: 'invalid option before missing resource', args: [...input, '-vf', 'lut3d=file=missing.cube', ...output, 'out.nut', '-unknown_contract_option'], paths: ['missing.cube', 'out.nut'] },
  { name: 'unknown preset option before late resource', args: [...input, '-fpre', 'command.ffpreset', ...output, 'out.nut'], paths: ['command.ffpreset', 'out.nut'] },
];

it.each(cases)('compares native streams, status and partial file effects: $name', async ({ name, args, paths }) => {
  const argv = args.map(value => typeof value === 'string' ? b(value) : value);
  // Expectations are independent of both native execution and shim discovery.
  expect(discover('ffmpeg', argv).dependencies.map(dependency => dependency.value)).toEqual(paths.map(value => typeof value === 'string' ? b(value) : value));
  const root = await mkdtemp(join(tmpdir(), 'media-command-contract-'));
  try {
    const outcomes = [];
    for (const mode of ['native', 'shim']) {
      const cwd = join(root, mode);
      // The native integration fixture may use disk; unit tests do not.
      await mkdir(cwd);
      await writeFile(join(cwd, 'out.nut'), 'existing output');
      if (name === 'unknown preset option before late resource') {
        await writeFile(join(cwd, 'command.ffpreset'), 'unknown_preset_option=value\nvf=lut3d=file=missing.cube\n');
      }
      const context = { cwd, env, stdin: new Uint8Array() };
      let observed: Awaited<ReturnType<typeof runNative>>;
      if (mode === 'native') observed = await runNative(nativeReference.executables.ffmpeg.path, argv, context);
      else {
        const shim = createFFmpegShims<typeof context>({ build: nativeReference.id, grammarRevision,
          argv: 'bytes', lateAccess: 'complete', effects: 'live', async run(invocation) {
            observed = await runNative(invocation.executable.path, invocation.argv, invocation.context);
            return { exitCode: observed.exitCode };
          } }).ffmpeg;
        expect(await shim(argv, context)).toEqual({ exitCode: observed!.exitCode });
      }
      const files: Record<string, string> = {};
      for (const name of await readdir(cwd, { encoding: 'buffer' })) {
        files[name.toString('base64')] = (await readFile(Buffer.concat([Buffer.from(cwd + '/'), name]))).toString('base64');
      }
      outcomes.push({ exitCode: observed!.exitCode, stdout: observed!.stdout,
        stderr: comparableDiagnostics(Buffer.from(observed!.stderr, 'base64')), files });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    // macOS rejects this non-UTF-8 pathname; argv remains byte-preserved and
    // native reports the platform failure. Linux raw-path success is separate.
    const fails = ['duplicate overwrite flags', 'empty output argument', 'raw output bytes',
      'missing late resource after early output', 'invalid option before missing resource',
      'unknown preset option before late resource'].includes(name);
    expect(outcomes[0].exitCode === 0).toBe(!fails);
    if (name === 'tee literal dash and stdout pipe') {
      const dash = outcomes[0].files[Buffer.from('-').toString('base64')];
      expect(dash).toBeTruthy();
      expect(outcomes[0].stdout).toBe(dash);
    }
    if (name === 'missing late resource after early output') {
      expect(outcomes[0].files[Buffer.from('early.nut').toString('base64')]).toBe('');
      expect(outcomes[0].stderr.toString()).toContain('missing.cube');
    }
    if (name === 'invalid option before missing resource') {
      expect(outcomes[0].stderr.toString()).not.toContain('missing.cube');
      expect(outcomes[0].files[Buffer.from('out.nut').toString('base64')]).toBe(Buffer.from('existing output').toString('base64'));
    }
    if (name === 'unknown preset option before late resource') {
      expect(outcomes[0].stderr.toString()).toContain('unknown_preset_option');
      expect(outcomes[0].stderr.toString()).not.toContain('missing.cube');
      expect(outcomes[0].files[Buffer.from('out.nut').toString('base64')]).toBe(Buffer.from('existing output').toString('base64'));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
