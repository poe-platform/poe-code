import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { parse, stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";
import type { PipelineFileSystem } from "@poe-code/pipeline";
import { runPipeline, type AgentRunInput, type PipelineRunOptions } from "./pipeline.js";

const scenarios = [
  { name: "absolute path", plan: "/repo/custom/plan.md", absolute: "/repo/custom/plan.md" },
  { name: "relative path", plan: "custom/plan.md", absolute: "/repo/custom/plan.md" },
  { name: "relative path with parent segments", plan: "custom/../custom/plan.md", absolute: "/repo/custom/plan.md" },
  { name: "home-relative path", plan: "~/custom/plan.md", absolute: "/home/fixture/custom/plan.md" },
  { name: "different configured discovery directory", plan: "/repo/custom/plan.md", absolute: "/repo/custom/plan.md", planDirectory: "/elsewhere/discovery" },
  { name: "number-prefixed filename", plan: "/repo/custom/07-plan.md", absolute: "/repo/custom/07-plan.md" }
];

function document(title: string, options: { done?: boolean; teardown?: boolean; nextTask?: boolean } = {}) {
  const task = { id: "selected", title, prompt: title, status: options.done ? "done" : "open" };
  const metadata = {
    kind: "pipeline", version: 1,
    ...(options.teardown ? { teardown: { prompt: "Finish selected work" } } : {}),
    tasks: [task, ...(options.nextTask ? [{ id: "next", title: "Next work", prompt: "Next work", status: "open" }] : [])]
  };
  return `---\n${stringify(metadata)}---\n# ${title}\n\nKeep this plan body unchanged.\n`;
}

function metadata(content: string) {
  const end = content.indexOf("\n---", 4);
  expect(end).toBeGreaterThan(0);
  return parse(content.slice(4, end)) as { state?: string; tasks: Array<{ id: string; status: string }> };
}

function fixture(scenario = scenarios[0], matchingPlan = true, content = document("Selected work")) {
  const directory = scenario.planDirectory ?? "/repo/docs/plans";
  const selectedDirectory = path.dirname(scenario.absolute);
  const unchanged = {
    [`${directory}/keep.md`]: document("Keep discovery work active"),
    [`${selectedDirectory}/99-keep.md`]: document("Keep selected-directory work active"),
    ...(matchingPlan ? { [`${directory}/plan.md`]: document("Unrelated unfinished work") } : {})
  };
  const raw = createFsFromVolume(Volume.fromJSON({ ...unchanged, [scenario.absolute]: content })).promises;
  const runner = vi.fn(async (input: AgentRunInput) => ({ stdout: input.prompt, stderr: "", exitCode: 0 }));
  const options: PipelineRunOptions = {
    agent: "fixture-agent", cwd: "/repo", homeDir: "/home/fixture",
    plan: scenario.plan, logDir: "/logs", fs: raw as unknown as PipelineFileSystem,
    runAgent: runner,
    ...(scenario.planDirectory ? { planDirectory: scenario.planDirectory } : {})
  };
  const archivePath = `${selectedDirectory}/archive/plan.md`;
  async function assertUnrelated() {
    for (const [filename, expected] of Object.entries(unchanged)) {
      expect(await raw.readFile(filename, "utf8")).toBe(expected);
    }
    await expect(raw.stat(`${directory}/archive/plan.md`)).rejects.toMatchObject({ code: "ENOENT" });
  }
  async function readSelected() {
    return metadata(String(await raw.readFile(scenario.absolute, "utf8")));
  }
  return { options, raw, runner, archivePath, selectedPath: scenario.absolute, assertUnrelated, readSelected };
}

describe("Pipeline SDK archives the selected plan", () => {
  describe.each(scenarios)("$name", (scenario) => {
    it.each([false, true])("ignores discovery-directory identities (matching unrelated plan: %s)", async (matchingPlan) => {
      const setup = fixture(scenario, matchingPlan);
      const result = await runPipeline(setup.options);

      expect(result).toMatchObject({ stopReason: "completed", runsCompleted: 1, planPath: scenario.plan });
      expect(setup.runner).toHaveBeenCalledTimes(1);
      expect(setup.runner.mock.calls[0][0].prompt).toBe("Selected work");
      await expect(setup.raw.stat(setup.selectedPath)).rejects.toMatchObject({ code: "ENOENT" });
      const archived = String(await setup.raw.readFile(setup.archivePath, "utf8"));
      expect(metadata(archived)).toMatchObject({ state: "archived", tasks: [{ id: "selected", status: "done" }] });
      expect(archived).toContain("# Selected work\n\nKeep this plan body unchanged.");
      await setup.assertUnrelated();
    });
  });

  it("still archives a plan chosen through configured discovery", async () => {
    const setup = fixture();
    const selectPlan = vi.fn(async (input: { options: Array<{ value: string }> }) => {
      return input.options.find(option => option.value.endsWith("/plan.md"))?.value ?? null;
    });
    const result = await runPipeline({ ...setup.options, plan: undefined, planDirectory: "custom", selectPlan });
    expect(result.stopReason).toBe("completed");
    expect(selectPlan).toHaveBeenCalledTimes(1);
    await expect(setup.raw.stat(setup.selectedPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(metadata(String(await setup.raw.readFile(setup.archivePath, "utf8"))).state).toBe("archived");
    await setup.assertUnrelated();
  });

  it("leaves the selected plan active when archiving is disabled", async () => {
    const setup = fixture();
    const result = await runPipeline({ ...setup.options, archive: false });
    expect(result.stopReason).toBe("completed");
    expect(await setup.readSelected()).toMatchObject({ tasks: [{ status: "done" }] });
    await expect(setup.raw.stat(setup.archivePath)).rejects.toMatchObject({ code: "ENOENT" });
    await setup.assertUnrelated();
  });

  it("does not archive a selected plan that was already complete", async () => {
    const content = document("Selected work", { done: true });
    const setup = fixture(scenarios[0], true, content);
    const result = await runPipeline(setup.options);
    expect(result.stopReason).toBe("nothing_to_run");
    expect(setup.runner).not.toHaveBeenCalled();
    expect(await setup.raw.readFile(setup.selectedPath, "utf8")).toBe(content);
    await expect(setup.raw.stat(setup.archivePath)).rejects.toMatchObject({ code: "ENOENT" });
    await setup.assertUnrelated();
  });

  it.each(["task", "teardown"] as const)("does not archive either plan after a failed %s", async (phase) => {
    const setup = fixture(scenarios[0], true, document("Selected work", { teardown: phase === "teardown" }));
    setup.runner.mockImplementation(async input => ({
      stdout: "", stderr: "Fixture failure",
      exitCode: phase === "task" || input.prompt === "Finish selected work" ? 1 : 0
    }));
    const result = await runPipeline(setup.options);
    expect(result.stopReason).toBe("failed");
    expect(await setup.readSelected()).toMatchObject({ tasks: [{ status: phase === "task" ? "failed" : "done" }] });
    await expect(setup.raw.stat(setup.archivePath)).rejects.toMatchObject({ code: "ENOENT" });
    await setup.assertUnrelated();
  });

  it("keeps both plans active when the run limit leaves selected work unfinished", async () => {
    const setup = fixture(scenarios[0], true, document("Selected work", { nextTask: true }));
    const result = await runPipeline({ ...setup.options, maxRuns: 1 });
    expect(result.stopReason).toBe("max_runs");
    expect(setup.runner).toHaveBeenCalledTimes(1);
    expect(await setup.readSelected()).toMatchObject({ tasks: [{ status: "done" }, { status: "open" }] });
    await expect(setup.raw.stat(setup.archivePath)).rejects.toMatchObject({ code: "ENOENT" });
    await setup.assertUnrelated();
  });

  it("reports a selected-directory archive collision without touching the other plan", async () => {
    const setup = fixture();
    const existing = document("Previously archived work", { done: true });
    await setup.raw.mkdir(path.dirname(setup.archivePath), { recursive: true });
    await setup.raw.writeFile(setup.archivePath, existing);
    await expect(runPipeline(setup.options)).rejects.toMatchObject({ name: "TaskAlreadyExistsError" });
    expect(await setup.readSelected()).toMatchObject({ tasks: [{ status: "done" }] });
    expect(await setup.raw.readFile(setup.archivePath, "utf8")).toBe(existing);
    await setup.assertUnrelated();
  });
});
