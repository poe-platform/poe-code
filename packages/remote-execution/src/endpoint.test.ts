import { describe, expect, it, vi } from 'vitest';
import { createEndpointAccess, EndpointCapabilityGap, type EndpointContext, type EndpointProvider, type NativeEndpointRequest } from './index.js';
const context: EndpointContext = { network: 'caller-session', dns: 'caller-resolver', proxy: 'native-explicit', bind: 'caller-interfaces', tls: 'native-openssl', certificates: 'synthetic-ca-v1' };
it.each(['direct', 'relay'] as const)('keeps incomplete qualification evidence a gap on the %s path', async route => {
  for (const evidence of [
    ['mock-contract-only', ''],
    ['mock-contract-only', undefined],
    ['mock-contract-only', { length: 1 }],
    Object.assign(new Array(2), { 0: 'mock-contract-only' }),
  ]) {
    const p = provider(route);
    const qualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c, evidence })) } as EndpointProvider;
    const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
      providers: [qualified], admittedRelays: ['fixture'] });
    await expect(access.open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
    expect(p.open).not.toHaveBeenCalled();
    await access.close();
  }
});
it.each(['network', 'dns', 'proxy', 'bind', 'tls', 'certificates'] as const)('requires an admitted relay when only sandbox %s context differs', async field => {
  const direct = { ...provider('direct'), id: 'direct-fixture' };
  const relay = provider('relay');
  const sandbox = { ...context, [field]: 'sandbox-context' };
  const access = createEndpointAccess({ sandbox, providers: [direct, relay], admittedRelays: ['fixture'] });
  const lease = await access.open(request);
  expect(direct.open).not.toHaveBeenCalled();
  expect(relay.open).toHaveBeenCalledWith({ route: 'relay', request: { ...request, signal: expect.any(AbortSignal) } });
  await lease.close();
  relay.open.mockClear();
  await expect(createEndpointAccess({ sandbox, providers: [direct, relay] }).open(request))
    .rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(direct.open).not.toHaveBeenCalled();
  expect(relay.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('rejects empty native endpoint bytes despite shadowed length on the %s path', async route => {
  const p = provider(route);
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [p], admittedRelays: ['fixture'] });
  const endpoint = new Uint8Array();
  Object.defineProperty(endpoint, 'length', { value: 1 });
  await expect(access.open({ ...request, endpoint })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('rejects an empty %s qualification scope despite shadowed length', route => {
  const p = provider(route);
  const endpoint = new Uint8Array();
  Object.defineProperty(endpoint, 'length', { value: 1 });
  const scoped = { ...p, capabilities: p.capabilities.map(c => ({ ...c,
    transports: c.transports.map(t => ({ ...t, endpoint })),
  })) };
  expect(() => createEndpointAccess({ sandbox: context, providers: [scoped], admittedRelays: ['fixture'] }))
    .toThrow(EndpointCapabilityGap);
});
const request: NativeEndpointRequest = { buildDigest: 'selected-build', context, protocol: 'tcp', semantics: 'stream', operation: 'connect', endpoint: new TextEncoder().encode('tcp://localhost:9000'), options: [{ name: new TextEncoder().encode('timeout'), value: new TextEncoder().encode('100') }], stage: 'input' };
it.each(['direct', 'relay'] as const)('does not widen a stage-scoped %s receipt to another native execution stage', async route => {
  const p = provider(route);
  const qualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c,
    transports: c.transports.map(t => ({ ...t, stage: 'input' })),
  })) };
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [qualified], admittedRelays: ['fixture'] });
  await expect(access.open({ ...request, stage: 'output' })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
  const lease = await access.open(request);
  expect(p.open).toHaveBeenCalledWith({ route, request: { ...request, signal: expect.any(AbortSignal) } });
  await lease.close();
});
it.each(['', 42, null])('rejects malformed native execution stage qualification %s', stage => {
  const p = provider('direct');
  const qualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c,
    transports: c.transports.map(t => ({ ...t, stage })),
  })) };
  expect(() => createEndpointAccess({ sandbox: context, providers: [qualified as EndpointProvider] }))
    .toThrow(EndpointCapabilityGap);
});
it.each(['direct', 'relay'] as const)('does not let an overridden transport map synthesize %s qualifications', async route => {
  const p = provider(route);
  const transports = p.capabilities[0].transports.slice();
  const map = vi.fn(() => [{ protocol: 'udp', semantics: 'datagram' as const, operation: 'listen' as const, options: request.options }]);
  Object.defineProperty(transports, 'map', { value: map });
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [{ ...p, capabilities: [{ ...p.capabilities[0], transports }] }], admittedRelays: ['fixture'] });
  await expect(access.open({ ...request, protocol: 'udp', semantics: 'datagram', operation: 'listen' })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(map).not.toHaveBeenCalled();
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('does not substitute iterable options for indexed native options on the %s path', async route => {
  const p = provider(route);
  const options = [{ name: Buffer.from('timeout'), value: Buffer.from('101') }];
  options[Symbol.iterator] = () => request.options[Symbol.iterator]();
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [p], admittedRelays: ['fixture'] });
  await expect(access.open({ ...request, options })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('owns indexed qualification options without invoking their iterator on the %s path', async route => {
  const p = provider(route);
  const options = request.options.map(option => ({ ...option }));
  const iterator = vi.fn(() => [{ name: Buffer.from('timeout'), value: Buffer.from('101') }][Symbol.iterator]());
  options[Symbol.iterator] = iterator;
  const qualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c,
    transports: c.transports.map(t => ({ ...t, options })),
  })) };
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [qualified], admittedRelays: ['fixture'] });
  const lease = await access.open(request);
  await lease.close();
  expect(iterator).not.toHaveBeenCalled();
  expect(vi.mocked(p.open).mock.calls[0][0].request.options).toEqual(request.options);
});
it('does not admit relay identities supplied only by an array iterator', async () => {
  const p = provider('relay');
  const admittedRelays: string[] = [];
  admittedRelays[Symbol.iterator] = () => ['fixture'][Symbol.iterator]();
  const access = createEndpointAccess({ sandbox: { ...context, network: 'sandbox' }, providers: [p], admittedRelays });
  await expect(access.open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('does not qualify %s evidence supplied only by an array iterator', async route => {
  const p = provider(route);
  const evidence: string[] = [];
  evidence[Symbol.iterator] = () => ['mock-contract-only'][Symbol.iterator]();
  const qualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c, evidence })) };
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [qualified], admittedRelays: ['fixture'] });
  await expect(access.open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['network', 'dns', 'proxy', 'bind', 'tls', 'certificates'] as const)('requires defined sandbox %s context before admitting a relay', field => {
  const p = provider('relay');
  for (const value of ['', undefined, null, 1]) {
    expect(() => createEndpointAccess({
      sandbox: { ...context, [field]: value } as EndpointContext,
      providers: [p], admittedRelays: ['fixture'],
    })).toThrow(EndpointCapabilityGap);
  }
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('opens each observed native request once and preserves options on the %s path', async route => {
  const p = provider(route);
  const bytes = (value: string) => new TextEncoder().encode(value);
  // These are native observations, not discovery hints or HTTP emulation.
  const nativeOptions = [
    { name: bytes('headers'), value: bytes('X-Oracle: synthetic\r\n') },
    { name: bytes('cookies'), value: bytes('s=synthetic; domain=localhost; path=/') },
  ];
  const observed = [
    ['http://localhost/entry.m3u8?original=%2f+%FF', 'input'],
    ['http://localhost/nested/index.m3u8?token=synthetic', 'runtime'],
    ['http://localhost/nested/segment.ts', 'runtime'],
    ['http://other.invalid/segment.ts?sig=%2f+%FF', 'runtime'],
  ].map(([endpoint, stage]) => ({ ...request, endpoint: bytes(endpoint), stage, options: nativeOptions }));
  const qualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c,
    transports: observed.map(native => ({ protocol: native.protocol, semantics: native.semantics,
      operation: native.operation, endpoint: native.endpoint, options: native.options })),
  })) };
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [qualified], admittedRelays: ['fixture'] });
  expect(p.open).not.toHaveBeenCalled();
  for (const native of observed) {
    const lease = await access.open(native);
    await lease.close();
  }
  expect(vi.mocked(p.open).mock.calls.map(([input]) => input)).toEqual(observed.map(native => ({ route, request: { ...native, signal: expect.any(AbortSignal) } })));
});
it.each(['direct', 'relay'] as const)('rejects an absent endpoint identity before %s acquisition', async route => {
  const p = provider(route);
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] });
  await expect(access.open({ ...request, endpoint: new Uint8Array() })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('captures the %s qualification receipt fields only once', async route => {
  const p = provider(route);
  const receipt = p.capabilities[0];
  let contextReads = 0, transportReads = 0, evidenceReads = 0;
  const changing = { ...receipt,
    get context() { return ++contextReads === 1 ? context : { ...context, certificates: 'unqualified-ca' }; },
    get transports() { return ++transportReads === 1 ? receipt.transports : [{ protocol: 'srt', semantics: 'stream' as const, operation: 'connect' as const, options: request.options }]; },
    get evidence() { return ++evidenceReads === 1 ? receipt.evidence : ['substituted-receipt']; },
  };
  const access = createEndpointAccess({
    sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [{ ...p, capabilities: [changing] }], admittedRelays: ['fixture'],
  });
  await access.open(request);
  await expect(access.open({ ...request, protocol: 'srt', context: { ...context, certificates: 'unqualified-ca' } })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect([contextReads, transportReads, evidenceReads]).toEqual([1, 1, 1]);
  expect(p.open).toHaveBeenCalledTimes(1);
});
it.each(['direct', 'relay'] as const)('does not admit unqualified native options on the %s path', async route => {
  const p = provider(route);
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] });
  for (const options of [
    [{ name: new TextEncoder().encode('timeout'), value: new TextEncoder().encode('101') }],
    [...request.options, { name: new TextEncoder().encode('tls_verify'), value: new TextEncoder().encode('0') }],
    [...request.options, ...request.options],
  ]) await expect(access.open({ ...request, options })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('owns exact ordered option qualification on the %s path', async route => {
  const p = provider(route);
  const options = [
    { name: Buffer.from('bind'), value: Buffer.from('synthetic-interface') },
    { name: Buffer.from('tls_verify'), value: Buffer.from('1') },
    { name: Buffer.from('bind'), value: Buffer.from('synthetic-interface') },
  ];
  const original = options.map(option => ({ name: new Uint8Array(option.name), value: new Uint8Array(option.value) }));
  const qualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c,
    transports: [{ protocol: 'tcp' as const, semantics: 'stream' as const, operation: 'connect' as const, options }],
  })) };
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [qualified], admittedRelays: ['fixture'] });
  options[0].value.fill(0);
  await access.open({ ...request, options: original });
  await expect(access.open({ ...request, options })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  await expect(access.open({ ...request, options: [original[1], original[0], original[2]] })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).toHaveBeenCalledTimes(1);
  expect(vi.mocked(p.open).mock.calls[0][0].request.options).toEqual(original);
});
it.each(['direct', 'relay'] as const)('an option-free receipt qualifies only option-free %s requests', async route => {
  const p = provider(route);
  const qualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c,
    transports: [{ protocol: 'tcp' as const, semantics: 'stream' as const, operation: 'connect' as const }],
  })) };
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [qualified], admittedRelays: ['fixture'] });
  await expect(access.open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
  await access.open({ ...request, options: [] });
  expect(p.open).toHaveBeenCalledTimes(1);
});
it.each(['direct', 'relay'] as const)('rejects missing ordered native options before %s acquisition', async route => {
  const p = provider(route);
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] });
  for (const options of [new Array(1), [undefined], [null]]) {
    await expect(access.open({ ...request, options } as NativeEndpointRequest)).rejects.toBeInstanceOf(EndpointCapabilityGap);
  }
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('retires an acquired %s endpoint on later cancellation and retains cleanup failure', async route => {
  const p = provider(route), abort = new AbortController();
  const failure = new Error('synthetic listener retirement failure');
  const close = vi.fn(async () => { throw failure; });
  vi.mocked(p.open).mockResolvedValueOnce({ close });
  const lease = await createEndpointAccess({
    sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [p], admittedRelays: ['fixture'],
  }).open({ ...request, operation: 'listen', signal: abort.signal });
  abort.abort(new Error('synthetic cancellation after acquisition'));
  await Promise.resolve();
  expect(close).toHaveBeenCalledTimes(1);
  await expect(lease.close()).rejects.toBe(failure);
  expect(close).toHaveBeenCalledTimes(1);
});
it.each(['direct', 'relay'] as const)('does not let malformed receipts admit unsupported %s requests', async route => {
  for (const transport of [
    { protocol: '', semantics: 'stream', operation: 'connect' },
    { protocol: 'tcp', semantics: 'message', operation: 'connect' },
    { protocol: 'tcp', semantics: 'stream', operation: 'fetch' },
  ]) {
    const p = provider(route);
    const malformed = { ...p, capabilities: p.capabilities.map(c => ({ ...c, transports: [transport] })) } as EndpointProvider;
    const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [malformed], admittedRelays: ['fixture'] });
    await expect(access.open({ ...request, ...transport } as NativeEndpointRequest)).rejects.toBeInstanceOf(EndpointCapabilityGap);
    expect(p.open).not.toHaveBeenCalled();
  }
});
it.each(['direct', 'relay'] as const)('requires string qualification evidence on the %s path', async route => {
  const p = provider(route);
  const malformed = { ...p, capabilities: p.capabilities.map(c => ({ ...c, evidence: [{ length: 1 }] })) } as unknown as EndpointProvider;
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [malformed], admittedRelays: ['fixture'] });
  await expect(access.open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('requires a retireable native transport lease on the %s path', async route => {
  const p = provider(route);
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] });
  for (const lease of [undefined, null, {}, { close: 'unavailable' }]) {
    vi.mocked(p.open).mockResolvedValueOnce(lease as unknown as Awaited<ReturnType<EndpointProvider['open']>>);
    await expect(access.open(request)).rejects.toThrow('Endpoint provider must return a retireable transport lease');
  }
});
it.each(['direct', 'relay'] as const)('owns once-only transport retirement on the %s path', async route => {
  const p = provider(route);
  const close = vi.fn(async () => {});
  const nativeLease = { close };
  vi.mocked(p.open).mockResolvedValueOnce(nativeLease);
  const lease = await createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] }).open(request);
  nativeLease.close = vi.fn(async () => { throw new Error('Substituted retirement'); });
  await Promise.all([lease.close(), lease.close()]);
  expect(close).toHaveBeenCalledTimes(1);
  expect(close.mock.contexts[0]).toBe(nativeLease);
});
it.each(['direct', 'relay'] as const)('retains synchronous retirement failure without retry on the %s path', async route => {
  const p = provider(route);
  const failure = new Error('Synthetic transport retirement failure');
  const close = vi.fn(() => { throw failure; });
  vi.mocked(p.open).mockResolvedValueOnce({ close });
  const lease = await createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] }).open(request);
  const first = lease.close();
  const second = lease.close();
  expect(second).toBe(first);
  await expect(first).rejects.toBe(failure);
  await expect(second).rejects.toBe(failure);
  expect(close).toHaveBeenCalledTimes(1);
});
function provider(route: 'direct' | 'relay'): EndpointProvider {
  const transports: EndpointProvider['capabilities'][number]['transports'] = [
    { protocol: 'tcp', semantics: 'stream', operation: 'connect' },
    { protocol: 'tcp', semantics: 'stream', operation: 'listen' },
    { protocol: 'udp', semantics: 'datagram', operation: 'bind' },
  ];
  const optionSets = [
    request.options,
    [{ name: new TextEncoder().encode('header'), value: new TextEncoder().encode('synthetic') }],
    [{ name: new TextEncoder().encode('headers'), value: new TextEncoder().encode('X-Oracle: synthetic\r\n') }],
  ];
  return {
    id: 'fixture',
    capabilities: [{ buildDigest: 'selected-build', route, context,
      transports: transports.flatMap(transport => optionSets.map(options => ({ ...transport, options }))),
      evidence: ['mock-contract-only'],
    }],
    open: vi.fn(async () => ({ close: vi.fn(async () => {}) })),
  };
}
it.each(['direct', 'relay'] as const)('does not widen an endpoint-scoped %s receipt to another native identity', async route => {
  const p = provider(route);
  const endpoint = Buffer.from(request.endpoint);
  const scoped = { ...p, capabilities: p.capabilities.map(c => ({ ...c,
    transports: c.transports.map(t => ({ ...t, endpoint })),
  })) };
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [scoped], admittedRelays: ['fixture'] });
  endpoint.fill(0);
  await expect(access.open({ ...request, endpoint: new TextEncoder().encode('tcp://other.invalid:9000') })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
  await access.open(request);
  expect(p.open).toHaveBeenCalledTimes(1);
});
it.each(['direct', 'relay'] as const)('compares signed endpoint scope bytes exactly on the %s path', async route => {
  const p = provider(route);
  const endpoint = Uint8Array.from(Buffer.from('tcp://localhost:9000?sig=%2f+%FF&x=1&x=2'));
  const scoped = { ...p, capabilities: p.capabilities.map(c => ({ ...c,
    transports: c.transports.map(t => ({ ...t, endpoint })),
  })) };
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [scoped], admittedRelays: ['fixture'] });
  for (const changed of ['tcp://localhost:9000?sig=%2F+%FF&x=1&x=2', 'tcp://127.0.0.1:9000?sig=%2f+%FF&x=1&x=2']) {
    await expect(access.open({ ...request, endpoint: Buffer.from(changed) })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  }
  await access.open({ ...request, endpoint });
  expect(p.open).toHaveBeenCalledTimes(1);
});
it.each([new Uint8Array(), 'tcp://localhost:9000', [116, 99, 112]])('rejects malformed endpoint scope %j at admission', endpoint => {
  const p = provider('direct');
  const scoped = { ...p, capabilities: p.capabilities.map(c => ({ ...c,
    transports: c.transports.map(t => ({ ...t, endpoint })),
  })) } as unknown as EndpointProvider;
  expect(() => createEndpointAccess({ sandbox: context, providers: [scoped] })).toThrow(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('captures the %s provider identity once before admission', async route => {
  const p = provider(route);
  let reads = 0;
  const changing = { ...p, get id() { return ++reads === 1 ? 'unadmitted' : 'fixture'; } };
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [changing], admittedRelays: ['fixture'] });
  if (route === 'relay') await expect(access.open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
  else await access.open(request);
  expect(reads).toBe(1);
  expect(p.open).toHaveBeenCalledTimes(route === 'relay' ? 0 : 1);
});
it.each(['direct', 'relay'] as const)('rejects coercible native bytes on the %s path', async route => {
  const p = provider(route);
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] });
  for (const malformed of [
    { endpoint: 'tcp://localhost:9000' },
    { endpoint: [116, 99, 112] },
    { options: [{ name: 'timeout', value: request.options[0].value }] },
    { options: [{ name: request.options[0].name, value: [49, 48, 48] }] },
  ]) await expect(access.open({ ...request, ...malformed } as unknown as NativeEndpointRequest)).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});
