import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as resolveConfigModule from "../configs/resolve-config.js";
import * as designSystem from "@poe-code/design-system";

import { spawnStreaming } from "./spawn.js";
import { renderAcpStream } from "./renderer.js";

type ExpectedAcpOutput = {
  fromCodex: Array<Record<string, unknown>>;
  fromClaude: Array<Record<string, unknown>>;
};

async function loadExpectedAcpOutput(): Promise<ExpectedAcpOutput> {
  const fixturesUrl = new URL("./__fixtures__/sample-sessions.json", import.meta.url);
  const fixtures = JSON.parse(await fs.readFile(fixturesUrl, "utf8")) as {
    expectedAcpOutput?: unknown;
  };
  const expected = fixtures.expectedAcpOutput as ExpectedAcpOutput | undefined;
  if (!expected || !Array.isArray(expected.fromCodex) || !Array.isArray(expected.fromClaude)) {
    throw new Error("Fixture expectedAcpOutput is missing or invalid");
  }
  return expected;
}

function normalizeExpectedEvent(event: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> =
    "output" in event && !("path" in event)
      ? (() => {
          const { output, ...rest } = event;
          return { ...rest, path: output };
        })()
      : { ...event };

  if (typeof normalized.path === "string") {
    normalized.path = normalized.path.replaceAll("\\n", "\n");
  }

  return normalized;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

async function collectUntilDone<T>(
  events: AsyncIterable<T>,
  done: Promise<unknown>,
  settleMs = 200
): Promise<T[]> {
  const items: T[] = [];
  let consumeError: unknown;
  const consumePromise = (async () => {
    try {
      for await (const item of events) {
        items.push(item);
      }
    } catch (error) {
      consumeError = error;
    }
  })();

  await done;
  await Promise.race([
    consumePromise,
    new Promise<void>((resolve) => setTimeout(resolve, settleMs))
  ]);

  if (consumeError) throw consumeError;
  return items;
}

function makeResolveConfigForAgent(
  agentId: string,
  mockAgentScriptPath: string,
  adapter: string
): ReturnType<typeof resolveConfigModule.resolveConfig> {
  return {
    agentId,
    binaryName: process.execPath,
    spawnConfig: {
      kind: "cli",
      agentId,
      adapter: adapter as any,
      promptFlag: mockAgentScriptPath,
      modelStripProviderPrefix: true,
      defaultArgs: [],
      modes: { yolo: [], edit: [], read: [] }
    }
  } as any;
}

describe("acp/spawnStreaming integration", () => {
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const mockAgentScriptPath = fileURLToPath(new URL("./__fixtures__/mock-agent.mjs", import.meta.url));
  const realSpawn = (globalThis as Record<string, unknown>).__POE_REAL_CHILD_PROCESS_SPAWN__ as
    | typeof import("node:child_process").spawn
    | undefined;

  const renderLog: unknown[] = [];
  let resolveConfigSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    mock.restore();
    if (!realSpawn) {
      throw new Error("Missing __POE_REAL_CHILD_PROCESS_SPAWN__ test setup hook.");
    }
    resolveConfigSpy = vi.spyOn(resolveConfigModule, "resolveConfig");
    vi.spyOn(designSystem.acp, "renderAgentMessage").mockImplementation((text: string) => {
      renderLog.push(["agent_message", text]);
    });
    vi.spyOn(designSystem.acp, "renderToolStart").mockImplementation((kind: string, title: string) => {
      renderLog.push(["tool_start", kind, title]);
    });
    vi.spyOn(designSystem.acp, "renderToolComplete").mockImplementation((kind: string) => {
      renderLog.push(["tool_complete", kind]);
    });
    vi.spyOn(designSystem.acp, "renderReasoning").mockImplementation((text: string) => {
      renderLog.push(["reasoning", text]);
    });
    vi.spyOn(designSystem.acp, "renderUsage").mockImplementation((usage: unknown) => {
      renderLog.push(["usage", usage]);
    });
    vi.spyOn(designSystem.acp, "renderError").mockImplementation((message: string) => {
      renderLog.push(["error", message]);
    });
    vi.spyOn(designSystem.text, "muted").mockImplementation((content: string) => `<muted>${content}</muted>`);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    renderLog.length = 0;
    resolveConfigSpy.mockReset();
  });

  it("spawnStreaming (codex) emits events in the expected order", async () => {
    const expected = await loadExpectedAcpOutput();

    resolveConfigSpy.mockImplementation((agentId: string) => {
      if (agentId !== "codex") throw new Error(`unexpected agentId: ${agentId}`);
      return makeResolveConfigForAgent("codex", mockAgentScriptPath, "codex");
    });

    const controller = new AbortController();
    try {
      const { events, done } = spawnStreaming({
        agentId: "codex",
        prompt: "codex",
        cwd: repoRoot,
        spawnImpl: realSpawn,
        signal: controller.signal
      });

      const actualEventsPromise = collectUntilDone(events, done);
      const doneResult = await done;
      const actualEvents = await actualEventsPromise;
      expect(doneResult).toMatchObject({ exitCode: 0 });

      const normalizedExpected = expected.fromCodex.map(normalizeExpectedEvent);
      expect(actualEvents.map((e: any) => e.event)).toEqual(normalizedExpected.map((e) => e.event));
      expect(actualEvents).toHaveLength(normalizedExpected.length);
      for (let i = 0; i < normalizedExpected.length; i++) {
        expect(actualEvents[i]).toMatchObject(normalizedExpected[i]);
      }
    } finally {
      controller.abort();
    }
  });

  it("spawnStreaming (claude) emits events in the expected order", async () => {
    const expected = await loadExpectedAcpOutput();

    resolveConfigSpy.mockImplementation((agentId: string) => {
      if (agentId !== "claude-code") throw new Error(`unexpected agentId: ${agentId}`);
      return makeResolveConfigForAgent("claude-code", mockAgentScriptPath, "claude");
    });

    const controller = new AbortController();
    try {
      const { events, done } = spawnStreaming({
        agentId: "claude-code",
        prompt: "claude",
        cwd: repoRoot,
        spawnImpl: realSpawn,
        signal: controller.signal
      });

      const actualEventsPromise = collectUntilDone(events, done);
      await expect(done).resolves.toMatchObject({ exitCode: 0 });
      const actualEvents = await actualEventsPromise;

      const normalizedExpected = expected.fromClaude.map(normalizeExpectedEvent);
      expect(actualEvents.map((e: any) => e.event)).toEqual(normalizedExpected.map((e) => e.event));
      expect(actualEvents).toHaveLength(normalizedExpected.length);
      for (let i = 0; i < normalizedExpected.length; i++) {
        expect(actualEvents[i]).toMatchObject(normalizedExpected[i]);
      }
    } finally {
      controller.abort();
    }
  });

  it("full pipeline: spawnStreaming → renderAcpStream", async () => {
    resolveConfigSpy.mockImplementation((agentId: string) => {
      if (agentId !== "codex") throw new Error(`unexpected agentId: ${agentId}`);
      return makeResolveConfigForAgent("codex", mockAgentScriptPath, "codex");
    });

    const controller = new AbortController();
    try {
      const { events, done } = spawnStreaming({
        agentId: "codex",
        prompt: "codex",
        cwd: repoRoot,
        spawnImpl: realSpawn,
        signal: controller.signal
      });

      const capturedPromise = collectUntilDone(events, done);
      await expect(done).resolves.toMatchObject({ exitCode: 0 });
      const captured = await capturedPromise;

      await renderAcpStream((async function* () {
        for (const event of captured) {
          yield event;
        }
      })());

      expect(renderLog).toEqual([
        ["tool_start", "exec", "ls -la"],
        ["tool_complete", "exec"],
        ["tool_start", "edit", "src/config.ts"],
        ["tool_complete", "edit"],
        ["tool_start", "think", "thinking..."],
        ["reasoning", "I need to update the imports after the file edit."],
        ["agent_message", "I've updated the configuration file with the new settings."],
        ["usage", { input: 1500, output: 350, cached: 800, costUsd: undefined }]
      ]);

      expect(captured.map((e) => e.event)).toContain("agent_message");
      expect(captured.map((e) => e.event)[0]).toBe("session_start");
    } finally {
      controller.abort();
    }
  });

  it("captures stderr and exitCode when the agent fails", async () => {
    resolveConfigSpy.mockImplementation((agentId: string) => {
      if (agentId !== "codex") throw new Error(`unexpected agentId: ${agentId}`);
      return makeResolveConfigForAgent("codex", mockAgentScriptPath, "codex");
    });

    const controller = new AbortController();
    try {
      const { events, done } = spawnStreaming({
        agentId: "codex",
        prompt: "fail",
        cwd: repoRoot,
        spawnImpl: realSpawn,
        signal: controller.signal
      });

      await expect(collectUntilDone(events, done)).resolves.toEqual([]);
      await expect(done).resolves.toMatchObject({
        exitCode: 2,
        stderr: "mock agent failed\n"
      });
    } finally {
      controller.abort();
    }
  });
});
