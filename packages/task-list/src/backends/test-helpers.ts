import { createFsFromVolume, Volume } from "memfs";
import type { TaskListFs } from "../types.js";

type TestFs = ReturnType<typeof createFsFromVolume>["promises"];

export function createFs(files: Record<string, string> = {}): {
  fs: TaskListFs;
  rawFs: TestFs;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  return {
    fs: rawFs as unknown as TaskListFs,
    rawFs,
    volume
  };
}

export function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => {
    throw new Error("Deferred promise resolved before initialization.");
  };
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

export function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

export async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }

    await flushMicrotasks();
  }

  throw new Error("Condition was not met in time.");
}
