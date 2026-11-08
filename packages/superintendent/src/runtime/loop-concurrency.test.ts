import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { parseSuperintendentDoc } from "../document/parse.js";
import { withAutonomousAgentRunner } from "./agent-runner.js";
import { runLoop, type AgentRunInput, type AgentRunResult, type SuperintendentFileSystem } from "./loop.js";

const external = vi.hoisted(() => ({ run: vi.fn(async () => { throw new Error("Unexpected external execution"); }) }));
vi.mock("@poe-code/agent-harness-tools", async (importOriginal) => ({
  ...await importOriginal<typeof import("@poe-code/agent-harness-tools")>(),
  runPoeCommand: external.run
}));

const roles = ["builder", "inspector-first", "inspector-second", "superintendent", "owner"] as const;
type Role = (typeof roles)[number];

function taskPrompt(input: AgentRunInput): string {
  return input.prompt.split("\n\n# Task\n\n").at(-1) ?? input.prompt;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(name: string, blockedRole: Role = "builder", withSignal = true) {
  const docPath = `/repo-${name}/docs/plans/loop.md`;
  const content = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: ${name}:builder
inspectors:
  first:
    agent: claude-code
    prompt: ${name}:inspector-first
  second:
    agent: claude-code
    prompt: ${name}:inspector-second
superintendent:
  agent: claude-code
  prompt: ${name}:superintendent {{inspectors.first}} {{inspectors.second}}
owner:
  agent: claude-code
  prompt: ${name}:owner
max_rounds: 1
status:
  state: in_progress
  round: 0
  review_turn: 0
---
# Independent plan ${name}

## Task Board

- [ ] Keep the task for ${name} unchanged.
`;
  const rawFs = createFsFromVolume(Volume.fromJSON({ [docPath]: content }, "/")).promises;
  const controller = new AbortController();
  const entered = deferred();
  const release = deferred();
  const runAgent = vi.fn(async (input: AgentRunInput): Promise<AgentRunResult> => {
    const prompt = taskPrompt(input);
    if (prompt === `${name}:${blockedRole}` || prompt.startsWith(`${name}:${blockedRole} `)) {
      entered.resolve();
      await release.promise;
    }
    const role = roles.find(candidate => prompt.split(" ")[0].endsWith(`:${candidate}`));
    if (!role) throw new Error(`Unknown fixture role: ${input.prompt}`);
    return {
      exitCode: 0,
      stdout: `${role} result`,
      stderr: "",
      ...(role === "superintendent" ? {
        toolCalls: [{ name: "workflow_transition", arguments: { action: "request_review", summary: "Ready" } }]
      } : {}),
      ...(role === "owner" ? {
        toolCalls: [{ name: "workflow_transition", arguments: { action: "approve_completion" } }]
      } : {})
    };
  });
  return {
    name, rawFs, controller, entered, release, runAgent,
    options: {
      docPath,
      cwd: `/repo-${name}`,
      homeDir: "/home/fixture",
      logDir: `/logs/${name}`,
      fs: rawFs as unknown as SuperintendentFileSystem,
      runAgent,
      ...(withSignal ? { signal: controller.signal } : {})
    }
  };
}

function assertOwnedCalls(current: ReturnType<typeof fixture>, count: number = roles.length) {
  expect(current.runAgent).toHaveBeenCalledTimes(count);
  for (const [input] of current.runAgent.mock.calls) {
    expect(taskPrompt(input).startsWith(`${current.name}:`)).toBe(true);
    expect(input.cwd).toBe(current.options.cwd);
    expect(input.signal).toBe(current.options.signal);
    expect(input.logPath?.startsWith(`${current.options.logDir}/`)).toBe(true);
  }
}

async function withOverlappingLoops(
  first: ReturnType<typeof fixture>,
  second: ReturnType<typeof fixture>,
  operation: (runs: { first: ReturnType<typeof runLoop>; second: ReturnType<typeof runLoop> }) => Promise<void>
) {
  const fallback = vi.fn(async () => { throw new Error("Unexpected outer runner"); });
  await withAutonomousAgentRunner(fallback, async () => {
    const firstRun = runLoop(first.options);
    let secondRun: ReturnType<typeof runLoop> | undefined;
    try {
      await Promise.race([first.entered.promise, firstRun.then(() => {
        throw new Error("First loop finished before entering its blocked role");
      })]);
      secondRun = runLoop(second.options);
      await Promise.race([second.entered.promise, secondRun.then(() => {
        throw new Error("Second loop finished before entering its blocked role");
      })]);
      await operation({ first: firstRun, second: secondRun });
      expect(fallback).not.toHaveBeenCalled();
      expect(external.run).not.toHaveBeenCalled();
    } finally {
      first.controller.abort();
      second.controller.abort();
      first.release.resolve();
      second.release.resolve();
      await Promise.allSettled([firstRun, ...(secondRun ? [secondRun] : [])]);
    }
  });
}

describe("independent Superintendent loop contexts", () => {
  it.each(roles)("keeps every role on its own runner while another loop's %s is pending", async (role) => {
    const first = fixture("A");
    const second = fixture("B", role);
    await withOverlappingLoops(first, second, async (runs) => {
      first.release.resolve();
      await expect(runs.first).resolves.toMatchObject({ state: "completed", stopReason: "completed" });
      assertOwnedCalls(first);
      expect(second.runAgent).toHaveBeenCalledTimes(roles.indexOf(role) + 1);
      second.release.resolve();
      await expect(runs.second).resolves.toMatchObject({ state: "completed", stopReason: "completed" });
      assertOwnedCalls(second);
      for (const current of [first, second]) {
        const text = await current.rawFs.readFile(current.options.docPath, "utf8");
        expect(parseSuperintendentDoc(current.options.docPath, String(text)).frontmatter.status.state).toBe("completed");
        expect(String(text)).toContain(`- [ ] Keep the task for ${current.name} unchanged.`);
      }
    });
  });

  it.each(["first", "second"] as const)("aborting the %s loop does not cancel or replace the other runner", async (abortedName) => {
    const first = fixture("A");
    const second = fixture("B");
    const fixtures = { first, second };
    const survivorName = abortedName === "first" ? "second" : "first";
    await withOverlappingLoops(first, second, async (runs) => {
      fixtures[abortedName].controller.abort();
      fixtures[abortedName].release.resolve();
      await expect(runs[abortedName]).resolves.toMatchObject({ stopReason: "aborted" });
      assertOwnedCalls(fixtures[abortedName], 1);
      expect(fixtures[survivorName].controller.signal.aborted).toBe(false);
      fixtures[survivorName].release.resolve();
      await expect(runs[survivorName]).resolves.toMatchObject({ state: "completed", stopReason: "completed" });
      assertOwnedCalls(fixtures[survivorName]);
    });
  });

  it("does not borrow another loop's signal when a caller omitted cancellation", async () => {
    const first = fixture("A");
    const second = fixture("B", "builder", false);
    await withOverlappingLoops(first, second, async (runs) => {
      first.release.resolve();
      await expect(runs.first).resolves.toMatchObject({ state: "completed" });
      assertOwnedCalls(first);
      second.release.resolve();
      await expect(runs.second).resolves.toMatchObject({ state: "completed" });
      assertOwnedCalls(second);
    });
  });
});
