import { expect, it, vi } from 'vitest';
import { relayTransport, type RelayPort, type TransportFrame } from './relay.js';
it.each(['stream', 'datagram'] as const)('bounds the actual %s payload despite shadowed byteLength metadata', async semantics => {
  const payload = new Uint8Array(1024 * 1024 + 1);
  Object.defineProperty(payload, 'byteLength', { value: 1 });
  const frame: TransportFrame = semantics === 'stream' ? { kind: 'bytes', payload }
    : { kind: 'datagram', payload, source: 'caller:100', destination: 'peer:200' };
  const left = port([frame]), right = port([]);
  await expect(relayTransport(semantics, left, right)).rejects.toThrow('Relay frame exceeds transport limit');
  expect(right.send).not.toHaveBeenCalled();
  expect(left.close).toHaveBeenCalledTimes(1);
  expect(right.close).toHaveBeenCalledTimes(1);
});
function port(frames: TransportFrame[]): RelayPort {
  return { receive: vi.fn(async () => frames.shift() ?? null), send: vi.fn(async () => {}), close: vi.fn(async () => {}) };
}
it.each(['stream', 'datagram'] as const)('preserves an undefined adapter failure on the %s path', async semantics => {
  const left = port([]), right = port([]);
  vi.mocked(left.receive).mockRejectedValueOnce(undefined);
  await expect(relayTransport(semantics, left, right)).rejects.toBeUndefined();
  expect(left.close).toHaveBeenCalledTimes(1);
  expect(right.close).toHaveBeenCalledTimes(1);
});

