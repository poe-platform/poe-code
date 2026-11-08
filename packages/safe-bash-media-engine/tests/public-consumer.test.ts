import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { runBash } from 'poe-code';
import { Shell, MemoryFileSystem } from 'poe-code/safe-bash';
import { mediaCommands, nativeReference, grammarRevision, imageMagickReference, imageMagickGrammarRevision } from 'poe-code/safe-bash/commands/media';
import { createTransport, fixtureDigest } from '../fixtures/transport.js';

it('shares owned byte arguments between the public Node shell and media plugin', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {} }).use(mediaCommands({ engine: {
    async execute(request) { await request.stdout.write(request.args[0]!); return { exitCode: 0 }; },
  } }));
  try {
    const result = await shell.exec("ffmpeg $'\\377'");
    expect(result.exitCode).toBe(0);
    expect(result.stdoutBytes).toEqual(Uint8Array.of(255));
  } finally { await shell.dispose(); }
});


it.each([
  ['ffmpeg', ['-help']],
  ['ffmpeg', ['-version']],
  ['ffmpeg', ['-formats']],
  ['ffmpeg', ['-encoders']],
  ['ffprobe', ['-help']],
  ['ffprobe', ['-show_program_version']],
  ['magick', ['-help']],
  ['identify', ['-version']],
  ['identify', ['-list', 'format']],
] as const)('revalidates remote %s %j through the built public SDK on every invocation', async (command, args) => {
  const transport = createTransport({ output: Uint8Array.of(255, 0, 10) });
  let drift = false;
  let capabilityRequests = 0;
  let sessionRequests = 0;
  const media = {
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'] as 'read'[],
      grantId: 'g', profile: 'live' as const },
    async fetch(input: string | URL | Request, init?: RequestInit) {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path.endsWith('/sessions') && init?.method === 'POST') sessionRequests++;
      const response = await transport(input, init);
      if (!path.endsWith('/capabilities')) return response;
      capabilityRequests++;
      const capabilities = await response.json();
      if (drift) capabilities.builds[0].sourceRevision = 'incompatible';
      return Response.json(capabilities);
    },
  };
  const settings = { fs: new MemoryFileSystem(), media, command, args };
  const admitted = await runBash(settings);
  expect(admitted.exitCode).toBe(0);
  expect(admitted.stdoutBytes).toEqual(Uint8Array.of(255, 0, 10));
  const admittedSessions = sessionRequests;
  expect(admittedSessions).toBe(1);
  drift = true;
  const writes: Uint8Array[] = [];
  await expect(runBash({ ...settings, stdout: { async write(bytes) { writes.push(Uint8Array.from(bytes)); } } }))
    .rejects.toThrow('pinned media frontend');
  expect(writes).toEqual([]);
  expect(capabilityRequests).toBe(2);
  expect(sessionRequests).toBe(admittedSessions);
});

it.each([
  'animate', 'compare', 'composite', 'conjure', 'convert', 'display', 'ffmpeg', 'ffprobe',
  'identify', 'import', 'magick', 'magick-script', 'mogrify', 'montage', 'stream',
])('executes remote %s through the built public SDK with identical script and literal byte argv', async command => {
  const requests: unknown[] = [];
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  const settings = { fs, cwd: '/work', env: { NATIVE: 'a b' }, media: {
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'] as 'read'[],
      grantId: 'g', profile: 'live' as const },
    fetch: createTransport({ observe(request) { requests.push(request); }, output: Uint8Array.of(255, 0, 10) }),
  } };
  const direct = await runBash({ ...settings, command,
    args: ['-help', '--media-provider', 'native-value', '', Uint8Array.of(255)] });
  const scripted = await runBash({ ...settings, source: `cat > /native.sh <<'EOF'\n#!/bin/sh\n${command} -help --media-provider native-value '' $'\\377'\nEOF\nchmod +x /native.sh\n/native.sh` });
  expect(direct.exitCode).toBe(0);
  expect(scripted.exitCode).toBe(direct.exitCode);
  expect(scripted.stdoutBytes).toEqual(direct.stdoutBytes);
  expect(direct.stdoutBytes).toEqual(Uint8Array.of(255, 0, 10));
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ toolId: command, cwd: '/work',
    env: expect.objectContaining({ NATIVE: 'a b' }), args: expect.arrayContaining([[], [255]]) });
});

