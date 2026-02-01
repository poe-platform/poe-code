import type { Command } from "commander";
import { select, isCancel, cancel } from "@clack/prompts";
import type { CliContainer } from "../container.js";
import { loadCredentials } from "../../services/credentials.js";
import { initializeClient } from "../../services/client-instance.js";
import { runMcpServerWithTransport, formatMcpToolsDocs } from "../mcp-server.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import {
  supportedAgents,
  configure,
  unconfigure
} from "@poe-code/agent-mcp-config";

export const MCP_SERVER_CONFIG = {
  "poe-code": {
    command: "npx",
    args: ["--yes", "poe-code", "mcp"]
  }
} as const;

const DEFAULT_MCP_AGENT = "claude-code";

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
    .command("configure [agent]")
    .description("Configure MCP client to use poe-code")
    .option("-y, --yes", "Skip prompt, use claude-code")
    .action(async (agentArg, options) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "mcp");

      let agent = agentArg;
      if (!agent) {
        if (options.yes) {
          agent = DEFAULT_MCP_AGENT;
        } else {
          const selected = await select({
            message: "Select agent to configure:",
            options: supportedAgents.map((a) => ({ value: a, label: a }))
          });
          if (isCancel(selected)) {
            cancel("Operation cancelled");
            return;
          }
          agent = selected as string;
        }
      }

      resources.logger.intro(`mcp configure ${agent}`);

      if (!supportedAgents.includes(agent)) {
        resources.logger.error(`Unknown agent: ${agent}`);
        return;
      }

      await configure(agent, {
        name: "poe-code",
        config: {
          transport: "stdio",
          command: MCP_SERVER_CONFIG["poe-code"].command,
          args: [...MCP_SERVER_CONFIG["poe-code"].args]
        }
      }, {
        fs: container.fs,
        homeDir: container.env.homeDir,
        platform: process.platform as "darwin" | "linux" | "win32",
        dryRun: flags.dryRun,
        observers: {
          onStart: (details) => {
            if (flags.dryRun) {
              resources.logger.dryRun(`Would ${details.label.toLowerCase()}`);
            }
          },
          onComplete: (details, outcome) => {
            if (!flags.dryRun && outcome.changed) {
              resources.logger.verbose(details.label);
            }
          }
        }
      });

      resources.context.complete({
        success: `Configured MCP for ${agent}.`,
        dry: `Would configure MCP for ${agent}.`
      });
      resources.context.finalize();
    });

  mcp
    .command("unconfigure <agent>")
    .description("Remove poe-code from MCP client")
    .action(async (agent) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "mcp");

      resources.logger.intro(`mcp unconfigure ${agent}`);

      if (!supportedAgents.includes(agent)) {
        resources.logger.error(`Unknown agent: ${agent}`);
        return;
      }

      await unconfigure(agent, "poe-code", {
        fs: container.fs,
        homeDir: container.env.homeDir,
        platform: process.platform as "darwin" | "linux" | "win32",
        dryRun: flags.dryRun,
        observers: {
          onStart: (details) => {
            if (flags.dryRun) {
              resources.logger.dryRun(`Would ${details.label.toLowerCase()}`);
            }
          },
          onComplete: (details, outcome) => {
            if (!flags.dryRun && outcome.changed) {
              resources.logger.verbose(details.label);
            }
          }
        }
      });

      resources.context.complete({
        success: `Removed MCP configuration from ${agent}.`,
        dry: `Would remove MCP configuration from ${agent}.`
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
