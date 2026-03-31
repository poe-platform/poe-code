import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { createPoeAgentProgram } from "./poe-agent-main.js";
import * as agentSpawnModule from "@poe-code/agent-spawn";
import * as designSystemModule from "@poe-code/design-system";

const spawnPoeAgentWithAcpMock = vi.fn(() => ({
  events: (async function* () {})(),
  done: Promise.resolve({
    stdout: "agent output\n",
    stderr: "",
    exitCode: 0,
  }),
}));

vi.mock("../providers/poe-agent.js", () => ({
  spawnPoeAgentWithAcp: spawnPoeAgentWithAcpMock,
  poeAgentService: { id: "poe-agent", name: "poe-agent", label: "Poe Agent", summary: "", configure: vi.fn(), unconfigure: vi.fn() },
  provider: { id: "poe-agent", name: "poe-agent", label: "Poe Agent", summary: "", configure: vi.fn(), unconfigure: vi.fn() },
}));

async function runProgram(args: string[]): Promise<void> {
  const program = createPoeAgentProgram();
  program.exitOverride();
  await program.parseAsync(["node", "poe-agent", ...args]);
}

describe("poe-agent CLI", () => {
  let renderAcpStreamSpy: ReturnType<typeof vi.spyOn>;
  let logInfoSpy: ReturnType<typeof vi.spyOn>;
  let logErrorSpy: ReturnType<typeof vi.spyOn>;
  let logMessageSpy: ReturnType<typeof vi.spyOn>;

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
    renderAcpStreamSpy = vi.spyOn(agentSpawnModule, "renderAcpStream" as any).mockResolvedValue(undefined);
    logInfoSpy = vi.spyOn(designSystemModule.log, "info").mockImplementation(() => {});
    logErrorSpy = vi.spyOn(designSystemModule.log, "error").mockImplementation(() => {});
    logMessageSpy = vi.spyOn(designSystemModule.log, "message").mockImplementation(() => {});
  });

  afterEach(() => {
    renderAcpStreamSpy?.mockRestore();
    logInfoSpy?.mockRestore();
    logErrorSpy?.mockRestore();
    logMessageSpy?.mockRestore();
  });

  it("passes prompt to spawnPoeAgentWithAcp", async () => {
    await runProgram(["Hello world"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledOnce();
    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Hello world" })
    );
  });

  it("passes --model option", async () => {
    await runProgram(["--model", "anthropic/claude-opus-4.6", "Test prompt"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic/claude-opus-4.6" })
    );
  });

  it("passes --cwd option resolved to absolute path", async () => {
    await runProgram(["-C", "/tmp/project", "Test prompt"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/tmp/project" })
    );
  });

  it("passes --mcp-config option", async () => {
    const mcpConfig = JSON.stringify({
      "test-server": { command: "test-mcp", args: ["serve"] },
    });

    await runProgram(["--mcp-config", mcpConfig, "Test prompt"]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: {
          "test-server": { command: "test-mcp", args: ["serve"] },
        },
      })
    );
  });

  it("throws on invalid --mcp-config JSON", async () => {
    await expect(
      runProgram(["--mcp-config", "not-json", "Test"])
    ).rejects.toThrow("--mcp-config must be valid JSON");
  });

  it("throws on --mcp-config with missing command", async () => {
    const mcpConfig = JSON.stringify({ server: {} });

    await expect(
      runProgram(["--mcp-config", mcpConfig, "Test"])
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
