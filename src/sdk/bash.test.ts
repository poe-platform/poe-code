import { expect, it, vi } from 'vitest';
import { MemoryFileSystem, type CommandContext } from '@poe-platform/safe-bash';
import type { NativeInvocation } from '@poe-code/remote-execution';
import { runBash } from './bash.js';
import { createTransport, fixtureDigest } from '../../packages/media-cli/fixtures/transport.js';
import { grammarRevision, nativeReference } from '../../packages/media-cli/src/options.generated.js';
import { imageMagickGrammarRevision, imageMagickReference } from '../../packages/media-cli/src/imagemagick.generated.js';

it('awaits the explicitly loaded media provider disposer before SDK settlement', async () => {
  const fixture = await import('../../packages/media-cli/fixtures/native-provider.js');
  let disposed = false;
  const factory = vi.spyOn(fixture, 'createMediaProvider').mockImplementation(() => ({
    fetch: createTransport(),
    async execute() { return { exitCode: 0 }; },
    async dispose() { await Promise.resolve(); disposed = true; },
  }));
  try {
    const result = await runBash({ fs: new MemoryFileSystem(), source: 'ffmpeg -version', media: {
      service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
      resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
      provider: { module: new URL('../../packages/media-cli/fixtures/native-provider.ts', import.meta.url).href },
    } });
    expect(result.exitCode).toBe(0);
    expect(factory).toHaveBeenCalledOnce();
    expect(disposed).toBe(true);
  } finally { factory.mockRestore(); }
});

it('lends the SDK process signal channel to the media invocation', async () => {
  const processSignals = { subscribe: vi.fn(() => async () => {}) };
  const execute = vi.fn(async (context: { processSignals?: unknown }) => {
    expect(context.processSignals).toBe(processSignals);
    return { exitCode: 42 };
  });
  const result = await runBash({ fs: new MemoryFileSystem(), source: 'ffmpeg -version', processSignals, media: { engine: { execute } } });
  expect(result.exitCode).toBe(42);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(processSignals.subscribe).not.toHaveBeenCalled();
});

it('preserves an explicitly borrowed SDK descriptor authority', async () => {
  const admittedHandles = { acquire: vi.fn(async () => { throw new Error('Not used by this engine'); }) };
  const execute = vi.fn(async (context: { admittedHandles?: unknown }) => {
    expect(context.admittedHandles).toBe(admittedHandles);
    return { exitCode: 0 };
  });
  const result = await runBash({ fs: new MemoryFileSystem(), source: 'ffmpeg -version', admittedHandles, media: { engine: { execute } } });
  expect(result.exitCode).toBe(0);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(admittedHandles.acquire).not.toHaveBeenCalled();
});

