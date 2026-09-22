import { expect, it, vi } from 'vitest';
import { CommandRegistry, MemoryFileSystem, Shell, agentCommands, createCommandArguments } from '@poe-platform/safe-bash';
import { mediaCommands } from '@poe-platform/safe-bash/commands/media';
import { grammarRevision, nativeReference } from './options.generated.js';
import { imageMagickGrammarRevision, imageMagickReference } from './imagemagick.generated.js';
import type { MediaEngineRequest } from './engine.js';
import type { ImageMagickDiscovery } from './imagemagick.js';

it('passes invocation cancellation to ImageMagick advisory filesystem operations', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/image.ppm', new TextEncoder().encode('image'));
  await fs.writeFile('/task.mg', new TextEncoder().encode('image.ppm -write out.ppm'));
  const stat = vi.spyOn(fs, 'stat');
  const access = vi.spyOn(fs, 'access');
  const read = vi.spyOn(fs, 'readFile');
  const execute = vi.fn(async (_request: MediaEngineRequest) => ({ exitCode: 0 }));
  const shell = new Shell({ fs }).use(mediaCommands({ engine: { execute } }));
  try {
    await shell.exec('magick-script task.mg');
    const signal = execute.mock.calls[0]![0].signal;
    expect(read).toHaveBeenCalledWith('/task.mg', { signal });
    expect(stat).toHaveBeenCalledWith('/image.ppm', { signal });
    expect(access).toHaveBeenCalledWith('/image.ppm', 0, { signal });
  } finally { await shell.dispose(); }
});

it('uses the invocation filesystem for ImageMagick engine discovery without changing argv or status', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  await fs.mkdir('/work/xc:green');
  await fs.writeFile('/work/-resize', new TextEncoder().encode('literal image'));
  await fs.writeFile('/work/text.txt', new TextEncoder().encode('caption'));
  await fs.writeFile('/work/task.mg', new TextEncoder().encode('caption:@text.txt -write first.ppm -negate +write second.ppm -unknown'));
  const execute = vi.fn(async (_request: MediaEngineRequest) => ({ exitCode: 1 }));
  const shell = new Shell({ fs, cwd: '/work' }).use(mediaCommands({ engine: { execute } }));
  try {
    const args = ['-resize', 'xc:green'];
    expect((await invoke(shell, 'identify', args)).exitCode).toBe(1);
    const first = execute.mock.calls[0]![0];
    expect(first.args).toEqual(args.map(value => new TextEncoder().encode(value)));
    expect((first.discovery as ImageMagickDiscovery).resources).toMatchObject([
      { kind: 'path', access: 'read', path: new TextEncoder().encode('-resize') },
      { kind: 'path', access: 'read', path: new TextEncoder().encode('xc:green') },
    ]);
    expect((await invoke(shell, 'magick-script', ['task.mg'])).exitCode).toBe(1);
    const discovery = execute.mock.calls[1]![0].discovery as ImageMagickDiscovery;
    expect(discovery.resources.map(r => [new TextDecoder().decode(r.path ?? r.operand), r.role, r.access])).toEqual([
      ['task.mg', 'script', 'read'], ['text.txt', 'text', 'read'],
      ['caption:@text.txt', 'image', 'read'], ['first.ppm', 'image', 'write'], ['second.ppm', 'image', 'write'],
    ]);
  } finally { await shell.dispose(); }
});

it('defers failed and non-UTF-8 ImageMagick filesystem probes to the engine', async () => {
  const fs = new MemoryFileSystem();
  const execute = vi.fn(async (_request: MediaEngineRequest) => ({ exitCode: 2 }));
  const shell = new Shell({ fs }).use(mediaCommands({ engine: { execute } }));
  const stat = vi.spyOn(fs, 'stat').mockRejectedValue(Error('advisory stat unavailable'));
  const read = vi.spyOn(fs, 'readFile').mockRejectedValue(Error('advisory read unavailable'));
  try {
    const bytes = Uint8Array.of(255, 58, 120);
    expect((await invoke(shell, 'identify', [bytes, 'xc:red'])).exitCode).toBe(2);
    expect(execute.mock.calls[0]![0].args).toEqual([bytes, new TextEncoder().encode('xc:red')]);
    expect(stat.mock.calls.every(([path]) => !path.includes('\uFFFD'))).toBe(true);
    expect((await invoke(shell, 'magick-script', ['task.mg'])).exitCode).toBe(2);
    expect(read.mock.calls.map(([path]) => path)).toEqual(['/task.mg']);
    expect(execute).toHaveBeenCalledTimes(2);
  } finally { stat.mockRestore(); read.mockRestore(); await shell.dispose(); }
});