it('retains an undefined transport failure alongside retirement failure', async () => {
  const left = port([]), right = port([]);
  const retirement = new Error('synthetic retirement failure');
  vi.mocked(left.receive).mockRejectedValueOnce(undefined);
  vi.mocked(right.close).mockRejectedValueOnce(retirement);
  const error = await relayTransport('stream', left, right).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([undefined, retirement]);
});
it.each(['stream', 'datagram'] as const)('retains the admitted %s port methods throughout forwarding and retirement', async semantics => {
  const frame: TransportFrame = semantics === 'stream'
    ? { kind: 'bytes', payload: Uint8Array.of(1) }
    : { kind: 'datagram', payload: Uint8Array.of(1), source: 'caller:100', destination: 'peer:200' };
  const left = port([frame, frame]), right = port([]);
  const receive = left.receive, send = right.send, closeLeft = left.close, closeRight = right.close;
  const substitutedReceive = vi.fn(async () => null);
  const substitutedSend = vi.fn(async () => {});
  const substitutedClose = vi.fn(async () => {});
  vi.mocked(send).mockImplementationOnce(async () => {
    left.receive = substitutedReceive;
    right.send = substitutedSend;
    left.close = substitutedClose;
    right.close = substitutedClose;
  });
  await relayTransport(semantics, left, right);
  expect(receive).toHaveBeenCalledTimes(3);
  expect(send).toHaveBeenCalledTimes(2);
  expect(closeLeft).toHaveBeenCalledTimes(1);
  expect(closeRight).toHaveBeenCalledTimes(1);
  expect(substitutedReceive).not.toHaveBeenCalled();
  expect(substitutedSend).not.toHaveBeenCalled();
  expect(substitutedClose).not.toHaveBeenCalled();
  expect(vi.mocked(receive).mock.contexts.every(value => value === left)).toBe(true);
  expect(vi.mocked(send).mock.contexts.every(value => value === right)).toBe(true);
});
it.each(['stream', 'datagram'] as const)('rejects oversized %s frames before copying or sending', async semantics => {
  const payload = new Uint8Array(1024 * 1024 + 1);
  const frame: TransportFrame = semantics === 'stream' ? { kind: 'bytes', payload }
    : { kind: 'datagram', payload, source: 'caller:100', destination: 'peer:200' };
  const left = port([frame]), right = port([]);
  await expect(relayTransport(semantics, left, right)).rejects.toThrow('Relay frame exceeds transport limit');
  expect(right.send).not.toHaveBeenCalled();
  expect(left.close).toHaveBeenCalledTimes(1);
  expect(right.close).toHaveBeenCalledTimes(1);
});
it.each(['stream', 'datagram'] as const)('preserves a %s frame at the transport size limit', async semantics => {
  const payload = new Uint8Array(1024 * 1024);
  const frame: TransportFrame = semantics === 'stream' ? { kind: 'bytes', payload }
    : { kind: 'datagram', payload, source: 'caller:100', destination: 'peer:200' };
  const left = port([frame]), right = port([]);
  await relayTransport(semantics, left, right);
  expect(right.send).toHaveBeenCalledTimes(1);
  const sent = vi.mocked(right.send).mock.calls[0][0];
  expect(sent.kind === 'end' ? undefined : sent.payload.length).toBe(payload.length);
});
it('forwards the same datagram identities that it validated', async () => {
  let reads = 0;
  const frame: TransportFrame = {
    kind: 'datagram', payload: Uint8Array.of(1),
    get source() { return ++reads <= 2 ? 'caller:100' : ''; },
    destination: 'peer:200',
  };
  const left = port([frame]), right = port([]);
  await relayTransport('datagram', left, right);
  expect(vi.mocked(right.send).mock.calls[0][0]).toEqual({
    kind: 'datagram', payload: Uint8Array.of(1), source: 'caller:100', destination: 'peer:200',
  });
});
it('rejects unavailable transport semantics even when ports have no frames', async () => {
  const left = port([]), right = port([]);
  await expect(relayTransport('message' as 'stream', left, right)).rejects.toThrow('semantics');
  expect(left.receive).not.toHaveBeenCalled();
  expect(right.receive).not.toHaveBeenCalled();
  expect(left.close).toHaveBeenCalledTimes(1);
  expect(right.close).toHaveBeenCalledTimes(1);
});
it.each([
  ['stream', { kind: 'packet', payload: Uint8Array.of(1) }],
  ['stream', { kind: 'bytes', payload: [1, 2] }],
  ['datagram', { kind: 'datagram', payload: Uint8Array.of(1), destination: 'peer:200' }],
  ['datagram', { kind: 'datagram', payload: Uint8Array.of(1), source: 'caller:100', destination: '' }],
] as const)('rejects malformed %s frames before forwarding', async (semantics, frame) => {
  const left = port([frame as unknown as TransportFrame]), right = port([]);
  await expect(relayTransport(semantics, left, right)).rejects.toThrow('Relay frame');
  expect(right.send).not.toHaveBeenCalled();
  expect(left.close).toHaveBeenCalledTimes(1);
  expect(right.close).toHaveBeenCalledTimes(1);
});
it('retires both ports when an adapter throws synchronously during cleanup', async () => {
  const left = port([]), right = port([]);
  const failure = new Error('synthetic synchronous retirement failure');
  vi.mocked(left.close).mockImplementationOnce(() => { throw failure; });
  await expect(relayTransport('datagram', left, right)).rejects.toBe(failure);
  expect(right.close).toHaveBeenCalledTimes(1);
});
it('reports transport and both retirement failures together', async () => {
  const left = port([{ kind: 'bytes', payload: Uint8Array.of(1) }]), right = port([]);
  const failure = new Error('synthetic reset');
  const leftFailure = new Error('left retirement failed'), rightFailure = new Error('right retirement failed');
  vi.mocked(right.send).mockRejectedValueOnce(failure);
  vi.mocked(left.close).mockRejectedValueOnce(leftFailure);
  vi.mocked(right.close).mockRejectedValueOnce(rightFailure);
  const error = await relayTransport('stream', left, right).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([failure, leftFailure, rightFailure]);
  expect(left.close).toHaveBeenCalledTimes(1);
  expect(right.close).toHaveBeenCalledTimes(1);
});
it('preserves UDP datagram boundaries, empty packets and endpoint identities', async () => {
  const frames: TransportFrame[] = [
    { kind: 'datagram', payload: Uint8Array.of(1, 2), source: '127.0.0.1:100', destination: '127.0.0.1:200' },
    { kind: 'datagram', payload: new Uint8Array(), source: '[::1]:100', destination: '[::1]:200' },
    { kind: 'datagram', payload: Uint8Array.of(3), source: '127.0.0.1:101', destination: '127.0.0.1:200' },
  ];
  const left = port([...frames]), right = port([]);
  await relayTransport('datagram', left, right);
  expect(vi.mocked(right.send).mock.calls.map(c => c[0])).toEqual(frames);
  expect(vi.mocked(right.send).mock.calls[0][0]).not.toBe(frames[0]);
});
it.each(['stream', 'datagram'] as const)('owns Buffer payloads under %s backpressure', async semantics => {
  const payload = Buffer.from([1, 2]);
  const frame: TransportFrame = semantics === 'stream' ? { kind: 'bytes', payload } : { kind: 'datagram', payload, source: 'a', destination: 'b' };
  const left = port([frame]), right = port([]);
  vi.mocked(right.send).mockImplementationOnce(async received => {
    payload.fill(0);
    expect(received.kind === 'end' ? undefined : [...received.payload]).toEqual([1, 2]);
  });
  await relayTransport(semantics, left, right);
});
it('preserves stream half-close independently in each direction', async () => {
  const left = port([{ kind: 'bytes', payload: Uint8Array.of(1) }, { kind: 'end' }]);
  const right = port([{ kind: 'bytes', payload: Uint8Array.of(2) }, { kind: 'end' }]);
  await relayTransport('stream', left, right);
  expect(right.send).toHaveBeenNthCalledWith(2, { kind: 'end' }, expect.any(AbortSignal));
  expect(left.send).toHaveBeenNthCalledWith(1, { kind: 'bytes', payload: Uint8Array.of(2) }, expect.any(AbortSignal));
  expect(left.close).toHaveBeenCalledTimes(1);
  expect(right.close).toHaveBeenCalledTimes(1);
});
it('applies backpressure before reading the next frame', async () => {
  const left = port([{ kind: 'bytes', payload: Uint8Array.of(1) }, { kind: 'end' }]), right = port([]);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(right.send).mockImplementationOnce(async () => { await blocked; });
  const done = relayTransport('stream', left, right);
  await vi.waitFor(() => expect(right.send).toHaveBeenCalledTimes(1));
  expect(left.receive).toHaveBeenCalledTimes(1);
  release();
  await done;
});
it('does not convert datagrams into a byte stream', async () => {
  const left = port([{ kind: 'datagram', payload: Uint8Array.of(1), source: 'a', destination: 'b' }]), right = port([]);
  await expect(relayTransport('stream', left, right)).rejects.toThrow('semantics');
  expect(right.send).not.toHaveBeenCalled();
  expect(left.close).toHaveBeenCalledTimes(1);
});
it('propagates network failure without retrying or losing cleanup', async () => {
  const left = port([{ kind: 'bytes', payload: Uint8Array.of(1) }]), right = port([]);
  const error = new Error('synthetic reset');
  vi.mocked(right.send).mockRejectedValueOnce(error);
  await expect(relayTransport('stream', left, right)).rejects.toBe(error);
  expect(right.send).toHaveBeenCalledTimes(1);
  expect(left.close).toHaveBeenCalledTimes(1);
  expect(right.close).toHaveBeenCalledTimes(1);
});
it('rejects bytes after stream half-close', async () => {
  const left = port([{ kind: 'end' }, { kind: 'bytes', payload: Uint8Array.of(1) }]), right = port([]);
  await expect(relayTransport('stream', left, right)).rejects.toThrow('half-close');
});
it('cancels pending reads and retires both ports', async () => {
  const left = port([]), right = port([]), abort = new AbortController();
  vi.mocked(left.receive).mockImplementation(signal => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }));
  const done = relayTransport('stream', left, right, abort.signal);
  abort.abort(new Error('synthetic cancellation'));
  await expect(done).rejects.toThrow('synthetic cancellation');
  expect(left.close).toHaveBeenCalledTimes(1);
  expect(right.close).toHaveBeenCalledTimes(1);
});
it.each(['stream', 'datagram'] as const)('does not send a %s frame received concurrently with cancellation', async semantics => {
  const left = port([]), right = port([]), abort = new AbortController();
  const frame: TransportFrame = semantics === 'stream'
    ? { kind: 'bytes', payload: Uint8Array.of(1) }
    : { kind: 'datagram', payload: Uint8Array.of(1), source: 'caller:100', destination: 'peer:200' };
  vi.mocked(left.receive).mockImplementationOnce(async () => {
    abort.abort(new Error('cancel during receive'));
    return frame;
  });
  await expect(relayTransport(semantics, left, right, abort.signal)).rejects.toThrow('cancel during receive');
  expect(right.send).not.toHaveBeenCalled();
  expect(left.close).toHaveBeenCalledTimes(1);
  expect(right.close).toHaveBeenCalledTimes(1);
});

it.each(['stream', 'datagram'] as const)('does not send a %s frame canceled while capturing its native metadata', async semantics => {
  const left = port([]), right = port([]), abort = new AbortController();
  const canceled = new Error('cancel during native metadata capture');
  const frame: TransportFrame = semantics === 'stream'
    ? { kind: 'bytes', get payload() { abort.abort(canceled); return Uint8Array.of(1); } }
    : { kind: 'datagram', payload: Uint8Array.of(1),
      get source() { abort.abort(canceled); return 'caller:100'; }, destination: 'peer:200' };
  vi.mocked(left.receive).mockResolvedValueOnce(frame);
  await expect(relayTransport(semantics, left, right, abort.signal)).rejects.toBe(canceled);
  expect(right.send).not.toHaveBeenCalled();
  expect(left.close).toHaveBeenCalledTimes(1);
  expect(right.close).toHaveBeenCalledTimes(1);
});
