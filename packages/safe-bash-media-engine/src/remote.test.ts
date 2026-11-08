import { expect, it, vi } from 'vitest';
import { createRemoteMediaCommands } from '@poe-platform/safe-bash/commands/media';
import { createTransport, fixtureDigest, fixtureLimits } from '../fixtures/transport.js';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { Shell, MemoryFileSystem } from '@poe-platform/safe-bash';
import { Shell as PublicShell, MemoryFileSystem as PublicMemoryFileSystem } from '@poe-platform/safe-bash';
import type { MediaEngineRequest } from './engine.js';

it('allows the host to answer a canonical file request through invocation-scoped transport', async () => {
  const grant = { grantId: 'metadata', namespaceId: 'work', root: '/', operations: ['stat' as const],
    maxBytes: '8192', maxOperations: 8, expiresAt: new Date(Date.now() + 60000).toISOString() };
  const received = vi.fn();
  const onControl = vi.fn(async (...args: unknown[]) => {
    const control = args[0] as import('@poe-code/remote-execution/wire').Callback;
    if (control.type !== 'Callback') return;
    const binding = args[2] as { respond(result: import('@poe-code/remote-execution/wire').CallbackResult): Promise<unknown> };
    expect(binding).toBeDefined();
    const result = { type: 'CallbackResult' as const, callbackId: control.callbackId, operationId: control.operationId,
      state: 'applied' as const, stat: { type: 'file' as const, size: 4, mode: 0o644, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 } };
    await expect(binding.respond({ ...result, callbackId: 'unrelated' })).rejects.toThrow('another operation');
    await expect(binding.respond({ ...result, operationId: 'unrelated' })).rejects.toThrow('another operation');
    await expect(binding.respond({ ...result, acknowledgedBytes: '4' })).rejects.toThrow('contradicts its operation');
    control.callbackId = 'replaced';
    await expect(binding.respond({ ...result, callbackId: control.callbackId })).rejects.toThrow('another operation');
    await binding.respond(result);
  });
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {} }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read', 'metadata'], grantId: 'g', profile: 'live' },
    grants: [grant], onControl,
    fetch: createTransport({ grants: [grant], fileRequest: { grantId: grant.grantId,
      operation: { op: 'stat', path: '/input.ppm' }, observe: received } }),
  }));
  try {
    expect(await shell.exec('ffprobe -version')).toMatchObject({ exitCode: 0 });
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ state: 'applied', stat: expect.objectContaining({ size: 4 }) }));
  } finally { await shell.dispose(); }
});

it.each([false, true])('owns provider cleanup before command settlement (shell registrar=%s)', async shellRegistrar => {
  const fixture = await import('../fixtures/native-provider.js');
  const events: string[] = [];
  let registrar: MediaEngineRequest['registerCleanup'];
  const cleanup = vi.fn(async () => { await Promise.resolve(); events.push('cleanup'); });
  const factory = vi.spyOn(fixture, 'createMediaProvider').mockReturnValue({
    fetch: createTransport(), async execute(request) {
      expect(request.registerCleanup).toBeTypeOf('function');
      registrar = request.registerCleanup;
      request.registerCleanup!(cleanup);
      events.push('acquired');
      return { exitCode: 17 };
    },
  });
  const shell = new PublicShell({ fs: new PublicMemoryFileSystem(), env: {} }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
    provider: { module: new URL('../fixtures/native-provider.ts', import.meta.url).href },
  }));
  shell.commands.register({ name: 'invoke-media', async execute(context) {
    const result = await shell.commands.get('ffmpeg')!.execute({ ...context,
      registerCleanup: shellRegistrar ? context.registerCleanup : undefined,
    });
    events.push('command-return');
    return result;
  } });
  try {
    expect((await shell.exec('invoke-media -version')).exitCode).toBe(17);
    expect(events).toEqual(['acquired', 'cleanup', 'command-return']);
    expect(cleanup).toHaveBeenCalledOnce();
    const late = vi.fn(async () => {});
    expect(() => registrar!(late)).toThrow('cleanup admission closed');
    expect(late).not.toHaveBeenCalled();
  } finally { await shell.dispose(); factory.mockRestore(); }
});

it('registered retirement releases a blocked provider dependency before waiting for execution', async () => {
  const fixture = await import('../fixtures/native-provider.js');
  let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
  let release!: () => void; const dependency = new Promise<void>(resolve => { release = resolve; });
  let cleanup!: () => void | Promise<void>;
  const retire = vi.fn(async () => { release(); });
  const factory = vi.spyOn(fixture, 'createMediaProvider').mockReturnValue({
    fetch: createTransport(), async execute(request) {
      request.registerCleanup!(retire);
      ready(); await dependency;
      request.signal.throwIfAborted();
      return { exitCode: 42 };
    },
  });
  const shell = new PublicShell({ fs: new PublicMemoryFileSystem(), env: {} }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
    provider: { module: new URL('../fixtures/native-provider.ts', import.meta.url).href },
  }));
  shell.commands.register({ name: 'invoke-media', execute(context) {
    return shell.commands.get('ffmpeg')!.execute({ ...context,
      registerCleanup(fn) { cleanup = fn; context.registerCleanup?.(fn); },
    });
  } });
  const execution = shell.exec('invoke-media -version');
  let retirement: Promise<void> | undefined;
  try {
    await started; retirement = Promise.resolve(cleanup());
    await vi.waitFor(() => expect(retire).toHaveBeenCalledOnce(), { interval: 1, timeout: 100 });
    await retirement; await execution;
    expect((await shell.exec('ffmpeg -version')).exitCode).toBe(42);
  } finally { release(); await retirement; await execution; await shell.dispose(); factory.mockRestore(); }
});

