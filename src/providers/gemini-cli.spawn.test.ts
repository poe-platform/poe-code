import {
  spawn as spawnChildProcess,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnAcp } from "@poe-code/agent-spawn";
import { createCliEnvironment } from "../cli/environment.js";
import { createLoggerFactory } from "../cli/logger.js";
import type { ProviderContext } from "../cli/service-registry.js";
import { geminiCliService } from "./gemini-cli.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

type JsonRpcMessage = { id?: number; method?: string; params?: unknown };

interface MockChildProcess {
  child: ChildProcessWithoutNullStreams;
  stdin: PassThrough;
  stdout: PassThrough;
  kill: ReturnType<typeof vi.fn<() => boolean>>;
  outbound(): JsonRpcMessage[];
}

const originalEnv = { ...process.env };

function createMockChildProcess(): MockChildProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let input = "";
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk) => {
    input += String(chunk);
  });

  const child = new EventEmitter() as ChildProcessWithoutNullStreams & {
    killed: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  };
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  const kill = vi.fn(() => {
    child.killed = true;
    child.signalCode = "SIGTERM";
    child.emit("close", null, "SIGTERM");
    return true;
  });
  child.kill = kill;

  return {
    child,
    stdin,
    stdout,
    kill,
    outbound: () =>
      input
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as JsonRpcMessage)
  };
}

async function waitForMethod(mock: MockChildProcess, method: string): Promise<JsonRpcMessage> {
  await vi.waitFor(() => {
    expect(mock.outbound().some((message) => message.method === method)).toBe(true);
  });
  return mock.outbound().find((message) => message.method === method)!;
}

function respond(mock: MockChildProcess, request: JsonRpcMessage, result: unknown): void {
  mock.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
}

