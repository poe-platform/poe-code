import { SandboxError } from "./budget.js";

const runningObjects = new WeakSet<object>();
const lockedCollections = new WeakSet<object>();
const activeSnapshots = new WeakSet<object>();

export function enterRunningState(object: object): () => void {
  if (runningObjects.has(object)) {
    throw new SandboxError("reentry");
  }

  runningObjects.add(object);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    runningObjects.delete(object);
  };
}

export function enterCollectionCallback(object: object): () => void {
  const leaveRunning = enterRunningState(object);
  lockedCollections.add(object);
  return () => {
    lockedCollections.delete(object);
    leaveRunning();
  };
}

export function assertCollectionMutable(object: object): void {
  if (lockedCollections.has(object)) {
    throw new SandboxError("reentry");
  }
}

export function enterSnapshotRun(snapshot: object): () => void {
  if (activeSnapshots.has(snapshot)) {
    throw new SandboxError("reentry");
  }
  activeSnapshots.add(snapshot);
  return () => activeSnapshots.delete(snapshot);
}

export function assertSnapshotInactive(snapshot: object): void {
  if (activeSnapshots.has(snapshot)) {
    throw new SandboxError("reentry");
  }
}
