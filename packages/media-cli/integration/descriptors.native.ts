/** Opt-in local descriptor differential; not remote transfer qualification. */
import { beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover } from '../src/discover.js';
import { createFFmpegShims } from '../src/shim.js';
import { grammarRevision, nativeReference } from '../src/options.generated.js';
import { runNative } from './runner.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
// Independently authored mono PCM wave, with four signed samples.
const samples = Buffer.from([0, 0, 1, 0, 255, 127, 0, 128]);
function wave() {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}
beforeAll(async () => {
  for (const executable of Object.values(nativeReference.executables)) {
    expect(createHash('sha256').update(await readFile(executable.path)).digest('hex')).toBe(executable.sha256);
  }
});

it.each([
  { tool: 'ffmpeg' as const, name: 'seekable fd input', argv: ['-v', 'error', '-fd', '3', '-i', 'fd:', '-f', 's16le', 'pipe:1'], dependencies: [['input', 'fd:'], ['output', 'pipe:1']], mode: 'read' as const },
  { tool: 'ffmpeg' as const, name: 'input seek on borrowed fd', argv: ['-v', 'error', '-ss', '0.00025', '-fd', '3', '-i', 'fd:', '-f', 's16le', 'pipe:1'], dependencies: [['input', 'fd:'], ['output', 'pipe:1']], mode: 'read' as const },
  { tool: 'ffprobe' as const, name: 'seekable fd probe', argv: ['-v', 'error', '-fd', '3', '-i', 'fd:', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json'], dependencies: [['input', 'fd:']], mode: 'read' as const },
  { tool: 'ffmpeg' as const, name: 'extra pipe output', argv: ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', 'pipe:3'], dependencies: [['input', 'pipe:0'], ['output', 'pipe:3']], mode: 'write' as const },
])('$name preserves decoded bytes and descriptor effects', async ({ tool, name, argv: values, dependencies, mode }) => {
  const argv = values.map(b);
  expect(discover(tool, argv).dependencies.map(item => [item.role, item.kind, item.value])).toEqual(
    dependencies.map(([role, value]) => [role, 'descriptor', b(value)]),
  );
  const root = await mkdtemp(join(tmpdir(), 'media-descriptors-'));
  try {
    const outcomes = [];
    for (const route of ['native', 'shim']) {
      const cwd = join(root, route);
      await mkdir(cwd);
      await writeFile(join(cwd, 'descriptor'), mode === 'read' ? wave() : Buffer.from('sentinel'));
      const context = { cwd, env, stdin: mode === 'write' ? wave() : new Uint8Array(), descriptors: [{ fd: 3, path: 'descriptor', mode }] };
      let observed: Awaited<ReturnType<typeof runNative>> | undefined;
      if (route === 'native') observed = await runNative(nativeReference.executables[tool].path, argv, context);
      else {
        const shim = createFFmpegShims<typeof context>({ build: nativeReference.id, grammarRevision,
          argv: 'bytes', lateAccess: 'complete', effects: 'live', async run(invocation) {
            observed = await runNative(invocation.executable.path, invocation.argv, invocation.context);
            return { exitCode: observed.exitCode };
          } });
        expect(await shim[tool](argv, context)).toEqual({ exitCode: 0 });
      }
      expect(observed!.exitCode).toBe(0);
      expect(observed!.stderr).toBe('');
      const descriptor = await readFile(join(cwd, 'descriptor'));
      if (mode === 'write') {
        expect(observed!.stdout).toBe('');
        expect(descriptor).toEqual(samples);
      } else {
        expect(descriptor).toEqual(wave());
        if (tool === 'ffmpeg') expect(Buffer.from(observed!.stdout, 'base64')).toEqual(name === 'input seek on borrowed fd' ? samples.subarray(4) : samples);
        else expect(JSON.parse(Buffer.from(observed!.stdout, 'base64').toString()).streams).toEqual([
          { codec_name: 'pcm_s16le', sample_rate: '8000', channels: 1 },
        ]);
      }
      outcomes.push({ ...observed, descriptor });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
