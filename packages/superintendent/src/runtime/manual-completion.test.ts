import { setImmediate } from "node:timers/promises";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { completeCommand } from "../commands/complete.js";
import { transitionState } from "../document/write.js";
import {
  runLoop,
  type AgentRunInput,
  type AgentRunResult,
  type LoopCallbacks,
  type SuperintendentFileSystem
} from "./loop.js";

const docPath = "/repo/docs/plans/manual-completion.md";
const reason = "Owner finished this work elsewhere";
const roles = [
  "builder",
  "inspector-first",
  "inspector-second",
  "superintendent",
  "owner"
] as const;
type Role = (typeof roles)[number];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function document(state = "in_progress", allDone = false): string {
  return `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: ROLE-builder
inspectors:
  first:
    agent: claude-code
    prompt: ROLE-inspector-first
  second:
    agent: claude-code
    prompt: ROLE-inspector-second
superintendent:
  agent: claude-code
  prompt: ROLE-superintendent {{inspectors.first}} {{inspectors.second}}
owner:
  agent: claude-code
  prompt: ROLE-owner
max_rounds: 1
status:
  state: ${state}
  round: 0
  review_turn: 0
---
# Keep this plan

## Task Board

- [${allDone ? "x" : " "}] Preserve independent requirements
`;
}

function fixture(state = "in_progress", allDone = false) {
  const rawFs = createFsFromVolume(
    Volume.fromJSON({ [docPath]: document(state, allDone) }, "/")
  ).promises;
  const fs = rawFs as unknown as SuperintendentFileSystem;
  const options = { docPath, cwd: "/repo", homeDir: "/home/fixture", fs };
  const content = async () => String(await rawFs.readFile(docPath, "utf8"));
  const complete = async (dryRun = false) => {
    const result = await completeCommand.handler!({
      params: { path: docPath, reason, dryRun },
      fs: {
        lstat: rawFs.lstat.bind(rawFs),
        readFile: rawFs.readFile.bind(rawFs),
        writeFile: rawFs.writeFile.bind(rawFs),
        rename: rawFs.rename.bind(rawFs),
        unlink: rawFs.unlink.bind(rawFs)
      }
    } as never);
    return { result, content: await content() };
  };
  return { rawFs, fs, options, content, complete };
}

function roleFor(input: AgentRunInput): Role {
  const role = roles.find((candidate) => input.prompt.includes(`ROLE-${candidate}`));
  if (!role) throw new Error(`Unexpected fixture prompt: ${input.prompt}`);
  return role;
}

function response(role: Role, review = true): AgentRunResult {
  return {
    exitCode: 0,
    stdout: "Fixture role result",
    stderr: "",
    ...(role === "superintendent" && review
      ? {
          toolCalls: [
            {
              name: "workflow_transition",
              arguments: { action: "request_review", summary: "Ready" }
            }
          ]
        }
      : {}),
    ...(role === "owner"
      ? {
          toolCalls: [{ name: "workflow_transition", arguments: { action: "approve_completion" } }]
        }
      : {})
  };
}

