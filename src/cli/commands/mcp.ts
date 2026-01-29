import type { Command } from "commander";
import { select, isCancel, cancel } from "@clack/prompts";
import type { CliContainer } from "../container.js";
import { loadCredentials } from "../../services/credentials.js";
import { initializeClient } from "../../services/client-instance.js";
import { runMcpServerWithTransport, formatMcpToolsDocs } from "../mcp-server.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";

export const MCP_SERVER_CONFIG = {
  "poe-code": {
    command: "npx",
    args: ["--yes", "poe-code", "mcp"]
  }
} as const;

const MCP_PROVIDERS = ["claude-code", "codex", "kimi", "opencode"] as const;
const DEFAULT_MCP_PROVIDER = "claude-code";

function buildHelpText(): string {
  const lines: string[] = [
    "",
    "Configuration:",
    JSON.stringify(MCP_SERVER_CONFIG, null, 2),
    "",
    formatMcpToolsDocs()
  ];
  return lines.join("\n");
}

export function registerMcpCommand(
  program: Command,
  container: CliContainer
): void {
  const mcp = program
    .command("mcp")
    .description("Run MCP server on stdin/stdout")
    .addHelpText("after", buildHelpText())
    .action(async function () {
      await runMcpServer(container);
    });

  mcp
    .command("configure [provider]")
    .description("Configure MCP client to use poe-code")
    .option("-y, --yes", "Skip prompt, use claude-code")
    .action(async (providerArg, options) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "mcp");

      let provider = providerArg;
      if (!provider) {
        if (options.yes) {
          provider = DEFAULT_MCP_PROVIDER;
        } else {
          const selected = await select({
            message: "Select MCP provider to configure:",
            options: MCP_PROVIDERS.map((p) => ({ value: p, label: p }))
          });
          if (isCancel(selected)) {
            cancel("Operation cancelled");
            return;
          }
          provider = selected as string;
        }
      }

      resources.logger.intro(`mcp configure ${provider}`);

      const service = container.registry.get(provider);
      if (!service) {
        resources.logger.error(`Unknown provider: ${provider}`);
        return;
      }

      if (!service.mcpConfigure) {
        resources.logger.error(
          `Provider "${provider}" does not support MCP configuration`
        );
        return;
      }

      const commandContext = container.contextFactory.create({
        dryRun: flags.dryRun,
        logger: resources.logger,
        runner: container.commandRunner
      });

      await service.mcpConfigure(
        {
          env: container.env,
          command: commandContext,
          logger: resources.logger
        },
        { dryRun: flags.dryRun }
      );

      resources.context.complete({
        success: `Configured MCP for ${provider}.`,
        dry: `Would configure MCP for ${provider}.`
      });
      resources.context.finalize();
    });

  mcp
    .command("unconfigure <provider>")
    .description("Remove poe-code from MCP client")
    .action(async (provider) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "mcp");

      resources.logger.intro(`mcp unconfigure ${provider}`);

      const service = container.registry.get(provider);
      if (!service) {
        resources.logger.error(`Unknown provider: ${provider}`);
        return;
      }

      if (!service.mcpUnconfigure) {
        resources.logger.error(
          `Provider "${provider}" does not support MCP unconfiguration`
        );
        return;
      }

      const commandContext = container.contextFactory.create({
        dryRun: flags.dryRun,
        logger: resources.logger,
        runner: container.commandRunner
      });

      await service.mcpUnconfigure(
        {
          env: container.env,
          command: commandContext,
          logger: resources.logger
        },
        { dryRun: flags.dryRun }
      );

      resources.context.complete({
        success: `Removed MCP configuration from ${provider}.`,
        dry: `Would remove MCP configuration from ${provider}.`
      });
      resources.context.finalize();
    });
}

async function runMcpServer(container: CliContainer): Promise<void> {
  const apiKey = await loadCredentials({
    fs: container.fs,
    filePath: container.env.credentialsPath
  });
  if (!apiKey) {
    process.stderr.write("No credentials found. Run 'poe-code login' first.\n");
    process.exit(1);
  }

  await initializeClient({
    fs: container.fs,
    credentialsPath: container.env.credentialsPath,
    baseUrl: container.env.poeApiBaseUrl,
    httpClient: container.httpClient
  });

  await runMcpServerWithTransport();
}
