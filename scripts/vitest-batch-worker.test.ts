import { expect, it, vi, beforeEach } from "vitest";
import { runBatchFiles } from "./vitest-batch-worker.mjs";
const mocks = vi.hoisted(() => ({ createVitest: vi.fn() }));
vi.mock("vitest/node", () => ({ createVitest: mocks.createVitest }));
vi.mock("./vitest-immediate-reporter.mjs", () => ({ default: class {} }));
beforeEach(() => mocks.createVitest.mockReset());
function context() {
  const state = {
    config: { isolate: true, globalSetup: [], coverage: { enabled: false } },
    globTestSpecifications: vi.fn(async () => [{ moduleId: "/repo/a.test.ts" }, { moduleId: "/repo/other.test.ts" }]),
    standalone: vi.fn(async () => undefined),
    runTestSpecifications: vi.fn(async () => ({ unhandledErrors: [], testModules: [{ moduleId: "/repo/a.test.ts", ok: () => true }] })),
    close: vi.fn(async () => undefined)
  };
  mocks.createVitest.mockResolvedValue(state);
  return state;
}
it("executes only exact selected files and closes the runner before reporting completion", async () => {
  const state = context();
  expect(await runBatchFiles("/repo", ["/repo/a.test.ts"])).toEqual(["/repo/a.test.ts"]);
  expect(state.runTestSpecifications).toHaveBeenCalledExactlyOnceWith([{ moduleId: "/repo/a.test.ts" }], false);
  expect(state.close).toHaveBeenCalledOnce();
});
it("rejects unsafe selections before creating the runner", async () => {
  await expect(runBatchFiles("/repo", ["/foreign/a.test.ts"])).rejects.toThrow();
  expect(mocks.createVitest).not.toHaveBeenCalled();
});
it("rejects partial completion and closes the runner", async () => {
  const state = context();
  state.runTestSpecifications.mockResolvedValueOnce({ unhandledErrors: [], testModules: [] });
  await expect(runBatchFiles("/repo", ["/repo/a.test.ts"])).rejects.toThrow("complete every file");
  expect(state.close).toHaveBeenCalledOnce();
});
it("preserves both execution and cleanup failures", async () => {
  const state = context();
  state.runTestSpecifications.mockRejectedValueOnce(new Error("execution"));
  state.close.mockRejectedValueOnce(new Error("cleanup"));
  await expect(runBatchFiles("/repo", ["/repo/a.test.ts"])).rejects.toBeInstanceOf(AggregateError);
});
it("accepts a canonical checkout root with a trailing separator", async () => {
  const state = context();
  expect(await runBatchFiles("/repo/", ["/repo/a.test.ts"])).toEqual(["/repo/a.test.ts"]);
  expect(state.close).toHaveBeenCalledOnce();
});
