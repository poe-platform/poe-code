import { describe, expect, it, vi } from "vitest";

import { dump } from "../dump.js";
import { Budget } from "../interp/budget.js";
import { run } from "../run.js";
import { makeAgentModule, type AgentModuleSpawnOptions } from "./agent.js";

const failedResult = {
  exitCode: 7,
  stdout: "partial output",
  stderr: "child failed",
  summary: "partial summary",
  durationMs: 3,
  usage: { inputTokens: 2, outputTokens: 4 }
};

describe("agent result policy", () => {
  it.each(["once", "retry", "default retry"])(
    "returns failed results from %s unless checking is requested",
    async (mode) => {
      const spawnAgent = vi.fn(async () => failedResult);
      const retry = { maxAttempts: 2, backoffMs: 0, isRetryable: () => true };
      const agent = makeAgentModule(
        spawnAgent,
        mode === "default retry" ? { defaultRetry: retry } : {}
      );
      const options = { prompt: "Run" };
      const promise =
        mode === "retry"
          ? agent.spawn.retry("codex", options, retry)
          : agent.spawn("codex", options);

      await expect(promise).resolves.toEqual(failedResult);
      expect(spawnAgent).toHaveBeenCalledTimes(mode === "once" ? 1 : 2);
    }
  );

  it.each(["once", "retry", "default retry"])(
    "retains the complete checked failure from %s",
    async (mode) => {
      const spawnAgent = vi.fn(async () => failedResult);
      const retry = { maxAttempts: 2, backoffMs: 0, isRetryable: () => true };
      const agent = makeAgentModule(
        spawnAgent,
        mode === "default retry" ? { defaultRetry: retry } : {}
      );
      const options = { prompt: "Run", check: true };
      const promise =
        mode === "retry"
          ? agent.spawn.retry("codex", options, retry)
          : agent.spawn("codex", options);

      await expect(promise).rejects.toMatchObject({
        name: "AgentSpawnError",
        result: failedResult
      });
      expect(spawnAgent).toHaveBeenCalledWith({ agent: "codex", prompt: "Run" });
    }
  );

  it("returns every parallel result by default", async () => {
    const spawnAgent = vi.fn(async () => failedResult);
    const agent = makeAgentModule(spawnAgent);

    await expect(
      agent.spawn.parallel([
        ["codex", { prompt: "First" }],
        ["codex", { prompt: "Second" }]
      ])
    ).resolves.toEqual([failedResult, failedResult]);
    expect(spawnAgent).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("checks parallel results with failFast=%s", async (failFast) => {
    const spawnAgent = vi.fn(async () => failedResult);
    const agent = makeAgentModule(spawnAgent);

    await expect(
      agent.spawn.parallel(
        [
          ["codex", { prompt: "First" }],
          ["codex", { prompt: "Second" }]
        ],
        { check: true, failFast, maxConcurrent: 1 }
      )
    ).rejects.toMatchObject({
      name: "SpawnParallelError",
      index: 0,
      result: failedResult,
      ...(failFast ? {} : { results: [failedResult, failedResult] })
    });
    expect(spawnAgent).toHaveBeenCalledTimes(failFast ? 1 : 2);
  });

  it("honors checked calls inside an unchecked parallel group", async () => {
    const spawnAgent = vi.fn(async () => failedResult);
    const agent = makeAgentModule(spawnAgent);

    await expect(
      agent.spawn.parallel([["codex", { prompt: "Run", check: true }]])
    ).rejects.toMatchObject({ name: "AgentSpawnError", result: failedResult });
  });

  it.each([false, true])("reports parallel group check=%s in failure events", async (check) => {
    const events: unknown[] = [];
    const agent = makeAgentModule(async () => failedResult, {
      onEvent: (event) => {
        events.push(event);
      }
    });

    await agent.spawn.parallel([["codex", { prompt: "Run" }]], { check }).catch(() => undefined);

    expect(events).toContainEqual(
      expect.objectContaining({ type: "spawn.failed", checked: check })
    );
  });

  it.each([null, "false", 0, {}, []])("rejects invalid check=%j before spawning", async (check) => {
    const spawnAgent = vi.fn(async () => failedResult);
    const agent = makeAgentModule(spawnAgent);

    await expect(
      agent.spawn("codex", { prompt: "Run", check } as unknown as AgentModuleSpawnOptions)
    ).rejects.toThrow("check must be a boolean");
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it("does not treat transport errors as child results", async () => {
    const failure = new Error("transport failed");
    const agent = makeAgentModule(async () => {
      throw failure;
    });

    await expect(agent.spawn("codex", { prompt: "Run", check: false })).rejects.toBe(failure);
  });

  it.each([false, true])(
    "reports the checked=%s result policy in failure events",
    async (check) => {
      const events: unknown[] = [];
      const agent = makeAgentModule(async () => failedResult, {
        onEvent: (event) => {
          events.push(event);
        }
      });

      await agent.spawn("codex", { prompt: "Run", check }).catch(() => undefined);

      expect(events).toContainEqual(
        expect.objectContaining({ type: "spawn.failed", checked: check })
      );
    }
  );

  it("ignores inherited checking options", async () => {
    const agent = makeAgentModule(async () => failedResult);
    const options = Object.assign(Object.create({ check: true }), { prompt: "Run" });

    await expect(agent.spawn("codex", options)).resolves.toEqual(failedResult);
  });

  it("does not let checked error payloads bypass string budgets", async () => {
    const agent = makeAgentModule(async () => ({ ...failedResult, stdout: "x".repeat(100) }));
    await expect(
      run(
        'import { spawn } from "agent"; try { await spawn("codex", { prompt: "Run", check: true }); } catch (error) { return "caught"; }',
        { modules: { agent }, budget: new Budget({ stringLength: 64 }) }
      )
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
  });

  it("still rejects cancellation after a child returns", async () => {
    const controller = new AbortController();
    const agent = makeAgentModule(async () => {
      controller.abort();
      return failedResult;
    });

    await expect(
      agent.spawn("codex", { prompt: "Run", check: false, signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each(["once", "retry", "defaultRetry", "parallel"])(
    "preserves cancellation reasons in %s",
    async (mode) => {
      for (const reason of [new Error("stop"), "stop", null, { stopped: true }]) {
        for (const phase of ["before", "during", "after"]) {
          const controller = new AbortController();
          const events: unknown[] = [];
          const spawnAgent = vi.fn(async () => {
            controller.abort(reason);
            if (phase === "during") throw reason;
            return failedResult;
          });
          const agent = makeAgentModule(spawnAgent, {
            ...(mode === "defaultRetry" ? { defaultRetry: { maxAttempts: 3, backoffMs: 0 } } : {}),
            onEvent: (event) => {
              events.push(event);
            }
          });
          if (phase === "before") controller.abort(reason);
          const options = { prompt: "Run", check: false, signal: controller.signal };
          const result =
            mode === "parallel"
              ? agent.spawn.parallel([["codex", options]], { signal: controller.signal })
              : mode === "retry"
                ? agent.spawn.retry("codex", options, { maxAttempts: 3, backoffMs: 0 })
                : agent.spawn("codex", options);

          await expect(result).rejects.toBe(reason);
          expect(spawnAgent).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
          expect(events).not.toContainEqual(expect.objectContaining({ type: "spawn.failed" }));
          expect(events).not.toContainEqual(expect.objectContaining({ type: "spawn.retry" }));
        }
      }
    }
  );

  it("preserves a custom cancellation reason during retry backoff", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const reason = new Error("stop waiting");
      const agent = makeAgentModule(async () => ({ ...failedResult, exitCode: 1 }));
      const result = agent.spawn.retry(
        "codex",
        { prompt: "Run", signal: controller.signal },
        { maxAttempts: 2, backoffMs: 100 }
      );
      const rejection = Promise.allSettled([result]);
      await vi.advanceTimersByTimeAsync(1);
      controller.abort(reason);
      const [outcome] = await rejection;
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") expect(outcome.reason).toBe(reason);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      name: "unchecked result",
      source: 'const result = await spawn("codex", { prompt: "Run" }); return result;',
      expected: failedResult
    },
    {
      name: "checked result",
      source:
        'try { await spawn("codex", { prompt: "Run", check: true }); } catch (error) { return { name: error.name, result: error.result }; }',
      expected: { name: "AgentSpawnError", result: failedResult }
    },
    {
      name: "collected checked calls",
      source:
        'try { await spawn.parallel([["codex", { prompt: "First", check: true }], ["codex", { prompt: "Second", check: true }]], { failFast: false }); } catch (error) { return { name: error.name, errors: error.errors.map(failure => [failure.name, failure.result.exitCode, failure instanceof Error]) }; }',
      expected: {
        name: "AggregateError",
        errors: [
          ["AgentSpawnError", 7, true],
          ["AgentSpawnError", 7, true]
        ]
      }
    },
    {
      name: "checked parallel results",
      source:
        'try { await spawn.parallel([["codex", { prompt: "First" }], ["codex", { prompt: "Second" }]], { check: true, failFast: false }); } catch (error) { return { name: error.name, result: error.result, results: error.results, index: error.index, shared: error.result === error.results[0] }; }',
      expected: {
        name: "SpawnParallelError",
        result: failedResult,
        results: [failedResult, failedResult],
        index: 0,
        shared: true
      }
    }
  ])("preserves $name through sandbox execution and replay", async ({ source, expected }) => {
    const spawnAgent = vi.fn(async () => failedResult);
    const modules = { agent: makeAgentModule(spawnAgent) };
    const script = `import { spawn } from "agent"; ${source}`;
    let result = await run(script, { modules });

    expect(result).toMatchObject({ ok: true, returnValue: expected });
    const calls = spawnAgent.mock.calls.length;
    for (let generation = 0; generation < 2; generation++) {
      const snapshot = JSON.parse(await dump(result));
      const restored = await run(script, { modules, snapshot });
      expect(restored).toMatchObject({ ok: true, returnValue: expected });
      expect(spawnAgent).toHaveBeenCalledTimes(calls);
      result = restored;
    }
  });
});