it('keeps multipart boundary generation portable in the public browser shell',async()=>{
 const result=await build({stdin:{resolveDir:new URL('..',import.meta.url).pathname,contents:`
  import {Shell,MemoryFileSystem,networkCommands} from 'poe-code/safe-bash';
  export let contentType='';
  const shell=new Shell({fs:new MemoryFileSystem(),env:{}}).use(networkCommands({
   authorize:async()=>true,async transport(input){
    contentType=input.headers.find(([name])=>name.toLowerCase()==='content-type')[1];
    for await(const bytes of input.body){}
    return {status:200,statusText:'OK',headers:[],body:(async function*(){})(),async dispose(){}};
   }
  }));
  export const outcome=await shell.exec('curl --form field=value https://example.test');
  await shell.dispose();
 `},tsconfigRaw:{compilerOptions:{}},platform:'browser',conditions:['browser'],format:'esm',bundle:true,write:false,logLevel:'silent'});
 const consumer=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles![0]!.contents).toString('base64'));
 expect(consumer.outcome.exitCode).toBe(0);
 const boundary=consumer.contentType.split('boundary=')[1];
 expect(boundary.startsWith('virtual-bash-')).toBe(true);
 const suffix=boundary.slice('virtual-bash-'.length);
 expect(suffix.length).toBe(36);
 expect(Array.from(suffix).every(character=>'0123456789abcdef'.includes(character as string))).toBe(true);
});

it('executes the public Node SDK and plugin exports with identical script and byte argv', async () => {
  const invocations: Uint8Array[][] = [];
  const media = { ffmpeg: {
    build: nativeReference.id, grammarRevision, argv: 'bytes' as const,
    lateAccess: 'complete' as const, effects: 'live' as const,
    async run({ argv, context }: { argv: readonly Uint8Array[]; context: { stdout: { write(bytes: Uint8Array): Promise<void> } } }) {
      invocations.push(argv.map(value => Uint8Array.from(value)));
      await context.stdout.write(argv[0]!);
      return { exitCode: 0 };
    },
  } };
  const fs = new MemoryFileSystem();
  const direct = await runBash({ fs, command: 'ffmpeg', args: [Uint8Array.of(255), '', '-version'], media });
  const scripted = await runBash({ fs, source: "cat > /native.sh <<'EOF'\n#!/bin/sh\nffmpeg $'\\377' '' -version\nEOF\nchmod +x /native.sh\n/native.sh", media });
  expect(direct.exitCode).toBe(0);
  expect(scripted.exitCode).toBe(0);
  expect(direct.stdoutBytes).toEqual(Uint8Array.of(255));
  expect(scripted.stdoutBytes).toEqual(direct.stdoutBytes);
  expect(invocations[1]).toEqual(invocations[0]);
});

it('preserves original native argv slots through the public SDK without calling array overrides', async () => {
  const bytes = Uint8Array.of(255);
  let iterated = false;
  bytes[Symbol.iterator] = function* () { iterated = true; yield 1; };
  const args = [bytes, '', '-help'];
  let mapped = false;
  args.map = (() => { mapped = true; return ['-version']; }) as typeof args.map;
  const requests: unknown[] = [];
  const result = await runBash({ fs: new MemoryFileSystem(), command: 'ffprobe', args, media: {
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
    fetch: createTransport({ observe(request) { requests.push(request); } }),
  } });
  expect(result.exitCode).toBe(0);
  expect(mapped).toBe(false);
  expect(iterated).toBe(false);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ toolId: 'ffprobe', args: [[255], [], Array.from(new TextEncoder().encode('-help'))] });
});

