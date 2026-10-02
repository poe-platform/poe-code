import { hostingOperation, type RemoteExecutionDriver } from '@poe-code/remote-execution';
import { boundedTransfer } from '../../remote-execution/src/hosting-stream.js';

/** Command-scoped canonical transport. Raw ranges need bounds independently of
 * the client's JSON/frame limits. No redirects or ambient fetch are permitted. */
export function createWorkerTransport(
  endpoint: Awaited<ReturnType<RemoteExecutionDriver['acquire']>>,
  signal: AbortSignal,
  abort: AbortController,
): typeof globalThis.fetch {
  let active = 0;
  return async (input, init) => {
    if (active >= 4) {
      const error = new RangeError('Canonical transfer credit exhausted');
      abort.abort(error);
      throw error;
    }
    active++;
    const retirement = new AbortController();
    let released = false;
    function release() {
      if (!released) {
        released = true;
        retirement.abort(new Error('Canonical transfer retired'));
        active--;
      }
    }
    try {
      // workerd rejects redirect:error. Manual preserves the SDK's refusal to
      // follow redirects; the client classifies the original non-2xx receipt.
      const request = new Request(input, { ...init, redirect: 'manual' });
      const transferSignal = AbortSignal.any([signal, request.signal, retirement.signal]);
      transferSignal.throwIfAborted();
      const limits = { maxChunkBytes: 65536, maxBytes: 67108864, maxWallClockMs: 300000 };
      function transfer(body: ReadableStream<Uint8Array>, finished: () => void) {
        // Canceling a deliberately partial range retires just that range.
        // Actual transport/limit errors must retire the command even if caught.
        const reader = boundedTransfer(body, limits, transferSignal, abort, false, false).getReader();
        let ended = false;
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const part = await reader.read();
              if (ended) return;
              if (part.done) { ended = true; reader.releaseLock(); finished(); controller.close(); }
              else controller.enqueue(part.value);
            } catch (error) {
              if (ended) return;
              ended = true;
              reader.releaseLock(); finished(); controller.error(error); abort.abort(error);
            }
          },
          async cancel(reason) {
            ended = true;
            try { await reader.cancel(reason); }
            finally { reader.releaseLock(); finished(); }
          },
        }, { highWaterMark: 0 });
      }
      const body = request.body ? transfer(request.body, () => {}) : null;
      const response = await hostingOperation(transferSignal, () => endpoint.fetch(new Request(request.url, {
        method: request.method, headers: request.headers, body, signal: transferSignal,
        redirect: 'manual', duplex: 'half',
      } as RequestInit)), response => response.body?.cancel(transferSignal.reason));
      if (!response.body) release();
      return new Response(response.body ? transfer(response.body, release) : null,
        { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { release(); throw error; }
  };
}
