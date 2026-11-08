/** Opaque, session-scoped identities established by the runtime. Equal network
 * names alone are insufficient: all endpoint context fields must match. */
export interface EndpointContext {
  readonly network: string;
  readonly dns: string;
  readonly proxy: string;
  readonly bind: string;
  readonly tls: string;
  readonly certificates: string;
}
export interface NativeEndpointRequest {
  /** Verified native executable/build identity, not a provider declaration. */
  readonly buildDigest: string;
  readonly context: EndpointContext;
  /** Actual underlying protocol chosen by native, not guessed from media URLs. */
  readonly protocol: string;
  readonly semantics: 'stream' | 'datagram';
  readonly operation: 'connect' | 'bind' | 'listen' | 'multicast';
  /** Nonempty native endpoint identity; never an implicit sandbox default. */
  readonly endpoint: Uint8Array;
  /** Native-owned options, ordered and byte preserving. No credential inference. */
  readonly options: readonly { readonly name: Uint8Array; readonly value: Uint8Array }[];
  readonly stage: string;
  readonly signal?: AbortSignal;
}
export interface EndpointCapability {
  /** Qualification applies only to this verified native build. */
  readonly buildDigest: string;
  readonly route: 'direct' | 'relay';
  readonly context: EndpointContext;
  /** Each receipt qualifies exact combinations, never a cross-product. */
  readonly transports: readonly {
    readonly protocol: string;
    readonly semantics: NativeEndpointRequest['semantics'];
    readonly operation: NativeEndpointRequest['operation'];
    /** Optional exact native execution stage covered by this receipt. Omission
     * declares qualification across stages; discovery never acquires access. */
    readonly stage?: string;
    /** Optional exact native endpoint scope. Omission declares context-wide
     * qualification; a fixture for one endpoint should supply its original bytes.
     * No URL normalization or origin inference is performed. */
    readonly endpoint?: Uint8Array;
    /** Exact ordered native option bytes qualified by this receipt. Omission
     * qualifies only an empty option list, never arbitrary socket options. */
    readonly options?: NativeEndpointRequest['options'];
  }[];
  /** Nonempty qualification receipts for this provider/build/context. Every
   * indexed receipt must be present and nonempty. Declarations are
   * not themselves qualification. Mock receipts authorize only test fixtures. */
  readonly evidence: readonly string[];
}
export interface EndpointLease {
  /** Retire all owned streams, datagrams and listener state; await cleanup.
   * Access-owned leases retire on request cancellation or explicit close, once.
   * Call close to await retirement and observe the retained cleanup outcome. */
  close(): Promise<void>;
}
export interface EndpointProvider {
  readonly id: string;
  readonly capabilities: readonly EndpointCapability[];
  /** Runtime adapter installs native socket/namespace access without changing
   * argv, URL, Host, SNI, peer identity or native protocol implementation. It must
   * reject any unsupported socket option and settle pending acquisition when
   * request.signal aborts, including access shutdown. HTTP fetching is not this
   * interface. */
  open(input: { readonly route: 'direct' | 'relay'; readonly request: NativeEndpointRequest }): Promise<EndpointLease>;
}
export class EndpointCapabilityGap extends Error {
  constructor() { super('No admitted endpoint transport matches the native request and context'); this.name = 'EndpointCapabilityGap'; }
}
function sameContext(a: EndpointContext, b: EndpointContext): boolean {
  return (['network', 'dns', 'proxy', 'bind', 'tls', 'certificates'] as const).every(key =>
    typeof a[key] === 'string' && a[key].length > 0 && a[key] === b[key]);
}
function ownOptions(options: NativeEndpointRequest['options']): NativeEndpointRequest['options'] {
  if (!Array.isArray(options)) throw new EndpointCapabilityGap();
  // Native options are indexed, ordered entries. An array's custom iterator
  // must neither replace their bytes nor silently omit unqualified options.
  return Array.from({ length: options.length }, (_, index) => {
    if (!Object.hasOwn(options, index)) throw new EndpointCapabilityGap();
    const option = options[index];
    if (option === null || typeof option !== 'object') throw new EndpointCapabilityGap();
    const { name, value } = option;
    if (!(name instanceof Uint8Array) || !(value instanceof Uint8Array)) throw new EndpointCapabilityGap();
    return { name: new Uint8Array(name), value: new Uint8Array(value) };
  });
}

/** Creating access is inert. Call open only from the actual native socket stage,
 * including each redirect/reload/key/seek/retry open; never for discovery hints.
 * Native owns HTTP semantics and retry policy. Provider failures propagate once. */
