import { expect, it } from "vitest";
import { cloneSandboxValue, deepCopyToSandbox, getPromiseProperties, isSandboxPromise } from "./values.js";
import { importedPromisePropertySnapshots } from "./promise-state.js";
import { decodeReplayData, encodeReplayData } from "../snapshot/replay-data.js";

it("captures self references without changing imported Promise identity", async () => {
  const native = Promise.resolve(7);
  Object.defineProperty(native, "self", { value: native });
  const promise = deepCopyToSandbox(native);
  if (!isSandboxPromise(promise)) throw new Error("Missing Promise");
  cloneSandboxValue({ promise }, { captureImportedProperties: true });
  expect(importedPromisePropertySnapshots.get(promise)).toMatchObject({ self: promise });
  expect((importedPromisePropertySnapshots.get(promise) as Record<string, unknown>).self).toBe(promise);
  await promise.promise;
  const graph = encodeReplayData({ promise }, { captureSettledImportedPromises: true });
  const restored = decodeReplayData(graph) as { promise: typeof promise };
  expect(getPromiseProperties(restored.promise).self).toBe(restored.promise);
});