it('executes a browser consumer with the public shell and plugin sharing byte argument identity', async () => {
  const result = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, contents: `
    import { Shell, MemoryFileSystem } from 'poe-code/safe-bash';
    import { mediaCommands, nativeReference, grammarRevision } from 'poe-code/safe-bash/commands/media';
    const shell = new Shell({fs: new MemoryFileSystem(), env: {}}).use(mediaCommands({ffmpeg: {
      build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
      async run({argv, context}) { await context.stdout.write(argv[0]); return {exitCode: 0}; }
    }}));
    export const outcome = await shell.exec('ffmpeg -version');
    await shell.dispose();
  ` }, tsconfigRaw: { compilerOptions: {} }, platform: 'browser', conditions: ['workerd'], format: 'esm', bundle: true, write: false, metafile: true, logLevel: 'silent' });
  expect(Object.keys(result.metafile!.inputs).filter(path => path.includes('native-process') || path.includes('media-server') || path.includes('sdk/bash'))).toEqual([]);
  const consumer = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles![0]!.contents).toString('base64'));
  expect(consumer.outcome.exitCode).toBe(0);
  expect(consumer.outcome.stdout).toBe('-version');
});

it('preserves ImageMagick discovery and byte argv through built public SDK exports', async () => {
  const invocations: Uint8Array[][] = [];
  const binding = {
    build: imageMagickReference.id, grammarRevision: imageMagickGrammarRevision,
    argv: 'bytes' as const, lateAccess: 'complete' as const, effects: 'live' as const,
    discoveries: 0,
    discoveryContext() { this.discoveries++; return {}; },
    async run({ argv, context }: { argv: readonly Uint8Array[]; context: { stdout: { write(bytes: Uint8Array): Promise<void> } } }) {
      invocations.push(argv.map(value => Uint8Array.from(value)));
      await context.stdout.write(argv[0]!);
      return { exitCode: 7 };
    },
  };
  const fs = new MemoryFileSystem();
  const media = { imageMagick: binding };
  const direct = await runBash({ fs, command: 'identify', args: [Uint8Array.of(255), '', '-version'], media });
  const scripted = await runBash({ fs, source: "cat > /image.sh <<'EOF'\n#!/bin/sh\nidentify $'\\377' '' -version\nEOF\nchmod +x /image.sh\n/image.sh", media });
  expect(direct.exitCode).toBe(7);
  expect(scripted.exitCode).toBe(direct.exitCode);
  expect(direct.stdoutBytes).toEqual(Uint8Array.of(255));
  expect(scripted.stdoutBytes).toEqual(direct.stdoutBytes);
  expect(invocations[1]).toEqual(invocations[0]);
  expect(binding.discoveries).toBe(2);
});

it('admits remote help through the browser export without importing Node hosts', async () => {
  const result = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, contents: `
    import { Shell, MemoryFileSystem } from 'poe-code/safe-bash';
    import { createRemoteMediaCommands } from 'poe-code/safe-bash/commands/media';
    export let requests = 0;
    export const errors = [];
    const shell = new Shell({fs: new MemoryFileSystem(), env: {}, onInternalError(error) { errors.push(String(error)); }})
      .use(createRemoteMediaCommands({service: 'https://media.test', authToken: 'explicit', buildDigest: '${'a'.repeat(64)}',
        resource: {namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live'},
        async fetch() { requests++; return Response.json({protocolMajor: 1, builds: [], features: [],
          limits: {maxJobs: 1, maxHandles: 1, maxArgvBytes: 1024, maxManifestEntries: 1, maxFrameBytes: 1024,
            maxInflightBytes: 2048, maxBlobBytes: 1024, maxReplayBytes: 2048, maxCallbacks: 1,
            maxNativeMemoryBytes: 1024, maxNativeProcesses: 1, maxJobDurationMs: 1000},
          requestStreaming: true, leaseMs: 1000, retentionMs: 1000}); }
      }));
    export const beforeInvocation = requests;
    export const outcome = await shell.exec('ffmpeg -help');
    await shell.dispose();
  ` }, tsconfigRaw: { compilerOptions: {} }, platform: 'browser', conditions: ['browser'], format: 'esm', bundle: true, write: false, metafile: true, logLevel: 'silent' });
  expect(Object.keys(result.metafile!.inputs).filter(path => path.includes('native-process') || path.includes('media-server') || path.includes('sdk/bash'))).toEqual([]);
  const consumer = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles![0]!.contents).toString('base64'));
  expect(consumer.beforeInvocation).toBe(0);
  expect(consumer.requests).toBe(1);
  expect(consumer.outcome.exitCode).not.toBe(0);
  expect(consumer.outcome.stdoutBytes).toEqual(new Uint8Array());
  expect(consumer.errors[0]).toContain('pinned');
});
