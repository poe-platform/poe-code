import { serializeSafeJSSnapshot } from "./dump-format.js";
import { SandboxError } from "../interp/budget.js";
const RUN_DUMP_CONTROLLER = Symbol("SafeJS.run-dump-controller");
export function attachDumpController(result, controller) {
    Object.defineProperty(result, RUN_DUMP_CONTROLLER, {
        configurable: false,
        enumerable: false,
        value: controller,
        writable: false
    });
    return result;
}
export function createDumpController(lifecycle) {
    let finished = false;
    let failed;
    let finalSnapshot;
    let latestSnapshot;
    let latestSnapshotFactory;
    let pendingRequest;
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
        requestCurrentSnapshot() {
            assertDumpAllowed();
            if (failed !== undefined) {
                return Promise.reject(failed.error);
            }
            if (latestSnapshot !== undefined || latestSnapshotFactory !== undefined) {
                try {
                    return Promise.resolve(serializeRunSnapshot(latestSnapshot ?? latestSnapshotFactory()));
                }
                catch (error) {
                    return Promise.reject(error);
                }
            }
            return this.requestSnapshot();
        },
        requestSnapshot() {
            assertDumpAllowed();
            if (failed !== undefined) {
                if (isDataBudgetError(failed.error) &&
                    (latestSnapshot !== undefined || latestSnapshotFactory !== undefined)) {
                    try {
                        return Promise.resolve(serializeRunSnapshot(latestSnapshot ?? latestSnapshotFactory()));
                    }
                    catch (error) {
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
                }
                catch (error) {
                    return Promise.reject(error);
                }
            }
            if (pendingRequest !== undefined) {
                return pendingRequest.promise;
            }
            let resolveSnapshot = () => undefined;
            let rejectSnapshot = () => undefined;
            const promise = new Promise((resolve, reject) => {
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
    function assertDumpAllowed() {
        if ((lifecycle?.hostCallbackDepth ?? 0) > 0) {
            throw new SandboxError("reentry");
        }
    }
    function settlePendingSnapshot(snapshot) {
        try {
            settlePendingRequest(serializeRunSnapshot(snapshot));
        }
        catch (error) {
            pendingRequest?.reject(error);
            pendingRequest = undefined;
        }
    }
    function settlePendingRequest(snapshot) {
        if (pendingRequest === undefined) {
            return;
        }
        pendingRequest.resolve(snapshot);
        pendingRequest = undefined;
    }
}
function isDataBudgetError(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "budgetExceeded" &&
        "budget" in error &&
        error.budget === "dataSize");
}
export function dump(result) {
    const controller = readDumpController(result);
    if (controller !== undefined) {
        return controller.requestSnapshot();
    }
    if (hasSnapshot(result)) {
        try {
            return Promise.resolve(serializeRunSnapshot(result.snapshot));
        }
        catch (error) {
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
export function dumpCurrent(result) {
    const controller = readDumpController(result);
    if (controller !== undefined) {
        return controller.requestCurrentSnapshot();
    }
    return dump(result);
}
export function serializeRunSnapshot(snapshot) {
    return serializeSafeJSSnapshot(snapshot);
}
function hasSnapshot(value) {
    return (typeof value === "object" &&
        value !== null &&
        Object.prototype.hasOwnProperty.call(value, "snapshot"));
}
function readDumpController(value) {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }
    return value[RUN_DUMP_CONTROLLER];
}
