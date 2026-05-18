import type { RunResult, RunSnapshot } from "../run.js";

const RUN_DUMP_CONTROLLER = Symbol("agent-script.run-dump-controller");

type DumpController = {
  fail(error: unknown): void;
  finalize(snapshot: RunSnapshot): void;
  onYield(createSnapshot: () => RunSnapshot): void;
  requestSnapshot(): Promise<string>;
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

export function createDumpController(): DumpController {
  let finished = false;
  let failed:
    | {
        error: unknown;
      }
    | undefined;
  let finalSnapshot: RunSnapshot | undefined;
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

      if (pendingRequest !== undefined) {
        settlePendingSnapshot(snapshot);
      }
    },
    onYield(createSnapshot) {
      if (pendingRequest === undefined) {
        return;
      }

      settlePendingSnapshot(createSnapshot());
    },
    requestSnapshot() {
      if (failed !== undefined) {
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

export function dump(result: Pick<RunResult, "snapshot"> | PromiseLike<RunResult>): Promise<string> {
  const controller = readDumpController(result);

  if (controller !== undefined) {
    return controller.requestSnapshot();
  }

  if (hasSnapshot(result)) {
    return Promise.resolve(serializeRunSnapshot(result.snapshot));
  }

  return Promise.resolve(result).then(({ snapshot }) => serializeRunSnapshot(snapshot));
}

export function serializeRunSnapshot(snapshot: RunSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

function hasSnapshot(value: unknown): value is Pick<RunResult, "snapshot"> {
  return typeof value === "object" && value !== null && "snapshot" in value;
}

function readDumpController(value: unknown): DumpController | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return (value as DumpableRunResult)[RUN_DUMP_CONTROLLER];
}