it('attempts every provider cleanup and rejects incomplete retirement before allowing reuse', async () => {
  const fixture = await import('../fixtures/native-provider.js');
  const cause = new Error('Provider lease retirement unconfirmed');
  const errors: unknown[] = [];
  let fail = true;
  const first = vi.fn(async () => { if (fail) { fail = false; throw cause; } });
  const sibling = vi.fn(async () => {});
  const factory = vi.spyOn(fixture, 'createMediaProvider').mockReturnValue({
    fetch: createTransport(), async execute(request) {
      request.registerCleanup!(first);
      request.registerCleanup!(sibling);
      return { exitCode: 42 };
    },
  });
  const shell = new PublicShell({ fs: new PublicMemoryFileSystem(), env: {}, onInternalError(error) { errors.push(error); } }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
    provider: { module: new URL('../fixtures/native-provider.ts', import.meta.url).href },
  }));
  try {
    await expect(shell.exec('ffmpeg -version')).rejects.toBe(cause);
    expect(errors).toContain(cause);
    expect(first).toHaveBeenCalledOnce(); expect(sibling).toHaveBeenCalledOnce();
    expect((await shell.exec('ffmpeg -version')).exitCode).toBe(42);
    expect(first).toHaveBeenCalledTimes(2); expect(sibling).toHaveBeenCalledTimes(2);
  } finally { await shell.dispose(); factory.mockRestore(); }
});

it.each((['stdin', 'descriptor'] as const).flatMap(route => ['EOF', 'span'].map(fault => ({ route, fault }))))('rejects invalid $route $fault before sending native input', async ({ route, fault }) => {
  const errors: unknown[] = [];
  const fragment = new Uint8Array(8192).fill(113);
  Object.defineProperty(fragment, 'length', { value: 1 });
  const read = vi.fn().mockResolvedValueOnce(fault === 'EOF'
    ? { done: 'false', value: Uint8Array.of(113, 10) }
    : { done: false, value: fragment }).mockResolvedValue({ done: true, value: undefined });
  const close = vi.fn(async () => {});
  const received = vi.fn();
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {}, onInternalError(cause) { errors.push(cause); } }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
    ...(route === 'descriptor' ? {
      grants: [{ grantId: 'extra-output', namespaceId: 'work', handleId: 'extra-output', operations: ['read' as const], maxBytes: '8192', maxOperations: 8, expiresAt: new Date(Date.now() + 60000).toISOString() }],
      descriptors: [{ fd: 3, handleId: 'extra-output', openDescriptionId: 'input', grantId: 'extra-output', rights: ['read' as const], seekable: false }],
    } : {}),
    fetch: createTransport({ descriptorInput: received }),
  }));
  shell.commands.register({ name: 'invoke-media', execute(context) {
    return shell.commands.get('ffmpeg')!.execute({ ...context,
      ...(route === 'stdin' ? { stdinInput: { position: 0, read: read as never } } : { admittedHandles: { async acquire() { return { read: read as never, close }; } } }),
    });
  } });
  try {
    expect(await shell.exec('invoke-media -i pipe:0 -f null -')).toMatchObject({ exitCode: 1 });
    expect(errors.some(cause => String(cause).includes(fault === 'EOF' ? 'Invalid process input read result' : 'read size'))).toBe(true);
    expect(received).not.toHaveBeenCalled();
    if (route === 'descriptor') expect(close).toHaveBeenCalledOnce();
    expect(await shell.exec('invoke-media -version')).toMatchObject({ exitCode: 0 });
  } finally { await shell.dispose(); }
});

it('keeps concurrent job input, output and control admission independent', async () => {
  const errors: unknown[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {}, onInternalError(error) { errors.push(error); } }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
    fetch: createTransport({ output: Uint8Array.of(0, 255) }),
  }));
  try {
    const results = await Promise.all([shell.exec('ffmpeg -version'), shell.exec('ffprobe -version')]);
    expect(errors).toEqual([]);
    for (const result of results) {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdoutBytes).toEqual(Uint8Array.of(0, 255));
    }
  } finally { await shell.dispose(); }
});

it('preserves a lost native stdin END receipt after an explicit successful exit', async () => {
  const cause = new Error('Native END receipt lost');
  const errors: unknown[] = [];
  const transport = createTransport();
  let loseReceipt = true;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await transport(input, init);
    if (loseReceipt && init?.method === 'POST' && String(input).endsWith('/frames')) {
      loseReceipt = false;
      // The native END and exit have settled. Deliver transport failure after
      // the independent JobState observer has retired new input reads.
      await new Promise<void>(resolve => setImmediate(resolve));
      await response.body?.cancel();
      throw cause;
    }
    return response;
  };
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {}, onInternalError(error) { errors.push(error); } }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' }, fetch,
  }));
  try {
    expect(await shell.exec('ffmpeg -i pipe:0 -f null -')).toMatchObject({ exitCode: 1 });
    expect(loseReceipt).toBe(false);
    expect(errors).toContainEqual(expect.objectContaining({ name: 'RemoteExecutionError', phase: 'unknown', cause }));
    expect(await shell.exec('ffmpeg -version')).toMatchObject({ exitCode: 0 });
  } finally { await shell.dispose(); }
});

