import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const memoryMocks = vi.hoisted(() => ({
  openMemory: vi.fn(),
  printMcpConfig: vi.fn(),
  resolveConfiguredMemoryRoot: vi.fn(),
  startMemoryMcpServer: vi.fn()
}));

vi.mock("@poe-code/memory", () => memoryMocks);

const mcpWritesAllowed = vi.fn();

vi.mock("@poe-code/poe-code-config/core", () => ({
  mcpWritesAllowed
}));

const { registerMemoryMcpCommand } = await import("./memory-mcp.js");

describe("memory-mcp command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryMocks.resolveConfiguredMemoryRoot.mockResolvedValue("/repo/.poe-code/memory");
    memoryMocks.printMcpConfig.mockReturnValue('{"mcpServers":{}}');
    memoryMocks.openMemory.mockReturnValue({ root: "/repo/.poe-code/memory" });
    memoryMocks.startMemoryMcpServer.mockResolvedValue({ server: { listen: vi.fn() } });
    mcpWritesAllowed.mockReset();
    mcpWritesAllowed.mockResolvedValue(false);
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

  it("hints where to paste the config on a TTY without contaminating piped stdout", async () => {
    const program = new Command().exitOverride();
    const container = { env: { cwd: "/repo", variables: {}, configPath: "/home/config", projectConfigPath: "/repo/.poe-code/config.json" }, fs: {} } as never;
    registerMemoryMcpCommand(program, container);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errorWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const isTTY = process.stdout.isTTY;

    try {
      process.stdout.isTTY = true;
      await program.parseAsync(["node", "cli", "memory-mcp", "--print-mcp-config"]);

      // stdout stays the pasteable snippet; guidance goes to stderr.
      expect(write).toHaveBeenCalledWith('{"mcpServers":{}}\n');
      expect(errorWrite).toHaveBeenCalledWith(expect.stringMatching(/memory install/));

      errorWrite.mockClear();
      process.stdout.isTTY = false;
      await program.parseAsync(["node", "cli", "memory-mcp", "--print-mcp-config"]);

      expect(errorWrite).not.toHaveBeenCalled();
    } finally {
      process.stdout.isTTY = isTTY;
    }
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

  it("uses memory.mcp.allowWrites config when the CLI flag is absent", async () => {
    mcpWritesAllowed.mockResolvedValueOnce(true);
    const listen = vi.fn().mockResolvedValue(undefined);
    memoryMocks.startMemoryMcpServer.mockResolvedValue({ server: { listen } });
    const program = new Command().exitOverride();
    const container = { env: { cwd: "/repo", variables: {}, configPath: "/home/config", projectConfigPath: "/repo/.poe-code/config.json" }, fs: {} } as never;
    registerMemoryMcpCommand(program, container);

    await program.parseAsync(["node", "cli", "memory-mcp"]);

    expect(mcpWritesAllowed).toHaveBeenCalledWith({
      fs: {},
      filePath: "/home/config",
      projectFilePath: "/repo/.poe-code/config.json"
    });
    expect(memoryMocks.startMemoryMcpServer).toHaveBeenCalledWith(
      { root: "/repo/.poe-code/memory" },
      { allowWrites: true }
    );
  });
});