describe("manual completion during live roles", () => {
  for (const target of roles) {
    for (const fails of [false, true]) {
      it(`preserves completion while ${target} ${fails ? "fails" : "finishes"}`, async () => {
        const current = fixture(target === "owner" ? "review" : "in_progress");
        const started = deferred();
        const release = deferred();
        const failed = vi.fn();
        const stateChanges: string[] = [];
        const runAgent = vi.fn(async (input: AgentRunInput) => {
          const role = roleFor(input);
          if (role === target) {
            started.resolve();
            await release.promise;
            if (fails) return { exitCode: 1, stdout: "", stderr: "Finished role failed" };
          }
          return response(role);
        });
        const running = runLoop({
          ...current.options,
          runAgent,
          callbacks: {
            onBuilderFailed: failed,
            onInspectorFailed: failed,
            onStateChange: (state) => {
              stateChanges.push(state.state);
            }
          }
        });
        const result = running.then(
          (value) => value,
          (error: unknown) => error
        );
        await started.promise;
        const completed = await current.complete();
        const callsAtCompletion = runAgent.mock.calls.length;
        const changesAtCompletion = stateChanges.length;
        expect(completed.result.state).toBe("completed");
        release.resolve();
        expect(await result).toMatchObject({ state: "completed", stopReason: "completed" });
        expect(runAgent).toHaveBeenCalledTimes(callsAtCompletion);
        expect(await current.content()).toBe(completed.content);
        expect(await current.content()).toContain(reason);
        expect(
          stateChanges.slice(changesAtCompletion).every((state) => state === "completed")
        ).toBe(true);
        expect(failed).not.toHaveBeenCalled();
        expect(await current.rawFs.readdir("/repo/docs/plans")).toEqual(["manual-completion.md"]);
      });
    }
  }

  it("honors completion during a review coordinator exchange", async () => {
    const current = fixture("review", true);
    const started = deferred();
    const release = deferred();
    const runAgent = vi.fn(async (input: AgentRunInput) => {
      const role = roleFor(input);
      if (role === "owner")
        return {
          ...response(role),
          toolCalls: [
            {
              name: "workflow_transition",
              arguments: { action: "request_changes", feedback: "One clarification" }
            }
          ]
        };
      if (role === "superintendent") {
        started.resolve();
        await release.promise;
        return { ...response(role), toolCalls: undefined };
      }
      throw new Error("Unexpected builder or inspector during review");
    });
    const running = runLoop({ ...current.options, runAgent });
    const outcome = running.then(
      (value) => value,
      (error: unknown) => error
    );
    await Promise.race([
      started.promise,
      outcome.then((result) => {
        throw new Error(`Review ended before coordinator dispatch: ${JSON.stringify(result)}`);
      })
    ]);
    const completed = await current.complete();
    release.resolve();
    expect(await outcome).toMatchObject({ state: "completed", stopReason: "completed" });
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(await current.content()).toBe(completed.content);
  });

  it("gives persisted completion precedence over abort rollback", async () => {
    const current = fixture();
    const controller = new AbortController();
    const started = deferred();
    const release = deferred();
    const runAgent = vi.fn(async () => {
      started.resolve();
      await release.promise;
      return response("builder");
    });
    const running = runLoop({ ...current.options, signal: controller.signal, runAgent });
    await started.promise;
    const completed = await current.complete();
    controller.abort();
    release.resolve();
    expect(await running).toMatchObject({ state: "completed", stopReason: "completed", round: 1 });
    expect(await current.content()).toBe(completed.content);
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("honors a completed document edited directly while a builder runs", async () => {
    const current = fixture();
    const started = deferred();
    const release = deferred();
    const runAgent = vi.fn(async () => {
      started.resolve();
      await release.promise;
      return response("builder");
    });
    const running = runLoop({ ...current.options, runAgent });
    await started.promise;
    const completed = transitionState(docPath, await current.content(), "completed");
    await current.rawFs.writeFile(docPath, completed);
    release.resolve();
    expect(await running).toMatchObject({ state: "completed", stopReason: "completed" });
    expect(await current.content()).toBe(completed);
    expect(runAgent).toHaveBeenCalledTimes(1);
  });
});

describe("completion before deferred role dispatch", () => {
  for (const target of ["builder", "inspector", "superintendent", "owner"] as const) {
    it(`does not dispatch ${target} after its callback wrapper resumes`, async () => {
      const current = fixture(target === "owner" ? "review" : "in_progress");
      const started = deferred();
      const release = deferred();
      const runAgent = vi.fn(async (input: AgentRunInput) => response(roleFor(input)));
      const callbacks: LoopCallbacks = {
        runRole: async (role, _name, run) => {
          if (role === target) {
            started.resolve();
            await release.promise;
          }
          return run();
        }
      };
      const running = runLoop({ ...current.options, runAgent, callbacks });
      await started.promise;
      const calls = runAgent.mock.calls.length;
      const completed = await current.complete();
      release.resolve();
      expect(await running).toMatchObject({ state: "completed", stopReason: "completed" });
      expect(runAgent).toHaveBeenCalledTimes(calls);
      expect(await current.content()).toBe(completed.content);
    });
  }
});

it("does not let an already prepared loop status write overwrite completion", async () => {
  const current = fixture();
  const prepared = deferred();
  const releaseWrite = deferred();
  const releaseBuilder = deferred();
  let held = false;
  const fs: SuperintendentFileSystem = {
    ...current.fs,
    rename: async (from, to) => {
      if (!held && to === docPath) {
        held = true;
        prepared.resolve();
        await releaseWrite.promise;
      }
      await current.fs.rename(from, to);
    }
  };
  const runAgent = vi.fn(async () => {
    await releaseBuilder.promise;
    return response("builder", false);
  });
  const running = runLoop({ ...current.options, fs, runAgent });
  await prepared.promise;
  const completing = current.complete();
  await setImmediate();
  releaseWrite.resolve();
  const completed = await completing;
  releaseBuilder.resolve();
  expect(await running).toMatchObject({ state: "completed", stopReason: "completed" });
  expect(await current.content()).toBe(completed.content);
  expect(runAgent.mock.calls.length).toBeLessThanOrEqual(1);
});

it("does not treat a dry-run completion as a stop request", async () => {
  const current = fixture();
  const started = deferred();
  const release = deferred();
  const runAgent = vi.fn(async (input: AgentRunInput) => {
    const role = roleFor(input);
    if (role === "builder") {
      started.resolve();
      await release.promise;
    }
    return response(role, false);
  });
  const running = runLoop({ ...current.options, runAgent });
  await started.promise;
  const before = await current.content();
  expect((await current.complete(true)).result).toMatchObject({ state: "completed", dryRun: true });
  expect(await current.content()).toBe(before);
  release.resolve();
  expect(await running).toMatchObject({ state: "in_progress", stopReason: "max_rounds" });
  expect(runAgent).toHaveBeenCalledTimes(4);
});