async function completeHappyPath(mock: MockChildProcess): Promise<void> {
  const initialize = await waitForMethod(mock, "initialize");
  respond(mock, initialize, {
    protocolVersion: 1,
    agentCapabilities: {
      promptCapabilities: { image: false, audio: false, embeddedContext: false }
    }
  });
  const newSession = await waitForMethod(mock, "session/new");
  respond(mock, newSession, { sessionId: "gemini-session" });
  const prompt = await waitForMethod(mock, "session/prompt");
  mock.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "gemini-session",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } }
      }
    })}\n`
  );
  respond(mock, prompt, { stopReason: "completed" });
}

function createProviderContext(): ProviderContext {
  const homeDir = "/tmp/gemini-provider-home";
  return {
    env: createCliEnvironment({ cwd: homeDir, homeDir, variables: {} }),
    command: {} as ProviderContext["command"],
    logger: createLoggerFactory(() => undefined).create({
      dryRun: false,
      verbose: true,
      scope: "test:gemini"
    }),
    activeProvider: {
      id: "cloudflare",
      apiShape: "google-generations",
      baseUrl: "https://gateway.example/google-ai-studio",
      agentBaseUrl: "https://gateway.example/google-ai-studio",
      credential: "gemini-key",
      extraEnv: { ISOLATED_EXTRA: "yes" }
    },
    runCheck: async () => undefined
  };
}

beforeEach(() => {
  process.env = { PATH: "/bin" };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe("geminiCliService ACP spawn", () => {
  it("leaves Gemini model selection to the agent when no model is supplied", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const result = geminiCliService.spawn!(createProviderContext(), {
      prompt: "answer this"
    });
    await completeHappyPath(mock);
    await expect(result).resolves.toMatchObject({ stdout: "hello\n", exitCode: 0 });

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "gemini",
      ["--acp", "--approval-mode", "yolo"],
      expect.any(Object)
    );
  });

  it("spawns Gemini ACP with the selected model and resolved provider environment", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const result = geminiCliService.spawn!(createProviderContext(), {
      prompt: "answer this",
      model: "gemini-2.5-pro"
    });
    await completeHappyPath(mock);
    await expect(result).resolves.toMatchObject({ stdout: "hello\n", exitCode: 0 });

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "gemini",
      ["--acp", "--model", "gemini-2.5-pro", "--approval-mode", "yolo"],
      {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: "/bin",
          GEMINI_API_KEY: "gemini-key",
          GOOGLE_GEMINI_BASE_URL: "https://gateway.example/google-ai-studio",
          GEMINI_SANDBOX: "false",
          HOME: path.join("/tmp/gemini-provider-home", ".poe-code", "gemini-cli"),
          ISOLATED_EXTRA: "yes"
        }
      }
    );
  });

  it("allows spawn-time MCP servers in Gemini ACP mode", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const result = geminiCliService.spawn!(createProviderContext(), {
      prompt: "call the MCP tool",
      mcpServers: {
        test: { command: "tiny-stdio-mcp-test-server" }
      }
    });
    await completeHappyPath(mock);
    await result;

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "gemini",
      ["--acp", "--allowed-mcp-server-names", "test", "--skip-trust", "--approval-mode", "yolo"],
      expect.any(Object)
    );
  });

  it("streams session updates during initialize, new session, and prompt", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const spawned = spawnAcp({ agentId: "gemini-cli", prompt: "hello", model: "gemini-2.5-flash" });
    const events = (async () => {
      const received = [];
      for await (const event of spawned.events) received.push(event);
      return received;
    })();

    await completeHappyPath(mock);
    await expect(spawned.done).resolves.toMatchObject({ threadId: "gemini-session" });
    await expect(events).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "session_start", threadId: "gemini-session" }),
        expect.objectContaining({ event: "agent_message", text: "hello" })
      ])
    );
  });

  it("uses environment authentication without sending authenticate", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const spawned = spawnAcp({ agentId: "gemini-cli", prompt: "hello", model: "gemini-2.5-flash" });
    const initialize = await waitForMethod(mock, "initialize");
    respond(mock, initialize, {
      protocolVersion: 1,
      authMethods: [{ id: "oauth", name: "Sign in" }],
      agentCapabilities: {
        promptCapabilities: { image: false, audio: false, embeddedContext: false }
      }
    });
    const newSession = await waitForMethod(mock, "session/new");
    respond(mock, newSession, { sessionId: "gemini-session" });
    const prompt = await waitForMethod(mock, "session/prompt");
    respond(mock, prompt, { stopReason: "completed" });

    await spawned.done;

    expect(mock.outbound().some((message) => message.method === "authenticate")).toBe(false);
  });

  it("updates the Gemini model after a session starts", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const spawned = spawnAcp({ agentId: "gemini-cli", prompt: "hello", model: "gemini-2.5-flash" });
    const initialize = await waitForMethod(mock, "initialize");
    respond(mock, initialize, {
      protocolVersion: 1,
      agentCapabilities: {
        promptCapabilities: { image: false, audio: false, embeddedContext: false }
      }
    });
    const newSession = await waitForMethod(mock, "session/new");
    respond(mock, newSession, { sessionId: "gemini-session" });
    const prompt = await waitForMethod(mock, "session/prompt");

    const updated = spawned.unstable_setSessionModel?.("gemini-3-pro-preview");
    const setConfigOption = await waitForMethod(mock, "session/set_config_option");
    expect(setConfigOption.params).toEqual({
      sessionId: "gemini-session",
      configId: "model",
      value: "gemini-3-pro-preview"
    });
    respond(mock, setConfigOption, { configOptions: [] });
    await updated;
    respond(mock, prompt, { stopReason: "completed" });

    await spawned.done;
  });

  it("cancels the Gemini ACP session before killing the process on abort", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const controller = new AbortController();
    const spawned = spawnAcp({
      agentId: "gemini-cli",
      prompt: "cancel me",
      model: "gemini-2.5-pro",
      signal: controller.signal
    });
    const aborted = spawned.done.catch((error: unknown) => error);
    const drainedEvents = (async () => {
      try {
        for await (const event of spawned.events) void event;
      } catch {
        return;
      }
    })();
    const initialize = await waitForMethod(mock, "initialize");
    respond(mock, initialize, {
      protocolVersion: 1,
      agentCapabilities: {
        promptCapabilities: { image: false, audio: false, embeddedContext: false }
      }
    });
    const newSession = await waitForMethod(mock, "session/new");
    respond(mock, newSession, { sessionId: "gemini-session" });
    await waitForMethod(mock, "session/prompt");

    controller.abort();

    await vi.waitFor(() => {
      expect(mock.outbound()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "session/cancel",
            params: { sessionId: "gemini-session" }
          })
        ])
      );
      expect(mock.kill).toHaveBeenCalledOnce();
    });
    await expect(aborted).resolves.toMatchObject({ name: "AbortError" });
    await drainedEvents;
  });

  it("always disables Gemini sandboxing for ACP gateway routing", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const spawned = spawnAcp({
      agentId: "gemini-cli",
      prompt: "route safely",
      model: "gemini-3-pro-preview"
    });
    await completeHappyPath(mock);
    await spawned.done;

    expect(vi.mocked(spawnChildProcess).mock.calls[0]?.[1]).not.toContain("--sandbox=false");
    expect(vi.mocked(spawnChildProcess).mock.calls[0]?.[2]?.env).toMatchObject({
      GEMINI_SANDBOX: "false"
    });
  });
});
