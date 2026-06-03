import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const memoryMocks = vi.hoisted(() => ({
  openMemory: vi.fn(),
  printMcpConfig: vi.fn(),
  resolveConfiguredMemoryRoot: vi.fn(),
  startMemoryMcpServer: vi.fn()
}));

vi.mock("@poe-code/memory", () => memoryMocks);

const { registerMemoryMcpCommand } = await import("./memory-mcp.js");

describe("memory-mcp command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryMocks.resolveConfiguredMemoryRoot.mockResolvedValue("/repo/.poe-code/memory");
    memoryMocks.printMcpConfig.mockReturnValue('{"mcpServers":{}}');
    memoryMocks.openMemory.mockReturnValue({ root: "/repo/.poe-code/memory" });
    memoryMocks.startMemoryMcpServer.mockResolvedValue({ server: { listen: vi.fn() } });
  });

  it("prints generated MCP configuration", async () => {
    const program = new Command().exitOverride();
    const container = { env: { cwd: "/repo", variables: {}, configPath: "/home/config", projectConfigPath: "/repo/.poe-code/config.json" }, fs: {} } as never;
    registerMemoryMcpCommand(program, container);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "memory-mcp", "--print-mcp-config"]);

    expect(write).toHaveBeenCalledWith('{"mcpServers":{}}\n');
    expect(memoryMocks.startMemoryMcpServer).not.toHaveBeenCalled();
  });

  it("starts the stdio server with configured writes", async () => {
    const listen = vi.fn().mockResolvedValue(undefined);
    memoryMocks.startMemoryMcpServer.mockResolvedValue({ server: { listen } });
    const program = new Command().exitOverride();
    const container = { env: { cwd: "/repo", variables: {}, configPath: "/home/config", projectConfigPath: "/repo/.poe-code/config.json" }, fs: {} } as never;
    registerMemoryMcpCommand(program, container);

    await program.parseAsync(["node", "cli", "memory-mcp", "--allow-writes"]);

    expect(memoryMocks.openMemory).toHaveBeenCalledWith({ root: "/repo/.poe-code/memory" });
    expect(memoryMocks.startMemoryMcpServer).toHaveBeenCalledWith(
      { root: "/repo/.poe-code/memory" },
      { allowWrites: true }
    );
    expect(listen).toHaveBeenCalledOnce();
  });
});
