import { afterEach, describe, expect, it, vi } from "vitest";
import { createDashboard, type DashboardOptions } from "toolcraft-design";
import { createRunQueue } from "./run-queue.js";
import { createHarnessDashboard } from "./harness-dashboard.js";

vi.mock("toolcraft-design", async (importOriginal) => ({
  ...await importOriginal<typeof import("toolcraft-design")>(),
  createDashboard: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), destroy: vi.fn(), updateStats: vi.fn(), appendOutput: vi.fn(), onCommand: vi.fn(), getPerformance: vi.fn() }))
}));
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("harness dashboard controller", () => {
  it("shows ordered work and accepts multiple follow-ups for a selected plan", async () => {
    vi.useFakeTimers();
    const queue = createRunQueue({ plans: ["one.md", "two.md"] });
    const view = createHarnessDashboard({ title: "Pipeline", agent: "codex", model: "model", cwd: "/repo", queue });
    view.start();
    const options = vi.mocked(createDashboard).mock.calls[0]![0] as DashboardOptions;
    const target = queue.getSnapshot().items[1]!.id;
    await options.onSubmit!({ kind: "message", text: "Review", afterPlanId: target });
    await options.onSubmit!({ kind: "message", text: "Verify", afterPlanId: target });
    expect(queue.getSnapshot().items.map((item) => item.kind === "plan" ? item.path : item.text)).toEqual(["one.md", "two.md", "Review", "Verify"]);
    expect(view.dashboard.updateStats).toHaveBeenLastCalledWith(expect.objectContaining({ usageAvailable: false, run: expect.objectContaining({ agent: "codex", model: "model", queue: queue.getSnapshot().items }) }));
    view.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("validates plans before accepting and never adds rejected input", async () => {
    const queue = createRunQueue({ plans: ["one.md"] });
    const validatePlan = vi.fn(async (file: string) => {
      if (file === "missing.md") throw new Error("Plan file not found");
      return `/repo/${file}`;
    });
    const view = createHarnessDashboard({ title: "Pipeline", agent: "codex", cwd: "/repo", queue, validatePlan });
    view.start();
    const submit = vi.mocked(createDashboard).mock.calls[0]![0]!.onSubmit!;
    await expect(submit({ kind: "plan", text: "missing.md" })).rejects.toThrow("Plan file not found");
    await submit({ kind: "plan", text: "two.md" });
    expect(queue.getSnapshot().items).toHaveLength(2);
    expect(queue.getSnapshot().items[1]).toMatchObject({ path: "/repo/two.md" });
    view.dispose();
  });

  it("accepts a plan submitted while running even if validation outlasts the last current item", async () => {
    const queue = createRunQueue({ plans: ["one.md"] });
    let validate!: (value: string) => void;
    let finish!: () => void;
    const view = createHarnessDashboard({
      title: "Pipeline", agent: "codex", cwd: "/repo", queue,
      validatePlan: () => new Promise<string>((resolve) => { validate = resolve; })
    });
    view.start();
    const submit = vi.mocked(createDashboard).mock.calls[0]![0]!.onSubmit!;
    const executed: string[] = [];
    const running = queue.run({ async execute(item) {
      if (item.kind === "plan") executed.push(item.path);
      if (executed.length === 1) await new Promise<void>((resolve) => { finish = resolve; });
      return "completed";
    } });
    const submitted = Promise.resolve(submit({ kind: "plan", text: "two.md" })).catch((error: unknown) => error);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    validate("/repo/two.md");
    const result = await submitted;
    await running;
    view.dispose();
    expect(result).toBeUndefined();
    expect(executed).toEqual(["one.md", "/repo/two.md"]);
  });

  it("clears task context on plan and follow-up transitions and retains pending work on failure", async () => {
    const queue = createRunQueue({ plans: ["one.md", "two.md"], afterEachPlan: ["Review"] });
    const view = createHarnessDashboard({ title: "Pipeline", agent: "codex", cwd: "/repo", queue });
    view.start();
    await queue.run({ async execute(item) {
      if (item.kind === "plan") {
        view.updateRun({ phase: "Implement", activeTaskId: "task", activeStep: "test", tasks: [{ id: "task", title: "Ship feature", status: "running" }] });
        return "completed";
      }
      expect(view.dashboard.updateStats).toHaveBeenLastCalledWith(expect.objectContaining({ run: expect.objectContaining({ phase: "Follow-up", activeTaskId: undefined, activeStep: undefined }) }));
      return "failed";
    } });
    expect(view.dashboard.updateStats).toHaveBeenLastCalledWith(expect.objectContaining({ status: "error", run: expect.objectContaining({ queue: queue.getSnapshot().items }) }));
    expect(queue.getSnapshot().items[2]).toMatchObject({ kind: "plan", status: "pending" });
    view.dispose();
    view.dispose();
    expect(view.dashboard.destroy).toHaveBeenCalledTimes(1);
  });
});
