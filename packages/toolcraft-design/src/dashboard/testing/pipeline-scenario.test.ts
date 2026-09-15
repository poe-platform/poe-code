import { afterEach, beforeEach, expect, it, vi } from "vitest";

const dashboard = vi.hoisted(() => ({
  start: vi.fn(),
  destroy: vi.fn(),
  onCommand: vi.fn(),
  updateStats: vi.fn(),
  appendOutput: vi.fn()
}));
vi.mock("../dashboard.js", () => ({ createDashboard: () => dashboard }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

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

it("provides a settled Unicode cursor and control-sequence scenario", async () => {
  vi.useFakeTimers();
  vi.spyOn(process, "once").mockReturnValue(process);
  vi.spyOn(process, "argv", "get").mockReturnValue(["node", "fixture", "cursor-controls"]);
  await import("./pipeline-scenario.js");
  const output = dashboard.appendOutput.mock.calls.map(([item]) => item.text).join("\n");
  expect(output).toContain("Cursor control fixture ready");
  expect(output).toContain("界界\rA");
  expect(output).toContain("👩‍💻\bX");
  expect(output).toContain("a\tB\rX");
  expect(output).toContain("Visible long DCS result");
  expect(output).toContain("Visible multiline OSC result");
  expect(output).toContain("Visible long CSI result");
  expect(output).not.toContain("Inspecting source file");
  const count = dashboard.appendOutput.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2_000);
  expect(dashboard.appendOutput).toHaveBeenCalledTimes(count);
});

it("provides terminal-string labels for clipping and fitting QA", async () => {
  vi.useFakeTimers();
  vi.spyOn(process, "once").mockReturnValue(process);
  vi.spyOn(process, "argv", "get").mockReturnValue(["node", "fixture", "label-controls"]);
  await import("./pipeline-scenario.js");
  expect(dashboard.appendOutput.mock.calls.map(([item]) => item.text).join("\n")).toContain("Label control fixture ready");
  expect(dashboard.updateStats).toHaveBeenCalledWith(expect.objectContaining({ iterationsLabel: expect.stringContaining("HIDDEN_") }));
});
