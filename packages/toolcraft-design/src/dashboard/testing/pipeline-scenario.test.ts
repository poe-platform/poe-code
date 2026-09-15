import { afterEach, expect, it, vi } from "vitest";

const dashboard = vi.hoisted(() => ({
  start: vi.fn(),
  destroy: vi.fn(),
  onCommand: vi.fn(),
  updateStats: vi.fn(),
  appendOutput: vi.fn()
}));
vi.mock("../dashboard.js", () => ({ createDashboard: () => dashboard }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("shows no task execution or usage for an empty fake run", async () => {
  vi.useFakeTimers();
  vi.spyOn(process, "once").mockReturnValue(process);
  vi.spyOn(process, "argv", "get").mockReturnValue(["node", "fixture", "empty"]);
  await import("./pipeline-scenario.js");
  const stats = Object.assign({}, ...dashboard.updateStats.mock.calls.map(([value]) => value));
  expect(stats).toMatchObject({
    status: "done",
    iterations: 0,
    tokensIn: 0,
    tokensOut: 0,
    elapsedMs: 0,
    currentAction: "Nothing to run"
  });
  expect(dashboard.appendOutput.mock.calls.map(([item]) => item.text).join("\n"))
    .not.toContain("Task 2/8");
});