it('retains an accepted descriptor prefix without admitting another partial write after cancellation', async () => {
  const controller = new AbortController();
  const cause = new Error('Cancel partial descriptor delivery');
  let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  const accepted: number[] = [];
  const write = vi.fn(async (bytes: Uint8Array) => { entered(); await pending; accepted.push(bytes[0]); return 1; });
  const close = vi.fn(async () => {});
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {} }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
    grants: [{ grantId: 'extra-output', namespaceId: 'work', handleId: 'extra-output', operations: ['write'], maxBytes: '8192', maxOperations: 8, expiresAt: new Date(Date.now() + 60000).toISOString() }],
    descriptors: [{ fd: 3, handleId: 'extra-output', openDescriptionId: 'output', grantId: 'extra-output', rights: ['write'], seekable: false }],
    fetch: createTransport({ descriptorOutput: Uint8Array.of(0, 255, 113, 10) }),
  }));
  shell.commands.register({ name: 'invoke-media', execute(context) {
    return shell.commands.get('ffmpeg')!.execute({ ...context, admittedHandles: { async acquire() { return { write, close }; } } });
  } });
  const execution = shell.exec('invoke-media -version', { signal: controller.signal });
  const rejected = expect(execution).rejects.toBe(cause);
  try {
    await ready; controller.abort(cause); release(); await rejected;
    expect(accepted).toEqual([0]); expect(write).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
    expect(await shell.exec('invoke-media -version')).toMatchObject({ exitCode: 0 });
  } finally { release(); await rejected; await shell.dispose(); }
});

it.each(['ffmpeg', 'ffprobe'] as const)('retains %s advisory discovery in the authenticated provider execution', async tool => {
  const fixture = await import('../fixtures/native-provider.js');
  const execute = vi.fn(async (_request: MediaEngineRequest) => ({ exitCode: 17 }));
  const factory = vi.spyOn(fixture, 'createMediaProvider').mockReturnValue({ fetch: createTransport(), execute });
  const shell = new PublicShell({ fs: new PublicMemoryFileSystem(), env: {} }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
    provider: { module: new URL('../fixtures/native-provider.ts', import.meta.url).href },
  }));
  try {
    expect((await shell.exec(`${tool} -i late.wav`)).exitCode).toBe(17);
    expect(execute).toHaveBeenCalledOnce();
    const request = execute.mock.calls[0]![0];
    const discovery = (request as MediaEngineRequest & { discovery: import('./types.js').Discovery }).discovery;
    expect(discovery.dependencies.map(item => [item.role, item.value])).toEqual([
      ['input', new TextEncoder().encode('late.wav')],
    ]);
    expect(discovery.deferred).toContainEqual({ index: -1, reason: 'native-access' });
    discovery.argv[0][0] = 0;
    expect(request.args[0]).toEqual(new TextEncoder().encode('-i'));
  } finally { await shell.dispose(); factory.mockRestore(); }
});

it('delivers remote bytes through the shell owned-output capability',async()=>{
  const write=vi.fn(async()=>{});const borrowed=vi.fn(async()=>{throw new Error('Borrowed write is unavailable');});
  const shell=new Shell({fs:new MemoryFileSystem(),env:{}}).use(createRemoteMediaCommands({
    service:'https://media.test',authToken:'fixture',buildDigest:fixtureDigest,
    resource:{namespaceId:'work',logicalRoot:'/',rights:['read'],grantId:'g',profile:'live'},
    fetch:createTransport({output:Uint8Array.of(0,255)}),
  }));
  shell.commands.register({name:'invoke-media',execute(context){return shell.commands.get('ffmpeg')!.execute({...context,
    stdout:{write:borrowed,ownedOutput:{consumerClosed:new AbortController().signal,write}},
  });}});
  try {
    expect(await shell.exec('invoke-media -version')).toMatchObject({exitCode:0});
    expect(write).toHaveBeenCalledExactlyOnceWith(Uint8Array.of(0,255));expect(borrowed).not.toHaveBeenCalled();
  }finally{await shell.dispose();}
});

it('drains owned delivery and its credit before registered cleanup cancels the job',async()=>{
  const events:string[]=[];let entered!:()=>void;let release!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;});const pending=new Promise<void>(resolve=>{release=resolve;});
  const transport=createTransport({output:Uint8Array.of(0,255)});
  const fetch:typeof globalThis.fetch=async(input,init)=>{
    if(String(input).endsWith('/ack'))events.push('ack');
    if(String(input).endsWith('/cancel'))events.push('cancel');
    return transport(input,init);
  };
  const controller=new AbortController();const cause=new Error('cancel owned remote delivery');
  let cleanup!:()=>void|Promise<void>;const borrowed=vi.fn(async()=>{throw new Error('Unowned output path');});
  const write=vi.fn(async()=>{entered();await pending;events.push('accepted');});
  const errors:unknown[]=[];
  const shell=new Shell({fs:new MemoryFileSystem(),env:{},onInternalError(cause){errors.push(cause);}}).use(createRemoteMediaCommands({
    service:'https://media.test',authToken:'fixture',buildDigest:fixtureDigest,
    resource:{namespaceId:'work',logicalRoot:'/',rights:['read'],grantId:'g',profile:'live'},fetch,
  }));
  shell.commands.register({name:'invoke-media',execute(context){return shell.commands.get('ffmpeg')!.execute({...context,
    registerCleanup(fn){cleanup=fn;context.registerCleanup?.(fn);},
    stdout:{write:borrowed,ownedOutput:{consumerClosed:new AbortController().signal,write}},
  });}});
  const execution=shell.exec('invoke-media -version',{signal:controller.signal});
  const rejected=expect(execution).rejects.toBe(cause);
  try {
    await ready;controller.abort(cause);
    let cleaned=false;const barrier=Promise.resolve(cleanup()).then(()=>{cleaned=true;});
    await new Promise<void>(resolve=>setImmediate(resolve));
    const retiredBeforeDelivery=events.includes('cancel');const cleanedBeforeDelivery=cleaned;
    release();await rejected;await barrier;
    expect(retiredBeforeDelivery).toBe(false);expect(cleanedBeforeDelivery).toBe(false);
    const accepted=events.indexOf('accepted');expect(accepted).toBeGreaterThanOrEqual(0);
    const acknowledgement=events.indexOf('ack',accepted);expect(acknowledgement).toBeGreaterThan(accepted);
    expect(events.indexOf('cancel')).toBeGreaterThan(acknowledgement);
    expect(write).toHaveBeenCalledOnce();expect(borrowed).not.toHaveBeenCalled();
    expect(await shell.exec('ffmpeg -version')).toMatchObject({exitCode:0});
    expect(errors.some(error=>String(error).includes('Unowned'))).toBe(false);
  }finally{release();await rejected;await shell.dispose();}
});

