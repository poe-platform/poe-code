import { compareFileVersion, compareIdentity } from "@poe-code/safe-fs/contracts";
import { retainFileSystemCleanup } from "@poe-code/safe-fs/core";
import type { CommandContext, FileReadHandle, FileStaging } from "safe-bash-contracts";
import { archiveStorageContext, checkPath, fail, type ArchiveLimits } from "./internal.js";
import type { ArchiveMetadataFactory, ArchiveMetadataSpool, ArchiveReadSource } from "./metadata-types.js";

export interface ArchiveScratchScope {
  readonly context: CommandContext;
  readonly limits: ArchiveLimits;
  operation<Value>(action: () => Value | PromiseLike<Value>): Promise<Value>;
}

let serial = 0;

/** One invocation owner retains only currently active immutable scratch runs. */
export function createArchiveScratchFactory(scope: ArchiveScratchScope, parentPath: string): ArchiveMetadataFactory & { close(): Promise<void>; initialize(): Promise<void>; ownsPath(path: string): boolean } {
  const context = archiveStorageContext(scope.context);
  const controller = new AbortController();
  const factorySignal = AbortSignal.any([context.signal, controller.signal]);
  const active = new Set<() => Promise<void>>();
  const ownedPaths = new Set<string>();
  let namespace: FileStaging | undefined;
  let initializing: Promise<void> | undefined;
  const removeNamespace = retainFileSystemCleanup(context.fs, async view => {
    if (namespace?.cleanup) await namespace.cleanup.remove();
    else if (namespace) await view.removeStagedFile!(namespace);
    if (namespace) ownedPaths.delete(namespace.directory.path);
    namespace = undefined;
  }, { maxOperations: 16 });
  const initialize = (): Promise<void> => {
    if (!initializing) initializing = (async () => {
      factorySignal.throwIfAborted();
      const { fs } = context;
      const parent = await fs.stat(parentPath, { signal: factorySignal });
      const capabilities = await fs.capabilitiesFor?.(parentPath, { signal: factorySignal }) ?? fs.capabilities;
      if (!fs.createStagedFile || !fs.openReadFile || capabilities.retainedRead !== true
        || capabilities.retainedStagingWrite !== true || capabilities.retainedStagingCleanup !== true) fail("ZIP metadata requires retained streaming scratch storage");
      for (let attempt = 0; attempt < scope.limits.maxMembers; attempt++) {
        factorySignal.throwIfAborted();
        const path = `${parentPath === "/" ? "" : parentPath}/.zip-metadata-${++serial}`;
        checkPath(`${path}/owner`, scope.limits);
        try {
          namespace = await fs.createStagedFile(path, "owner", { type: "file", data: new Uint8Array() }, { signal: factorySignal, parent, retainCleanup: true, mode: 0o600 });
          ownedPaths.add(namespace.directory.path);
          factorySignal.throwIfAborted();
          return;
        } catch (error) {
          factorySignal.throwIfAborted();
          if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") throw error;
        }
      }
      fail("ZIP scratch namespace acquisition failed");
    })();
    return initializing;
  };
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (!closing) {
      controller.abort(new Error("ZIP scratch factory is closed"));
      closing = Promise.resolve().then(async () => {
        await initializing?.catch(() => {});
        const results = await Promise.allSettled([...active].map(close => close()));
        try { await removeNamespace(); } catch (reason) { results.push({ status: "rejected", reason }); }
        const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, "ZIP scratch cleanup failed");
      });
    }
    return closing;
  };
  context.registerCleanup?.(close);
  const create = async (): Promise<ArchiveMetadataSpool> => {
    await initialize();
    factorySignal.throwIfAborted();
    const { fs } = context;
    const runController = new AbortController();
    const signal = AbortSignal.any([factorySignal, runController.signal]);
    let staging: FileStaging | undefined;
    let handle: FileReadHandle | undefined;
    let tail = Promise.resolve();
    let ending: Promise<void> | undefined;
    let sealed = false;
    let size = 0;
    const remove = retainFileSystemCleanup(fs, async view => {
      try { await handle?.close(); }
      finally {
        handle = undefined;
        if (staging?.cleanup) await staging.cleanup.remove();
        else if (staging) await view.removeStagedFile!(staging);
        if (staging) ownedPaths.delete(staging.directory.path);
        staging = undefined;
      }
    }, { maxOperations: 16 });
    const retire = (): Promise<void> => {
      if (!ending) {
        runController.abort(new Error("ZIP scratch is closed"));
        ending = Promise.resolve().then(async () => {
          await tail;
          try { await remove(); } finally { active.delete(retire); }
        });
      }
      return ending;
    };
    active.add(retire);
    const operation = async <Value>(action: () => Promise<Value>): Promise<Value> => {
      signal.throwIfAborted();
      const pending = tail.then(() => scope.operation(async () => {
        signal.throwIfAborted();
        return action();
      }));
      tail = pending.then(() => {}, () => {});
      return pending;
    };
    try {
      await operation(async () => {
        const capabilities = await fs.capabilitiesFor?.(namespace!.directory.path, { signal }) ?? fs.capabilities;
        if (!fs.createStagedFile || !fs.openReadFile || capabilities.retainedRead !== true
          || capabilities.retainedStagingWrite !== true || capabilities.retainedStagingCleanup !== true) fail("ZIP metadata requires retained streaming scratch storage");
        const parent = await fs.stat(namespace!.directory.path, { signal });
        for (let attempt = 0; attempt < scope.limits.maxMembers; attempt++) {
          signal.throwIfAborted();
          const path = `${namespace!.directory.path}/run-${++serial}`;
          checkPath(`${path}/run`, scope.limits);
          try {
            staging = await fs.createStagedFile(path, "run", { type: "file", data: new Uint8Array() }, { signal, parent, retainCleanup: true, mode: 0o600 });
            ownedPaths.add(staging.directory.path);
            break;
          } catch (error) {
            signal.throwIfAborted();
            if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") throw error;
          }
        }
        if (!staging?.writer) fail("ZIP metadata requires a retained staged writer");
        signal.throwIfAborted();
      });
      return {
        async append(bytes: Uint8Array) {
          if (sealed) fail("ZIP scratch is sealed");
          await operation(async () => {
            if (!Number.isSafeInteger(bytes.length) || bytes.length < 0 || bytes.length > Number.MAX_SAFE_INTEGER - size) fail("ZIP metadata scratch size overflow");
            for (let offset = 0; offset < bytes.length; offset += scope.limits.chunkSize) {
              signal.throwIfAborted();
              await staging!.writer!.write(bytes.subarray(offset, offset + scope.limits.chunkSize), { signal });
            }
            size += bytes.length;
          });
        },
        async finish(): Promise<ArchiveReadSource> {
          if (sealed) fail("ZIP scratch is sealed");
          sealed = true;
          return operation(async () => {
            const stat = await staging!.writer!.finish({ signal });
            staging = { ...staging!, file: { ...staging!.file, stat } };
            handle = await fs.openReadFile!(staging.file.path, { signal });
            signal.throwIfAborted();
            const validate = async () => {
              const current = await handle!.stat({ signal });
              if (current.type !== "file" || current.size !== size || compareIdentity(stat, current) !== "same" || !compareFileVersion(stat, current)) fail("ZIP scratch changed after sealing");
            };
            await validate();
            return { size, read: (offset, length) => operation(async () => {
              if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || offset > size || length < 0) fail("ZIP invalid scratch range");
              const maximum = Math.min(length, size - offset, scope.limits.chunkSize);
              if (!maximum) return new Uint8Array();
              await validate();
              const bytes = await handle!.read(offset, maximum, { signal });
              await validate();
              if (!bytes.length || bytes.length > maximum) fail("ZIP invalid scratch read");
              return bytes;
            }) };
          });
        },
        close: retire,
      };
    } catch (error) {
      try { await retire(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "ZIP scratch acquisition and cleanup failed"); }
      throw error;
    }
  };
  return Object.assign(create, { close, initialize, ownsPath: (path: string) => {
    for (const owned of ownedPaths) if (path === owned || path.startsWith(`${owned}/`)) return true;
    return false;
  } });
}
