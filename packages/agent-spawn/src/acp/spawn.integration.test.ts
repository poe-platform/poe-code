import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

vi.mock("../configs/resolve-config.js", () => ({
  resolveConfig: vi.fn()
}));

vi.mock("../native-otel.js", () => ({
  startNativeOtelCapture: vi.fn(async () => ({
    args: [],
    correlationId: "test-native-otel-correlation-id",
    env: {},
    drain: vi.fn(async () => [
      {
        signal: "traces",
        contentType: "application/json",
        body: { resourceSpans: [{ scopeSpans: [] }] }
      }
    ])
  }))
}));

vi.mock("toolcraft-design", () => {
  const renderLog: unknown[] = [];
  (globalThis as any).__acpIntegrationRenderLog = renderLog;

  return {
    acp: {
      renderAgentMessage: vi.fn((text: string) => {
        renderLog.push(["agent_message", text]);
      }),
      renderToolStart: vi.fn((kind: string, title: string) => {
        renderLog.push(["tool_start", kind, title]);
      }),
      renderToolComplete: vi.fn((kind: string) => {
        renderLog.push(["tool_complete", kind]);
      }),
      renderReasoning: vi.fn((text: string) => {
        renderLog.push(["reasoning", text]);
      }),
      renderUsage: vi.fn((usage: unknown) => {
        renderLog.push(["usage", usage]);
      }),
      renderError: vi.fn((message: string) => {
        renderLog.push(["error", message]);
      })
    },
    text: {
      muted: (content: string) => `<muted>${content}</muted>`
    }
  };
});

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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("acp/spawnStreaming integration", () => {
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const mockAgentExecutablePath = fileURLToPath(
    new URL("./__fixtures__/mock-agent.mjs", import.meta.url)
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    const log = (globalThis as any).__acpIntegrationRenderLog as unknown[] | undefined;
    if (Array.isArray(log)) {
      log.length = 0;
    }
  });

  it("spawnStreaming (codex) emits events in the expected order", async () => {
    const expected = await loadExpectedAcpOutput();

    const { resolveConfig } = await import("../configs/resolve-config.js");
    vi.mocked(resolveConfig).mockImplementation((agentId: string) => {
      if (agentId !== "codex") {
        throw new Error(`unexpected agentId: ${agentId}`);
      }
      return {
        agentId: "codex",
        binaryName: process.execPath,
        spawnConfig: {
          kind: "cli",
          agentId: "codex",
          adapter: "codex",
          promptFlag: mockAgentExecutablePath,
          modelStripProviderPrefix: true,
          defaultArgs: [],
          modes: { yolo: [], auto: [], edit: [], read: [] }
        }
      };
    });

    const { spawnStreaming } = await import("./spawn.js");

    const { events, done } = spawnStreaming({
      agentId: "codex",
      prompt: "codex",
      cwd: repoRoot
    });

    const actualEvents = await collect(events);
    await expect(done).resolves.toMatchObject({ exitCode: 0 });

    const normalizedExpected = expected.fromCodex.map(normalizeExpectedEvent);
    expect(actualEvents.map((e: any) => e.event)).toEqual(normalizedExpected.map((e) => e.event));
    expect(actualEvents).toHaveLength(normalizedExpected.length);
    for (let i = 0; i < normalizedExpected.length; i++) {
      expect(actualEvents[i]).toMatchObject(normalizedExpected[i]);
    }
  });

  it("merges captured native OTLP records before consumer middleware completes", async () => {
    const { resolveConfig } = await import("../configs/resolve-config.js");
    vi.mocked(resolveConfig).mockReturnValue({
      agentId: "codex",
      binaryName: process.execPath,
      spawnConfig: {
        kind: "cli",
        agentId: "codex",
        adapter: "codex",
        promptFlag: mockAgentExecutablePath,
        modelStripProviderPrefix: true,
        defaultArgs: [],
        modes: { yolo: [], auto: [], edit: [], read: [] }
      }
    });
    let metadata: Record<string, unknown> | undefined;

    const { spawnStreaming } = await import("./spawn.js");
    const { events, done } = spawnStreaming({
      agentId: "codex",
      prompt: "codex",
      cwd: repoRoot,
      captureOtel: true,
      middlewares: [
        async (ctx, next) => {
          await next();
          metadata = ctx.metadata;
        }
      ]
    });

    await collect(events);
    await expect(done).resolves.toMatchObject({ exitCode: 0 });
    expect(metadata).toMatchObject({
      nativeOtelCorrelationId: expect.any(String),
      nativeOtel: [
        {
          signal: "traces",
          contentType: "application/json",
          body: { resourceSpans: [{ scopeSpans: [] }] }
        }
      ]
    });
  });

  it("spawnStreaming (claude) emits events in the expected order", async () => {
    const expected = await loadExpectedAcpOutput();

    const { resolveConfig } = await import("../configs/resolve-config.js");
    vi.mocked(resolveConfig).mockImplementation((agentId: string) => {
      if (agentId !== "claude-code") {
        throw new Error(`unexpected agentId: ${agentId}`);
      }
      return {
        agentId: "claude-code",
        binaryName: process.execPath,
        spawnConfig: {
          kind: "cli",
          agentId: "claude-code",
          adapter: "claude",
          promptFlag: mockAgentExecutablePath,
          modelStripProviderPrefix: true,
          defaultArgs: [],
          modes: { yolo: [], auto: [], edit: [], read: [] }
        }
      };
    });

    const { spawnStreaming } = await import("./spawn.js");

    const { events, done } = spawnStreaming({
      agentId: "claude-code",
      prompt: "claude",
      cwd: repoRoot
    });

    const actualEvents = await collect(events);
    await expect(done).resolves.toMatchObject({ exitCode: 0 });

    const normalizedExpected = expected.fromClaude.map(normalizeExpectedEvent);
    expect(actualEvents.map((e: any) => e.event)).toEqual(normalizedExpected.map((e) => e.event));
    expect(actualEvents).toHaveLength(normalizedExpected.length);
    for (let i = 0; i < normalizedExpected.length; i++) {
      expect(actualEvents[i]).toMatchObject(normalizedExpected[i]);
    }
  });

  it("ignores adapter outputs whose event field is only inherited", async () => {
    const { resolveConfig } = await import("../configs/resolve-config.js");
    vi.mocked(resolveConfig).mockImplementation((agentId: string) => {
      if (agentId !== "native-empty") {
        throw new Error(`unexpected agentId: ${agentId}`);
      }
      return {
        agentId: "native-empty",
        binaryName: process.execPath,
        spawnConfig: {
          kind: "cli",
          agentId: "native-empty",
          adapter: "native",
          promptFlag: mockAgentExecutablePath,
          defaultArgs: [],
          modes: { yolo: [], auto: [], edit: [], read: [] }
        }
      };
    });

    const { spawnStreaming } = await import("./spawn.js");
    let actualEvents: unknown[] = [];
    let result: unknown;

    await withObjectPrototypeProperties({ event: "polluted" }, async () => {
      const { events, done } = spawnStreaming({
        agentId: "native-empty",
        prompt: "native-empty",
        cwd: repoRoot
      });

      actualEvents = await collect(events);
      result = await done;
    });

    expect(actualEvents).toEqual([]);
    expect(result).toMatchObject({ exitCode: 0 });
  });

  it("full pipeline: spawnStreaming → renderAcpStream", async () => {
    const { resolveConfig } = await import("../configs/resolve-config.js");
    vi.mocked(resolveConfig).mockImplementation((agentId: string) => {
      if (agentId !== "codex") {
        throw new Error(`unexpected agentId: ${agentId}`);
      }
      return {
        agentId: "codex",
        binaryName: process.execPath,
        spawnConfig: {
          kind: "cli",
          agentId: "codex",
          adapter: "codex",
          promptFlag: mockAgentExecutablePath,
          modelStripProviderPrefix: true,
          defaultArgs: [],
          modes: { yolo: [], auto: [], edit: [], read: [] }
        }
      };
    });

    const { spawnStreaming } = await import("./spawn.js");
    const { renderAcpStream } = await import("./renderer.js");

    const { events, done } = spawnStreaming({
      agentId: "codex",
      prompt: "codex",
      cwd: repoRoot
    });

    const captured: any[] = [];
    async function* tap(iterable: AsyncIterable<any>): AsyncIterable<any> {
      for await (const item of iterable) {
        captured.push(item);
        yield item;
      }
    }

    await renderAcpStream(tap(events));
    await expect(done).resolves.toMatchObject({ exitCode: 0 });

    const log = (globalThis as any).__acpIntegrationRenderLog as unknown[];
    expect(log).toEqual([
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
  });

  it("captures stderr and exitCode when the agent fails", async () => {
    const { resolveConfig } = await import("../configs/resolve-config.js");
    vi.mocked(resolveConfig).mockImplementation((agentId: string) => {
      if (agentId !== "codex") {
        throw new Error(`unexpected agentId: ${agentId}`);
      }
      return {
        agentId: "codex",
        binaryName: process.execPath,
        spawnConfig: {
          kind: "cli",
          agentId: "codex",
          adapter: "codex",
          promptFlag: mockAgentExecutablePath,
          modelStripProviderPrefix: true,
          defaultArgs: [],
          modes: { yolo: [], auto: [], edit: [], read: [] }
        }
      };
    });

    const { spawnStreaming } = await import("./spawn.js");

    const { events, done } = spawnStreaming({
      agentId: "codex",
      prompt: "fail",
      cwd: repoRoot
    });

    await expect(collect(events)).resolves.toEqual([]);
    await expect(done).resolves.toMatchObject({ exitCode: 2 });
    await expect(done).resolves.toEqual(
      expect.objectContaining({ stderr: expect.stringContaining("mock agent failed") })
    );
  });
});
