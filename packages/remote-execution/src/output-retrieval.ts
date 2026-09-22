import type { EffectManifest, FileMetadata } from './wire.generated.js';
import { validateWire } from './wire-validation.js';
import { admitOutputFreshness } from './output-freshness.js';

/** Host-issued retained identity and stable content version. assertCurrent must
 * validate access and that exact object/version under a backend guarantee,
 * including mutations between reads. Path hashes, sizes and timestamps cannot
 * implement this contract. Tokens are local capabilities, never wire values. */
export interface OutputFreshness {
  readonly identity: object | symbol;
  readonly version: string;
  assertCurrent(signal?: AbortSignal): Promise<void>;
}
export interface OutputSource {
  /** Stable host-qualified scope for opaque identities. Remote adapters include
   * the endpoint, session, epoch and job; credentials are not part of identity. */
  readonly scope?: string;
  metadata(identityId: string, signal?: AbortSignal): Promise<FileMetadata>;
  range(identityId: string, start: bigint, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
  freshness?(identityId: string, signal?: AbortSignal): Promise<OutputFreshness | undefined>;
}
export interface OutputDestination {
  /** Stable destination authority for cursor reuse across adapter instances.
   * Defaults to this adapter object. Reuse only for the same tree whose
   * acknowledged files, prefixes and directories remain present. */
  readonly identity?: object | symbol;
  mkdir(relativePath: string, signal?: AbortSignal): Promise<void>;
  /** Resume opens must preserve the acknowledged prefix. write returns a settled
   * partial count. A rejected write must expose no unacknowledged mutation; an
   * adapter unable to guarantee that requires explicit recovery before retry. */
  open(relativePath: string, metadata: FileMetadata, signal?: AbortSignal): Promise<{
    write(position: bigint, bytes: Uint8Array, signal?: AbortSignal): Promise<number>;
    truncate(size: bigint, signal?: AbortSignal): Promise<void>;
    close(): Promise<void>;
  }>;
}
export interface OutputTransferCursor {
  completed: Set<string>;
  offsets: Map<string, bigint>;
  directories?: Set<string>;
  /** Owned by retrieval. Preserve this binding along with acknowledged progress
   * when resuming; a cursor cannot be reused for another job or effect revision. */
  binding?: string;
  /** Retain with acknowledged progress; another tree cannot reuse its prefix. */
  destination?: object | symbol;
  /** Preserve with progress; equal opaque IDs in another scope are unrelated. */
  sourceScope?: string;
  /** Retain with progress. Missing backend freshness permits live one-pass
   * retrieval, but never authorizes reuse of an acknowledged prefix. */
  sources?: Map<string, { identityId: string; identity: object | symbol; version: string; assertCurrent: OutputFreshness['assertCurrent'] }>;
}

export interface OutputTransferOptions {
  /** Maximum source frame retained by retrieval, checked before copying or
   * writing. Defaults to 1 MiB. Sources must bound their own allocations and
   * queued frames independently; this is not a backend memory guarantee. */
  readonly maxFrameBytes?: number;
}

export interface OutputTreeInspection {
  manifest: EffectManifest;
  files: { path: string; relativePath: string; identityId: string }[];
  directories: { path: string; relativePath: string }[];
  retainedIdentities: string[];
  detachedIdentities: string[];
  /** Produced identities whose namespace location was never observed. Retained
   * identities remain downloadable; missing retains cannot certify a tree. */
  unlocatedIdentities: string[];
  /** Settled output paths for which no retained identity was admitted. Never
   * reopen these names: they may already refer to a replacement object. */
  unavailablePaths: { path: string; relativePath: string }[];
  /** Receipts whose namespace settlement is unknown. Independent known files
   * remain retrievable, but these prevent certification of a complete tree. */
  unresolvedEffects: string[];
}

/** Project settled invocation effects without enumerating any source directory.
 * Paths describe observed namespace effects; identities remain the authority
 * for reads, including removed and replaced outputs. */
export function inspectOutputTree(manifest: EffectManifest, logicalRoot: string): OutputTreeInspection {
  validateWire('EffectManifest', manifest);
  // Keep the inspected effects and native outcome together even if transfer
  // fails. Caller mutation must not change the revision used by this transfer.
  manifest = structuredClone(manifest);
  // Sequence identifies an operation, not its settlement time. Concurrent
  // operations can settle out of sequence, and requested/settled receipts share
  // a sequence. Preserve observation order while refusing ambiguous replay.
  const sequences = new Map<string, string>();
  const receipts = new Map<string, EffectManifest['effects'][number]>();
  for (const effect of manifest.effects) {
    const owner = sequences.get(effect.sequence);
    const previous = receipts.get(effect.operationId);
    if ((owner !== undefined && owner !== effect.operationId)
      || (previous && (previous.sequence !== effect.sequence || previous.state !== 'requested' || effect.state === 'requested'
        || (['operation', 'namespaceId', 'path', 'destination', 'identityId', 'offset', 'length', 'handleId'] as const)
          .some(field => previous[field] !== undefined && previous[field] !== effect[field])))) throw new TypeError('Conflicting output effect receipt');
    sequences.set(effect.sequence, effect.operationId);
    receipts.set(effect.operationId, effect);
  }
  if (!logicalRoot.startsWith('/') || logicalRoot.includes('\0') || logicalRoot.split('/').some(part => part === '..' || part === '.')) throw new TypeError('Invalid output root');
  const root = logicalRoot === '/' ? '' : logicalRoot.endsWith('/') ? logicalRoot.slice(0, -1) : logicalRoot;
  const files = new Map<string, string | undefined>(); const directories = new Set<string>(); const detached = new Set<string>();
  // Untouched input names are namespace observations, not output membership.
  // They still establish same-object rename no-ops involving generated aliases.
  const occupants = new Map<string, string>();
  const unresolvedEffects: string[] = [];
  const uncertainIdentities = new Set<string>();
  const produced = new Set(manifest.effects.flatMap(effect => effect.state === 'applied' && effect.identityId
    && ['created', 'modified', 'write', 'append', 'truncate', 'metadata', 'link', 'rename'].includes(effect.operation)
    && !((effect.operation === 'write' || effect.operation === 'append') && effect.acknowledgedBytes === '0') ? [effect.identityId] : []));
  // A link produces its destination, but does not modify the original input.
  // Initial open observations locate later mutations, never untouched sources
  // that merely gained a generated alias or were renamed elsewhere.
  const modified = new Set(manifest.effects.flatMap(effect => effect.state === 'applied' && effect.identityId
    && ['created', 'modified', 'write', 'append', 'truncate', 'metadata'].includes(effect.operation)
    && !((effect.operation === 'write' || effect.operation === 'append') && effect.acknowledgedBytes === '0') ? [effect.identityId] : []));
  const inside = (path: string) => path.startsWith(root + '/') && path.length > root.length + 1;
  const relative = (path: string) => {
    const value = path.slice(root.length + 1);
    if (value.split('/').some(part => !part || part === '.' || part === '..') || value.includes('\0')) throw new TypeError('Unsafe output path');
    return value;
  };
  for (const effect of manifest.effects) {
    // Native settlement alone cannot locate a namespace mutation. A receipt
    // without the affected names must not preserve an earlier observed alias.
    const incompleteNamespace = effect.state === 'applied' && (
      (effect.operation === 'rename' && (!effect.path || !effect.destination))
      || (['unlink', 'rmdir', 'mkdir', 'symlink'].includes(effect.operation) && !effect.path)
      || (effect.operation === 'link' && !effect.destination)
      // Handle-only IO can be correlated through retained identity. Without
      // either identity or pathname, a settled mutation cannot certify a tree.
      || (!effect.path && !effect.identityId
        && ['created', 'modified', 'write', 'append', 'truncate', 'metadata'].includes(effect.operation)
        && !((effect.operation === 'write' || effect.operation === 'append') && effect.acknowledgedBytes === '0')));
    // Requested receipts are unresolved only when no later settlement for this
    // operation was observed. Treat their affected names as uncertain, just as
    // unknown settlement, without discarding independent settled outputs.
    const pending = effect.state === 'requested' && receipts.get(effect.operationId) === effect;
    if (effect.state === 'unknown' || pending || incompleteNamespace) {
      unresolvedEffects.push(effect.operationId);
      // An unlocated directory removal could remove any observed empty output
      // directory. Keep known files, whose required parents are derived below,
      // but do not recreate directories that may have been removed.
      if (effect.operation === 'rmdir' && !effect.path) directories.clear();
      // An identity-only namespace receipt cannot tell which retained alias
      // moved or disappeared. Invalidate its observed locations rather than
      // reconstructing a name from an earlier open or a stale handle hint.
      if (effect.identityId && ['rename', 'unlink'].includes(effect.operation) && !effect.path) {
        for (const [path, identity] of occupants) if (identity === effect.identityId) occupants.delete(path);
        uncertainIdentities.add(effect.identityId);
        for (const [path, identity] of files) if (identity === effect.identityId) files.delete(path);
      }
      // An uncertain mutation cannot authorize either former or destination
      // spelling. Keep retained identities readable without guessing a move.
      // A link's source remains in place even when its destination is unknown.
      for (const affected of effect.operation === 'link' ? [effect.destination] : [effect.path, effect.destination]) {
        if (!affected) continue;
        for (const path of occupants.keys()) if (path === affected || path.startsWith(affected + '/')) occupants.delete(path);
        for (const [path, identity] of files) if (path === affected || path.startsWith(affected + '/')) {
          if (identity) uncertainIdentities.add(identity);
          files.delete(path);
        }
        for (const path of directories) if (path === affected || path.startsWith(affected + '/')) directories.delete(path);
      }
      continue;
    }
    if (effect.state !== 'applied') continue;
    // Preserve the receipt in inspection, but zero settled bytes do not establish
    // output membership for an existing file opened without truncation.
    if ((effect.operation === 'write' || effect.operation === 'append') && effect.acknowledgedBytes === '0') continue;
    // A generated hard link grants retrieval of its identity, but does not
    // produce every known input alias of that object. Reopening an unchanged
    // source must not promote it into the output tree.
    const untouchedSource = effect.operation === 'open' && effect.path !== undefined && effect.identityId !== undefined
      && occupants.get(effect.path) === effect.identityId && !files.has(effect.path) && !modified.has(effect.identityId);
    if (effect.operation === 'rename' && effect.path && effect.destination) {
      const sourceIdentity = files.get(effect.path) ?? effect.identityId ?? occupants.get(effect.path);
      if (effect.path === effect.destination || (sourceIdentity !== undefined
        && sourceIdentity === (files.get(effect.destination) ?? occupants.get(effect.destination)))) continue;
      for (const path of occupants.keys()) if (path === effect.destination || path.startsWith(effect.destination + '/')) occupants.delete(path);
      for (const [path, identity] of [...occupants]) if (path === effect.path || path.startsWith(effect.path + '/')) {
        occupants.delete(path); occupants.set(effect.destination + path.slice(effect.path.length), identity);
      }
      if (effect.identityId) occupants.set(effect.destination, effect.identityId);
    } else if (effect.operation === 'link' && effect.destination) {
      occupants.delete(effect.destination);
      if (effect.identityId) {
        occupants.set(effect.destination, effect.identityId);
        if (effect.path) occupants.set(effect.path, effect.identityId);
      }
    } else if (effect.path && ['open', 'created', 'unlink', 'rmdir', 'mkdir', 'symlink'].includes(effect.operation)) {
      occupants.delete(effect.path);
      if (effect.identityId && ['open', 'created'].includes(effect.operation)) occupants.set(effect.path, effect.identityId);
    }
    if (effect.operation === 'open' && effect.path) {
      const located = effect.identityId !== undefined && [...files.values()].includes(effect.identityId);
      const displaced = files.get(effect.path);
      if (displaced && displaced !== effect.identityId) detached.add(displaced);
      // Opens observe namespace occupants, but do not themselves produce an
      // output. Do not copy an untouched input over a prior output's name.
      files.delete(effect.path);
      if (effect.identityId && !untouchedSource && (modified.has(effect.identityId) || located)) {
        uncertainIdentities.delete(effect.identityId);
        detached.delete(effect.identityId);
        files.set(effect.path, effect.identityId);
      }
    } else if (effect.operation === 'link' && effect.destination) {
      const replaced = files.get(effect.destination);
      if (replaced && replaced !== effect.identityId) detached.add(replaced);
      files.set(effect.destination, effect.identityId);
      if (effect.identityId) { detached.delete(effect.identityId); uncertainIdentities.delete(effect.identityId); }
    } else if (effect.operation === 'rename' && effect.path && effect.destination) {
      // A renamed input can become an output without an earlier create/write.
      // Bind only an explicitly retained identity, never enumerate the source.
      if (!files.has(effect.path) && !directories.has(effect.path) && effect.identityId && manifest.outputs.includes(effect.identityId)) files.set(effect.path, effect.identityId);
      const sourceObserved = [...files.keys(), ...directories].some(path => path === effect.path || path.startsWith(effect.path + '/'));
      const replaced = files.get(effect.destination); if (replaced && replaced !== files.get(effect.path)) detached.add(replaced);
      // A settled rename replaces the destination even when its source was
      // never retained by this invocation. Keep the old object downloadable,
      // but do not reconstruct it at a name now occupied by an unknown object.
      files.delete(effect.destination); directories.delete(effect.destination);
      if (!sourceObserved) files.set(effect.destination, undefined);
      for (const [path, identity] of [...files]) if (path === effect.path || path.startsWith(effect.path + '/')) { files.delete(path); files.set(effect.destination + path.slice(effect.path.length), identity); }
      for (const path of [...directories]) if (path === effect.path || path.startsWith(effect.path + '/')) { directories.delete(path); directories.add(effect.destination + path.slice(effect.path.length)); }
    } else if (effect.path && effect.operation === 'symlink') {
      // A regular-file destination cannot materialize this namespace effect.
      // Keep its location visible while allowing independent files to settle.
      const displaced = files.get(effect.path);
      if (displaced) detached.add(displaced);
      files.set(effect.path, undefined);
    } else if (effect.path && ['unlink', 'rmdir'].includes(effect.operation)) {
      const identity = files.get(effect.path) ?? effect.identityId; if (identity) detached.add(identity);
      files.delete(effect.path); directories.delete(effect.path);
    } else if (effect.path && effect.operation === 'mkdir') directories.add(effect.path);
    else if (effect.path && !effect.identityId && ['created', 'modified', 'write', 'append', 'truncate', 'metadata'].includes(effect.operation)) {
      const displaced = files.get(effect.path);
      if (displaced) detached.add(displaced);
      files.set(effect.path, undefined);
    } else if (effect.path && effect.identityId && ['created', 'modified', 'write', 'append', 'truncate', 'metadata'].includes(effect.operation)) {
      if (effect.operation === 'created') { detached.delete(effect.identityId); uncertainIdentities.delete(effect.identityId); }
      // Handle receipts can carry the pathname used at open. Once a namespace
      // operation moves that identity, subsequent IO must not bind it there again.
      if (detached.has(effect.identityId) || uncertainIdentities.has(effect.identityId) || (effect.operation !== 'created' && [...files.values()].includes(effect.identityId))) continue;
      const displaced = files.get(effect.path);
      if (displaced && displaced !== effect.identityId) detached.add(displaced);
      files.set(effect.path, effect.identityId);
    }
  }
  // A receipt can identify a settled object even when retaining it failed.
  // Namespace correlation is useful while projecting moves and replacements,
  // but only manifest output authority permits a retrieval request. Preserve
  // unavailable names and transfer independent retained files first.
  const retained = new Set(manifest.outputs);
  // An admitted output with no receipt is still retrievable by identity, but
  // cannot certify a reconstructed tree. Do not guess its name or enumerate
  // shared storage. Known opens and zero-byte writes remain non-producing.
  const observedIdentities = new Set(manifest.effects.flatMap(effect => effect.identityId ? [effect.identityId] : []));
  // Keep namespace observations even when retaining their objects failed.
  // Located missing retains are reported as unavailablePaths; unlocated settled
  // writes must also prevent success, without blocking independent transfers.
  const observedLocations = new Set(files.values());
  for (const [path, identity] of files) if (identity !== undefined && !retained.has(identity)) files.set(path, undefined);
  for (const path of [...files.keys(), ...directories]) if (inside(path)) { const components = relative(path).split('/'); for (let i = 1; i < components.length; i++) directories.add(root + '/' + components.slice(0, i).join('/')); }
  const located = new Set(files.values());
  return {
    manifest,
    files: [...files].flatMap(([path, identityId]) => inside(path) && identityId !== undefined ? [{ path, relativePath: relative(path), identityId }] : []),
    directories: [...directories].filter(inside).sort((a, b) => a.split('/').length - b.split('/').length).map(path => ({ path, relativePath: relative(path) })),
    retainedIdentities: [...manifest.outputs],
    detachedIdentities: [...detached].filter(identity => retained.has(identity) && !located.has(identity)),
    // Preserve produced objects without known locations, including failed
    // retains, and retained outputs from newer receipt operations. Known opens
    // and zero-progress writes do not produce untouched inputs.
    unlocatedIdentities: [...new Set([...produced, ...manifest.outputs.filter(identity => !observedIdentities.has(identity)), ...manifest.effects.flatMap(effect =>
      effect.state === 'applied' && effect.identityId && manifest.outputs.includes(effect.identityId)
        && !['open', 'created', 'modified', 'write', 'append', 'truncate', 'metadata', 'link', 'rename', 'unlink', 'mkdir', 'rmdir'].includes(effect.operation)
        ? [effect.identityId] : [])])].filter(identity => !detached.has(identity) && !observedLocations.has(identity)),
    unavailablePaths: [...files].flatMap(([path, identityId]) => inside(path) && identityId === undefined ? [{ path, relativePath: relative(path) }] : []),
    unresolvedEffects,
  };
}

/** Reconstruct the surviving output tree, even after native error/cancellation.
 * Each write settles independently; completed files are never rolled back.
 * Resume requires the same manifest and unchanged retained source content.
 * This is retrieval, not the live canonical execution adapter. */
export async function retrieveOutputs(manifest: EffectManifest, logicalRoot: string, source: OutputSource, destination: OutputDestination, cursor: OutputTransferCursor = { completed: new Set(), offsets: new Map() }, signal?: AbortSignal, options: OutputTransferOptions = {}) {
  let currentPath: string | undefined;
  try {
    const tree = inspectOutputTree(manifest, logicalRoot);
    manifest = tree.manifest;
    const maxFrameBytes = options.maxFrameBytes ?? 1048576;
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1) throw new TypeError('Invalid output transfer frame bound');
    // Pin admitted host facets before freshness or destination work can await.
    // Bound receivers continue observing live retained bytes and backend policy.
    source = Object.freeze({ scope: source.scope, metadata: source.metadata.bind(source), range: source.range.bind(source),
      freshness: source.freshness?.bind(source) });
    const destinationIdentity = destination.identity ?? destination;
    if ((typeof destinationIdentity !== 'object' || destinationIdentity === null) && typeof destinationIdentity !== 'symbol') throw new TypeError('Invalid output destination identity');
    destination = Object.freeze({ mkdir: destination.mkdir.bind(destination), open: destination.open.bind(destination) });
    signal?.throwIfAborted();
    const root = logicalRoot === '/' ? '' : logicalRoot.endsWith('/') ? logicalRoot.slice(0, -1) : logicalRoot;
    const binding = JSON.stringify([manifest.jobId, root, manifest.effectBarrier, manifest.outputs, manifest.effects]);
    if (cursor.binding !== undefined && cursor.binding !== binding) throw new Error('Output resume cursor belongs to a different effect manifest or root');
    if (cursor.binding === undefined && (cursor.completed.size || cursor.offsets.size || cursor.directories?.size)) throw new Error('Output resume cursor has no manifest binding');
    const progressed = cursor.completed.size || cursor.offsets.size || cursor.directories?.size;
    if (progressed && cursor.destination !== destinationIdentity) throw new Error('Output resume cursor belongs to a different destination or has no destination binding');
    if (progressed && cursor.sourceScope !== source.scope) throw new Error('Output resume cursor belongs to a different source scope or has no source binding');
    cursor.binding = binding;
    cursor.destination = destinationIdentity;
    cursor.sourceScope = source.scope;
    // Completed files still participate in the qualified source revision. Check
    // them before any new destination effects, while preserving settled bytes.
    for (const { relativePath, identityId } of tree.files) {
      if (!cursor.completed.has(relativePath)) continue;
      const previous = cursor.sources?.get(relativePath);
      currentPath = relativePath;
      signal?.throwIfAborted();
      if (!previous) throw new Error('Output resume requires qualified source identity and version');
      await previous.assertCurrent(signal);
      const supplied = await source.freshness?.(identityId, signal);
      const freshness = supplied ? admitOutputFreshness(supplied) : undefined;
      const { identity, version, assertCurrent } = freshness ?? {};
      if (previous.identityId !== identityId || previous.identity !== identity || previous.version !== version || typeof assertCurrent !== 'function') throw new Error('Output source identity or version changed');
      await assertCurrent.call(freshness, signal);
    }
    for (const directory of tree.directories) { currentPath = directory.relativePath; if (cursor.directories?.has(currentPath)) continue; signal?.throwIfAborted(); await destination.mkdir(currentPath, signal); (cursor.directories ??= new Set()).add(currentPath); }
    for (const { relativePath, identityId: identity } of tree.files) {
      currentPath = relativePath;
      if (cursor.completed.has(currentPath)) continue;
      signal?.throwIfAborted();
      let offset = cursor.offsets.get(currentPath) ?? 0n;
      const previous = cursor.sources?.get(currentPath);
      await previous?.assertCurrent(signal);
      const supplied = await source.freshness?.(identity, signal);
      const freshness = supplied ? admitOutputFreshness(supplied) : undefined;
      // Admission pins the token and checks its original binding around every
      // validation, including later cursor reuse and completed-file checks.
      const { identity: object, version, assertCurrent } = freshness ?? {};
      const observedCurrent = assertCurrent?.bind(freshness);
      if (offset > 0n && (!previous || !observedCurrent)) throw new Error('Output resume requires qualified source identity and version');
      if (previous && (!observedCurrent || previous.identityId !== identity || previous.identity !== object || previous.version !== version)) throw new Error('Output source identity or version changed');
      await observedCurrent?.(signal);
      const current = previous?.assertCurrent ?? observedCurrent;
      await current?.(signal);
      if (freshness && !previous) (cursor.sources ??= new Map()).set(currentPath, { identityId: identity, identity: object!, version: version!, assertCurrent: current! });
      const metadata = structuredClone(await source.metadata(identity, signal)); validateWire('FileMetadata', metadata);
      if (metadata.type !== 'file') throw new Error('Output is not a regular file');
      const size = BigInt(metadata.size);
      if (offset < 0n || offset > size) throw new Error('Output resume cursor no longer matches retained file');
      await current?.(signal);
      const file = await destination.open(currentPath, metadata, signal);
      const close = file.close.bind(file);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined; let primary: { cause: unknown } | undefined;
      let cancellation: Promise<void> | undefined;
      const cancelRead = () => {
        cancellation ??= reader!.cancel(signal?.reason);
        // Observe rejection immediately; cleanup still reports its outcome.
        void cancellation.catch(() => {});
      };
      try {
        const write = file.write.bind(file); const truncate = file.truncate.bind(file);
        if (offset < size) {
          reader = (await source.range(identity, offset, signal)).getReader();
          signal?.addEventListener('abort', cancelRead, { once: true });
          if (signal?.aborted) cancelRead();
          for (;;) {
            signal?.throwIfAborted(); await current?.(signal);
            const part = await reader.read(); signal?.throwIfAborted();
            if (part.done) { await current?.(signal); break; }
            const fragment = part.value;
            if (!(fragment instanceof Uint8Array)) throw new Error('Invalid output range bytes');
            const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(fragment) as number;
            if (!length) throw new Error('Invalid output range bytes');
            if (length > maxFrameBytes) throw new Error('Output range frame exceeds transfer bound');
            if (offset + BigInt(length) > size) throw new Error('Invalid output range bytes');
            const bytes = new Uint8Array(fragment);
            await current?.(signal);
            for (let position = 0; position < bytes.length;) {
              signal?.throwIfAborted(); await current?.(signal);
              // A consumer owns its admitted buffer, but a partial receipt must
              // not let it rewrite the remaining ordered source bytes.
              const count = await write(offset, bytes.slice(position), signal);
              if (!Number.isSafeInteger(count) || count < 1 || count > bytes.length - position) throw new Error('Invalid output write receipt');
              position += count; offset += BigInt(count); cursor.offsets.set(currentPath, offset);
            }
          }
        }
        signal?.throwIfAborted();
        await current?.(signal);
        if (offset !== size) throw new Error('Output range interrupted');
        await truncate(size, signal);
        await current?.(signal);
      } catch (cause) { primary = { cause }; }
      signal?.removeEventListener('abort', cancelRead);
      // Admit both cleanup operations before calling adapters, which may throw
      // synchronously. Keep every failure and always release the reader lock.
      const cleanup = await Promise.allSettled([
        cancellation ?? Promise.resolve().then(() => reader?.cancel()),
        Promise.resolve().then(close),
      ]); reader?.releaseLock();
      const failures = cleanup.filter(result => result.status === 'rejected');
      if (failures.length) throw new AggregateError([...(primary === undefined ? [] : [primary.cause]), ...failures.map(result => result.reason)], 'Output transfer cleanup failed');
      if (primary) throw primary.cause;
      // Final destination work can await concurrent canonical mutations. Keep
      // acknowledged progress, but do not certify a stale source as complete.
      await current?.(signal);
      cursor.completed.add(currentPath);
    }
    // Every settled operation remains acknowledged, including the last one.
    // Consumer closure still prevents reporting a successful transfer.
    signal?.throwIfAborted();
    // Later files and destination cleanup can await concurrent canonical writers.
    // Revalidate every qualified version before certifying the transfer; this
    // is a measured observation, not cross-file snapshot isolation. Keep all
    // settled destination progress if an earlier source has since changed.
    for (const { relativePath } of tree.files) {
      currentPath = relativePath;
      await cursor.sources?.get(relativePath)?.assertCurrent(signal);
    }
    signal?.throwIfAborted();
    currentPath = undefined;
    if (tree.unresolvedEffects.length) throw new Error('Output effect settlement unavailable: ' + tree.unresolvedEffects.join(', '));
    if (tree.unlocatedIdentities.length) throw new Error('Output namespace location unavailable: ' + tree.unlocatedIdentities.join(', '));
    if (tree.unavailablePaths.length) throw new Error('Output retained identity unavailable: ' + tree.unavailablePaths.map(file => file.relativePath).join(', '));
    return { manifest, processOutcome: manifest.processOutcome, outcome: manifest.outcome, transfer: { state: 'complete' as const, cursor } };
  } catch (error) { return { manifest, processOutcome: manifest.processOutcome, outcome: manifest.outcome, transfer: { state: 'failed' as const, path: currentPath, error, cursor } }; }
}
