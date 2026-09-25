import { collectBytes, dirname, FsError, joinPath, type CommandContext, type CreateStagedFileOptions, type FileReadHandle, type FileStaging, type FileStagingEntry, type FileStat } from "../contracts/index.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { compareCopyIdentity } from "./copy-identity.js";
import { filesystemCommandRequirements } from "./filesystem-requirements.js";
import { codeOf } from "./internal.js";
import type { MoveBudget } from "./move.js";

export interface MoveStagingPlan {
  readonly target: string;
  readonly resolutionGuard?: () => true;
  readonly parent: FileStat;
  readonly ancestors: readonly FileStagingEntry[];
  readonly metadata: Pick<CreateStagedFileOptions, "mode" | "atimeMs" | "mtimeMs">;
}

function authoritative(stat: FileStat): boolean {
  return compareCopyIdentity(stat, stat) === "same" && Number.isSafeInteger(stat.revision) && stat.revision! >= 0;
}

export async function prepareMoveStaging(context: CommandContext, source: string, sourceStat: FileStat,
  target: string, expected: FileStat, budget: MoveBudget): Promise<MoveStagingPlan> {
  checkSource(sourceStat, sourceStat, source);
  let canonicalTarget = target;
  let boundAncestors: readonly FileStagingEntry[] | undefined;
  let resolutionGuard: (() => true) | undefined;
  if (context.fs.prepareStagingResolution) {
    const declared = await context.fs.capabilitiesFor?.(target, { signal: context.signal, stagingResolution: true }) ?? context.fs.capabilities;
    context.signal.throwIfAborted();
    if (declared.synchronousStagingResolution === true) {
      const resolution = await context.fs.prepareStagingResolution(target, { signal: context.signal });
      context.signal.throwIfAborted();
      const current = resolution.destination;
      if (!current || current.type !== "file" || compareCopyIdentity(expected, current) !== "same"
        || (["revision", "size", "mode", "nlink", "mtimeMs", "ctimeMs"] as const).some(field => expected[field] !== current[field])) {
        throw new FsError("EAGAIN", { path: target, message: "move destination changed during resolution capture" });
      }
      resolutionGuard = () => {
        context.signal.throwIfAborted();
        const result: unknown = resolution.validate();
        if (result !== true) {
          void Promise.resolve(result).catch(() => {});
          throw new FsError("ENOTSUP", { path: target, message: "move resolution validation must be synchronous" });
        }
        return true;
      };
      resolutionGuard();
      canonicalTarget = resolution.path;
      boundAncestors = resolution.ancestors;
    }
  }
  const capabilities = await context.fs.capabilitiesFor?.(canonicalTarget, { signal: context.signal, stagingAncestry: true }) ?? context.fs.capabilities;
  context.signal.throwIfAborted();
  if (context.fs.capabilities.readOnly === true || capabilities.readOnly === true) throw new FsError("EROFS", { path: target });
  if (!context.fs.createStagedFile || !context.fs.publishStagedFile
    || capabilities.atomicFileStaging !== true || capabilities.retainedStagingCleanup !== true
    || capabilities.atomicStagingAncestry !== true || capabilities.guardedStagingPublication !== true) {
    throw new FsError("ENOTSUP", { path: target, message: "cross-device overwrite requires atomic destination and ancestry binding" });
  }
  assertCommandRequirements(context, filesystemCommandRequirements.mv, ["cross-staged"], capabilities);
  if (!authoritative(expected)) throw new FsError("ENOTSUP", {
    path: target, message: "cross-device overwrite requires atomic destination and ancestry binding: move destination lacks authoritative snapshot",
  });
  const paths: string[] = [];
  for (let path = dirname(canonicalTarget);; path = dirname(path)) {
    await budget.step();
    paths.push(path);
    if (path === "/") break;
  }
  const ancestors: FileStagingEntry[] = boundAncestors ? [...boundAncestors] : [];
  for (const path of boundAncestors ? [] : paths.reverse()) {
    const stat = await context.fs.lstat(path, { signal: context.signal });
    if (stat.type !== "directory" || compareCopyIdentity(stat, stat) !== "same") {
      throw new FsError("ENOTSUP", { path, message: "move destination ancestry lacks authoritative directory identity" });
    }
    ancestors.push({ path, stat });
  }
  return { target: canonicalTarget, ...(resolutionGuard ? { resolutionGuard } : {}), parent: ancestors[ancestors.length - 1]!.stat, ancestors, metadata: {
    ...(capabilities.permissions === true ? { mode: sourceStat.mode & 0o7777 } : {}),
    ...(capabilities.timestamps === true ? { atimeMs: sourceStat.atimeMs, mtimeMs: sourceStat.mtimeMs } : {}),
  } };
}

