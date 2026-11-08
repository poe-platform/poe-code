import { getSandbox, type Sandbox } from '@cloudflare/sandbox';
import { createContainerExecutionDriver, type RemoteExecutionDriver } from '../src/deployment.js';
import provider from '@poe-code/remote-execution/providers/cloudflare';

/** Caller identities are opaque, case-sensitive authorization values. Encode a
 * domain-separated digest rather than normalizing or truncating the caller ID
 * to fit the Sandbox SDK's 63-character, non-reserved namespace constraint. */
export function createSandboxDriver(namespace: DurableObjectNamespace<Sandbox>): RemoteExecutionDriver {
  const driver = createContainerExecutionDriver(provider, (id, config) => getSandbox(namespace, id, {
    ...config.lifecycle, transport: config.transport, normalizeId: false,
  }));
  async function identity(owner: string) {
    if (!owner || new TextEncoder().encode(owner).length > 4096) throw new TypeError('Bounded caller identity required');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['poe-media-sandbox-v1', owner]))));
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let result = 'media-';
    let bits = 0;
    let value = 0;
    for (const byte of digest) {
      value = (value << 8) | byte; bits += 8;
      while (bits >= 5) { bits -= 5; result += alphabet[(value >>> bits) & 31]; }
      value &= (1 << bits) - 1;
    }
    if (bits) result += alphabet[(value << (5 - bits)) & 31];
    return result;
  }
  return {
    async acquire(owner) { return driver.acquire(await identity(owner)); },
    async destroy(owner) { await driver.destroy(await identity(owner)); },
  };
}