function bindings() {
  const run = vi.fn(async ({ context }: { context: { stdout: { write(bytes: Uint8Array): Promise<void> } } }) => {
    await context.stdout.write(Uint8Array.of(0, 255, 10));
    return { exitCode: 0 };
  });
  return {
    ffmpeg: { build: nativeReference.id, grammarRevision, argv: 'bytes' as const, lateAccess: 'complete' as const, effects: 'live' as const, run },
    imageMagick: { build: imageMagickReference.id, grammarRevision: imageMagickGrammarRevision, argv: 'bytes' as const, lateAccess: 'complete' as const, effects: 'live' as const, run },
    run,
  };
}

async function invoke(shell: Shell, command: string, values: readonly (string | Uint8Array)[]) {
  const argumentValues = createCommandArguments([]).withValues(values);
  shell.commands.register({ name: 'sdk-invoke', execute(context) {
    return context.invoke!(command, argumentValues.args, { argumentValues });
  } }, { replace: true });
  return shell.exec('sdk-invoke');
}

it('preflights all collisions before registration and supports explicit replacement', () => {
  const options = bindings();
  const commands = new CommandRegistry([{ name: 'identify', execute: () => ({ exitCode: 7 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  expect(() => mediaCommands(options).setup(host)).toThrow('identify');
  expect(commands.has('ffmpeg')).toBe(false);
  mediaCommands({ ...options, replace: true }).setup(host);
  expect(commands.has('ffprobe')).toBe(true);
  expect(commands.has('MagickCore-config')).toBe(false);
});

it('registers the native media inventory without build helpers or dependency declarations', () => {
  const commands = new CommandRegistry();
  mediaCommands(bindings()).setup({ commands, use() {}, registerFileSystem() {} });
  expect(commands.list().map(command => command.name).sort()).toEqual([
    'animate', 'compare', 'composite', 'conjure', 'convert', 'display', 'ffmpeg', 'ffprobe',
    'identify', 'import', 'magick', 'magick-script', 'mogrify', 'montage', 'stream',
  ]);
});

it('owns the collision policy when the plugin is created', () => {
  const options = { ...bindings(), replace: false };
  const plugin = mediaCommands(options);
  options.replace = true;
  const commands = new CommandRegistry([{ name: 'identify', execute: () => ({ exitCode: 7 }) }]);
  expect(() => plugin.setup({ commands, use() {}, registerFileSystem() {} })).toThrow('identify');
  expect(commands.has('ffmpeg')).toBe(false);
});

it.each(['false', 0, 1, null, {}])('rejects a nonboolean replacement policy before registering commands: %j', replace => {
  const commands = new CommandRegistry([{ name: 'identify', execute: () => ({ exitCode: 7 }) }]);
  expect(() => mediaCommands({ ...bindings(), replace: replace as unknown as boolean })
    .setup({ commands, use() {}, registerFileSystem() {} })).toThrow('boolean');
  expect(commands.list().map(command => command.name)).toEqual(['identify']);
});

it('keeps media opt-in and validates pinned builds even for help', () => {
  const options = bindings();
  expect(() => mediaCommands({ ...options, ffmpeg: { ...options.ffmpeg, build: 'incompatible' } })).toThrow('pinned');
  expect(options.run).not.toHaveBeenCalled();
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  expect(shell.commands.has('ffmpeg')).toBe(false);
});

it('preserves invalid UTF-8 argv and caller context through public invocation', async () => {
  const options = bindings();
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  const shell = new Shell({ fs, cwd: '/work', env: { TOKEN: 'native-only' } }).use(mediaCommands(options));
  const result = await invoke(shell, 'ffmpeg', [Uint8Array.of(255), '-help', '']);
  expect(result.stdoutBytes).toEqual(Uint8Array.of(0, 255, 10));
  const invocation = options.run.mock.calls[0]![0] as unknown as { argv: Uint8Array[]; context: { fs: unknown; cwd: string; env: unknown } };
  expect(invocation.argv).toEqual([Uint8Array.of(255), new TextEncoder().encode('-help'), new Uint8Array()]);
  expect(invocation.context.fs).toBeDefined();
  expect(invocation.context.cwd).toBe('/work');
  expect(invocation.context.env).toMatchObject({ TOKEN: 'native-only' });
  await shell.dispose();
});

it('executes a VFS script created with a heredoc equivalently to literal SDK argv', async () => {
  const options = bindings();
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, env: {} }).use(agentCommands()).use(mediaCommands(options));
  const direct = await invoke(shell, 'ffprobe', ['-show_entries', 'format=duration', 'a b.mp4']);
  const scripted = await shell.exec("cat > /run.sh <<'EOF'\n#!/bin/sh\nffprobe -show_entries format=duration 'a b.mp4'\nEOF\nchmod +x /run.sh\n/run.sh");
  expect(scripted.exitCode).toBe(0);
  expect(scripted.stdoutBytes).toEqual(direct.stdoutBytes);
  const calls = options.run.mock.calls as unknown as [{ argv: Uint8Array[] }][];
  expect(calls[1]![0].argv).toEqual(calls[0]![0].argv);
  const pipe = await shell.exec('ffmpeg -version | ffprobe -version > /out');
  expect(pipe.exitCode).toBe(0);
  expect(await fs.readFile('/out')).toEqual(direct.stdoutBytes);
  await shell.dispose();
});

it('binds an explicit portable engine to both media families', async () => {
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(mediaCommands({ engine: { execute } }));
  expect((await shell.exec('ffmpeg -version')).exitCode).toBe(0);
  expect((await shell.exec('identify -version')).exitCode).toBe(0);
  expect(execute.mock.calls).toHaveLength(2);
  await shell.dispose();
});

it.each(['ffmpeg', 'ffprobe'] as const)('carries %s dependency hints to the engine independently of native argv', async command => {
  const args = ['-i', '-source.wav', command === 'ffmpeg' ? '-/filter:a:0' : '-/show_entries', 'graph.option',
    ...(command === 'ffmpeg' ? ['out.wav'] : ['-o', 'out.json'])];
  const execute = vi.fn(async (_request: MediaEngineRequest) => ({ exitCode: 17 }));
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(mediaCommands({ engine: { execute } }));
  try {
    expect((await invoke(shell, command, args)).exitCode).toBe(17);
    expect(execute).toHaveBeenCalledOnce();
    const request = execute.mock.calls[0]![0];
    const discovery = (request as MediaEngineRequest & { discovery: import('./types.js').Discovery }).discovery;
    expect(discovery.tool).toBe(command);
    expect(discovery.dependencies.map(item => [item.role, item.value])).toEqual([
      ['input', new TextEncoder().encode('-source.wav')],
      ['option-file', new TextEncoder().encode('graph.option')],
      ['output', new TextEncoder().encode(command === 'ffmpeg' ? 'out.wav' : 'out.json')],
    ]);
    expect(discovery.deferred).toContainEqual({ index: -1, reason: 'native-access' });
    discovery.argv[0][0] = 0;
    expect(request.args).toEqual(args.map(value => new TextEncoder().encode(value)));
  } finally { await shell.dispose(); }
});

it('retains the admitted engine method and receiver for both media families', async () => {
  const execute = vi.fn(async function (this: { marker: string }) {
    expect(this.marker).toBe('admitted');
    return { exitCode: 7 };
  });
  const engine = { marker: 'admitted', execute };
  const plugin = mediaCommands({ engine });
  engine.execute = vi.fn(async () => ({ exitCode: 99 }));
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(plugin);
  try {
    expect((await shell.exec('ffmpeg -version')).exitCode).toBe(7);
    expect((await shell.exec('identify -version')).exitCode).toBe(7);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(engine.execute).not.toHaveBeenCalled();
  } finally { await shell.dispose(); }
});

it.each([
  'animate', 'compare', 'composite', 'conjure', 'convert', 'display', 'ffmpeg', 'ffprobe',
  'identify', 'import', 'magick', 'magick-script', 'mogrify', 'montage', 'stream',
])('preserves %s native argv through executable heredocs and literal invocation', async command => {
  const options = bindings();
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { NATIVE: 'a b' } })
    .use(agentCommands()).use(mediaCommands(options));
  try {
    const direct = await invoke(shell, command, ['-version', '--media-service', 'a b', '', Uint8Array.of(255)]);
    const scripted = await shell.exec(`cat > /native.sh <<'EOF'\n#!/bin/sh\n${command} -version --media-service 'a b' '' $'\\377'\nEOF\nchmod +x /native.sh\n/native.sh`);
    expect(scripted.exitCode).toBe(direct.exitCode);
    expect(scripted.stdoutBytes).toEqual(direct.stdoutBytes);
    expect(scripted.stderrBytes).toEqual(direct.stderrBytes);
    const calls = options.run.mock.calls as unknown as [{ tool: string; argv: Uint8Array[]; context: { cwd: string; env: unknown } }][];
    expect(calls).toHaveLength(2);
    expect(calls[1]![0].tool).toBe(command);
    expect(calls[1]![0].argv).toEqual(calls[0]![0].argv);
    expect(calls[1]![0].context.cwd).toBe(calls[0]![0].context.cwd);
    expect(calls[1]![0].context.env).toMatchObject({ NATIVE: 'a b' });
  } finally { await shell.dispose(); }
});