it('does not execute scripts, touch files, consume stdin or connect media in dry run', async () => {
  const fs = new MemoryFileSystem();
  const write = vi.spyOn(fs, 'writeFile');
  const fetch = vi.fn();
  const next = vi.fn(async () => ({ done: true as const, value: undefined }));
  const result = await runBash({ fs, source: 'printf changed > /proof.txt; ffmpeg -version',
    dryRun: true, stdin: { [Symbol.asyncIterator]: () => ({ next }) },
    media: { service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
      resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' }, fetch },
  });
  expect(result).toMatchObject({ exitCode: 0, stdout: '', stderr: '' });
  expect(write).not.toHaveBeenCalled();
  await expect(fs.stat('/proof.txt')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(next).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves the ImageMagick discovery capability and receiver through SDK configuration capture', async () => {
  const discoveryContext = vi.fn(function (this: { marker: string }) {
    expect(this.marker).toBe('admitted');
    return {};
  });
  const binding = { build: imageMagickReference.id, grammarRevision: imageMagickGrammarRevision,
    argv: 'bytes' as const, lateAccess: 'complete' as const, effects: 'live' as const,
    marker: 'admitted', discoveryContext, async run() { return { exitCode: 0 }; } };
  const execution = runBash({ fs: new MemoryFileSystem(), command: 'identify', args: ['-version'], media: { imageMagick: binding } });
  binding.discoveryContext = vi.fn(() => ({}));
  expect((await execution).exitCode).toBe(0);
  expect(discoveryContext).toHaveBeenCalledOnce();
  expect(binding.discoveryContext).not.toHaveBeenCalled();
});

it('executes literal argv without shell expansion through the SDK', async () => {
  const result = await runBash({ fs: new MemoryFileSystem(), command: 'printf', args: ['%s', '$(echo unsafe); * > /file'], env: {} });
  expect(result.stdout).toBe('$(echo unsafe); * > /file');
  expect(result.exitCode).toBe(0);
});

it('owns byte argv and exported environment before asynchronous module loading', async () => {
  const bytes = Uint8Array.of(255);
  const environment = { VALUE: 'before' };
  const argv = runBash({ fs: new MemoryFileSystem(), command: 'printf', args: ['%s', bytes] });
  const source = runBash({ fs: new MemoryFileSystem(), source: 'printf "%s" "$VALUE"', env: environment });
  bytes.fill(0); environment.VALUE = 'after';
  expect((await argv).stdoutBytes).toEqual(Uint8Array.of(255));
  expect((await source).stdout).toBe('before');
});

it('forwards the original native argv slots without invoking a supplied array map', async () => {
  const args = ['-i', Uint8Array.of(255), ''];
  const map = vi.fn(() => ['-version']);
  args.map = map as typeof args.map;
  const run = vi.fn(async ({ argv }: NativeInvocation<CommandContext>) => {
    expect(argv).toEqual([new TextEncoder().encode('-i'), Uint8Array.of(255), new Uint8Array()]);
    return { exitCode: 17 };
  });
  const result = await runBash({ fs: new MemoryFileSystem(), command: 'ffmpeg', args,
    media: { ffmpeg: { build: nativeReference.id, grammarRevision, argv: 'bytes',
      lateAccess: 'complete', effects: 'live', run } } });
  expect(result.exitCode).toBe(17);
  expect(map).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledOnce();
});

it('captures intrinsic byte argv without invoking a supplied byte iterator', async () => {
  const bytes = Uint8Array.of(255);
  const iterator = vi.fn(function* () { yield 1; });
  bytes[Symbol.iterator] = iterator;
  const result = await runBash({ fs: new MemoryFileSystem(), command: 'printf', args: ['%s', bytes] });
  expect(result.stdoutBytes).toEqual(Uint8Array.of(255));
  expect(iterator).not.toHaveBeenCalled();
});

it('executes shell scripts with the same explicit cwd/environment options', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  const result = await runBash({ fs, source: 'printf "%s:%s" "$PWD" "$VALUE"', cwd: '/work', env: { VALUE: 'a b' } });
  expect(result.stdout).toBe('/work:a b');
});

it('preserves byte argv and does not enable cloud media implicitly', async () => {
  const result = await runBash({ fs: new MemoryFileSystem(), command: 'printf', args: ['%s', Uint8Array.of(255)], env: {} });
  expect(result.stdoutBytes).toEqual(Uint8Array.of(255));
  const missing = await runBash({ fs: new MemoryFileSystem(), command: 'ffmpeg', args: ['-version'], env: {} });
  expect(missing.exitCode).toBe(127);
});

it('keeps explicitly configured remote media inert for ordinary shell commands', async () => {
  const fetch = vi.fn(async () => { throw new Error('Unexpected cloud connection'); });
  const result = await runBash({ fs: new MemoryFileSystem(), source: 'printf "%s" "$VALUE"',
    env: { VALUE: 'ordinary command' }, media: {
      service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
      resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
      provider: { module: 'file:///must-not-load-media-provider.mjs' }, fetch,
    } });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe('ordinary command');
  expect(fetch).not.toHaveBeenCalled();
});

it('runs executable heredoc media scripts and SDK byte argv through identical remote invocations', async () => {
  const requests: unknown[] = [];
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  const media = { service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest, resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read', 'write'] as ('read' | 'write')[], grantId: 'host-issued', profile: 'live' as const }, fetch: createTransport({ observe(request) { requests.push(request); }, output: Uint8Array.of(255, 0) }) };
  const context = { fs, media, cwd: '/work', env: { NATIVE_OPTION: 'a b' } };
  const direct = await runBash({ ...context, command: 'ffprobe', args: ['-show_entries', 'format=duration', 'a b.mp4', Uint8Array.of(255), ''] });
  const script = await runBash({ ...context, source: "cat > /media.sh <<'EOF'\n#!/bin/sh\nffprobe -show_entries format=duration 'a b.mp4' $'\\377' ''\nEOF\nchmod +x /media.sh\n/media.sh" });
  expect(script.exitCode).toBe(direct.exitCode);
  expect(script.stdoutBytes).toEqual(direct.stdoutBytes);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ cwd: '/work', env: expect.objectContaining({ NATIVE_OPTION: 'a b' }),
    args: expect.arrayContaining([[255], []]) });
  const bytes = await runBash({ fs, command: 'ffmpeg', args: [Uint8Array.of(255), ''], media });
  expect(bytes.exitCode).toBe(0);
  expect(requests[2]).toMatchObject({ args: [[255], []] });
});

it('owns remote configuration before asynchronous module loading', async () => {
  const requests: unknown[] = [];
  const media = { service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'] as ('read' | 'write')[], grantId: 'host-issued', profile: 'live' as const },
    fetch: createTransport({ observe(request) { requests.push(request); } }) };
  const execution = runBash({ fs: new MemoryFileSystem(), command: 'ffmpeg', args: ['-version'], media });
  media.service = 'http://changed.invalid';
  media.authToken = 'changed';
  media.buildDigest = 'incompatible';
  media.resource.namespaceId = 'changed';
  media.resource.rights.push('write');
  expect((await execution).exitCode).toBe(0);
  expect(requests[0]).toMatchObject({ buildDigest: fixtureDigest, namespaceId: 'work' });
});