it.each([
  { outcome: { kind: 'signaled', signal: 'SIGTERM', signalNumber: 15 }, expected: 130, calls: 1 },
  { outcome: { kind: 'exited', exitCode: 42 }, expected: 42, calls: 0 },
] as const)('uses the supplied shell signal convention only for signal-only termination ($outcome.kind)', async ({ outcome, expected, calls }) => {
  const fetch=createTransport({outcome});const signalStatus=vi.fn(()=>130);
  const shell=new Shell({fs:new MemoryFileSystem(),env:{}}).use(createRemoteMediaCommands({
    service:'https://media.test',authToken:'fixture',buildDigest:fixtureDigest,
    resource:{namespaceId:'work',logicalRoot:'/',rights:['read'],grantId:'g',profile:'live'},fetch,signalStatus,
  }));
  try {
    expect(await shell.exec('ffmpeg -version')).toMatchObject({exitCode:expected});
    expect(signalStatus).toHaveBeenCalledTimes(calls);
    if(calls)expect(signalStatus).toHaveBeenCalledWith('SIGTERM',15);
  } finally {await shell.dispose();}
});

it('keeps output available when signal termination has no qualified shell projection', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const output=Uint8Array.of(0,255);const errors:unknown[]=[];
  const fetch=createTransport({output,outcome:{kind:'signaled',signal:'SIGTERM',signalNumber:15}});
  const shell=new Shell({fs:new MemoryFileSystem(),env:{},onInternalError(cause){errors.push(cause);}}).use(createRemoteMediaCommands({
    service:'https://media.test',authToken:'fixture',buildDigest:fixtureDigest,
    resource:{namespaceId:'work',logicalRoot:'/',rights:['read'],grantId:'g',profile:'live'},fetch,
  }));
  try {
    expect(await shell.exec('ffmpeg -version')).toMatchObject({exitCode:1,stdoutBytes:output});
    expect(String(errors[0])).toContain('signaled');
  } finally {await shell.dispose();}
});

it('refuses an explicit pipe binding for seekable redirected stdin before session acquisition', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const fs=new MemoryFileSystem();await fs.writeFile('/input',Uint8Array.of(0,255));
  const fetch=vi.fn(createTransport());const errors: unknown[]=[];
  const shell=new Shell({fs,env:{},onInternalError(cause){errors.push(cause);}}).use(createRemoteMediaCommands({
    service:'https://media.test',authToken:'fixture',buildDigest:fixtureDigest,
    resource:{namespaceId:'work',logicalRoot:'/',rights:['read'],grantId:'g',profile:'live'},
    stdin:{kind:'stream',seekable:false},fetch,
  }));
  try {
    expect(await shell.exec('ffmpeg -version < /input')).toMatchObject({exitCode:1});
    expect(String(errors[0])).toContain('seekable native stdin');
    expect(fetch.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
  } finally {await shell.dispose();}
});

it('uploads the borrowed stdinInput cursor, including no-data fragments, without a second stdin reader', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const iterate = vi.fn(() => { throw new Error('competing stdin reader'); });
  const read = vi.fn()
    .mockResolvedValueOnce({ done: false, value: new Uint8Array() })
    .mockResolvedValueOnce({ done: false, value: Uint8Array.of(0, 255, 113, 10) })
    .mockResolvedValue({ done: true, value: undefined });
  const onProgress = vi.fn();const errors: unknown[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {}, onInternalError(cause) { errors.push(cause); } }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
    fetch: createTransport(), onProgress,
  }));
  shell.commands.register({ name: 'stdin-cursor', execute(context) {
    return shell.commands.get('ffmpeg')!.execute({ ...context, stdin: { [Symbol.asyncIterator]: iterate }, stdinInput: { position: 7, read } });
  } });
  try {
    expect(await shell.exec('stdin-cursor -i pipe:0 -f null -')).toMatchObject({ exitCode: 0 });
    expect(errors).toEqual([]);expect(iterate).not.toHaveBeenCalled();expect(read).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenCalledWith({ direction: 'upload', bytes: 4 });
  } finally { await shell.dispose(); }
});

it('supplies the provider the same owned resource binding as remote admission', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const fixture = await import('../fixtures/native-provider.js');
  const received: unknown[] = [];
  const factory = vi.spyOn(fixture, 'createMediaProvider').mockImplementation((...args) => {
    received.push(structuredClone((args as unknown as [{ resource: unknown }])[0].resource));
    return { fetch: createTransport(), async execute() { return { exitCode: 0 }; } };
  });
  const resource = { namespaceId: 'work', logicalRoot: '/', rights: ['read'] as ('read' | 'write')[], grantId: 'g', profile: 'live' as const };
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {} }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest, resource,
    provider: { module: new URL('../fixtures/native-provider.ts', import.meta.url).href },
  }));
  resource.namespaceId = 'changed';
  resource.rights.push('write');
  try {
    expect((await shell.exec('ffmpeg -version')).exitCode).toBe(0);
    expect(received).toEqual([{ namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' }]);
  } finally { await shell.dispose(); factory.mockRestore(); }
});

it('preserves a failed output sink cause when remote cleanup also fails', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const primary = new Error('host output failed');
  const errors: unknown[] = [];
  const transport = createTransport({ extraOutput: Uint8Array.of(0, 255, 10) });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (init?.method === 'DELETE') throw new Error('remote cleanup unreachable');
    return transport(input, init);
  };
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {}, onInternalError(error) { errors.push(error); } })
    .use(createRemoteMediaCommands({ service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
      resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' }, fetch,
      grants: [{ grantId: 'extra-output', namespaceId: 'work', handleId: 'extra-output', operations: ['write'], maxBytes: '8192', maxOperations: 8, expiresAt: new Date(Date.now() + 60000).toISOString() }],
      onOutputChannel: async () => ({ async write() { throw primary; } }) }));
  try {
    expect(await shell.exec('ffmpeg -version')).toMatchObject({ exitCode: 1 });
    expect(errors).toContainEqual(expect.objectContaining({
      name: 'UnrecoverableTransportError', cause: primary,
      recoveryActions: expect.arrayContaining(['recover-partial-outputs']),
    }));
    expect(errors).toContainEqual(expect.objectContaining({ cause: expect.objectContaining({ message: 'remote cleanup unreachable' }) }));
  } finally { await shell.dispose(); }
});

