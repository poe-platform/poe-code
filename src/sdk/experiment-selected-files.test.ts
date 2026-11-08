import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { parse as parseShell } from "shell-quote";
import { describe, expect, it, vi } from "vitest";
import type { AgentRunInput, ExperimentFileSystem, ExecFn, JournalEntry } from "@poe-code/experiment-loop";
import { readExperimentJournal, runExperiment } from "./experiment.js";

const document = "---\nkind: experiment\nversion: 1\nagent: fixture-agent\nmetric:\n  name: score\n  script: fixture-metric\n  direction: maximize\nbaseline: { score: 1 }\n---\nImprove this fixture.\n";

function fixture(docPath = "/repo/docs/plans/sample.md", cwd = "/repo") {
  const journalPath = path.join(path.dirname(docPath), `${path.basename(docPath, ".md")}.journal.jsonl`);
  const originalFiles: Record<string, string> = { [docPath]: document, "/repo/src/code.txt": "baseline code" };
  const volume = Volume.fromJSON(originalFiles);
  const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
  const exec = vi.fn<ExecFn>(async (command, options) => {
    expect(options?.cwd).toBe(cwd);
    const args = parseShell(command).filter((value): value is string => typeof value === "string");
    if (command === "git rev-parse --show-cdup") return { stdout: cwd === "/repo/src" ? "../\n" : "\n", stderr: "", exitCode: 0 };
    if (command === "git rev-parse --short HEAD") return { stdout: "baseline\n", stderr: "", exitCode: 0 };
    if (args[1] === "status") {
      const exclusions = args.filter((value) => value.startsWith(":(top,exclude,literal)"))
        .map((value) => path.join("/repo", value.slice(":(top,exclude,literal)".length)));
      const files = volume.toJSON();
      const changed = Object.entries(files).filter(([filePath, content]) =>
        filePath.startsWith("/repo/") && content !== originalFiles[filePath] && !exclusions.includes(filePath) &&
        !(args.includes(":(exclude).poe-code/experiments") && filePath.startsWith("/repo/.poe-code/experiments/"))
      );
      return { stdout: changed.map(([filePath]) => ` M ${path.relative("/repo", filePath)}\n`).join(""), stderr: "", exitCode: 0 };
    }
    if (args[1] === "restore") {
      expect(args).toContain(`:(top,exclude,literal)${path.relative("/repo", docPath)}`);
      expect(args).toContain(`:(top,exclude,literal)${path.relative("/repo", journalPath)}`);
      await fs.writeFile("/repo/src/code.txt", "baseline code");
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (command === "git reset --mixed -q 'baseline'") return { stdout: "", stderr: "", exitCode: 0 };
    throw new Error(`Unexpected execution: ${command}`);
  });
  const log = async (entry: JournalEntry) => fs.appendFile(journalPath, `${JSON.stringify(entry)}\n`);
  const runAgent = vi.fn(async (_input: AgentRunInput) => {
    await log({ commit: "kept", status: "keep", scores: { score: 2 }, durationMs: 1, timestamp: "2026-09-01T00:00:00.000Z", output: "kept", agentOutput: "" });
    return { stdout: "", stderr: "", exitCode: 0 };
  });
  const options = { cwd, homeDir: "/home/fixture", docPath, fs, exec, runAgent, maxExperiments: 1 };
  return { options, fs, exec, runAgent, journalPath, log };
}

describe("public experiment selected files", () => {
  it.each([
    "/repo/docs/plans/sample.md",
    "/repo/docs/experiments/sample.md",
    "/repo/.poe-code/experiments/sample.md",
    "/repo/sample.md",
    "/home/fixture/experiments/sample.md"
  ])("starts with its new sibling journal at %s", async (docPath) => {
    const state = fixture(docPath);
    await expect(runExperiment(state.options)).resolves.toMatchObject({ experimentsCompleted: 1, experimentsKept: 1 });
    expect(state.runAgent).toHaveBeenCalledTimes(1);
    await expect(readExperimentJournal(state.options)).resolves.toMatchObject([{ status: "keep", commit: "kept" }]);
    await expect(state.fs.readFile(docPath, "utf8")).resolves.toBe(document);
    await expect(runExperiment(state.options)).resolves.toMatchObject({ experimentsCompleted: 1 });
    expect(state.runAgent).toHaveBeenCalledTimes(1);
  });

  it("resolves a selected document outside a nested invocation directory", async () => {
    const state = fixture("/repo/docs/plans/sample.md", "/repo/src");
    await expect(runExperiment({ ...state.options, docPath: "../docs/plans/sample.md" })).resolves.toMatchObject({ experimentsKept: 1 });
    expect(state.exec.mock.calls.find(([command]) => command.startsWith("git status"))?.[0])
      .toContain("':(top,exclude,literal)docs/plans/sample.journal.jsonl'");
  });

  it.each(["/repo/docs/plans/other.md", "/repo/.poe-code/experiments/other.md", "/repo/src/other.txt"])("still rejects unrelated edits to %s", async (filePath) => {
    const state = fixture();
    await state.fs.mkdir(path.dirname(filePath), { recursive: true });
    await state.fs.writeFile(filePath, "unrelated");
    await expect(runExperiment(state.options)).rejects.toThrow("requires a clean working tree");
    expect(state.runAgent).not.toHaveBeenCalled();
    expect(state.exec.mock.calls.some(([command]) => command.startsWith("git reset"))).toBe(false);
    await expect(state.fs.readFile(filePath, "utf8")).resolves.toBe("unrelated");
  });

  it("excludes only the selected files from both staging and committing", async () => {
    const state = fixture("/repo/docs/plans/a'b [x]*.md");
    await runExperiment(state.options);
    const commitLine = state.runAgent.mock.calls[0]![0].prompt.split("\n").find((line) => line.startsWith("- Commit: `"))!;
    const command = commitLine.slice("- Commit: `".length, -1);
    const sections = command.split(" && ").map((section) => parseShell(section));
    expect(sections).toEqual([
      ["git", "add", "-A", "--", ".", ":(exclude,literal)docs/plans/a'b [x]*.md", ":(exclude,literal)docs/plans/a'b [x]*.journal.jsonl"],
      ["git", "commit", "-m", "experiment-loop: a'b [x]* #1", "--", ".", ":(exclude,literal)docs/plans/a'b [x]*.md", ":(exclude,literal)docs/plans/a'b [x]*.journal.jsonl"]
    ]);
  });

  it.each(["discard", "failure", "metric", "missing", "throw", "cancelled"])("preserves current metadata while rolling back %s", async (outcome) => {
    const state = fixture();
    const defaultExec = state.exec.getMockImplementation()!;
    state.exec.mockImplementation(async (command, options) => command === "fixture-metric"
      ? { stdout: "", stderr: "failed metric", exitCode: 1 }
      : defaultExec(command, options));
    state.runAgent.mockImplementation(async () => {
      await state.fs.writeFile(state.options.docPath, `${document}\nRetain these instructions.\n`);
      await state.fs.writeFile("/repo/src/code.txt", "discarded code");
      if (outcome === "throw" || outcome === "cancelled") {
        const error = new Error("agent stopped");
        if (outcome === "cancelled") error.name = "AbortError";
        throw error;
      }
      if (outcome !== "missing") {
        await state.log({ commit: "discarded", status: outcome === "failure" || outcome === "metric" ? "keep" : "discard", durationMs: 1, timestamp: "2026-09-01T00:00:00.000Z", output: "discarded", agentOutput: "" });
      }
      return { stdout: "", stderr: "", exitCode: outcome === "failure" ? 1 : 0 };
    });
    if (outcome === "throw") await expect(runExperiment(state.options)).rejects.toThrow("agent stopped");
    else await expect(runExperiment(state.options)).resolves.toMatchObject({ stopReason: outcome === "cancelled" ? "cancelled" : "max_experiments" });
    await expect(state.fs.readFile(state.options.docPath, "utf8")).resolves.toBe(`${document}\nRetain these instructions.\n`);
    await expect(state.fs.readFile("/repo/src/code.txt", "utf8")).resolves.toBe("baseline code");
    const entries = await readExperimentJournal(state.options);
    expect(entries).toHaveLength(["discard", "failure", "metric"].includes(outcome) ? 1 : 0);
    for (const entry of entries) expect(entry.status).toBe("discard");
  });

  it("continues after a discarded iteration without losing journal history or plan edits", async () => {
    const state = fixture();
    const keep = state.runAgent.getMockImplementation()!;
    state.runAgent.mockImplementationOnce(async () => {
      await state.fs.writeFile(state.options.docPath, `${document}\nRetain the new instructions.\n`);
      await state.fs.writeFile("/repo/src/code.txt", "discarded code");
      await state.log({ commit: "discarded", status: "discard", durationMs: 1, timestamp: "2026-09-01T00:00:00.000Z", output: "discarded", agentOutput: "" });
      return { stdout: "", stderr: "", exitCode: 0 };
    }).mockImplementationOnce(async (input) => {
      expect(input.prompt).toContain("Retain the new instructions.");
      expect(input.prompt).toContain("discarded");
      await expect(state.fs.readFile("/repo/src/code.txt", "utf8")).resolves.toBe("baseline code");
      return keep(input);
    });
    await expect(runExperiment({ ...state.options, maxExperiments: 2 })).resolves.toMatchObject({ experimentsCompleted: 2, experimentsKept: 1 });
    await expect(readExperimentJournal(state.options)).resolves.toMatchObject([{ status: "discard" }, { status: "keep" }]);
    expect(state.runAgent).toHaveBeenCalledTimes(2);
  });

  it("does not query Git when the caller supplies an adapter", async () => {
    const state = fixture();
    const git = { currentHash: vi.fn(async () => "baseline"), reset: vi.fn(async () => undefined) };
    await expect(runExperiment({ ...state.options, git })).resolves.toMatchObject({ experimentsKept: 1 });
    expect(state.exec).not.toHaveBeenCalled();
  });
});