it('preserves ImageMagick native grammar through SDK argv and executable heredocs', async () => {
  const requests: unknown[] = [];
  const fs = new MemoryFileSystem();
  const media = { service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'] as ('read' | 'write')[], grantId: 'g', profile: 'live' as const },
    fetch: createTransport({ observe(request) { requests.push(request); } }) };
  const direct = await runBash({ fs, media, command: 'identify', args: ['-format', '%w %h', 'a b.png[0]'] });
  const scripted = await runBash({ fs, media, source: "cat > /image.sh <<'EOF'\n#!/bin/sh\nidentify -format '%w %h' 'a b.png[0]'\nEOF\nchmod +x /image.sh\n/image.sh" });
  expect(direct.exitCode).toBe(0);
  expect(scripted.exitCode).toBe(direct.exitCode);
  expect(scripted.stdoutBytes).toEqual(direct.stdoutBytes);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ toolId: 'identify', args: ['-format', '%w %h', 'a b.png[0]'].map(value => Array.from(new TextEncoder().encode(value))) });
});

it('preserves trusted binding methods and their receiver', async () => {
  class Binding {
    readonly build = nativeReference.id;
    readonly grammarRevision = grammarRevision;
    readonly argv = 'bytes' as const;
    readonly lateAccess = 'complete' as const;
    readonly effects = 'live' as const;
    calls = 0;
    async run({ context }: { context: { stdout: { write(bytes: Uint8Array): Promise<void> } } }) {
      this.calls++;
      await context.stdout.write(Uint8Array.of(255));
      return { exitCode: 0 };
    }
  }
  const binding = new Binding();
  const result = await runBash({ fs: new MemoryFileSystem(), command: 'ffmpeg', args: ['-version'], media: { ffmpeg: binding } });
  expect(result.stdoutBytes).toEqual(Uint8Array.of(255));
  expect(binding.calls).toBe(1);
});

it('admits native bindings before asynchronous SDK module loading', async () => {
  const run = vi.fn(async () => ({ exitCode: 7 }));
  const binding = { build: nativeReference.id, grammarRevision, argv: 'bytes' as const,
    lateAccess: 'complete' as const, effects: 'live' as const, run };
  const execution = runBash({ fs: new MemoryFileSystem(), command: 'ffmpeg', args: ['-version'], media: { ffmpeg: binding } });
  binding.build = 'incompatible';
  binding.run = vi.fn(async () => ({ exitCode: 99 }));
  expect((await execution).exitCode).toBe(7);
  expect(run).toHaveBeenCalledOnce();
  expect(binding.run).not.toHaveBeenCalled();
});

it('keeps native input, redirection and pipeline statuses equivalent to SDK streams', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  const invocations: { argv: Uint8Array[]; input: number[]; cwd: string; value: string | undefined }[] = [];
  const media = { ffmpeg: {
    build: nativeReference.id, grammarRevision, argv: 'bytes' as const,
    lateAccess: 'complete' as const, effects: 'live' as const,
    async run({ argv, context }: NativeInvocation<CommandContext>) {
      const input: number[] = [];
      for await (const bytes of context.stdin) {
        input.push(...bytes);
        await context.stdout.write(bytes);
      }
      await context.stderr.write(Uint8Array.of(255, 10));
      invocations.push({ argv: argv.map(bytes => Uint8Array.from(bytes)), input, cwd: context.cwd, value: context.env.VALUE });
      return { exitCode: 7 };
    },
  } };
  const settings = { fs, media, cwd: '/work', env: { VALUE: 'a b' } };
  const direct = await runBash({ ...settings, command: 'ffmpeg', args: ['-i', 'pipe:0', '-f', 'data', 'pipe:1'], stdin: Uint8Array.of(0, 255, 10) });
  const scripted = await runBash({ ...settings, source: "cat > /pipeline.sh <<'EOF'\n#!/bin/sh\nprintf '\\000\\377\\n' | ffmpeg -i pipe:0 -f data pipe:1 > /output 2> /errors\nprintf '%s' \"${PIPESTATUS[*]}\"\nEOF\nchmod +x /pipeline.sh\n/pipeline.sh" });
  expect(direct.exitCode).toBe(7);
  expect(scripted.exitCode).toBe(0);
  expect(scripted.stdout).toBe('0 7');
  expect(scripted.stderrBytes).toEqual(new Uint8Array());
  expect(await fs.readFile('/output')).toEqual(direct.stdoutBytes);
  expect(await fs.readFile('/errors')).toEqual(direct.stderrBytes);
  expect(invocations[1]).toEqual(invocations[0]);
  expect(invocations[0]).toMatchObject({ input: [0, 255, 10], cwd: '/work', value: 'a b' });
});