it('supports explicit remote replacement using the plugin collision policy without connecting', async () => {
  const { CommandRegistry } = await import('@poe-platform/safe-bash');
  const fetch = vi.fn(createTransport());
  const commands = new CommandRegistry([{ name: 'identify', execute: () => ({ exitCode: 7 }) }]);
  const plugin = createRemoteMediaCommands({ service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' }, fetch, replace: true });
  plugin.setup({ commands, use() {}, registerFileSystem() {} });
  expect(commands.has('ffmpeg')).toBe(true);
  expect(commands.get('identify')!.execute).not.toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it('awaits host transfer events before settling native output', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let settled = false;
  const shell = new PublicShell({ fs: new PublicMemoryFileSystem(), env: {} }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' },
    fetch: createTransport(), async onProgress(event) { if (event.direction === 'download') { entered(); await pending; } },
  }));
  const execution = shell.exec('ffmpeg -version').then(result => { settled = true; return result; });
  try {
    await ready;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBe(false);
  } finally { release(); await execution; await shell.dispose(); }
});

it('rejects duplicate native fd mappings before acquiring leases or opening sessions', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const acquire = vi.fn(async () => ({ async write(bytes: Uint8Array) { return bytes.length; }, async close() {} }));
  const fetch = vi.fn(createTransport());
  const descriptor = { fd: 3, handleId: 'output', openDescriptionId: 'output', grantId: 'output', rights: ['write' as const], seekable: false };
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {} }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'host-issued', profile: 'live' },
    descriptors: [descriptor, descriptor], fetch,
  }));
  shell.commands.register({ name: 'invoke-media', execute(context) { return context.invoke!('ffmpeg', ['-version'], { admittedHandles: { acquire } }); } });
  try {
    expect(await shell.exec('invoke-media')).toMatchObject({ exitCode: 1 });
    expect(acquire).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { await shell.dispose(); }
});

it('sends admitted descriptor input and EOF on the shared ordered input lane', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const received = vi.fn(); const close = vi.fn(async () => {});
  let read = 0;
  const acquire = vi.fn(async () => ({ async read() {
    if (read++ === 0) return { done: false as const, value: new Uint8Array() };
    if (read > 2) return { done: true as const, value: undefined };
    return { done: false as const, value: Uint8Array.of(0, 255, 10) };
  }, close }));
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {} }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'host-issued', profile: 'live' },
    grants: [{ grantId: 'extra-output', namespaceId: 'work', handleId: 'extra-output', operations: ['read'], maxBytes: '8192', maxOperations: 8, expiresAt: new Date(Date.now() + 60000).toISOString() }],
    descriptors: [{ fd: 3, handleId: 'extra-output', openDescriptionId: 'input', grantId: 'extra-output', rights: ['read'], seekable: false }],
    fetch: createTransport({ descriptorInput: received }),
  }));
  shell.commands.register({ name: 'invoke-media', execute(context) { return context.invoke!('ffmpeg', ['-i', 'pipe:3', '-f', 'null', '-'], { admittedHandles: { acquire } }); } });
  try {
    const execution = shell.exec('invoke-media');
    expect(await execution).toMatchObject({ exitCode: 0 });
    expect(received).toHaveBeenCalledExactlyOnceWith(Uint8Array.of(0, 255, 10));
    expect(acquire).toHaveBeenCalledWith(3, ['read'], expect.any(AbortSignal));
    expect(close).toHaveBeenCalledOnce();
  } finally { await shell.dispose(); }
});

it('bounds extra descriptor reads by the shell contract when transport credit is larger', async () => {
  const fetch=createTransport({descriptorInput(){},limits:{...fixtureLimits,maxFrameBytes:131072,maxInflightBytes:262144,maxReplayBytes:524288}});
  const read=vi.fn(async(count:number)=>{
    if(count>65536)throw new Error('Shell descriptor read exceeds its contract');
    return {done:true as const,value:undefined};
  });
  const close=vi.fn(async()=>{});const errors:unknown[]=[];
  const shell=new Shell({fs:new MemoryFileSystem(),env:{},onInternalError(cause){errors.push(cause);}}).use(createRemoteMediaCommands({
    service:'https://media.test',authToken:'fixture',buildDigest:fixtureDigest,
    resource:{namespaceId:'work',logicalRoot:'/',rights:['read'],grantId:'g',profile:'live'},
    grants:[{grantId:'extra-output',namespaceId:'work',handleId:'extra-output',operations:['read'],maxBytes:'8192',maxOperations:8,expiresAt:new Date(Date.now()+60000).toISOString()}],
    descriptors:[{fd:3,handleId:'extra-output',openDescriptionId:'input',grantId:'extra-output',rights:['read'],seekable:false}],fetch,
  }));
  shell.commands.register({name:'invoke-media',execute(context){return context.invoke!('ffmpeg',['-i','pipe:3','-f','null','-'],{admittedHandles:{async acquire(){return{read,close};}}});}});
  try {
    expect(await shell.exec('invoke-media')).toMatchObject({exitCode:0});
    expect(errors).toEqual([]);expect(read).toHaveBeenCalledExactlyOnceWith(65536,expect.any(AbortSignal));
    expect(close).toHaveBeenCalledOnce();
  } finally {await shell.dispose();}
});

