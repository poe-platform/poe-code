import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPoeAgentProgram, normalizePoeAgentArgv } from "./poe-agent-main.js";

const spawnPoeAgentWithAcpMock = vi.hoisted(() =>
  vi.fn(() => ({
    events: (async function* () {})(),
    done: Promise.resolve({
      stdout: "agent output\n",
      stderr: "",
      exitCode: 0
    })
  }))
);

vi.mock("../providers/poe-agent.js", () => ({
  spawnPoeAgentWithAcp: spawnPoeAgentWithAcpMock
}));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    renderAcpStream: vi.fn()
  };
});

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    log: {
      info: vi.fn(),
      error: vi.fn(),
      message: vi.fn()
    }
  };
});

async function runProgram(args: string[]): Promise<void> {
  const program = createPoeAgentProgram();
  program.exitOverride();
  await program.parseAsync(normalizePoeAgentArgv(["node", "poe-agent", ...args]));
}

describe("poe-agent CLI", () => {
  beforeEach(() => {
    spawnPoeAgentWithAcpMock.mockClear();
    spawnPoeAgentWithAcpMock.mockReturnValue({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "agent output\n",
        stderr: "",
        exitCode: 0
      })
    });
  });

  it("passes prompt to spawnPoeAgentWithAcp", async () => {
    await runProgram(["Hello world"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledOnce();
    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Hello world" })
    );
  });

  it("passes --model option", async () => {
    await runProgram(["--model", "anthropic/claude-opus-4.7", "Test prompt"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic/claude-opus-4.7" })
    );
  });

  it("passes --resume-thread-id without forcing a model", async () => {
    await runProgram(["--resume-thread-id", "poe-agent-existing", "continue"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: undefined,
        resumeThreadId: "poe-agent-existing"
      })
    );
  });

  it("supports the run subcommand with --prompt", async () => {
    await runProgram(["run", "--model", "anthropic/claude-opus-4.7", "--prompt", "Test prompt"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "anthropic/claude-opus-4.7",
        prompt: "Test prompt"
      })
    );
  });

  it("normalizes the optional run prefix", () => {
    expect(normalizePoeAgentArgv(["node", "poe-agent", "run", "--help"])).toEqual([
      "node",
      "poe-agent",
      "--help"
    ]);
    expect(normalizePoeAgentArgv(["node", "poe-agent", "--help"])).toEqual([
      "node",
      "poe-agent",
      "--help"
    ]);
  });

  it("passes --cwd option resolved to absolute path", async () => {
    await runProgram(["-C", "/tmp/project", "Test prompt"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/tmp/project" })
    );
  });

  it("passes --mcp-servers option", async () => {
    const mcpServersJson = JSON.stringify({
      "test-server": { command: "test-mcp", args: ["serve"] }
    });

    await runProgram(["--mcp-servers", mcpServersJson, "Test prompt"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: {
          "test-server": { command: "test-mcp", args: ["serve"] }
        }
      })
    );
  });

  it("preserves special-key --mcp-servers names and environments", async () => {
    await runProgram([
      "--mcp-servers",
      '{"__proto__":{"command":"custom-server","env":{"__proto__":"visible"}}}',
      "Test prompt"
    ]);

    const options = spawnPoeAgentWithAcpMock.mock.calls[0]?.[0] as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    expect(Object.hasOwn(options.mcpServers ?? {}, "__proto__")).toBe(true);
    expect(Object.hasOwn(options.mcpServers?.["__proto__"]?.env ?? {}, "__proto__")).toBe(true);
    expect(options.mcpServers?.["__proto__"]?.env?.["__proto__"]).toBe("visible");
  });

  it("throws on invalid --mcp-servers JSON", async () => {
    await expect(runProgram(["--mcp-servers", "not-json", "Test"])).rejects.toThrow(
      "--mcp-servers must be valid JSON"
    );
  });

  it("throws on --mcp-servers with missing command", async () => {
    const mcpServersJson = JSON.stringify({ server: {} });

    await expect(runProgram(["--mcp-servers", mcpServersJson, "Test"])).rejects.toThrow(
      'must include a non-empty string "command"'
    );
  });

  it("lets the provider choose the default model when none is configured", async () => {
    await runProgram(["Test prompt"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledOnce();

    const [call] = spawnPoeAgentWithAcpMock.mock.calls;

    if (!call) {
      throw new Error("Expected spawnPoeAgentWithAcp to be called.");
    }

    expect(call[0]).toMatchObject({ model: undefined });
  });

  it("propagates non-zero exit code as error", async () => {
    spawnPoeAgentWithAcpMock.mockReturnValue({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "something went wrong",
        exitCode: 1
      })
    });

    await expect(runProgram(["Test prompt"])).rejects.toThrow("poe-agent failed with exit code 1");
  });
});