export function createEndpointAccess(config: {
  readonly sandbox: EndpointContext;
  readonly providers: readonly EndpointProvider[];
  readonly admittedRelays?: readonly string[];
}): {
  open(request: NativeEndpointRequest): Promise<EndpointLease>;
  /** Close admission, drain acquisitions, then retire every owned transport.
   * Providers must settle acquisitions on request cancellation. A failed lease
   * retirement remains a cleanup gap, including leases explicitly closed earlier.
   * Register this barrier with the owning native invocation's cleanup. */
  close(): Promise<void>;
} {
  // Admission belongs to this access instance. Caller mutations must not widen
  // qualification, change endpoint context, or authorize another relay later.
  const sandbox = { ...config.sandbox };
  // Missing context cannot decide whether localhost denotes the sandbox or the
  // caller. Define every context component before selecting either route.
  if (!sameContext(sandbox, sandbox)) throw new EndpointCapabilityGap();
  const declaredRelays = config.admittedRelays;
  if (declaredRelays !== undefined && !Array.isArray(declaredRelays)) {
    throw new TypeError('Relay admission must be an array of nonempty provider identities');
  }
  const relayIdentities = Array.from({ length: declaredRelays?.length ?? 0 }, (_, index) =>
    declaredRelays && Object.hasOwn(declaredRelays, index) ? declaredRelays[index] : undefined);
  if (relayIdentities.some(id => typeof id !== 'string' || !id.length)) {
    throw new TypeError('Relay admission must be an array of nonempty provider identities');
  }
  const admittedRelays = new Set(relayIdentities);
  const identities = new Set<string>();
  const declaredProviders = config.providers;
  if (!Array.isArray(declaredProviders)) throw new EndpointCapabilityGap();
  const providers = Array.from({ length: declaredProviders.length }, (_, index) => {
    if (!Object.hasOwn(declaredProviders, index)) throw new EndpointCapabilityGap();
    const provider: EndpointProvider = declaredProviders[index];
    const id = provider.id;
    if (typeof id !== 'string' || !id.length || identities.has(id)) {
      throw new TypeError('Endpoint provider identities must be nonempty and unique');
    }
    identities.add(id);
    const capabilities = provider.capabilities;
    if (!Array.isArray(capabilities)) throw new EndpointCapabilityGap();
    return {
      id,
      open: provider.open.bind(provider),
      capabilities: Array.from({ length: capabilities.length }, (_, index) => {
        if (!Object.hasOwn(capabilities, index)) throw new EndpointCapabilityGap();
        const capability: EndpointCapability = capabilities[index];
        // Capture accessor-backed receipt fields once, then own those exact
        // fields. A second read must not substitute a different qualification.
        const owned = { ...capability };
        const transports = owned.transports;
        if (!Array.isArray(transports)) throw new EndpointCapabilityGap();
        return {
          ...owned,
          context: { ...owned.context },
          transports: Array.from({ length: transports.length }, (_, index) => {
            if (!Object.hasOwn(transports, index)) throw new EndpointCapabilityGap();
            const transport: EndpointCapability['transports'][number] = transports[index];
            const owned = { ...transport };
            if (owned.stage !== undefined && (typeof owned.stage !== 'string' || !owned.stage.length)) {
              throw new EndpointCapabilityGap();
            }
            if (owned.endpoint !== undefined && !(owned.endpoint instanceof Uint8Array)) {
              throw new EndpointCapabilityGap();
            }
            const endpoint = owned.endpoint === undefined ? undefined : new Uint8Array(owned.endpoint);
            if (endpoint !== undefined && !endpoint.length) throw new EndpointCapabilityGap();
            return { ...owned,
              endpoint,
              options: owned.options === undefined ? undefined : ownOptions(owned.options) };
          }),
          // Iterability alone is not receipt admission: strings would otherwise
          // become nonempty character receipts and falsely qualify a transport.
          evidence: Array.isArray(owned.evidence) ? Array.from({ length: owned.evidence.length }, (_, index) =>
            Object.hasOwn(owned.evidence, index) ? owned.evidence[index] : undefined) : [],
        };
      }),
    };
  });
  const pending = new Set<Promise<EndpointLease>>();
  const leases = new Set<EndpointLease>();
  const shutdown = new AbortController();
  let closing: Promise<void> | undefined;
  async function acquire(request: NativeEndpointRequest): Promise<EndpointLease> {
      if (closing) throw new Error('Endpoint access is retiring');
      // Qualify and dispatch the same owned request. Accessors or later caller
      // mutation cannot substitute an unqualified protocol/build/context.
      request = { ...request };
      if (!(request.endpoint instanceof Uint8Array)
        || !Array.isArray(request.options)) throw new EndpointCapabilityGap();
      const endpoint = new Uint8Array(request.endpoint);
      if (!endpoint.length) throw new EndpointCapabilityGap();
      const options = ownOptions(request.options);
      request = {
        ...request, context: { ...request.context }, endpoint,
        options,
      };
      if (typeof request.stage !== 'string' || !request.stage.length
        || typeof request.protocol !== 'string' || !request.protocol.length
        || !['stream', 'datagram'].includes(request.semantics)
        || !['connect', 'bind', 'listen', 'multicast'].includes(request.operation)) throw new EndpointCapabilityGap();
      const signal = request.signal ? AbortSignal.any([request.signal, shutdown.signal]) : shutdown.signal;
      request = { ...request, signal };
      signal.throwIfAborted();
      const route = sameContext(request.context, sandbox) ? 'direct' : 'relay';
      for (const provider of providers) {
        if (route === 'relay' && !admittedRelays.has(provider.id)) continue;
        const capability = provider.capabilities.find(c => c.route === route
          && typeof request.buildDigest === 'string' && request.buildDigest.length > 0
          && c.buildDigest === request.buildDigest
          && c.evidence.length > 0 && c.evidence.every(e => typeof e === 'string' && e.length > 0)
          && sameContext(c.context, request.context)
          && c.transports.some(t => t.protocol === request.protocol
            && t.semantics === request.semantics && t.operation === request.operation
            && (t.stage === undefined || t.stage === request.stage)
            && (t.endpoint === undefined || (t.endpoint.length === request.endpoint.length
              && t.endpoint.every((byte, offset) => byte === request.endpoint[offset])))
            && (t.options?.length ?? 0) === request.options.length
            && request.options.every((option, index) => {
              const qualified = t.options?.[index];
              return qualified !== undefined
                && option.name.length === qualified.name.length
                && option.value.length === qualified.value.length
                && option.name.every((byte, offset) => byte === qualified.name[offset])
                && option.value.every((byte, offset) => byte === qualified.value[offset]);
            })));
        if (!capability) continue;
        const nativeLease = await provider.open({ route, request });
        const retire = nativeLease?.close;
        if (typeof retire !== 'function') throw new TypeError('Endpoint provider must return a retireable transport lease');
        let retirement: Promise<void> | undefined;
        const lease: EndpointLease = {
          close() {
            signal?.removeEventListener('abort', cancel);
            if (!retirement) {
              retirement = Promise.resolve().then(() => retire.call(nativeLease));
              // Successful retirement releases ownership. Failed retirement is
              // retained so invocation cleanup cannot report false completion.
              void retirement.then(() => leases.delete(lease), () => {});
            }
            return retirement;
          },
        };
        // Abort listeners cannot return an awaitable cleanup result. Observe it
        // here; explicit close still returns the original retirement outcome.
        const cancel = () => { void lease.close().catch(() => {}); };
        leases.add(lease);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) {
          const cleanup = await Promise.allSettled([Promise.resolve().then(() => lease.close())]);
          if (cleanup[0].status === 'rejected') throw new AggregateError([signal.reason, cleanup[0].reason], 'Endpoint cancellation cleanup failed');
          signal.throwIfAborted();
        }
        if (closing) {
          await lease.close();
          throw new Error('Endpoint access is retiring');
        }
        return lease;
      }
      throw new EndpointCapabilityGap();
  }
  return {
    open(request) {
      if (closing) return Promise.reject(new Error('Endpoint access is retiring'));
      // Register acquisition before provider code can reenter retirement.
      let resolve!: (lease: EndpointLease) => void;
      let reject!: (cause: unknown) => void;
      const work = new Promise<EndpointLease>((settled, failed) => { resolve = settled; reject = failed; });
      pending.add(work);
      void work.then(() => pending.delete(work), () => pending.delete(work));
      void acquire(request).then(resolve, reject);
      return work;
    },
    close() {
      closing ??= Promise.resolve().then(async () => {
        // Established listeners/streams can release pending acquisition work.
        // Start their retirement while draining acquisitions, not afterwards.
        await Promise.allSettled([...pending, ...[...leases].map(lease => lease.close())]);
        // Late acquisitions retire themselves. Retained leases here include
        // every failed retirement; close returns the original outcome once.
        const results = await Promise.allSettled([...leases].map(lease => lease.close()));
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Endpoint access retirement failed');
      });
      // Publish retirement before notifying providers: cancellation listeners
      // can synchronously reenter close. Pending DNS/connect/listen work must
      // settle on this signal even when the caller supplied no cancellation.
      shutdown.abort(new Error('Endpoint access is retiring'));
      void closing.catch(() => {});
      return closing;
    },
  };
}