function checkSource(expected: FileStat, current: FileStat, source: string): void {
  if (!authoritative(expected) || !authoritative(current)) throw new FsError("ENOTSUP", { path: source, message: "move source lacks authoritative snapshot" });
  if (compareCopyIdentity(expected, current) !== "same" || current.type !== "file"
    || expected.revision !== current.revision || expected.size !== current.size
    || expected.mode !== current.mode || expected.nlink !== current.nlink
    || expected.mtimeMs !== current.mtimeMs || expected.ctimeMs !== current.ctimeMs) {
    throw new FsError("EBUSY", { path: source, message: "move source changed during retained read" });
  }
}

export async function stageMoveReplacement(context: CommandContext, source: string, target: string,
  expected: FileStat, destination: FileStat, plan: MoveStagingPlan, budget: MoveBudget): Promise<void> {
  const publicationTarget = plan.target;
  let accepting = true;
  let reader: FileReadHandle | undefined;
  let staging: FileStaging | undefined;
  let active: Promise<unknown> | undefined;
  let reading: Promise<Uint8Array> | undefined;
  let closing: Promise<void> | undefined;
  const assertOpen = (): true => {
    context.signal.throwIfAborted();
    if (!accepting) throw new FsError("EBADF", { path: source });
    return true;
  };
  const operation = <T>(action: () => Promise<T>): Promise<T> => {
    assertOpen();
    // Install the drain before invoking a provider that can reenter cleanup.
    const result = Promise.resolve().then(() => { assertOpen(); return action(); });
    active = result;
    return result;
  };
  const close = (): Promise<void> => {
    accepting = false;
    return closing ??= (async () => {
      await active?.catch(() => {});
      // collectBytes can stop observing its iterator immediately on abort.
      // Retain the admitted read independently until the provider settles it.
      await reading?.catch(() => {});
      const results = await Promise.allSettled([
        Promise.resolve().then(() => staging?.cleanup?.remove()),
        Promise.resolve().then(() => reader?.close()),
      ]);
      const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
      try { await staging?.cleanup?.close(); } catch (error) { errors.push(error); }
      reader = undefined; staging = undefined; active = undefined; reading = undefined;
      if (errors.length) throw new AggregateError(errors, "move resource cleanup failed");
    })();
  };
  context.registerCleanup?.(close);
  let failed = false, failure: unknown;
  try {
    plan.resolutionGuard?.();
    await operation(async () => { reader = await context.fs.openReadFile!(source, { signal: context.signal }); });
    checkSource(expected, await operation(() => reader!.stat({ signal: context.signal })), source);
    const size = expected.size, maxMemoryBytes = size * 3 + 64 * 1024;
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(maxMemoryBytes)) {
      throw new FsError("EFBIG", { path: source, message: "move source exceeds bounded collection capacity" });
    }
    context.inputBudget?.check(size);
    if (size > (context.inputBudget?.maxBytes ?? Infinity)) throw new FsError("EFBIG", { path: source, message: "move source exceeds input budget" });
    const data = await operation(() => collectBytes((async function* () {
      let position = 0;
      while (true) {
        assertOpen();
        await budget.step();
        reading = Promise.resolve().then(() => {
          assertOpen();
          return reader!.read(position, 64 * 1024, { signal: context.signal });
        });
        const chunk = await reading;
        if (!chunk.length) return;
        position += chunk.length;
        yield chunk;
      }
    })(), { maxBytes: size, maxMemoryBytes, signal: context.signal }));
    if (data.length !== size) throw new FsError("EBUSY", { path: source, message: "move source size changed" });
    checkSource(expected, await operation(() => reader!.stat({ signal: context.signal })), source);
    for (let attempt = 0; attempt < 128; attempt++) {
      await budget.step();
      const candidate = joinPath(dirname(publicationTarget), `.mv-${attempt + 1}`);
      if (candidate === publicationTarget) continue;
      try {
        await operation(async () => {
          staging = await context.fs.createStagedFile!(candidate, "entry", { type: "file", data }, {
            parent: plan.parent, retainCleanup: true, ...plan.metadata, signal: context.signal,
          });
        });
        break;
      } catch (error) { assertOpen(); if (codeOf(error) !== "EEXIST") throw error; }
    }
    if (!staging) throw new FsError("EEXIST", { path: target, message: "move staging attempt limit exceeded" });
    if (!staging.cleanup) throw new FsError("ENOTSUP", { path: target, message: "move staging omitted retained cleanup" });
    // Reject changes observed during staging. These reads are not a lease:
    // conditional removal still protects the source after publication.
    checkSource(expected, await operation(() => reader!.stat({ signal: context.signal })), source);
    checkSource(expected, await operation(() => context.fs.lstat(source, { signal: context.signal })), source);
    await operation(() => context.fs.publishStagedFile!(staging!, publicationTarget, {
      parent: plan.parent, destination, ancestors: plan.ancestors, commitGuard: () => {
        assertOpen();
        plan.resolutionGuard?.();
        return true;
      }, signal: context.signal,
    }));
  } catch (error) { failed = true; failure = error; }
  finally {
    try { await close(); }
    catch (error) {
      failure = failed ? new AggregateError([failure, error], "move failed and cleanup failed") : error;
      failed = true;
    }
  }
  if (failed) throw failure;
}
