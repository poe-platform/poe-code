import { beforeEach, expect, it, vi } from "vitest";
import { executeTest262 } from "./execute.js";
import { executeWorkerRequest } from "./worker.js";

vi.mock("./execute.js", () => ({ executeTest262: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const request = { type: "execute", id: "variant-1", filename: "sample.js", source: "0", mode: "strict", harness: [["assert.js", "0"]], timeoutMs: 3000 };
it("signals execution start before guest work and returns exactly the selected variant", async () => {
  const messages: unknown[] = [];
  vi.mocked(executeTest262).mockImplementation(async (_filename, _source, options) => {
    expect(messages).toEqual([{ type: "started", id: "variant-1" }]);
    expect(options).toMatchObject({ mode: "strict", timeoutMs: 3000, harness: new Map([["assert.js", "0"]]) });
    return { kind: "test", results: [{ mode: "strict", status: "passed" }] };
  });
  await executeWorkerRequest(request, message => messages.push(message));
  expect(messages).toEqual([{ type: "started", id: "variant-1" }, { type: "result", id: "variant-1", result: { mode: "strict", status: "passed" } }]);
});
it.each([
  { ...request, mode: "invented" }, { ...request, harness: [["assert.js", 1]] },
  { ...request, timeoutMs: 0 }, { ...request, source: 42 }
])("rejects malformed worker requests without executing", async invalid => {
  const messages: unknown[] = [];
  await executeWorkerRequest(invalid, message => messages.push(message));
  expect(executeTest262).not.toHaveBeenCalled();
  expect(messages).toEqual([{ type: "error", id: "variant-1", message: "Invalid Test262 worker request" }]);
});
it("never converts missing or extra execution results into a pass", async () => {
  const messages: unknown[] = [];
  vi.mocked(executeTest262).mockResolvedValue({ kind: "test", results: [{ mode: "sloppy", status: "passed" }, { mode: "strict", status: "passed" }] });
  await executeWorkerRequest(request, message => messages.push(message));
  expect(messages.at(-1)).toMatchObject({ type: "error", id: "variant-1" });
});
it("reports execution exceptions independently of guest negatives", async () => {
  const messages: unknown[] = [];
  vi.mocked(executeTest262).mockRejectedValue(new Error("worker failure"));
  await executeWorkerRequest(request, message => messages.push(message));
  expect(messages.at(-1)).toEqual({ type: "error", id: "variant-1", message: "worker failure" });
});