it('maps configured fd output through an admitted lease and drains partial writes before releasing it', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const output: number[] = []; const close = vi.fn(async () => {});
  const acquire = vi.fn(async () => ({
    async write(bytes: Uint8Array) { output.push(bytes[0]); return 1; }, close,
  }));
  const errors: unknown[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {}, onInternalError(error) { errors.push(error); } }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read', 'write'], grantId: 'host-issued', profile: 'live' },
    grants: [{ grantId: 'extra-output', namespaceId: 'work', handleId: 'extra-output', operations: ['write'], maxBytes: '8192', maxOperations: 8, expiresAt: new Date(Date.now() + 60000).toISOString() }],
    descriptors: [{ fd: 3, handleId: 'extra-output', openDescriptionId: 'output', grantId: 'extra-output', rights: ['write'], seekable: false }],
    fetch: createTransport({ descriptorOutput: Uint8Array.of(0, 255, 10) }),
  }));
  shell.commands.register({ name: 'invoke-media', execute(context) { return context.invoke!('ffmpeg', ['-version'], { admittedHandles: { acquire } }); } });
  try {
    expect(await shell.exec('invoke-media')).toMatchObject({ exitCode: 0 });
    expect(errors).toEqual([]);
    expect(acquire).toHaveBeenCalledWith(3, ['write'], expect.any(AbortSignal));
    expect(output).toEqual([0, 255, 10]);
    expect(close).toHaveBeenCalledOnce();
  } finally { await shell.dispose(); }
});

it('drains large transport frames through bounded partial descriptor writes', async () => {
  const media=Uint8Array.from({length:70000},(_,index)=>index%256);const received:Uint8Array[]=[];
  const write=vi.fn(async(bytes:Uint8Array)=>{
    if(bytes.length>65536)throw new Error('Shell descriptor write exceeds its contract');
    const count=Math.min(bytes.length,32768);received.push(bytes.slice(0,count));return count;
  });
  const close=vi.fn(async()=>{});const errors:unknown[]=[];
  const shell=new Shell({fs:new MemoryFileSystem(),env:{},onInternalError(cause){errors.push(cause);}}).use(createRemoteMediaCommands({
    service:'https://media.test',authToken:'fixture',buildDigest:fixtureDigest,
    resource:{namespaceId:'work',logicalRoot:'/',rights:['read','write'],grantId:'g',profile:'live'},
    grants:[{grantId:'extra-output',namespaceId:'work',handleId:'extra-output',operations:['write'],maxBytes:'70000',maxOperations:8,expiresAt:new Date(Date.now()+60000).toISOString()}],
    descriptors:[{fd:3,handleId:'extra-output',openDescriptionId:'output',grantId:'extra-output',rights:['write'],seekable:false}],
    fetch:createTransport({descriptorOutput:media,limits:{...fixtureLimits,maxFrameBytes:131072,maxInflightBytes:262144,maxReplayBytes:524288}}),
  }));
  shell.commands.register({name:'invoke-media',execute(context){return context.invoke!('ffmpeg',['-version'],{admittedHandles:{async acquire(){return{write,close};}}});}});
  try {
    expect(await shell.exec('invoke-media')).toMatchObject({exitCode:0});expect(errors).toEqual([]);
    expect(write.mock.calls.map(([bytes])=>bytes.length)).toEqual([65536,37232,4464]);
    const combined=new Uint8Array(media.length);let offset=0;
    for(const bytes of received){combined.set(bytes,offset);offset+=bytes.length;}
    expect(combined).toEqual(media);expect(close).toHaveBeenCalledOnce();
  } finally {await shell.dispose();}
});

it('forwards admitted process-group signals and drains unsubscription before returning', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  type Accept = Parameters<NonNullable<import('safe-bash-contracts/command').CommandContext['processSignals']>['subscribe']>[0];
  let accept: Accept | undefined;
  let subscribed!: () => void;
  const ready = new Promise<void>(resolve => { subscribed = resolve; });
  let release!: () => void;
  const input = new Promise<void>(resolve => { release = resolve; });
  const unsubscribe = vi.fn(async () => {}); const onSignal = vi.fn();
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {} }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'host-issued', profile: 'live' },
    fetch: createTransport({ onSignal }),
  }));
  const execution = shell.exec('ffmpeg -i pipe:0 -f null -', {
    stdin: { async *[Symbol.asyncIterator]() { await input; yield Uint8Array.of(1); } },
    processSignals: { subscribe(listener) { accept = listener; subscribed(); return unsubscribe; } },
  });
  try {
    await ready;
    expect(await accept!({ name: 'SIGUSR1', number: 10, target: 'process-group', sequence: 1n })).toEqual({ sequence: 1n });
    expect(onSignal).toHaveBeenCalledExactlyOnceWith('SIGUSR1');
    release();
    expect(await execution).toMatchObject({ exitCode: 0 });
    expect(unsubscribe).toHaveBeenCalledOnce();
  } finally { release(); await execution; await shell.dispose(); }
});

