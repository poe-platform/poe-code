import { afterEach, describe, expect, it, vi } from "vitest";

import { dump } from "./dump.js";
import { formatInterpreterError } from "./error/format.js";
import { Budget, SandboxError } from "./interp/budget.js";
import { createSandboxClosure, createSandboxPromise } from "./interp/values.js";
import { declareHostOperation } from "./interp/host-bridge.js";
import { makeAgentModule, type AgentSpawnEvent } from "./modules/agent.js";
import { makeEnvModule } from "./modules/env.js";
import { makeFailModule } from "./modules/fail.js";
import { makeMcpModule } from "./modules/mcp.js";
import { restore } from "./restore.js";
import { run } from "./run.js";
import { resolvePendingHostCallResumePolicy } from "./snapshot/policy.js";

describe("run", () => {
  it("continues to accept an injected promise without requiring durable snapshots", async () => {
    await expect(
      run("return await pending;", {
        bindings: { pending: createSandboxPromise(Promise.resolve(42)) }
      })
    ).resolves.toMatchObject({ ok: true, returnValue: 42 });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("executes sources with a leading hashbang or byte order mark", async () => {
    await expect(run("#!/usr/bin/env bun\nreturn 1;")).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });

    await expect(run("\uFEFFreturn 2;")).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
  });

  it("rejects parser stack stress with a controlled parse error", async () => {
    await expect(run(createElseIfChain(3_000), { filename: "branches.ajs" })).rejects.toMatchObject(
      {
        filename: "branches.ajs",
        kind: "ParseError",
        message: expect.stringContaining("If statement nesting limit exceeded")
      }
    );
  });

  it("rejects unbounded recursion with the default call-depth guard", async () => {
    await expect(run("function loop() { return loop(); } return loop();")).rejects.toMatchObject({
      name: "SandboxError",
      code: "budgetExceeded",
      budget: "callDepth"
    });
  });

  it("preserves non-enumerable static methods on injected functions", async () => {
    function HostApi() {
      return undefined;
    }
    Object.defineProperty(HostApi, "join", {
      configurable: true,
      value: (left: string, right: string) => `${left}:${right}`
    });

    await expect(
      run('return HostApi.join("left", "right");', {
        bindings: {
          HostApi
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "left:right"
    });
  });

  it("registers declarative host operation resume policies", async () => {
    const write = declareHostOperation(async () => "written", "read-side-effect");
    const read = declareHostOperation(async () => "read", "re-issue");

    await expect(
      run('import { read, write } from "storage"; return await read() + await write();', {
        modules: {
          storage: { read, write }
        }
      })
    ).resolves.toMatchObject({ ok: true, returnValue: "readwritten" });

    expect(
      resolvePendingHostCallResumePolicy({
        id: "storage-read-1",
        moduleId: "storage",
        operation: "read"
      })
    ).toEqual({ kind: "re-issue" });
    expect(
      resolvePendingHostCallResumePolicy({
        id: "storage-write-1",
        moduleId: "storage",
        operation: "write"
      })
    ).toEqual({
      kind: "read-side-effect",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "storage-write-1",
        moduleId: "storage",
        operation: "write"
      }
    });
  });

  it("leaves undeclared host operations unregistered for typed resume failures", async () => {
    await expect(
      run('import { charge } from "payments"; return await charge();', {
        modules: {
          payments: {
            charge: async () => "charged"
          }
        }
      })
    ).resolves.toMatchObject({ ok: true, returnValue: "charged" });

    expect(() =>
      resolvePendingHostCallResumePolicy({
        id: "payments-charge-1",
        moduleId: "payments",
        operation: "charge"
      })
    ).toThrowError(
      "Host operation payments.charge has no resume policy; declare 're-issue' (idempotent) or 'read-side-effect' (effectful)."
    );
  });

  it("registers Math globals by default", async () => {
    await expect(run("return Math.max(Math.min(5, -2), Math.abs(-4))")).resolves.toMatchObject({
      ok: true,
      returnValue: 4
    });
  });

  it("registers standard numeric globals used by Math edge cases", async () => {
    await expect(run("return Math.min(1, NaN, 2);")).resolves.toMatchObject({
      ok: true,
      returnValue: Number.NaN
    });
    await expect(run("return Math.max(1, NaN, 2);")).resolves.toMatchObject({
      ok: true,
      returnValue: Number.NaN
    });
    await expect(run("return Math.min();")).resolves.toMatchObject({
      ok: true,
      returnValue: Infinity
    });
    await expect(run("return Math.max();")).resolves.toMatchObject({
      ok: true,
      returnValue: -Infinity
    });
  });

  it("registers structuredClone and coercing numeric globals by default", async () => {
    const result = await run(
      [
        "const source = { nested: ['value'] };",
        "const clone = structuredClone(source);",
        "clone.nested.push('clone');",
        "return JSON.stringify([",
        "  source.nested.length,",
        "  clone.nested.length,",
        "  parseInt('11px', 2),",
        "  parseFloat('3.5px'),",
        "  isNaN('not-a-number'),",
        "  isFinite('12')",
        "]);"
      ].join("\n")
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify([1, 2, 3, 3.5, true, true])
    });
  });

  it("keeps caught circular JSON.stringify failures from failing final snapshotting", async () => {
    await expect(
      run(
        [
          "const circular = {};",
          "Object.assign(circular, { self: circular });",
          "try {",
          "  JSON.stringify(circular);",
          "} catch (error) {",
          "  return error.name;",
          "}"
        ].join("\n")
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "TypeError"
    });
  });

  it("includes the current dump format version in in-memory snapshots", async () => {
    const result = await run("return true");

    expect(result.snapshot.version).toBe(1);
  });

  it("lets scripts read only allow-listed environment variables through the env module", async () => {
    vi.stubEnv("ALLOWED_TOKEN", "secret");
    vi.stubEnv("BLOCKED_TOKEN", "hidden");

    const result = await run(
      [
        'import { get } from "env";',
        'let denied; try { get("BLOCKED_TOKEN"); } catch(error) { denied = error.code; }',
        'return JSON.stringify(Array.of(get("ALLOWED_TOKEN"), denied, get("MISSING_TOKEN")));'
      ].join("\n"),
      {
        modules: {
          env: makeEnvModule(["ALLOWED_TOKEN", "MISSING_TOKEN"])
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["secret", "ENV_ACCESS_DENIED", null])
    });
  });

  it("does not expose process.env or other extra exports through env namespace imports", async () => {
    vi.stubEnv("ALLOWED_TOKEN", "secret");
    vi.stubEnv("BLOCKED_TOKEN", "hidden");

    const result = await run(
      [
        'import * as env from "env";',
        'return JSON.stringify(Array.of(env.get("ALLOWED_TOKEN"), Object.keys(env), env.process, env.env));'
      ].join("\n"),
      {
        modules: {
          env: makeEnvModule(["ALLOWED_TOKEN"])
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["secret", ["get"], null, null])
    });
  });

  it("resolves named, default, and namespace imports from the module registry", async () => {
    const request = vi.fn(() => "named");
    const result = await run(
      [
        'import fallback from "api";',
        'import { request as call } from "api";',
        'import * as api from "api";',
        "return JSON.stringify(Array.of(fallback, call(), api.request(), api.default));"
      ].join("\n"),
      {
        modules: {
          api: {
            default: "default-export",
            request
          }
        }
      }
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["default-export", "named", "named", "default-export"])
    });
  });

  it("converts fail module throws into catchable HarnessFailure subset errors", async () => {
    const result = await run(
      [
        'import fail from "fail";',
        "try {",
        '  fail("stop now");',
        "} catch ({ name, message, stack }) {",
        "  return JSON.stringify(Array.of(name, message, stack));",
        "}"
      ].join("\n"),
      {
        modules: {
          fail: makeFailModule()
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify([
        "HarnessFailure",
        "stop now",
        "HarnessFailure: stop now\n    at fail (line 3, column 3)"
      ])
    });
  });

  it("rejects unhandled fail module throws with a HarnessFailure subset error", async () => {
    await expect(
      run(['import fail from "fail";', 'fail("stop now");'].join("\n"), {
        modules: {
          fail: makeFailModule()
        }
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "HarnessFailure",
        message: "stop now"
      })
    );
  });

  it("preserves fail module message whitespace through unhandled runner failures", async () => {
    await expect(
      run(['import fail from "fail";', 'fail("  stop now  ");'].join("\n"), {
        modules: {
          fail: makeFailModule()
        }
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "HarnessFailure",
        message: "  stop now  "
      })
    );
  });

  it("accepts Map-based registries and module export maps at runtime", async () => {
    const result = await run('import { answer } from "numbers"; return answer;', {
      modules: new Map([["numbers", new Map([["answer", 42]])]])
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: 42
    });
  });

  it("throws the lint-style unknown module error when a module import is missing at runtime", async () => {
    await expect(
      run('import { request } from "htp"; return request();', { modules: {} })
    ).rejects.toThrow("Unknown module 'htp'. No modules are registered.");
  });

  it("throws the lint-style unknown export error when an imported export is missing at runtime", async () => {
    await expect(
      run('import value from "api"; return value;', {
        modules: {
          api: {
            request: vi.fn(() => "ok")
          }
        }
      })
    ).rejects.toThrow("Module 'api' does not export 'default'. Available exports: request.");
  });

  it("attaches import-site source context to missing runtime export errors", async () => {
    const source = 'import { missing } from "api";\nreturn missing;';

    await expect(
      run(source, {
        filename: "workflow.ajs",
        modules: {
          api: {
            request: vi.fn(() => "ok")
          }
        }
      })
    ).rejects.toMatchObject({
      span: {
        start: { line: 1, column: 10 }
      }
    });

    await run(source, {
      filename: "workflow.ajs",
      modules: {
        api: {
          request: vi.fn(() => "ok")
        }
      }
    }).catch((error: unknown) => {
      expect(formatInterpreterError(error, { filename: "workflow.ajs", source })).toContain(
        "InterpreterError: workflow.ajs:1:10"
      );
    });
  });

  it("supports edge-case import local names without leaking inherited namespace members", async () => {
    const result = await run(
      [
        'import { first as toString } from "api";',
        'import { second as __proto__ } from "api";',
        'import * as api from "api";',
        "return JSON.stringify(Array.of(toString, __proto__, api.value, api.toString));"
      ].join("\n"),
      {
        modules: {
          api: {
            first: 1,
            second: 2,
            value: 3
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify([1, 2, 3, null])
    });
  });

  it("runs agent spawns through the injected module and returns the full spawn result", async () => {
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "patched files",
      stderr: "",
      summary: "Applied the requested fix",
      durationMs: 2750
    }));

    const result = await run(
      [
        'import { spawn } from "agent";',
        "return JSON.stringify(await spawn({",
        '  agent: "codex",',
        '  prompt: "You are careful.",',
        '  model: "openai/gpt-5.4",',
        '  mode: "read",',
        '  cwd: "/defaults",',
        "  mcp: {",
        "    search: {",
        '      command: "mcp-search",',
        '      args: ["serve"],',
        '      env: { TOKEN: "secret" },',
        "      timeout: 30",
        "    }",
        "  }",
        "}, {",
        '  prompt: "Inspect the diff.",',
        '  mode: "edit",',
        '  cwd: "/workspace",',
        "  timeoutMs: 5000",
        "}));"
      ].join("\n"),
      {
        modules: {
          agent: makeAgentModule(spawnAgent)
        }
      }
    );

    expect(spawnAgent).toHaveBeenCalledWith({
      agent: "codex",
      prompt: "You are careful.\n\n# Task\n\nInspect the diff.",
      model: "openai/gpt-5.4",
      mode: "edit",
      cwd: "/workspace",
      mcp: {
        search: {
          command: "mcp-search",
          args: ["serve"],
          env: {
            TOKEN: "secret"
          },
          timeout: 30
        }
      },
      timeoutMs: 5000
    });
    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify({
        exitCode: 0,
        stdout: "patched files",
        stderr: "",
        summary: "Applied the requested fix",
        durationMs: 2750
      })
    });
  });

  it("keeps sandbox spawn labels in lifecycle events and out of provider input", async () => {
    const events: AgentSpawnEvent[] = [];
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "reviewed",
      stderr: "",
      summary: "done",
      durationMs: 4
    }));

    const result = await run(
      [
        'import { spawn } from "agent";',
        'const response = await spawn("codex", {',
        '  label: "Review authentication",',
        '  prompt: "Review generated sensitive implementation details."',
        "});",
        "return response.summary;"
      ].join("\n"),
      {
        modules: {
          agent: makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) })
        }
      }
    );

    expect(result).toMatchObject({ ok: true, returnValue: "done" });
    expect(spawnAgent).toHaveBeenCalledWith({
      agent: "codex",
      prompt: "Review generated sensitive implementation details."
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "spawn.started",
        spawnId: 1,
        task: "Review authentication"
      }),
      expect.objectContaining({
        type: "spawn.succeeded",
        spawnId: 1,
        task: "Review authentication"
      })
    ]);
  });

  it("runs explicit sandbox retries with lifecycle events", async () => {
    const events: AgentSpawnEvent[] = [];
    const spawnAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("sandbox temporarily unavailable"))
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "reviewed",
        stderr: "",
        summary: "done",
        durationMs: 4
      });

    const result = await run(
      [
        'import { spawn } from "agent";',
        'const response = await spawn.retry("codex", { label: "Review auth", prompt: "Generated details" }, {',
        "  maxAttempts: 2,",
        "  backoffMs: 0",
        "});",
        "return response.summary;"
      ].join("\n"),
      {
        modules: {
          agent: makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) })
        }
      }
    );

    expect(result).toMatchObject({ ok: true, returnValue: "done" });
    expect(spawnAgent).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      expect.objectContaining({ type: "spawn.started", spawnId: 1, attempt: 1 }),
      expect.objectContaining({ type: "spawn.retry", spawnId: 1, attempt: 1 }),
      expect.objectContaining({ type: "spawn.started", spawnId: 1, attempt: 2 }),
      expect.objectContaining({ type: "spawn.succeeded", spawnId: 1, attempt: 2 })
    ]);
  });

  it("rejects explicit sandbox retry policies above five attempts", async () => {
    const spawnAgent = vi.fn();

    const result = await run(
      [
        'import { spawn } from "agent";',
        "try {",
        '  await spawn.retry("codex", { prompt: "Generated details" }, { maxAttempts: 6, backoffMs: 0 });',
        "} catch ({ message }) {",
        "  return message;",
        "}"
      ].join("\n"),
      {
        modules: {
          agent: makeAgentModule(spawnAgent)
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: "Agent spawn retry maxAttempts must not exceed 5."
    });
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it("runs agent.spawn.parallel through the injected module", async () => {
    const spawnAgent = vi.fn(async (input: { prompt: string }) => ({
      exitCode: input.prompt.includes("Fail") ? 5 : 0,
      stdout: input.prompt,
      stderr: input.prompt.includes("Fail") ? "failed" : "",
      summary: "",
      durationMs: 10
    }));

    const result = await run(
      [
        'import { spawn } from "agent";',
        "const results = await spawn.parallel([",
        '  ["codex", { prompt: "Build" }],',
        '  ["claude-code", { prompt: "Fail" }]',
        "], { maxConcurrent: 1, failFast: false });",
        "return JSON.stringify(results.map((result) => result.exitCode));"
      ].join("\n"),
      {
        modules: {
          agent: makeAgentModule(spawnAgent)
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify([0, 5])
    });
    expect(spawnAgent).toHaveBeenCalledTimes(2);
  });

  it("applies numbered lifecycle events and default retries to sandbox parallel spawns", async () => {
    const events: AgentSpawnEvent[] = [];
    const spawnAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("sandbox temporarily unavailable"))
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "built",
        stderr: "",
        summary: "built",
        durationMs: 2
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "reviewed",
        stderr: "",
        summary: "reviewed",
        durationMs: 3
      });

    const result = await run(
      [
        'import { spawn } from "agent";',
        "const results = await spawn.parallel([",
        '  ["codex", { label: "Build feature", prompt: "Generated build details" }],',
        '  ["codex", { label: "Review feature", prompt: "Generated review details" }]',
        "], { maxConcurrent: 1 });",
        "return JSON.stringify(results.map((response) => response.summary));"
      ].join("\n"),
      {
        modules: {
          agent: makeAgentModule(spawnAgent, {
            defaultRetry: { maxAttempts: 2, backoffMs: 0 },
            onEvent: (event) => events.push(event)
          })
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["built", "reviewed"])
    });
    expect(spawnAgent).toHaveBeenCalledTimes(3);
    expect(spawnAgent).toHaveBeenNthCalledWith(1, {
      agent: "codex",
      prompt: "Generated build details",
      signal: expect.objectContaining({ aborted: false })
    });
    expect(spawnAgent).toHaveBeenNthCalledWith(3, {
      agent: "codex",
      prompt: "Generated review details",
      signal: expect.objectContaining({ aborted: false })
    });
    expect(events).toEqual([
      expect.objectContaining({ type: "spawn.started", spawnId: 1, task: "Build feature" }),
      expect.objectContaining({ type: "spawn.retry", spawnId: 1, task: "Build feature" }),
      expect.objectContaining({ type: "spawn.started", spawnId: 1, attempt: 2 }),
      expect.objectContaining({ type: "spawn.succeeded", spawnId: 1, attempt: 2 }),
      expect.objectContaining({ type: "spawn.started", spawnId: 2, task: "Review feature" }),
      expect.objectContaining({ type: "spawn.succeeded", spawnId: 2, task: "Review feature" })
    ]);
  });

  it("surfaces agent spawn failures as catchable sandbox errors", async () => {
    const spawnAgent = vi.fn(async () => ({
      exitCode: 23,
      stdout: "",
      stderr: "",
      summary: "tool call timed out",
      durationMs: 99
    }));

    const result = await run(
      [
        'import { spawn } from "agent";',
        "try {",
        '  await spawn("codex", { prompt: "Do the thing.", check: true });',
        "} catch ({ message }) {",
        "  return message;",
        "}"
      ].join("\n"),
      {
        modules: {
          agent: makeAgentModule(spawnAgent)
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: "Agent spawn failed with exit code 23: tool call timed out"
    });
  });

  it("supports MCP clients returned from module calls inside the sandbox", async () => {
    const connectMcp = vi.fn(async (server: unknown) => ({
      async listTools() {
        return {
          tools: [
            {
              name: "sum",
              description: "Add numbers",
              inputSchema: {
                type: "object",
                properties: {
                  a: { type: "number" },
                  b: { type: "number" }
                }
              }
            }
          ]
        };
      },
      async callTool(params: unknown) {
        return {
          server,
          params
        };
      }
    }));

    const result = await run(
      [
        'import { server, client } from "mcp";',
        "return JSON.stringify({",
        '  tools: await (await client(server({ command: "calc-mcp", args: ["serve"], env: { TOKEN: "abc" } }))).tools(),',
        '  result: await (await client(server({ command: "calc-mcp", args: ["serve"], env: { TOKEN: "abc" } }))).tool("sum", { a: 2, b: 3 })',
        "});"
      ].join("\n"),
      {
        modules: {
          mcp: makeMcpModule(connectMcp)
        }
      }
    );

    expect(connectMcp).toHaveBeenNthCalledWith(1, {
      command: "calc-mcp",
      args: ["serve"],
      env: {
        TOKEN: "abc"
      }
    });
    expect(connectMcp).toHaveBeenNthCalledWith(2, {
      command: "calc-mcp",
      args: ["serve"],
      env: {
        TOKEN: "abc"
      }
    });
    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify({
        tools: [
          {
            name: "sum",
            description: "Add numbers",
            schema: {
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" }
              }
            }
          }
        ],
        result: {
          server: {
            command: "calc-mcp",
            args: ["serve"],
            env: {
              TOKEN: "abc"
            }
          },
          params: {
            name: "sum",
            arguments: {
              a: 2,
              b: 3
            }
          }
        }
      })
    });
  });

  it("validates malformed agent spawn calls from scripts with explicit errors", async () => {
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "",
      durationMs: 1
    }));

    const invalidAgentResult = await run(
      [
        'import { spawn } from "agent";',
        "try {",
        '  await spawn({ prompt: "missing agent" }, { prompt: "Do the thing." });',
        "} catch ({ message }) {",
        "  return message;",
        "}"
      ].join("\n"),
      {
        modules: {
          agent: makeAgentModule(spawnAgent)
        }
      }
    );

    expect(invalidAgentResult).toMatchObject({
      ok: true,
      returnValue: "Agent definition must define a non-empty agent."
    });

    const invalidPromptResult = await run(
      [
        'import { spawn } from "agent";',
        "try {",
        '  await spawn("codex", {});',
        "} catch ({ message }) {",
        "  return message;",
        "}"
      ].join("\n"),
      {
        modules: {
          agent: makeAgentModule(spawnAgent)
        }
      }
    );

    expect(invalidPromptResult).toMatchObject({
      ok: true,
      returnValue: "Agent spawn options must define a non-empty prompt."
    });
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it("registers Object, Array, and coercion globals by default", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      Object.keys(JSON.parse('{"alpha":1,"beta":2}')),
      Object.values(JSON.parse('{"alpha":1,"beta":2}')),
      Object.entries(JSON.parse('{"alpha":1}')),
      Object.fromEntries(JSON.parse('[["left",1],["right",2]]')),
      Object.freeze(JSON.parse('{"locked":true}')),
      Object.assign(JSON.parse('{"start":1}'), JSON.parse('{"extra":2}')),
      Array.isArray(Array.of(1, 2)),
      Array.from(JSON.parse('["a","b"]')),
      Array.from(JSON.parse('["1","2"]'), Number),
      Array.of(1, 2, 3),
      String(123),
      Number('42.5'),
      Number.isFinite(1),
      Number.isFinite(1 / 0),
      Number.isFinite(0 / 0),
      Number.isFinite('1'),
      Number.isNaN(0 / 0),
      Number.isNaN(1),
      Number.isNaN('NaN'),
      Number.isInteger(1),
      Number.isInteger(1.5),
      Number.isInteger('1'),
      typeof Number.isFinite,
      typeof Number.isNaN,
      typeof Number.isInteger,
      Boolean(0)
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      ["alpha", "beta"],
      [1, 2],
      [["alpha", 1]],
      {
        left: 1,
        right: 2
      },
      {
        locked: true
      },
      {
        start: 1,
        extra: 2
      },
      true,
      ["a", "b"],
      [1, 2],
      [1, 2, 3],
      "123",
      42.5,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      "function",
      "function",
      "function",
      false
    ]);
  });

  it("registers structured clone and coercing numeric globals by default", async () => {
    const result = await run(`
      const source = { nested: ["value"] };
      const clone = structuredClone(source);
      return JSON.stringify([
        clone,
        clone === source,
        clone.nested === source.nested,
        parseInt("12px", 10),
        parseFloat("3.5px"),
        isNaN("not-a-number"),
        isFinite("12"),
        Number.isNaN("not-a-number"),
        Number.isFinite("12")
      ]);
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: '[{"nested":["value"]},false,false,12,3.5,true,true,false,false]'
    });
  });

  it("registers subset Promise helpers by default", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      await Promise.resolve('ready'),
      await Promise.all(Array.of(Promise.resolve(1), 2)),
      await Promise.race(Array.of(Promise.resolve('first'))),
      await Promise.allSettled(Array.of(Promise.resolve('ok'), Promise.reject('no'))),
      await Promise.any(Array.of(Promise.reject('left'), Promise.resolve('right')))
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      "ready",
      [1, 2],
      "first",
      [
        {
          status: "fulfilled",
          value: "ok"
        },
        {
          reason: "no",
          status: "rejected"
        }
      ],
      "right"
    ]);
  });

  it("supports catch and finally promise chains in sandbox scripts", async () => {
    const result = await run(`
      const order = [];
      const recovered = await Promise.reject('failure')
        .catch(async (reason) => {
          order.push('catch:' + reason);
          return await Promise.resolve('recovered');
        })
        .finally(async () => {
          order.push('finally');
          await Promise.resolve('ignored');
        });
      let rejected;
      try {
        await Promise.reject('original').finally(() => {
          throw 'cleanup';
        });
      } catch (error) {
        rejected = error;
      }
      return JSON.stringify(Array.of(recovered, order, rejected));
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["recovered", ["catch:failure", "finally"], "cleanup"])
    });
  });

  it("rejects detached async function rejections as unhandled", async () => {
    await expect(
      run(`
        async function fail() {
          await Promise.resolve('tick');
          throw 'boom';
        }
        fail();
        return 'ok';
      `)
    ).rejects.toMatchObject({
      name: "UnhandledRejectionError",
      reason: "boom"
    });
  });

  // The await already accounts for the one host call result, so the boundary check must
  // report the returned rejection rather than the journal's double-consumption error.
  it("reports a returned rejected host call promise as unhandled after a sandbox catch", async () => {
    const read = declareHostOperation(async () => {
      throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
    }, "re-issue");

    await expect(
      run(
        [
          'import { read } from "files";',
          "const pending = read();",
          "try {",
          "  await pending;",
          "} catch {}",
          "return pending;"
        ].join("\n"),
        { modules: { files: { read } } }
      )
    ).rejects.toMatchObject({
      name: "UnhandledRejectionError",
      reason: expect.objectContaining({ code: "ENOENT" })
    });
  });

  it("does not reject detached async function rejections with sandbox catches", async () => {
    const result = await run(`
      async function fail() {
        await Promise.resolve('tick');
        throw 'boom';
      }
      fail().catch(() => undefined);
      return 'ok';
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: "ok"
    });
  });

  it("drains detached fulfilled promise reactions before completing", async () => {
    const messages: string[] = [];
    const result = await run(
      `
        Promise.resolve('one')
          .then((value) => {
            console.log(value);
            return 'two';
          })
          .then((value) => {
            console.log(value);
          });
        return 'done';
      `,
      {
        sink: {
          error: () => undefined,
          log: (...args) => {
            messages.push(args.join(" "));
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: "done"
    });
    expect(messages).toEqual(["one", "two"]);
  });

  it("applies detached fulfilled promise side effects before snapshotting", async () => {
    const cases = [
      {
        expected: 1,
        source: `
          let value = 0;
          Promise.resolve(1).then((next) => {
            value = next;
          });
          return value;
        `
      },
      {
        expected: 2,
        source: `
          let value = 0;
          Promise.resolve(1)
            .then((next) => next + 1)
            .then((next) => {
              value = next;
            });
          return value;
        `
      },
      {
        expected: 1,
        source: `
          let value = 0;
          Promise.resolve().then(() =>
            Promise.resolve().then(() => {
              value = 1;
            })
          );
          return value;
        `
      }
    ];

    for (const testCase of cases) {
      const result = await run(testCase.source);

      expect(result).toMatchObject({
        ok: true,
        returnValue: 0,
        snapshot: {
          bindings: {
            value: testCase.expected
          }
        }
      });
    }
  });

  it("rejects promise chains that resolve to themselves", async () => {
    const result = await run(`
      let chained;
      chained = Promise.resolve().then(() => chained);
      try {
        await chained;
      } catch (error) {
        return [error.name, error.message];
      }
      return 'resolved';
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: ["TypeError", "Promise cannot resolve to itself."]
    });
  });

  it("rejects in-flight awaits and the next host call when aborted", async () => {
    const controller = new AbortController();
    const after = vi.fn(() => "after");
    const result = run(
      `
try {
  await wait();
  return 'missed';
} catch {
  try {
    return after();
  } catch ({ message }) {
    return message;
  }
}
      `,
      {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(new Promise(() => undefined)),
            name: "wait"
          }),
          after: createSandboxClosure({
            call: () => after(),
            name: "after"
          })
        },
        signal: controller.signal
      }
    );

    controller.abort();

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "This operation was aborted"
    });
    expect(after).not.toHaveBeenCalled();
  });

  it("resolves import.meta from an injected deep copy", async () => {
    const importMeta = {
      filepath: "script.ajs",
      nested: {
        value: "before"
      }
    };
    const first = createDeferred<void>();
    const result = run(
      [
        "await wait();",
        "return JSON.stringify(Array.of(import.meta.filepath, import.meta.nested.value));"
      ].join("\n"),
      {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(first.promise),
            name: "wait"
          })
        },
        importMeta
      }
    );

    importMeta.filepath = "changed.ajs";
    importMeta.nested.value = "after";
    first.resolve();

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["script.ajs", "before"])
    });
  });

  it("calls the default export with entryPointArgs and returns its awaited result", async () => {
    const result = await run(
      [
        "export const schema = { type: 'object' };",
        "export default (first, second) => JSON.stringify(Array.of(schema.type, first, second));"
      ].join("\n"),
      {
        entryPointArgs: [
          {
            label: "alpha"
          },
          [1, 2]
        ]
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify([
        "object",
        {
          label: "alpha"
        },
        [1, 2]
      ])
    });
  });

  it("copies entryPointArgs before top-level evaluation can yield", async () => {
    const input = {
      nested: {
        value: "before"
      }
    };
    const first = createDeferred<void>();
    const result = run(
      ["await wait();", "export default (arg) => JSON.stringify(Array.of(arg.nested.value));"].join(
        "\n"
      ),
      {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(first.promise),
            name: "wait"
          })
        },
        entryPointArgs: [input]
      }
    );

    input.nested.value = "after";
    first.resolve();

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["before"])
    });
  });

  it("throws a runtime error with the filename when entryPointArgs is set without a default export", async () => {
    await expect(
      run("return 'top-level';", { entryPointArgs: [], filename: "script.ajs" })
    ).rejects.toThrow("Script script.ajs does not export a default function.");
  });

  it("propagates default export throws with sandbox stack formatting", async () => {
    await expect(
      run(["export default () => {", '  explode("boom");', "};"].join("\n"), {
        bindings: {
          explode(message: string) {
            throw new TypeError(message);
          }
        },
        entryPointArgs: []
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: "boom",
        name: "TypeError",
        stack:
          "TypeError: boom\n    at explode (line 2, column 3)\n    at <anonymous> (line 1, column 1)"
      })
    );
  });

  it("preserves sandbox call stacks for missing identifiers", async () => {
    await expect(
      run(
        [
          "function a() { return b(); }",
          "function b() { return c(); }",
          "function c() { return missing; }",
          "return a();"
        ].join("\n")
      )
    ).rejects.toMatchObject({
      name: "ReferenceError",
      stack: expect.stringContaining("at c")
    });

    await expect(
      run(
        [
          "function a() { return b(); }",
          "function b() { return c(); }",
          "function c() { return missing; }",
          "return a();"
        ].join("\n")
      )
    ).rejects.toMatchObject({
      stack: expect.stringContaining("at b")
    });
  });

  it("blocks imported module calls when the signal is already aborted", async () => {
    const controller = new AbortController();
    const request = vi.fn(() => "called");
    controller.abort();

    const result = run(['import { request } from "api";', "return request();"].join("\n"), {
      modules: {
        api: {
          request: createSandboxClosure({
            call: () => request(),
            name: "request"
          })
        }
      },
      signal: controller.signal
    });

    await expect(result).rejects.toMatchObject({
      message: "This operation was aborted",
      name: "AbortError"
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("aborts at the next host call inside the entry function and can restore a pre-abort snapshot", async () => {
    const source = [
      "export default async () => {",
      "  await first();",
      "  await second();",
      "  await third();",
      "  return 'done';",
      "};"
    ].join("\n");
    const controller = new AbortController();
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const third = vi.fn(() => "missed");
    const result = run(source, {
      bindings: {
        first: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(first.promise),
          name: "first"
        }),
        second: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(second.promise),
          name: "second"
        }),
        third: createSandboxClosure({
          call: () => third(),
          name: "third"
        })
      },
      entryPointArgs: [],
      signal: controller.signal
    });
    const snapshotPromise = dump(result);

    first.resolve();
    const snapshot = JSON.parse(await snapshotPromise);
    second.resolve();
    controller.abort();

    await expect(result).rejects.toMatchObject({
      message: "This operation was aborted",
      name: "AbortError"
    });
    expect(third).not.toHaveBeenCalled();

    const restored = restore(snapshot, { source });
    const resumed = await run(source, {
      bindings: {
        first: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(Promise.resolve()),
          name: "first"
        }),
        second: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(Promise.resolve()),
          name: "second"
        }),
        third: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(Promise.resolve()),
          name: "third"
        })
      },
      entryPointArgs: [],
      snapshot: restored
    });

    expect(resumed).toMatchObject({
      ok: true,
      returnValue: "done"
    });
  });

  function createDeferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((nextResolve) => {
      resolve = nextResolve;
    });

    return {
      promise,
      resolve
    };
  }

  it("wraps caller-injected host function arguments and return values across the sandbox boundary", async () => {
    const observedArgs: unknown[] = [];
    const host = vi.fn((input: { nested: { value: number } }, items: number[]) => {
      observedArgs.push([structuredClone(input), structuredClone(items)]);
      input.nested.value = 7;
      items.push(3);

      return {
        seen: input,
        items
      };
    });

    const result = await run(
      `return JSON.stringify(Array.of(
        host(JSON.parse('{"nested":{"value":1}}'), Array.of(1, 2)).seen.nested.value,
        host(JSON.parse('{"nested":{"value":1}}'), Array.of(1, 2)).items.length
      ))`,
      {
        bindings: {
          host
        }
      }
    );

    expect(observedArgs).toEqual([
      [
        {
          nested: {
            value: 1
          }
        },
        [1, 2]
      ],
      [
        {
          nested: {
            value: 1
          }
        },
        [1, 2]
      ]
    ]);
    expect(host).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify([7, 3])
    });
  });

  it("converts caller-injected host throws into subset errors without host stack frames", async () => {
    const result = await run(
      "try { explode(); } catch ({ name, message, stack }) { return JSON.stringify(Array.of(name, message, stack)); }",
      {
        bindings: {
          explode() {
            throw new TypeError("boom");
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify([
        "TypeError",
        "boom",
        "TypeError: boom\n    at explode (line 1, column 7)"
      ])
    });
    expect((result.ok ? result.returnValue : "") as string).not.toContain("run.test.ts");
  });

  it("wraps caller-injected callback arguments so host code can await them repeatedly", async () => {
    const host = vi.fn(async (callback: (value: number) => Promise<number>) => [
      await callback(1),
      await callback(2)
    ]);
    const result = await run("return await inspect(async (value) => value)", {
      bindings: {
        inspect: host
      }
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: [1, 2]
    });
    expect(host).toHaveBeenCalledTimes(1);
  });

  it("treats async caller-injected host functions as subset promises with copied values", async () => {
    const observedArgs: unknown[] = [];
    const load = vi.fn(async (input: { value: number }) => {
      observedArgs.push(structuredClone(input));
      input.value = 2;

      return {
        input
      };
    });

    const result = await run(
      `return JSON.stringify(Array.of((await load(JSON.parse('{"value":1}'))).input.value))`,
      {
        bindings: {
          load
        }
      }
    );

    expect(observedArgs).toEqual([
      {
        value: 1
      }
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify([2])
    });
  });

  it("converts async caller-injected copy failures into subset errors through run()", async () => {
    const result = await run(
      "try { await load(); } catch ({ name, message, stack }) { return JSON.stringify(Array.of(name, message, stack)); }",
      {
        bindings: {
          async load() {
            return new Date("2026-04-28T12:00:00Z");
          }
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify([
        "TypeError",
        "Unsupported sandbox value at <root>: Date",
        "TypeError: Unsupported sandbox value at <root>: Date\n    at load (line 1, column 13)"
      ])
    });
    expect((result.ok ? result.returnValue : "") as string).not.toContain("run.test.ts");
  });

  it("supports empty Promise iterables and enforces budgets through run()", async () => {
    const emptyResult = await run(`return JSON.stringify(Array.of(
      await Promise.all(Array.of()),
      await Promise.allSettled(Array.of())
    ))`);

    expect(emptyResult.ok).toBe(true);
    if (!emptyResult.ok) {
      return;
    }

    expect(JSON.parse(emptyResult.returnValue as string)).toEqual([[], []]);

    await expect(
      run("return await Promise.resolve(value)", {
        bindings: {
          value: "ready"
        },
        budget: new Budget({
          stringLength: 4
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        budget: "stringLength",
        current: 5,
        limit: 4
      } satisfies Partial<SandboxError>)
    );
  });

  it("registers Error globals by default", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      Error('boom').name,
      Error('boom').message,
      Error().message,
      Error().stack,
      TypeError(42).name,
      TypeError(42).message,
      Error('boom').stack
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      "Error",
      "boom",
      "",
      "Error\n    at Error (line 5, column 7)",
      "TypeError",
      "42",
      "Error: boom\n    at Error (line 8, column 7)"
    ]);
  });

  it("intercepts supported string properties and methods", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      'hello'.length,
      'hello'.charAt(1),
      'hello'.charCodeAt(1),
      'hello'.codePointAt(1),
      'hello'.includes('ell'),
      'hello'.startsWith('he'),
      'hello'.endsWith('lo'),
      'banana'.indexOf('an'),
      'banana'.lastIndexOf('an'),
      'banana'.slice(1, 4),
      'banana'.substring(1, 4),
      'banana'.substr(1, 3),
      'a,b,c'.split(','),
      'abba'.replace('b', 'x'),
      'abba'.replaceAll('b', 'x'),
      'HeLLo'.toLowerCase(),
      'HeLLo'.toUpperCase(),
      '  hi  '.trim(),
      '  hi  '.trimStart(),
      '  hi  '.trimEnd(),
      '5'.padStart(3, '0'),
      '5'.padEnd(3, '0'),
      'ha'.repeat(2),
      'a'.concat('b', 'c'),
      JSON.parse('"e\\\\u0301"').normalize()
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      5,
      "e",
      101,
      101,
      true,
      true,
      true,
      1,
      3,
      "ana",
      "ana",
      "ana",
      ["a", "b", "c"],
      "axba",
      "axxa",
      "hello",
      "HELLO",
      "hi",
      "hi  ",
      "  hi",
      "005",
      "500",
      "haha",
      "abc",
      "\u00E9"
    ]);
  });

  it("matches JavaScript edge behavior for intercepted string methods", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      'banana'.includes('an', 2),
      'banana'.startsWith('na', 2),
      'banana'.endsWith('na', 4),
      'banana'.slice(-3, -1),
      'banana'.substring(4, 1),
      'banana'.substr(-2),
      'a,b,c'.split(undefined),
      'a,b,c'.split(',', 0),
      'abba'.replace('', '-'),
      'aba'.replaceAll('', '-'),
      'x'.padStart(4),
      JSON.parse('"e\\\\u0301"').normalize('NFD')
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      true,
      true,
      true,
      "an",
      "ana",
      "na",
      ["a,b,c"],
      [],
      "-abba",
      "-a-b-a-",
      "   x",
      "e\u0301"
    ]);
  });

  it("keeps coercion helpers opaque when used as Object sources", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      Object.keys(String),
      Object.values(String),
      Object.entries(String),
      Object.assign(JSON.parse('{}'), String, JSON.parse('{"ok":true}'))
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([[], [], [], { ok: true }]);
  });

  it("supports string replacer closures and rejects other function string arguments", async () => {
    await expect(run("return 'abba'.replace('a', () => 'b')")).resolves.toMatchObject({
      ok: true,
      returnValue: "bbba"
    });
    await expect(
      run("return 'abba'.replaceAll('a', replacer)", {
        bindings: { replacer: createSandboxClosure({ call: () => "b" }) }
      })
    ).resolves.toMatchObject({ ok: true, returnValue: "bbbb" });
    await expect(
      run("return 'a,b'.split(',', limit)", {
        bindings: { limit: createSandboxClosure({ call: () => 1 }) }
      })
    ).rejects.toThrow("String#split does not support function arguments.");
  });

  it("uses deterministic Math.random() when seeded", async () => {
    const first = await run("return Math.random()", {
      randomSeed: 123
    });
    const second = await run("return Math.random()", {
      randomSeed: 123
    });

    expect(first).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053,
      snapshot: {
        random: {
          seed: 123,
          state: 1_218_640_798
        }
      }
    });
    expect(second).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053,
      snapshot: {
        random: {
          seed: 123,
          state: 1_218_640_798
        }
      }
    });
  });

  it("replays seeded completed snapshots from their original random state", async () => {
    const source = "return Math.random()";
    const first = await run(source, {
      randomSeed: 123
    });
    const snapshot = JSON.parse(await dump(first));
    const restored = restore(snapshot, { source });
    const second = await run(source, {
      randomSeed: 999,
      snapshot: restored
    });

    expect(first).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053
    });
    expect(second).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053,
      snapshot: {
        random: {
          seed: 123,
          state: 1_218_640_798
        }
      }
    });
  });

  it("serializes automatically seeded random state by default", async () => {
    const result = await run("return Math.random()");

    expect(result.ok).toBe(true);
    expect(result.snapshot.random).toMatchObject({
      seed: expect.any(Number),
      state: expect.any(Number)
    });
  });

  it("evaluates regex literals and constructable RegExp globals", async () => {
    const result = await run(
      [
        "const literal = /a+/g;",
        "const dynamic = new RegExp('(b+)', 'g');",
        "literal.lastIndex = 1;",
        "return [literal.test('baac'), literal.lastIndex, dynamic.exec('abbc'), 'a1a2'.replaceAll(/a(.)/g, (match, capture, offset, input) => `${capture}:${offset}:${input.length}`)];"
      ].join("\n")
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: [true, 3, Object.assign(["bb", "bb"], { index: 1, input: "abbc" }), "1:0:42:2:4"]
    });
  });
});

function createElseIfChain(depth: number): string {
  let source = "";
  for (let index = 0; index < depth; index += 1) {
    source += `if (0) { return ${index}; } else `;
  }
  return `${source}{ return ""; }`;
}
