import type { Page, Frame } from '@cloudflare/playwright';
import type { PlaywrightSnapshotReferenceCapture } from '@poe-platform/safe-bash/playwright';

interface IdentityScript {
  document: Document;
  parseSelector(selector: string): unknown;
  querySelectorAll(selector: unknown, root: Document): Element[];
  _lastAriaSnapshotForQuery?: { elements: Map<string, Element> };
  // Private native utility-world state. Weak keys do not keep DOM nodes alive.
  __safeBashSnapshotIdentity?: { sequence: number; nodes: WeakMap<Element, number> };
}
interface InjectedHandle {
  evaluate<T, A>(fn: (script: IdentityScript, arg: A) => T, arg: A): Promise<T>;
}
interface NativeFrame {
  readonly seq: number;
  _utilityContext(): Promise<NativeContext>;
}
interface NativeContext {
  injectedScript(): Promise<InjectedHandle>;
  adoptIfNeeded(handle: unknown): Promise<{ dispose(): void | Promise<void> }> | null;
}
interface ReferenceWitness { frame: Frame; context: NativeContext; injected: InjectedHandle; identity: number }
type NativePage = Page & { _connection: { toImpl(value: Frame): NativeFrame; toImpl(value: unknown): unknown } };

/** Preserve native accessibility IDs, but bind immutable identities in one RPC per frame.
 * Borrow the provider's utility handle; acquire no per-node browser resources here. */
export const captureBrowserSnapshotReferences: PlaywrightSnapshotReferenceCapture = async (page, refs, options) => {
  const signal = options.timeoutMs === 0 ? options.signal : AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
  signal.throwIfAborted();
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // This read allocates no owned browser handles. A late result is discarded,
    // while the adapter can interrupt/release its transport after cancellation.
    return await Promise.race([captureReferences(page, refs, { ...options, signal }), aborted]);
  } finally { signal.removeEventListener('abort', onAbort); }
};

const captureReferences: PlaywrightSnapshotReferenceCapture = async (page, refs, options) => {
  // type-erasure-boundary -- The pinned provider exposes its native utility world through this private bridge.
  const native = page as unknown as NativePage;
  const witnesses: (ReferenceWitness | undefined)[] = Array(refs.length);
  for (const frame of native.frames()) {
    options.signal.throwIfAborted();
    const implementation = native._connection.toImpl(frame);
    const prefix = `f${implementation.seq}e`;
    const requested = refs.flatMap((ref, index) => (frame === native.mainFrame() ? ref.startsWith('e') : ref.startsWith(prefix)) ? [{ ref, index }] : []);
    if (!requested.length) continue;
    try {
      const context = await implementation._utilityContext();
      const injected = await context.injectedScript();
      const identities = await injected.evaluate((script, refs) => {
        const state = script.__safeBashSnapshotIdentity ??= { sequence: 0, nodes: new WeakMap() };
        return refs.map(ref => {
          const node = script._lastAriaSnapshotForQuery?.elements.get(ref);
          if (!node?.isConnected || node.ownerDocument.defaultView?.document !== node.ownerDocument) return 0;
          let identity = state.nodes.get(node);
          if (identity === undefined) {
            identity = ++state.sequence;
            if (!Number.isSafeInteger(identity)) throw new Error('Snapshot identity space exhausted');
            state.nodes.set(node, identity);
          }
          return identity;
        });
      }, requested.map(entry => entry.ref));
      for (let index = 0; index < identities.length; index++) {
        const identity = identities[index];
        if (!identity) continue;
        witnesses[requested[index]!.index] = { frame, context, injected, identity };
      }
    } catch { options.signal.throwIfAborted(); } // A missing/destroyed target stays a tombstone, like eager binding.
  }
  options.signal.throwIfAborted();
  return {
    identities: witnesses.map(witness => witness && { scope: witness.injected, value: witness.identity }),
    async connected() {
      const result = refs.map(() => false);
      const groups = new Map<InjectedHandle, { index: number; ref: string; identity: number }[]>();
      for (let index = 0; index < witnesses.length; index++) {
        const witness = witnesses[index];
        if (!witness) continue;
        let entries = groups.get(witness.injected);
        if (!entries) groups.set(witness.injected, entries = []);
        entries.push({ index, ref: refs[index]!, identity: witness.identity });
      }
      for (const [injected, entries] of groups) {
        let live: boolean[];
        try {
          live = await injected.evaluate((script, entries) => {
            const identities = new Set(script.querySelectorAll(script.parseSelector('css=*'), script.document)
              .filter(node => node.isConnected && node.ownerDocument.defaultView?.document === node.ownerDocument)
              .map(node => script.__safeBashSnapshotIdentity?.nodes.get(node)));
            return entries.map(entry => identities.has(entry.identity));
          }, entries);
        } catch { continue; } // A destroyed execution context has no live witnesses.
        for (let index = 0; index < entries.length; index++) result[entries[index]!.index] = live[index] === true;
      }
      return result;
    },
    async resolve(index) {
      const witness = witnesses[index];
      if (!witness) return null;
      try {
        if (await native._connection.toImpl(witness.frame)._utilityContext() !== witness.context) return null;
      } catch { return null; }
      // External native snapshots can assign the same node a different aria ID
      // (for example after its accessible name changes). Find that original node
      // by identity if its old native selector no longer denotes it. Recheck the
      // acquired handle so a DOM reorder cannot redirect the action.
      for (let attempt = 0; attempt < 2; attempt++) {
        let selector = `aria-ref=${refs[index]}`;
        if (attempt) {
          let slot: number;
          try {
            slot = await witness.injected.evaluate((script, identity) => script.querySelectorAll(script.parseSelector('css=*'), script.document)
              .findIndex(node => script.__safeBashSnapshotIdentity?.nodes.get(node) === identity), witness.identity);
          } catch { return null; }
          if (slot < 0) return null;
          selector = `css=* >> nth=${slot}`;
        }
        let handles: Awaited<ReturnType<ReturnType<Frame['locator']>['elementHandles']>>;
        try { handles = await witness.frame.locator(selector).elementHandles(); }
        catch { continue; }
        let keep = false;
        const errors: unknown[] = [];
        if (handles.length === 1) {
          try { keep = await matchesWitness(witness, native._connection.toImpl(handles[0]!)); }
          catch (error) { errors.push(error); }
        }
        if (!keep) {
          const results = await Promise.allSettled(handles.map(handle => handle.dispose()));
          for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'Snapshot candidate handle disposal failed');
        if (keep) return handles[0]!;
      }
      return null;
    },
  };
};

async function matchesWitness(witness: ReferenceWitness, server: unknown): Promise<boolean> {
  // Adopt explicitly before evaluate: the pinned engine otherwise leaves an
  // unobserved disposal promise when cross-world adoption rejects.
  let adopted: { dispose(): void | Promise<void> } | null;
  try { adopted = await witness.context.adoptIfNeeded(server); }
  catch { return false; }
  let matches = false;
  try {
    matches = await witness.injected.evaluate((script, args) => args.node.isConnected && args.node.ownerDocument.defaultView?.document === args.node.ownerDocument && script.__safeBashSnapshotIdentity?.nodes.get(args.node) === args.identity, {
      node: (adopted ?? server) as Element,
      identity: witness.identity,
    });
  } catch { /* A disappeared document or target is stale. */ }
  // Cleanup errors propagate separately and the caller still disposes its candidate.
  await adopted?.dispose();
  return matches;
}
