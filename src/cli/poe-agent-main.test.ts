import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPoeAgentProgram } from "./poe-agent-main.js";

const spawnPoeAgentWithAcpMock = vi.hoisted(() =>
  vi.fn(() => ({
    events: (async function* () {})(),
    done: Promise.resolve({
      stdout: "agent output\n",
      stderr: "",
      exitCode: 0,
    }),
  }))
);

vi.mock("../providers/poe-agent.js", () => ({
  spawnPoeAgentWithAcp: spawnPoeAgentWithAcpMock,
}));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    renderAcpStream: vi.fn(),
  };
});

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    log: {
      info: vi.fn(),
      error: vi.fn(),
      message: vi.fn(),
    },
  };
});

async function runProgram(args: string[]): Promise<void> {
  const program = createPoeAgentProgram();
  program.exitOverride();
  await program.parseAsync(["node", "poe-agent", ...args]);
}

describe("poe-agent CLI", () => {
  beforeEach(() => {
    spawnPoeAgentWithAcpMock.mockClear();
    spawnPoeAgentWithAcpMock.mockReturnValue({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "agent output\n",
        stderr: "",
        exitCode: 0,
      }),
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

  it("passes --cwd option resolved to absolute path", async () => {
    await runProgram(["-C", "/tmp/project", "Test prompt"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/tmp/project" })
    );
  });

  it("passes --mcp-servers option", async () => {
    const mcpServersJson = JSON.stringify({
      "test-server": { command: "test-mcp", args: ["serve"] },
    });

    await runProgram(["--mcp-servers", mcpServersJson, "Test prompt"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: {
          "test-server": { command: "test-mcp", args: ["serve"] },
        },
      })
    );
  });

  it("throws on invalid --mcp-servers JSON", async () => {
    await expect(
      runProgram(["--mcp-servers", "not-json", "Test"])
    ).rejects.toThrow("--mcp-servers must be valid JSON");
  });

  it("throws on --mcp-servers with missing command", async () => {
    const mcpServersJson = JSON.stringify({ server: {} });

    await expect(
      runProgram(["--mcp-servers", mcpServersJson, "Test"])
    ).rejects.toThrow('must include a non-empty string "command"');
  });

  it("uses default model when --model is not specified", async () => {
    await runProgram(["Test prompt"]);

    const call = spawnPoeAgentWithAcpMock.mock.calls[0]?.[0];
    expect(call?.model).toBe("anthropic/claude-sonnet-4.6");
  });

  it("propagates non-zero exit code as error", async () => {
    spawnPoeAgentWithAcpMock.mockReturnValue({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "something went wrong",
        exitCode: 1,
      }),
    });

    await expect(runProgram(["Test prompt"])).rejects.toThrow(
      "poe-agent failed with exit code 1"
    );
  });
});