describe('endpoint admission', () => {
  it.each(['direct', 'relay'] as const)('does not widen %s qualification when caller configuration changes', async route => {
    const p = provider(route);
    const transports: { protocol: string; semantics: NativeEndpointRequest['semantics']; operation: NativeEndpointRequest['operation'] }[] = [{ protocol: 'udp', semantics: 'datagram', operation: 'bind' }];
    const qualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c, transports })) };
    const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [qualified], admittedRelays: ['fixture'] });
    transports.push({ protocol: 'tcp', semantics: 'stream', operation: 'connect' });
    await expect(access.open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
    expect(p.open).not.toHaveBeenCalled();
  });
  it('does not admit a relay added after access creation', async () => {
    const p = provider('relay');
    const admittedRelays: string[] = [];
    const access = createEndpointAccess({ sandbox: { ...context, network: 'sandbox' }, providers: [p], admittedRelays });
    admittedRelays.push(p.id);
    await expect(access.open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
    expect(p.open).not.toHaveBeenCalled();
  });
  it.each(['direct', 'relay'] as const)('rejects another native build on the %s path', async route => {
    const p = provider(route);
    const qualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c, buildDigest: 'selected-build' })) };
    const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [qualified], admittedRelays: ['fixture'] });
    await expect(access.open({ ...request, buildDigest: 'another-build' } as NativeEndpointRequest)).rejects.toBeInstanceOf(EndpointCapabilityGap);
    expect(p.open).not.toHaveBeenCalled();
  });
  it('does not open anything until the native stage', async () => {
    const p = provider('direct');
    const access = createEndpointAccess({ sandbox: context, providers: [p] });
    expect(p.open).not.toHaveBeenCalled();
    await access.open(request);
    expect(p.open).toHaveBeenCalledWith(expect.objectContaining({ route: 'direct', request: { ...request, signal: expect.any(AbortSignal) } }));
  });
  it('never reinterprets caller localhost as sandbox localhost', async () => {
    const p = provider('direct');
    const access = createEndpointAccess({ sandbox: { ...context, network: 'sandbox' }, providers: [p] });
    await expect(access.open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
    expect(p.open).not.toHaveBeenCalled();
  });
  it('requires explicit admission of the relay provider', async () => {
    const p = provider('relay');
    const config = { sandbox: { ...context, network: 'sandbox' }, providers: [p] };
    await expect(createEndpointAccess(config).open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
    await createEndpointAccess({ ...config, admittedRelays: ['fixture'] }).open(request);
    expect(p.open).toHaveBeenCalledWith({ route: 'relay', request: { ...request, signal: expect.any(AbortSignal) } });
  });
  it.each(['dns', 'proxy', 'bind', 'tls', 'certificates'] as const)('fails closed on mismatched %s context', async field => {
    const p = provider('relay');
    const access = createEndpointAccess({ sandbox: context, providers: [p], admittedRelays: ['fixture'] });
    await expect(access.open({ ...request, context: { ...context, [field]: 'other' } })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  });
  it.each([{ protocol: 'srt' }, { operation: 'multicast' }, { semantics: 'message' }])('reports unsupported requirements %j', async changes => {
    const p = provider('direct');
    await expect(createEndpointAccess({ sandbox: context, providers: [p] }).open({ ...request, ...changes } as NativeEndpointRequest)).rejects.toBeInstanceOf(EndpointCapabilityGap);
  });
  it('does not retry or fall back after a network failure', async () => {
    const first = provider('direct'), second = { ...provider('direct'), id: 'second-fixture' };
    const failure = new Error('synthetic connection reset');
    vi.mocked(first.open).mockRejectedValue(failure);
    await expect(createEndpointAccess({ sandbox: context, providers: [first, second] }).open(request)).rejects.toBe(failure);
    expect(first.open).toHaveBeenCalledTimes(1);
    expect(second.open).not.toHaveBeenCalled();
  });
  it('does not admit evidence-free capabilities', async () => {
    const p = provider('direct');
    const unqualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c, evidence: [] })) };
    await expect(createEndpointAccess({ sandbox: context, providers: [unqualified] }).open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
  });
});

