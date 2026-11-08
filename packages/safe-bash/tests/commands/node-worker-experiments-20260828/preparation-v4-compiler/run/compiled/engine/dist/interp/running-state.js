import { SandboxError } from "./budget.js";
const runningObjects = new WeakSet();
const lockedCollections = new WeakSet();
const activeSnapshots = new WeakSet();
export function enterRunningState(object) {
    if (runningObjects.has(object)) {
        throw new SandboxError("reentry");
    }
    runningObjects.add(object);
    let active = true;
    return () => {
        if (!active)
            return;
        active = false;
        runningObjects.delete(object);
    };
}
export function enterCollectionCallback(object) {
    const leaveRunning = enterRunningState(object);
    lockedCollections.add(object);
    return () => {
        lockedCollections.delete(object);
        leaveRunning();
    };
}
export function assertCollectionMutable(object) {
    if (lockedCollections.has(object)) {
        throw new SandboxError("reentry");
    }
}
export function enterSnapshotRun(snapshot) {
    if (activeSnapshots.has(snapshot)) {
        throw new SandboxError("reentry");
    }
    activeSnapshots.add(snapshot);
    return () => activeSnapshots.delete(snapshot);
}
export function assertSnapshotInactive(snapshot) {
    if (activeSnapshots.has(snapshot)) {
        throw new SandboxError("reentry");
    }
}