it('delivers an admitted extra output channel to its host sink without closing borrowed outputs', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const bytes = Uint8Array.of(0, 255, 10);
  const write = vi.fn(async () => {}); const close = vi.fn(); const errors: unknown[] = [];
  const onOutputChannel = vi.fn(async () => ({ write, close }));
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {}, onInternalError(error) { errors.push(error); } }).use(createRemoteMediaCommands({
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read', 'write'], grantId: 'host-issued', profile: 'live' },
    grants: [{ grantId: 'extra-output', namespaceId: 'work', handleId: 'extra-output', operations: ['write'], maxBytes: '8192', maxOperations: 8, expiresAt: new Date(Date.now() + 60000).toISOString() }],
    fetch: createTransport({ extraOutput: bytes }), onOutputChannel,
  }));
  try {
    const result = await shell.exec('ffmpeg -version');
    expect(errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(onOutputChannel).toHaveBeenCalledWith(expect.objectContaining({ channelId: 4, resourceId: 'extra-output', direction: 'write' }), expect.objectContaining({ fs: expect.anything() }));
    expect(write).toHaveBeenCalledExactlyOnceWith(bytes);
    expect(close).not.toHaveBeenCalled();
    expect(result.stdout).toBe('fixture media output\n');
    expect(result.stderrBytes).toEqual(new Uint8Array());
  } finally { await shell.dispose(); }
});

it('rejects incomplete configuration without credentials, network or native fallback', () => {
  const fetch = vi.fn();
  expect(() => createRemoteMediaCommands({ service: 'https://media.test', fetch } as never)).toThrow('configuration');
  expect(fetch).not.toHaveBeenCalled();
});

it('refuses a backend without byte argv before opening a native session', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const transport = createTransport();
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const response = await transport(input, init);
    if (new URL(input instanceof Request ? input.url : input).pathname.endsWith('/capabilities')) {
      const capabilities = await response.json();
      capabilities.features = capabilities.features.filter((feature: string) => feature !== 'byte-argv');
      return Response.json(capabilities);
    }
    return response;
  });
  const errors: unknown[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {}, onInternalError(error) { errors.push(error); } })
    .use(createRemoteMediaCommands({ service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
      resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' }, fetch }));
  try {
    const result = await shell.exec('ffmpeg -help');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdoutBytes).toEqual(new Uint8Array());
    expect(String(errors[0])).toContain('byte argv');
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { await shell.dispose(); }
});

it.each([
  { token: Uint8Array.of(239, 187, 191, 32, 59, 36, 40, 41), accepted: true },
  { token: new Uint8Array(), accepted: true },
  { token: Uint8Array.of(255), accepted: false },
  { token: Uint8Array.of(192, 175), accepted: false },
  { token: Uint8Array.of(0), accepted: false },
])('negotiates UTF-8 argv without altering original bytes ($token, $accepted)', async ({token,accepted})=>{
 const {Shell,MemoryFileSystem}=await import('@poe-platform/safe-bash');
 const observe=vi.fn();const transport=createTransport({observe});const errors:unknown[]=[];
 const fetch=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
  const response=await transport(input,init);
  if(new URL(input instanceof Request?input.url:input).pathname.endsWith('/capabilities')){
   const capabilities=await response.json();
   capabilities.features=capabilities.features.filter((feature:string)=>feature!=='byte-argv');
   capabilities.features.push('utf8-argv');return Response.json(capabilities);
  }
  return response;
 });
 const shell=new Shell({fs:new MemoryFileSystem(),env:{},onInternalError(cause){errors.push(cause);}}).use(createRemoteMediaCommands({
  service:'https://media.test',authToken:'fixture',buildDigest:fixtureDigest,
  resource:{namespaceId:'work',logicalRoot:'/',rights:['read'],grantId:'g',profile:'live'},fetch,
 }));
 shell.commands.register({name:'original-argv',execute(context){
  const argumentValues=createCommandArguments([]).withValues([new TextEncoder().encode('-version'),token]);
  return shell.commands.get('ffmpeg')!.execute({...context,args:argumentValues.args,argumentValues});
 }});
 try{
  const result=await shell.exec('original-argv');
  if(accepted){expect(errors).toEqual([]);expect(result.exitCode).toBe(0);expect(observe).toHaveBeenCalledWith(expect.objectContaining({args:[Array.from(new TextEncoder().encode('-version')),Array.from(token)]}));}
  else{expect(result.exitCode).not.toBe(0);expect(String(errors[0])).toContain('argv');expect(fetch.mock.calls.every(([,init])=>!init?.method || init.method==='GET')).toBe(true);expect(observe).not.toHaveBeenCalled();}
 }finally{await shell.dispose();}
});

it('runs native byte argv through the actual remote protocol with progress outside native streams', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const output = Uint8Array.of(0, 255, 10);
  const observe = vi.fn(); const onProgress = vi.fn(); const errors: unknown[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { NATIVE: 'value' }, onInternalError(error) { errors.push(error); } }).use(createRemoteMediaCommands({ service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest, resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read', 'write'], grantId: 'host-issued', profile: 'live' }, fetch: createTransport({ observe, output }), onProgress }));
  const result = await shell.exec("ffmpeg -i pipe:0 -f null -", { stdin: Uint8Array.of(1, 2, 3) });
  expect(errors).toEqual([]);
  expect(result.exitCode).toBe(0);
  expect(result.stdoutBytes).toEqual(output);
  expect(result.stderrBytes).toEqual(new Uint8Array());
  expect(observe).toHaveBeenCalledWith(expect.objectContaining({ args: ['-i', 'pipe:0', '-f', 'null', '-'].map(value => Array.from(new TextEncoder().encode(value))), env: expect.objectContaining({ NATIVE: 'value' }) }));
  expect(onProgress).toHaveBeenCalledWith({ direction: 'upload', bytes: 3 });
  expect(onProgress).toHaveBeenCalledWith({ direction: 'download', bytes: 3 });
  await shell.dispose();
});

it('allows an explicitly configured provider to retain seekable backend descriptors', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input', Uint8Array.of(0, 255, 10));
  const errors: unknown[] = [];
  const shell = new Shell({ fs, env: {}, onInternalError(error) { errors.push(error); } }).use(createRemoteMediaCommands({ service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest, resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'host-issued', profile: 'live' }, provider: { module: new URL('../fixtures/native-provider.ts', import.meta.url).href } }));
  const result = await shell.exec('ffmpeg -i pipe:0 < /input');
  expect(errors).toEqual([]);
  expect(result.stdoutBytes).toEqual(Uint8Array.of(0, 255, 10));
  await shell.dispose();
});

