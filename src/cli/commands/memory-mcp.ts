import type { Command } from "commander";
import {
  openMemory,
  printMcpConfig,
  resolveConfiguredMemoryRoot,
  startMemoryMcpServer
} from "@poe-code/memory";
import { mcpWritesAllowed } from "@poe-code/poe-code-config/core";
import type { CliContainer } from "../container.js";

export function registerMemoryMcpCommand(program: Command, container: CliContainer): void {
  program
    .command("memory-mcp")
    .description("Run the memory MCP server on stdin/stdout.")
    .option("--allow-writes", "Enable append_to_page writes.")
    .option("--print-mcp-config", "Print MCP client configuration as JSON.")
    .action(async (options: { allowWrites?: boolean; printMcpConfig?: boolean }) => {
      if (options.printMcpConfig === true) {
        process.stdout.write(`${printMcpConfig()}\n`);
        // Guidance goes to stderr so the snippet stays pasteable when stdout is piped.
        if (process.stdout.isTTY === true) {
          process.stderr.write(
            'Merge this block into your MCP client config, or run "poe-code memory install --agent <agent>" to write it for you.\n'
          );
        }
        return;
      }

      const root = await resolveConfiguredMemoryRoot({
        cwd: container.env.cwd,
        env: container.env.variables,
        fs: container.fs,
        configPath: container.env.configPath,
        projectConfigPath: container.env.projectConfigPath
      });
      const handle = openMemory({ root });
      const allowWrites =
        options.allowWrites === true ||
        (await mcpWritesAllowed({
          fs: container.fs,
          filePath: container.env.configPath,
          projectFilePath: container.env.projectConfigPath
        }));
      const { server } = await startMemoryMcpServer(handle, { allowWrites });
      await server.listen();
    });
}