it.each(['direct', 'relay'] as const)('preserves native request bytes and listen/bind semantics on the %s provider path', async route => {
  const p = provider(route);
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] });
  for (const [protocol, semantics, operation] of [['tcp', 'stream', 'listen'], ['udp', 'datagram', 'bind']] as const) {
    const native = { ...request, protocol, semantics, operation, endpoint: Uint8Array.of(116, 99, 112, 58, 255), stage: 'runtime' };
    await access.open(native);
    const observed = vi.mocked(p.open).mock.calls.at(-1)![0];
    expect(observed).toEqual({ route, request: { ...native, signal: expect.any(AbortSignal) } });
    expect(observed.request.endpoint).not.toBe(native.endpoint);
    expect(observed.request.options[0].value).not.toBe(native.options[0].value);
  }
});
it('retires a lease acquired while cancellation was pending', async () => {
  const p = provider('direct'), abort = new AbortController();
  const close = vi.fn(async () => {});
  vi.mocked(p.open).mockImplementationOnce(async () => { abort.abort(new Error('cancel during open')); return { close }; });
  await expect(createEndpointAccess({ sandbox: context, providers: [p] }).open({ ...request, signal: abort.signal })).rejects.toThrow('cancel during open');
  expect(close).toHaveBeenCalledTimes(1);
});
it.each(['direct', 'relay'] as const)('retains the admitted cancellation signal during %s acquisition', async route => {
  const p = provider(route), abort = new AbortController();
  const native = { ...request, signal: abort.signal as AbortSignal | undefined };
  const close = vi.fn(async () => {});
  vi.mocked(p.open).mockImplementationOnce(async () => {
    native.signal = undefined;
    abort.abort(new Error('synthetic cancellation'));
    return { close };
  });
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] });
  await expect(access.open(native)).rejects.toThrow('synthetic cancellation');
  expect(close).toHaveBeenCalledTimes(1);
});
it.each(['direct', 'relay'] as const)('owns Buffer request bytes on the %s path', async route => {
  const p = provider(route);
  const endpoint = Buffer.from('tcp://localhost:9000?sig=%2f+X');
  const value = Buffer.from('synthetic');
  vi.mocked(p.open).mockImplementationOnce(async input => {
    endpoint.fill(0); value.fill(0);
    expect(new TextDecoder().decode(input.request.endpoint)).toBe('tcp://localhost:9000?sig=%2f+X');
    expect(new TextDecoder().decode(input.request.options[0].value)).toBe('synthetic');
    return { close: async () => {} };
  });
  await createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] }).open({ ...request, endpoint, options: [{ name: Buffer.from('header'), value }] });
});

