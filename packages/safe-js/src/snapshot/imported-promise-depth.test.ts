import { expect, it } from "vitest";
import { decodeReplayData } from "./replay-data.js";
import { isSandboxPromise } from "../interp/values.js";

function chain(length: number, cycle = false) {
  const graphs = new Map<string, unknown>();
  for (let index = 0; index < length; index++) graphs.set(String(index), {
    root: { tag: "ref", id: 0 }, nodes: [
      { kind: "settled-imported-promise", status: "fulfilled", outcome: { tag: "ref", id: 1 } },
      { kind: "object", extensible: true, nullPrototype: false, properties: {
        next: { configurable: true, enumerable: true, writable: true,
          value: index + 1 < length || cycle ? {
            tag: "imported-promise-reference", callId: String((index + 1) % length), node: 0
          } : null }
      } }
    ]
  });
  return { graph: graphs.get("0"), options: {
    graphId: "0", importedPromiseMemo: new Map(), resolvePromiseGraph: (id: string) => graphs.get(id)
  } };
}

it("reconstructs a supported chain without recursive host-stack expansion", async () => {
  const { graph, options } = chain(300);
  let value = decodeReplayData(graph, options);
  for (let index = 0; index < 300; index++) {
    if (!isSandboxPromise(value)) throw new Error("Expected Promise");
    const outcome = await value.promise;
    expect(outcome).toHaveProperty("next");
    value = (outcome as { next: typeof value }).next;
  }
  expect(value).toBeNull();
});

it("rejects combined depth with a controlled error and rolls back memo entries", () => {
  const { graph, options } = chain(600);
  expect(() => decodeReplayData(graph, options)).toThrow("Replay data exceeds the nesting limit");
  expect(options.importedPromiseMemo.size).toBe(0);
});

it("preserves a cross-graph cycle after queued reconstruction", async () => {
  const { graph, options } = chain(300, true);
  const first = decodeReplayData(graph, options);
  let value = first;
  for (let index = 0; index < 300; index++) {
    if (!isSandboxPromise(value)) throw new Error("Expected Promise");
    value = (await value.promise as { next: typeof value }).next;
  }
  expect(value).toBe(first);
});
