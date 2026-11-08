import { hashSource } from "./parse/hash.js";
import { replaceErrorStack } from "./error/shape.js";
import { SnapshotValidationError, validateDumpEnvelope } from "./snapshot/validation.js";
import { EXECUTION_SEMANTICS } from "./snapshot/dump-format.js";
import { assertSnapshotInactive } from "./interp/running-state.js";
export class SnapshotMismatchError extends Error {
    actualHash;
    expectedHash;
    constructor(expectedHash, actualHash) {
        super(`source changed since snapshot was taken (hash ${expectedHash} expected, got ${actualHash}); pass --reset to discard`);
        this.name = "SnapshotMismatchError";
        this.actualHash = actualHash;
        this.expectedHash = expectedHash;
        replaceErrorStack(this);
    }
}
export function restore(snapshot, options) {
    assertSnapshotInactive(snapshot);
    validateDumpEnvelope(snapshot);
    if (snapshot.executionSemantics !== EXECUTION_SEMANTICS &&
        (snapshot.executionSemantics !== undefined ||
            snapshot.promiseReplay !== undefined ||
            snapshot.replay !== undefined ||
            snapshot.initialInputs !== undefined)) {
        throw new SnapshotValidationError("unsupportedVersion", "$.executionSemantics", "incompatible execution semantics; resume with the SafeJS version that created this snapshot. Migration requires explicit reconciliation, not changing its version marker.");
    }
    const currentSourceHash = hashSource(options.source);
    if (snapshot.sourceHash !== currentSourceHash) {
        throw new SnapshotMismatchError(snapshot.sourceHash, currentSourceHash);
    }
    return snapshot;
}