it('rejects ambiguous relay provider identities before admission', () => {
  const admitted = provider('relay');
  const other = provider('relay');
  expect(() => createEndpointAccess({
    sandbox: { ...context, network: 'sandbox' },
    providers: [admitted, other], admittedRelays: [admitted.id],
  })).toThrow('Endpoint provider identities must be nonempty and unique');
  expect(admitted.open).not.toHaveBeenCalled();
  expect(other.open).not.toHaveBeenCalled();
});
it('rejects an unnamed endpoint provider', () => {
  expect(() => createEndpointAccess({ sandbox: context, providers: [{ ...provider('direct'), id: '' }] }))
    .toThrow('Endpoint provider identities must be nonempty and unique');
});

it.each(['direct', 'relay'] as const)('dispatches only the protocol qualified for the %s request', async route => {
  const p = provider(route);
  let reads = 0;
  const native = { ...request, get protocol() { return ++reads === 1 ? 'tcp' : 'srt'; } };
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] });
  await access.open(native);
  expect(vi.mocked(p.open).mock.calls[0][0].request.protocol).toBe('tcp');
});

it('retains cancellation and synchronous lease retirement failures', async () => {
  const p = provider('direct'), abort = new AbortController();
  const canceled = new Error('synthetic cancellation');
  const retirement = new Error('synthetic synchronous retirement failure');
  vi.mocked(p.open).mockImplementationOnce(async () => {
    abort.abort(canceled);
    return { close: () => { throw retirement; } };
  });
  const error = await createEndpointAccess({ sandbox: context, providers: [p] }).open({ ...request, signal: abort.signal }).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([canceled, retirement]);
});

