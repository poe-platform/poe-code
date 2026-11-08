export type TransportFrame =
  | { readonly kind: 'bytes'; readonly payload: Uint8Array }
  | { readonly kind: 'end' }
  | { readonly kind: 'datagram'; readonly payload: Uint8Array; readonly source: string; readonly destination: string };
/** Already admitted, authenticated ports. receive(null) retires that relay
 * direction; stream half-close is an explicit end frame. Datagram empty payload
 * is a packet, never EOF. Addresses are native socket identities, not relay hops.
 * Implementations MUST settle pending I/O on abort and bound frame/queue sizes. */
export interface RelayPort {
  receive(signal: AbortSignal): Promise<TransportFrame | null>;
  send(frame: TransportFrame, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
/** Transport-only forwarding. Native retains TLS, HTTP, redirects, cookies,
 * ranges, retries and live reads. A runtime socket bridge is required to restore
 * endpoint metadata; merely forwarding packets does not qualify peer identity.
 * Frames are bounded to 1 MiB. Stream adapters may frame a larger byte stream;
 * datagram adapters must reject oversized packets without splitting them. */
export async function relayTransport(semantics: 'stream' | 'datagram', left: RelayPort, right: RelayPort, signal?: AbortSignal): Promise<void> {
  // Retain the authenticated adapters and their retirement methods before any
  // I/O yields. Later producer mutation must not substitute a different port.
  [left, right] = [left, right].map(port => ({
    receive: port.receive.bind(port),
    send: port.send.bind(port),
    close: port.close.bind(port),
  }));
  const controller = new AbortController();
  // AbortController replaces an undefined reason with AbortError. Retain the
  // first adapter failure separately so cancellation cannot rewrite it.
  let transportFailure: { cause: unknown } | undefined;
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  async function forward(source: RelayPort, target: RelayPort): Promise<void> {
    let ended = false;
    try {
      for (;;) {
        controller.signal.throwIfAborted();
        const received = await source.receive(controller.signal);
        controller.signal.throwIfAborted();
        if (received === null) return;
        // Validate and forward the same metadata, even for adapter accessors.
        const frame = { ...received };
        if (semantics === 'datagram' ? frame.kind !== 'datagram' : frame.kind !== 'bytes' && frame.kind !== 'end') {
          throw new Error('Relay frame violates admitted transport semantics');
        }
        if (frame.kind !== 'end' && !(frame.payload instanceof Uint8Array)) {
          throw new Error('Relay frame requires native payload bytes');
        }
        // Typed-array metadata can be shadowed by an adapter. Bound the native
        // buffer before allocation; datagrams must never be split to fit.
        if (frame.kind !== 'end' && Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(frame.payload) > 1024 * 1024) {
          throw new Error('Relay frame exceeds transport limit');
        }
        if (frame.kind === 'datagram' && (typeof frame.source !== 'string' || !frame.source
          || typeof frame.destination !== 'string' || !frame.destination)) {
          throw new Error('Relay frame requires native endpoint identities');
        }
        if (ended) throw new Error('Relay received data after stream half-close');
        if (frame.kind === 'end') ended = true;
        // Native metadata accessors can cancel while the frame is captured.
        // Do not hand canceled work to a transport adapter after validation.
        controller.signal.throwIfAborted();
        await target.send(frame.kind === 'end' ? { kind: 'end' } : { ...frame, payload: new Uint8Array(frame.payload) }, controller.signal);
      }
    } catch (error) {
      if (!controller.signal.aborted) transportFailure = { cause: error };
      controller.abort(error);
      throw error;
    }
  }
  const failures: unknown[] = [];
  try {
    if (semantics !== 'stream' && semantics !== 'datagram') {
      throw new Error('Relay transport requires supported semantics');
    }
    const results = await Promise.allSettled([forward(left, right), forward(right, left)]);
    if (controller.signal.aborted) throw transportFailure ? transportFailure.cause : controller.signal.reason;
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  } catch (error) {
    failures.push(error);
  } finally {
    signal?.removeEventListener('abort', abort);
    const cleanup = await Promise.allSettled([left, right].map(port => Promise.resolve().then(() => port.close())));
    for (const result of cleanup) if (result.status === 'rejected') failures.push(result.reason);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Relay transport retirement failed');
}
