import { expect, it, vi } from 'vitest';
import { createEndpointAccess, type EndpointContext, type EndpointProvider, type NativeEndpointRequest } from './endpoint.js';
const context: EndpointContext = { network: 'caller', dns: 'resolver', proxy: 'none', bind: 'caller', tls: 'native', certificates: 'synthetic-ca' };
const request: NativeEndpointRequest = { buildDigest: 'fixture', context, protocol: 'tcp', semantics: 'stream', operation: 'listen', endpoint: new TextEncoder().encode('tcp://localhost:9000?listen=1'), options: [], stage: 'output' };
function fixture(route: 'direct' | 'relay') {
  const close = vi.fn(async () => {});
  const provider: EndpointProvider = { id: 'fixture', capabilities: [{ buildDigest: 'fixture', route, context,
    transports: [{ protocol: 'tcp', semantics: 'stream', operation: 'listen' }], evidence: ['mock listener fixture only'] }],
    open: vi.fn(async () => ({ close })) };
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [provider], admittedRelays: ['fixture'] });
  return { access, provider, close };
}
it.each(['direct', 'relay'] as const)('cancels pending %s native listener acquisition during shutdown', async route => {
  const { access, provider } = fixture(route);
  let signal: AbortSignal | undefined;
  let release!: () => void;
  vi.mocked(provider.open).mockImplementationOnce(async input => {
    signal = input.request.signal;
    await new Promise<void>(resolve => {
      release = resolve;
      signal?.addEventListener('abort', resolve.bind(null, undefined), { once: true });
    });
    signal?.throwIfAborted();
    return { close: async () => {} };
  });
  const opening = access.open(request);
  // Observe rejection immediately; shutdown owns cancellation, not the caller.
  const outcome = opening.then(() => undefined, error => error);
  const closing = access.close();
  try {
    await Promise.resolve();
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
  } finally {
    release();
    await closing;
    expect(await outcome).toBe(signal?.reason);
  }
});
it.each(['direct', 'relay'] as const)('retires owned %s listeners once and closes acquisition admission', async route => {
  const { access, provider, close } = fixture(route);
  const lease = await access.open(request);
  const first = access.close();
  expect(access.close()).toBe(first);
  await first;
  await lease.close();
  expect(close).toHaveBeenCalledTimes(1);
  await expect(access.open(request)).rejects.toThrow('Endpoint access is retiring');
  expect(provider.open).toHaveBeenCalledTimes(1);
});
it.each(['direct', 'relay'] as const)('drains pending %s acquisitions before retirement completes', async route => {
  const { access, provider, close } = fixture(route);
  let acquired!: (lease: { close(): Promise<void> }) => void;
  vi.mocked(provider.open).mockImplementationOnce(() => new Promise(resolve => { acquired = resolve; }));
  const opening = access.open(request);
  await Promise.resolve();
  const closing = access.close();
  const rejected = expect(opening).rejects.toThrow('Endpoint access is retiring');
  acquired({ close });
  await rejected;
  await closing;
  expect(close).toHaveBeenCalledTimes(1);
});
it.each(['direct', 'relay'] as const)('drains every %s listener and retains retirement failures', async route => {
  const { access, provider, close } = fixture(route);
  const failure = new Error('synthetic listener retirement failure');
  close.mockRejectedValueOnce(failure);
  const other = vi.fn(async () => {});
  await access.open(request);
  vi.mocked(provider.open).mockResolvedValueOnce({ close: other });
  await access.open(request);
  await expect(access.close()).rejects.toThrow(AggregateError);
  await expect(access.close()).rejects.toMatchObject({ errors: [failure] });
  expect(close).toHaveBeenCalledTimes(1);
  expect(other).toHaveBeenCalledTimes(1);
});
it.each(['direct', 'relay'] as const)('retains failed explicit %s retirement at invocation cleanup', async route => {
  const { access, close } = fixture(route);
  const failure = new Error('synthetic explicit retirement failure');
  close.mockRejectedValueOnce(failure);
  const lease = await access.open(request);
  await expect(lease.close()).rejects.toBe(failure);
  await expect(access.close()).rejects.toMatchObject({ errors: [failure] });
  expect(close).toHaveBeenCalledTimes(1);
});
it.each(['direct', 'relay'] as const)('retains acquisition-time %s URL bytes before yielding', async route => {
  const { access, provider } = fixture(route);
  const endpoint = new Uint8Array(request.endpoint);
  const opening = access.open({ ...request, endpoint });
  endpoint.fill(0);
  await opening;
  expect(vi.mocked(provider.open).mock.calls[0][0].request.endpoint).toEqual(request.endpoint);
  await access.close();
});
it.each(['direct', 'relay'] as const)('starts established %s retirement while acquisitions are pending', async route => {
  const { access, provider, close } = fixture(route);
  await access.open(request);
  let acquired!: (lease: { close(): Promise<void> }) => void;
  vi.mocked(provider.open).mockImplementationOnce(() => new Promise(resolve => { acquired = resolve; }));
  const opening = access.open(request);
  const rejected = expect(opening).rejects.toThrow('Endpoint access is retiring');
  const closing = access.close();
  try {
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    acquired({ close: vi.fn(async () => {}) });
    await rejected;
    await closing;
  }
});
