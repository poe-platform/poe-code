/** Trusted provider fixture exercising the full backend context, not a local
 * native process or a claim about deployed provider isolation. */
import { createTransport } from './transport.js';
import type { MediaEngineRequest } from '../src/engine.js';
export function createMediaProvider() {
  return { fetch: createTransport(), async execute(request: MediaEngineRequest) {
    // Seekable stdin is intentionally handled as the supplied descriptor.
    if (request.stdinInput?.seek) {
      await request.stdinInput.seek(0, request.signal);
      const input = await request.stdinInput.read(64, request.signal);
      if (!input.done) await request.stdout.write(input.value);
    } else if (request.stdinInput?.descriptor?.capabilities.positionedRead) {
      const bytes = new Uint8Array(64);
      const count = await request.stdinInput.descriptor.read(bytes, 0, { signal: request.signal });
      await request.stdout.write(bytes.subarray(0, count));
    } else await request.stdout.write(request.args[0] ?? new Uint8Array());
    return { exitCode: 0 };
  } };
}
