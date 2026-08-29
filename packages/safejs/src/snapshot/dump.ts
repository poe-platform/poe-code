import type { AsyncLocalStorage } from "node:async_hooks";

import type { RunResult, RunSnapshot } from "../run.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";
import { SandboxError } from "../interp/budget.js";

const RUN_DUMP_CONTROLLER = Symbol("SafeJS.run-dump-controller");

export type DumpOptions = {
  mode?: "capture" | "replay";
  onFailure?: "throw" | "checkpoint";
};

type DumpController = {
  fail(error: unknown): void;
  finalize(snapshot: RunSnapshot): void;
  onYield(createSnapshot: () => RunSnapshot): void;
  requestCurrentSnapshot(options?: DumpOptions): Promise<string>;
  requestSnapshot(options?: DumpOptions): Promise<string>;
};

export type RunLifecycle = {
  hostCallbackContext: AsyncLocalStorage<boolean>;
  hostCallbackDepth: number;
};

type DumpableRunResult = Promise<RunResult> & {
  [RUN_DUMP_CONTROLLER]?: DumpController;
};

export function attachDumpController(
  result: Promise<RunResult>,
  controller: DumpController
): Promise<RunResult> {
  Object.defineProperty(result, RUN_DUMP_CONTROLLER, {
    configurable: false,
    enumerable: false,
    value: controller,
    writable: false
  });

  return result;
}

export function createDumpController(lifecycle?: RunLifecycle): DumpController {
  let finished = false;
  let failed:
    | {
        error: unknown;
      }
    | undefined;
  let finalSnapshot: RunSnapshot | undefined;
  let latestSnapshot: RunSnapshot | undefined;
  let latestSnapshotFactory: (() => RunSnapshot) | undefined;
  let pendingRequest:
    | {
        promise: Promise<string>;
        reject: (error: unknown) => void;
        resolve: (snapshot: string) => void;
      }
    | undefined;

  return {
    fail(error) {
      finished = true;
      failed = {
        error
      };

      if (pendingRequest === undefined) {
        return;
      }

      pendingRequest.reject(error);
      pendingRequest = undefined;
    },
    finalize(snapshot) {
      finished = true;
      finalSnapshot = snapshot;
      latestSnapshot = snapshot;
      latestSnapshotFactory = undefined;

      if (pendingRequest !== undefined) {
        settlePendingSnapshot(snapshot);
      }
    },
    onYield(createSnapshot) {
      latestSnapshot = undefined;
      latestSnapshotFactory = createSnapshot;

      if (pendingRequest === undefined) {
        return;
      }

      settlePendingSnapshot(createSnapshot());
    },
    requestCurrentSnapshot(options = {}) {
      assertDumpAllowed(options);
      if (failed !== undefined) {
        return Promise.reject(failed.error);
      }

      if (latestSnapshot !== undefined || latestSnapshotFactory !== undefined) {
        try {
          return Promise.resolve(serializeRunSnapshot(latestSnapshot ?? latestSnapshotFactory!()));
        } catch (error) {
          return Promise.reject(error);
        }
      }

      return this.requestSnapshot(options);
    },
    requestSnapshot(options = {}) {
      assertDumpAllowed(options);
      if (failed !== undefined) {
        if (
          (options.onFailure === "checkpoint" ||
            (options.onFailure === undefined && isDataBudgetError(failed.error))) &&
          finalSnapshot !== undefined
        ) {
          try {
            return Promise.resolve(serializeRunSnapshot(finalSnapshot));
          } catch (error) {
            return Promise.reject(error);
          }
        }
        return Promise.reject(failed.error);
      }

      if (finished) {
        if (finalSnapshot === undefined) {
          throw new Error("Run completed without producing a snapshot.");
        }

        try {
          const serializedSnapshot = serializeRunSnapshot(finalSnapshot);
          return Promise.resolve(serializedSnapshot);
        } catch (error) {
          return Promise.reject(error);
        }
      }

      if (
        options.mode === "replay" &&
        (latestSnapshot !== undefined || latestSnapshotFactory !== undefined)
      ) {
        return this.requestCurrentSnapshot(options);
      }

      if (pendingRequest !== undefined) {
        return pendingRequest.promise;
      }

      let resolveSnapshot: (snapshot: string) => void = () => undefined;
      let rejectSnapshot: (error: unknown) => void = () => undefined;
      const promise = new Promise<string>((resolve, reject) => {
        resolveSnapshot = resolve;
        rejectSnapshot = reject;
      });

      pendingRequest = {
        promise,
        reject: rejectSnapshot,
        resolve: resolveSnapshot
      };

      return promise;
    }
  };

  function assertDumpAllowed(options: DumpOptions): void {
    if (
      (lifecycle?.hostCallbackDepth ?? 0) > 0 &&
      (options.mode !== "replay" || lifecycle?.hostCallbackContext.getStore() === true)
    ) {
      throw new SandboxError("reentry");
    }
  }

  function settlePendingSnapshot(snapshot: RunSnapshot): void {
    try {
      settlePendingRequest(serializeRunSnapshot(snapshot));
    } catch (error) {
      pendingRequest?.reject(error);
      pendingRequest = undefined;
    }
  }

  function settlePendingRequest(snapshot: string): void {
    if (pendingRequest === undefined) {
      return;
    }

    pendingRequest.resolve(snapshot);
    pendingRequest = undefined;
  }
}

function isDataBudgetError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "budgetExceeded" &&
    "budget" in error &&
    error.budget === "dataSize"
  );
}

export function dump(
  result: Pick<RunResult, "snapshot"> | PromiseLike<RunResult>,
  options: DumpOptions = {}
): Promise<string> {
  const controller = readDumpController(result);

  if (controller !== undefined) {
    return controller.requestSnapshot(options);
  }

  if (hasSnapshot(result)) {
    try {
      return Promise.resolve(serializeRunSnapshot(result.snapshot));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return Promise.resolve(result).then((resolved) => {
    if (!hasSnapshot(resolved)) {
      throw new Error("Run completed without producing a snapshot.");
    }

    return serializeRunSnapshot(resolved.snapshot);
  });
}

export function dumpCurrent(
  result: Pick<RunResult, "snapshot"> | PromiseLike<RunResult>
): Promise<string> {
  const controller = readDumpController(result);

  if (controller !== undefined) {
    return controller.requestCurrentSnapshot();
  }

  return dump(result);
}

export function serializeRunSnapshot(snapshot: RunSnapshot): string {
  return serializeSafeJSSnapshot(snapshot);
}

function hasSnapshot(value: unknown): value is Pick<RunResult, "snapshot"> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, "snapshot")
  );
}

function readDumpController(value: unknown): DumpController | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return (value as DumpableRunResult)[RUN_DUMP_CONTROLLER];
}