it.each(['direct', 'relay'] as const)('captures original URL, options and context once on the %s path', async route => {
  const p = provider(route);
  let endpointReads = 0, optionReads = 0, contextReads = 0;
  const endpoint = new TextEncoder().encode('tcp://localhost:9000?sig=%2f+%FF&x=1&x=2');
  const options = [{ name: new TextEncoder().encode('headers'), value: new TextEncoder().encode('X-Oracle: synthetic\r\n') }];
  const native = {
    ...request,
    get endpoint() { return ++endpointReads === 1 ? endpoint : Buffer.from('tcp://other.invalid:9000'); },
    get options() { return ++optionReads === 1 ? options : []; },
    get context() { return ++contextReads === 1 ? context : { ...context, dns: 'other-resolver' }; },
  };
  await createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] }).open(native);
  expect(vi.mocked(p.open).mock.calls[0][0]).toEqual({ route, request: { ...request, endpoint, options, signal: expect.any(AbortSignal) } });
  expect([endpointReads, optionReads, contextReads]).toEqual([1, 1, 1]);
});

// A receipt for TCP streams and UDP packets does not qualify their cross-product.
it.each(['direct', 'relay'] as const)('rejects unqualified transport combinations on the %s path', async route => {
  const p = provider(route);
  const qualified = { ...p, capabilities: p.capabilities.map(c => ({ ...c,
    transports: [
      { protocol: 'tcp', semantics: 'stream', operation: 'connect' },
      { protocol: 'udp', semantics: 'datagram', operation: 'bind' },
    ],
  })) } as EndpointProvider;
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [qualified], admittedRelays: ['fixture'] });
  await expect(access.open({ ...request, protocol: 'udp', semantics: 'stream', operation: 'connect' })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});
