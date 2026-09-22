import { expect, it, vi } from 'vitest';
import { MemoryFileSystem } from '@poe-platform/safe-bash';
import { createCanonicalWorkerRuntime, runtime as deploymentRuntime } from '../deploy/runtime.js';
import { createWorkerShell } from '../deploy/composition.js';

it('refuses deployment execution without a qualified canonical backend', async () => {
  const persistNative = vi.fn();
  const client = { execute: vi.fn() };
  await expect(deploymentRuntime({
    principal: { namespaceId: 'authenticated-caller', expiresAt: Date.now() + 60000 },
    client: client as never,
    signal: new AbortController().signal,
    commandKey: 'command',
    persistNative,
  })).rejects.toThrow('explicit qualified canonical filesystem');
  expect(client.execute).not.toHaveBeenCalled();
  expect(persistNative).not.toHaveBeenCalled();
});

it('binds native invocations to the explicitly acquired caller filesystem', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/marker', new Uint8Array([42]));
  const bytes = new Uint8Array([0, 128, 255]);
  const close = vi.fn(async () => {});
  const acquire = vi.fn(async () => ({ fs, close, async bind(request: import('./engine.js').MediaEngineRequest) {
    expect(await request.fs.stat!('/marker')).toEqual(await fs.stat('/marker'));
    return { invocation: {
      sessionId: 'caller', epoch: 'e', buildId: 'build', sourceAuthorityId: 'source', bindingId: 'grant',
      materializationId: 'materialization', manifestId: 'manifest', manifestRevision: 'r', directoryRevision: 'd',
    }, job: { async execute() {
      await request.stdout.write(bytes);
      return { exitCode: 0 };
    } } };
  } }));
  const input = { principal: { namespaceId: 'verified-caller', expiresAt: Date.now() + 60000 }, client: {} as never, signal: new AbortController().signal, commandKey: 'command', persistNative: vi.fn() };
  const runtime = await createCanonicalWorkerRuntime(acquire)(input);
  expect(acquire).toHaveBeenCalledWith(input);
  const shell = createWorkerShell(runtime);
  expect((await shell.exec('ffmpeg -version > /out')).exitCode).toBe(0);
  expect(await fs.readFile('/out')).toEqual(bytes);
  await shell.dispose();
  await runtime.close();
  expect(close).toHaveBeenCalledOnce();
});

it('rejects a canonical lease without filesystem authority and retires it', async () => {
  const close = vi.fn(async () => {});
  const runtime = createCanonicalWorkerRuntime(async () => ({ fs: undefined, close, bind: vi.fn() }) as never);
  await expect(runtime({ principal: { namespaceId: 'caller', expiresAt: Date.now() + 1000 }, client: {} as never, signal: new AbortController().signal, commandKey: 'one', persistNative: vi.fn() })).rejects.toThrow('canonical');
  expect(close).toHaveBeenCalledOnce();
});

it('retires a lease acquired after the request was canceled', async () => {
  const controller = new AbortController();
  const close = vi.fn(async () => {});
  const runtime = createCanonicalWorkerRuntime(async () => {
    controller.abort(new Error('disconnect'));
    return { fs: new MemoryFileSystem(), close, bind: vi.fn() };
  });
  await expect(runtime({ principal: { namespaceId: 'caller', expiresAt: Date.now() + 1000 }, client: {} as never, signal: controller.signal, commandKey: 'one', persistNative: vi.fn() })).rejects.toThrow('disconnect');
  expect(close).toHaveBeenCalledOnce();
});
