import { describe, expect, it, vi } from "vitest";
import { createDefaultGit } from "./git.js";
import type { ExecFn } from "../types.js";

const managedPaths = ["/repo/docs/plans/sample.md", "/repo/docs/plans/sample.journal.jsonl"];
const selectedScope = "':(top)' ':(top,exclude,literal)docs/plans/sample.md' ':(top,exclude,literal)docs/plans/sample.journal.jsonl'";

function createExec(overrides: Record<string, { stdout?: string; stderr?: string; exitCode?: number }> = {}) {
  return vi.fn<ExecFn>(async (command, options) => ({
    stdout: command === "git rev-parse --show-cdup" ? (options?.cwd === "/repo/src" ? "../\n" : "\n")
      : command === "git rev-parse --short HEAD" ? "baseline\n" : "",
    stderr: "",
    exitCode: 0,
    ...overrides[command]
  }));
}

describe("selected experiment Git files", () => {
  it.each(["/repo", "/repo/src"])("checks the full repository from %s excluding only selected files", async (cwd) => {
    const exec = createExec();
    await expect(createDefaultGit(exec, managedPaths).currentHash(cwd)).resolves.toBe("baseline");
    expect(exec.mock.calls).toEqual([
      ["git rev-parse --show-cdup", { cwd }],
      [`git status --porcelain --untracked-files=all -- ${selectedScope}`, { cwd }],
      ["git rev-parse --short HEAD", { cwd }]
    ]);
  });

  it.each(["docs/plans/other.md", ".poe-code/experiments/other.md", "src/code.ts"])("rejects unrelated changes in %s", async (filePath) => {
    const exec = createExec({
      [`git status --porcelain --untracked-files=all -- ${selectedScope}`]: { stdout: ` M ${filePath}\n` }
    });
    await expect(createDefaultGit(exec, managedPaths).currentHash("/repo")).rejects.toThrow("requires a clean working tree");
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("uses literal exclusions and shell quoting for special filenames", async () => {
    const exec = createExec();
    await createDefaultGit(exec, ["/repo/docs/a'b [x]*.md", "/repo/docs/a'b [x]*.md"]).currentHash("/repo");
    expect(exec.mock.calls[1]?.[0]).toBe("git status --porcelain --untracked-files=all -- ':(top)' ':(top,exclude,literal)docs/a'\\''b [x]*.md'");
  });

  it("retains the caller's repository alias when Git reports the root relatively", async () => {
    const exec = createExec();
    await createDefaultGit(exec, ["/alias/docs/plans/sample.md", "/alias/docs/plans/sample.journal.jsonl"]).currentHash("/alias");
    expect(exec.mock.calls[1]?.[0]).toBe(`git status --porcelain --untracked-files=all -- ${selectedScope}`);
  });

  it("omits files outside the repository without excluding unrelated repository files", async () => {
    const exec = createExec();
    await createDefaultGit(exec, ["/repo-other/plan.md", "/home/user/plan.journal.jsonl"]).currentHash("/repo/src");
    expect(exec.mock.calls[1]?.[0]).toBe("git status --porcelain --untracked-files=all -- ':(top)'");
  });

  it("resolves relative selected paths against the invocation directory", async () => {
    const exec = createExec();
    await createDefaultGit(exec, ["../docs/plans/sample.md", "../docs/plans/sample.journal.jsonl"]).currentHash("/repo/src");
    expect(exec.mock.calls[1]?.[0]).toBe(`git status --porcelain --untracked-files=all -- ${selectedScope}`);
  });

  it.each(["/repo", "/repo/src"])("rolls back code and HEAD without stashing selected files from %s", async (cwd) => {
    const exec = createExec();
    await createDefaultGit(exec, managedPaths).reset("base'line", cwd);
    expect(exec.mock.calls).toEqual([
      ["git rev-parse --show-cdup", { cwd }],
      [`git restore --source='base'\\''line' --staged --worktree -- ${selectedScope}`, { cwd }],
      ["git reset --mixed -q 'base'\\''line'", { cwd }]
    ]);
  });

  it.each([
    "git rev-parse --show-cdup",
    `git restore --source='baseline' --staged --worktree -- ${selectedScope}`
  ])("does not move HEAD after %s fails", async (command) => {
    const exec = createExec({ [command]: { exitCode: 1, stderr: "fixture failure" } });
    await expect(createDefaultGit(exec, managedPaths).reset("baseline", "/repo")).rejects.toThrow("fixture failure");
    expect(exec.mock.calls.some(([value]) => value.startsWith("git reset"))).toBe(false);
  });

  it("reports a failed HEAD reset", async () => {
    const exec = createExec({ "git reset --mixed -q 'baseline'": { exitCode: 1, stderr: "reset failed" } });
    await expect(createDefaultGit(exec, managedPaths).reset("baseline", "/repo")).rejects.toThrow("reset failed");
  });
});
