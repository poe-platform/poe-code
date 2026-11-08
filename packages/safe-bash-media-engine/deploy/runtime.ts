import type { WorkerOptions } from './entrypoint.js';
import { createMediaEngine } from '../src/index.js';
import type { WorkerRuntime } from './composition.js';

export interface CanonicalWorkerLease {
  fs: WorkerRuntime['fs'];
  /** Bind late access and native IO to this lease's exact canonical authority.
   * Use input.client for container transport and input.persistNative before
   * acknowledging acceptance/effects, including interrupted admission. */
  bind: Parameters<typeof createMediaEngine>[0]['bind'];
  close(): Promise<void>;
}

/** The operator supplies a qualified backend, never a filesystem inferred from
 * an object bucket or caller-provided namespace. Acquisition is caller scoped. */
export function createCanonicalWorkerRuntime(
  acquire: (input: Parameters<WorkerOptions['runtime']>[0]) => Promise<CanonicalWorkerLease>,
): WorkerOptions['runtime'] {
  return async input => {
    input.signal.throwIfAborted();
    const lease = await acquire(input);
    try {
      input.signal.throwIfAborted();
      if (!lease.fs || typeof lease.bind !== 'function') throw new TypeError('Explicit canonical filesystem and native binding required');
      return { fs: lease.fs, engine: createMediaEngine({ bind: lease.bind.bind(lease) }), close: lease.close.bind(lease) };
    } catch (error) {
      await lease.close();
      throw error;
    }
  };
}
/** Replace with an operator-owned, qualified canonical backend composition.
 * No ephemeral filesystem, R2 mount, or Node SDK fallback is authorized here. */
export const runtime: WorkerOptions['runtime'] = async () => {
  throw new Error('Deployment requires an explicit qualified canonical filesystem and remote engine binding');
};