it('stops pending stdin after native version exits without waiting for EOF', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  let release: (() => void) | undefined;
  const source = { [Symbol.asyncIterator]() { return {
    next() { return new Promise<IteratorResult<Uint8Array>>(resolve => { release = () => resolve({ done: true, value: undefined }); }); },
    async return() { release?.(); return { done: true as const, value: undefined }; },
  }; } };
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {} }).use(createRemoteMediaCommands({ service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest, resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'host-issued', profile: 'live' }, fetch: createTransport() }));
  const execution = shell.exec('ffmpeg -version', { stdin: source });
  let outcome: Awaited<typeof execution> | undefined;
  void execution.then(result => { outcome = result; });
  try {
    // Assert completion while next() remains pending. Polling returns as soon as
    // the result arrives without imposing a 100ms process-scheduling deadline.
    await vi.waitFor(() => expect(outcome).toMatchObject({ exitCode: 0, stdout: 'fixture media output\n' }), { timeout: 1000, interval: 1 });
  } finally { release?.(); await execution; await shell.dispose(); }
});

it.each(['ffmpeg -help', 'ffmpeg -version', 'ffmpeg -formats', 'ffprobe -help', 'ffprobe -version', 'identify -help', 'identify -list format', 'magick -version', 'convert -help'])('refuses incompatible server builds before running %s', async command => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ protocolMajor: 1, builds: [], features: [], limits: {
    maxJobs: 1, maxHandles: 1, maxArgvBytes: 1024, maxManifestEntries: 1, maxFrameBytes: 1024, maxInflightBytes: 2048, maxBlobBytes: 1024, maxReplayBytes: 2048, maxCallbacks: 1, maxNativeMemoryBytes: 1024, maxNativeProcesses: 1, maxJobDurationMs: 1000,
  }, requestStreaming: true, leaseMs: 1000, retentionMs: 1000 }), { headers: { 'Content-Type': 'application/json' } }));
  const plugin = createRemoteMediaCommands({ service: 'https://media.test', authToken: 'secret', buildDigest: 'sha256:' + 'a'.repeat(64), resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' }, fetch });
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const errors: unknown[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {}, onInternalError(error) { errors.push(error); } }).use(plugin);
  const result = await shell.exec(command);
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(String(errors[0])).toContain('pinned');
  expect(fetch).toHaveBeenCalledTimes(1);
  await shell.dispose();
});

it.each(['grammarRevision', 'sourceRevision', 'executables'] as const)('rejects pinned server %s drift before native help or session creation', async field => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const transport = createTransport();
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const response = await transport(input, init);
    const capabilities = await response.json();
    capabilities.builds[0][field] = field === 'executables' ? {} : 'incompatible';
    return Response.json(capabilities);
  });
  const errors: unknown[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {}, onInternalError(error) { errors.push(error); } })
    .use(createRemoteMediaCommands({ service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
      resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' }, fetch }));
  try {
    const result = await shell.exec('ffmpeg -help');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdoutBytes).toEqual(new Uint8Array());
    expect(String(errors[0])).toContain('pinned');
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { await shell.dispose(); }
});

it.each(['ffmpeg -help', 'ffprobe -version', 'identify -list format'])('returns the admitted server bytes unchanged for %s', async source => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const output = Uint8Array.of(255, 0, 13, 10);
  const fetch = vi.fn(createTransport({ output }));
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {} })
    .use(createRemoteMediaCommands({ service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
      resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' }, fetch }));
  try {
    expect(fetch).not.toHaveBeenCalled();
    const result = await shell.exec(source);
    expect(result.exitCode).toBe(0);
    expect(result.stdoutBytes).toEqual(output);
    expect(fetch).toHaveBeenCalled();
  } finally { await shell.dispose(); }
});

it('rechecks the pinned build after successful help instead of serving cached native output', async () => {
  const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
  const transport = createTransport();
  let incompatible = false;
  let capabilityRequests = 0;
  let sessionRequests = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const pathname = new URL(input instanceof Request ? input.url : input).pathname;
    const response = await transport(input, init);
    if (pathname.endsWith('/sessions') && init?.method === 'POST') sessionRequests++;
    if (!pathname.endsWith('/capabilities')) return response;
    capabilityRequests++;
    if (!incompatible) return response;
    const capabilities = await response.json();
    capabilities.builds[0].sourceRevision = 'incompatible';
    return Response.json(capabilities);
  };
  const errors: unknown[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem(), env: {}, onInternalError(error) { errors.push(error); } })
    .use(createRemoteMediaCommands({ service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
      resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read'], grantId: 'g', profile: 'live' }, fetch }));
  try {
    const admitted = await shell.exec('ffmpeg -help');
    expect(admitted.exitCode).toBe(0);
    expect(admitted.stdoutBytes.length).toBeGreaterThan(0);
    expect(sessionRequests).toBe(1);
    incompatible = true;
    const rejected = await shell.exec('ffmpeg -help');
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stdoutBytes).toEqual(new Uint8Array());
    expect(String(errors[0])).toContain('pinned');
    expect(capabilityRequests).toBe(2);
    expect(sessionRequests).toBe(1);
  } finally { await shell.dispose(); }
});