it.each(['direct', 'relay'] as const)('rejects missing native execution stage on the %s path', async route => {
  const p = provider(route);
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' }, providers: [p], admittedRelays: ['fixture'] });
  await expect(access.open({ ...request, stage: '' })).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});

// Iterability is not qualification: a string must not become character receipts.
it.each(['direct', 'relay'] as const)('rejects non-array evidence on the %s provider path', async route => {
  const p = provider(route);
  const malformed = { ...p, capabilities: p.capabilities.map(c => ({ ...c, evidence: 'mock-contract-only' })) } as unknown as EndpointProvider;
  const access = createEndpointAccess({ sandbox: route === 'direct' ? context : { ...context, network: 'sandbox' },
    providers: [malformed], admittedRelays: ['fixture'] });
  await expect(access.open(request)).rejects.toBeInstanceOf(EndpointCapabilityGap);
  expect(p.open).not.toHaveBeenCalled();
});

it('rejects a string relay admission rather than admitting its characters', () => {
  const p = { ...provider('relay'), id: 'f' };
  expect(() => createEndpointAccess({
    sandbox: { ...context, network: 'sandbox' }, providers: [p],
    admittedRelays: 'fixture' as unknown as readonly string[],
  })).toThrow('Relay admission must be an array of nonempty provider identities');
  expect(p.open).not.toHaveBeenCalled();
});

it.each([null, new Set(['fixture']), [''], [undefined], new Array(1)])('rejects malformed relay admission %s', admittedRelays => {
  expect(() => createEndpointAccess({
    sandbox: context, providers: [], admittedRelays: admittedRelays as unknown as readonly string[],
  })).toThrow('Relay admission must be an array of nonempty provider identities');
});

it('qualifies the same relay identities that it captured from an admission array', async () => {
  const p = provider('relay');
  let reads = 0;
  const admittedRelays: string[] = [];
  Object.defineProperty(admittedRelays, 0, { get: () => ++reads === 1 ? p.id : 'other' });
  const access = createEndpointAccess({
    sandbox: { ...context, network: 'sandbox' }, providers: [p], admittedRelays,
  });
  const lease = await access.open(request);
  expect(reads).toBe(1);
  expect(p.open).toHaveBeenCalledTimes(1);
  await lease.close();
});
