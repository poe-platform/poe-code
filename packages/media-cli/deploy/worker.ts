import { DurableObject } from 'cloudflare:workers';
import type { Sandbox } from '@cloudflare/sandbox';
import { createSandboxDriver } from './sandbox.js';
import { createMediaWorker, type CommandRecord, type Principal, type WorkerOptions } from './entrypoint.js';
import { runtime } from './runtime.js';
export { Sandbox } from '@cloudflare/sandbox';
export interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  COMMAND_JOURNAL: DurableObjectNamespace<CommandJournal>;
  AUTHORIZATION: Fetcher;
}
/** Metadata owner only; never claims ownership or recovery of a live shell. */
export class CommandJournal extends DurableObject {
  constructor(private state: DurableObjectState, env: Env) { super(state, env); }
  async accept(key: string, record: CommandRecord) {
    return this.state.storage.transaction(async storage => {
      if (await storage.get(key)) return false;
      if ((await storage.list({ limit: 1024 })).size >= 1024) throw new Error('Journal capacity; explicit retention cleanup required');
      await storage.put(key, record); return true;
    });
  }
  async inspect(key: string) { return this.state.storage.get<CommandRecord>(key); }
  async put(key: string, record: CommandRecord) { await this.state.storage.put(key, record); }
}
/** Operator bindings are available only to the runtime composition. Do not
 * forward the environment or broad storage credentials into native jobs.
 * The checked-in default refuses commands until a qualified authority exists. */
export function createDeploymentWorker<Environment extends Env = Env>(
  runtime: (input: Parameters<WorkerOptions['runtime']>[0] & { env: Environment }) => ReturnType<WorkerOptions['runtime']>,
) {
return { async fetch(request: Request, env: Environment, context: ExecutionContext) {
  const driver = createSandboxDriver(env.Sandbox);
  function journal(owner: string) { return env.COMMAND_JOURNAL.get(env.COMMAND_JOURNAL.idFromName(owner)); }
  return createMediaWorker({ driver, runtime: input => runtime({ ...input, env }), journal: {
    accept: (owner, key, record) => journal(owner).accept(key, record),
    inspect: (owner, key) => journal(owner).inspect(key),
    put: (owner, key, record) => journal(owner).put(key, record),
  }, async authenticate(input) {
    const authorization = input.headers.get('Authorization'); if (!authorization) return null;
    const response = await env.AUTHORIZATION.fetch('https://authorization.internal/authorize', { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ audience: new URL(input.url).origin, method: input.method, path: new URL(input.url).pathname }), signal: input.signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      input.signal.throwIfAborted();
      return null;
    }
    let value: unknown;
    // Authorization is a bounded control message, never an unbounded JSON body.
    const reader = response.body?.getReader();
    if (!reader) return null;
    const stop = () => { void reader.cancel(input.signal.reason).catch(() => {}); };
    input.signal.addEventListener('abort', stop, { once: true });
    try {
      const bytes = new Uint8Array(4096);
      let length = 0;
      for (;;) {
        input.signal.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        if (part.value.byteLength > bytes.byteLength - length) return null;
        bytes.set(part.value, length); length += part.value.byteLength;
      }
      input.signal.throwIfAborted();
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    } catch { input.signal.throwIfAborted(); return null; }
    finally {
      input.signal.removeEventListener('abort', stop);
      try { await reader.cancel(); } finally { reader.releaseLock(); }
    }
    if (!value || typeof value !== 'object' || !('namespaceId' in value) || typeof value.namespaceId !== 'string' || !value.namespaceId || !('expiresAt' in value) || typeof value.expiresAt !== 'number') return null;
    return value as Principal;
  } }).fetch(request, context);
} };
}
export default createDeploymentWorker(runtime);
