import type { Command } from "commander";
import { select, isCancel, cancel } from "toolcraft-design";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import type { CliContainer } from "../container.js";
import { initializeClient } from "../../services/client-instance.js";
import { runMcpServerWithTransport, formatMcpToolsDocs } from "../mcp-server.js";
import {
  createExecutionResources,
  resolveCommandFlags,
  resolveDefaultAgent
} from "./shared.js";
import { parseMcpOutputFormatPreferences } from "../mcp-output-format.js";
import { throwCommandNotFound } from "../command-not-found.js";
import {
  supportedAgents,
  configure,
  unconfigure,
  resolveAgentSupport,
  type McpServerEntry
} from "@poe-code/agent-mcp-config";
import {
  getCurrentExecutionContext,
  toMcpServerCommand
} from "../../utils/execution-context.js";
import { POE_PROVIDER_ID } from "@poe-code/providers";
import { ValidationError } from "../errors.js";

const DEFAULT_MCP_AGENT = "claude-code";

function createMcpServerEntry(mcpOutputFormat?: string): McpServerEntry {
  const context = getCurrentExecutionContext(import.meta.url);
  const mcpCommand = toMcpServerCommand(context.command, "mcp");
  const args = [...mcpCommand.args, "serve"];
  if (mcpOutputFormat) {
    args.push("--output-format", mcpOutputFormat);
  }
  return {
    name: "poe-code",
    config: {
      transport: "stdio",
      command: mcpCommand.command,
      args
    }
  };
}

function buildHelpText(): string {
  const server = createMcpServerEntry();
  const lines: string[] = [
    "",
    "Configuration:",
    JSON.stringify({ [server.name]: server.config }, null, 2)
  ];
  return lines.join("\n");
}

export function registerMcpCommand(
  program: Command,
  container: CliContainer
): void {
  const mcp = program
    .command("mcp")
    .description("MCP server commands.")
    .addHelpText("after", buildHelpText())
    .allowExcessArguments()
    .action(function (this: Command) {
      if (this.args.length > 0) {
        throwCommandNotFound({
          container,
          scope: "mcp",
          unknownCommand: this.args.at(0) ?? "",
          helpArgs: ["mcp", "--help"],
          moduleUrl: import.meta.url
        });
      }
      this.help();
    });

  mcp
    .command("serve")
    .description("Run MCP server on stdin/stdout.")
    .option(
      "--output-format <format>",
      'Preferred MCP media output format(s): "url", "base64", "markdown", or comma-separated list (default: "url"). Note: "markdown" cannot be combined with other formats.'
    )
    .addHelpText("after", `${buildHelpText()}\n\n${formatMcpToolsDocs()}`)
    .action(async (options: { outputFormat?: string }) => {
      const flags = resolveCommandFlags(program);
      await runMcpServer(container, { outputFormat: options.outputFormat, dryRun: flags.dryRun });
    });

  mcp
    .command("configure")
    .description("Configure MCP client to use poe-code.")
    .argument("[agent]", `Agent to configure (${supportedAgents.join(" | ")})`)
    .option("-y, --yes", "Accept defaults, skip prompts")
    .action(async (agentArg, options) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "mcp");

      let agent = agentArg;
      if (!agent) {
        if (flags.assumeYes || options.yes) {
          const fromConfig = await resolveDefaultAgent(container, { readOnly: flags.dryRun });
          agent = fromConfig !== null ? parseAgentSpecifier(fromConfig).agent : DEFAULT_MCP_AGENT;
        } else {
          if (process.stdin.isTTY !== true) {
            throw new ValidationError(
              "MCP agent selection requires an agent or --yes when running without an interactive TTY."
            );
          }
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

      const support = resolveAgentSupport(agent);
      if (support.status === "unknown") {
        throw new Error(`Unknown agent: ${agent}`);
      }
      if (support.status === "unsupported") {
        throw new Error(`MCP not supported for ${support.id}.`);
      }

      const existingKey = await resolvePoeCredential(container, { readOnly: flags.dryRun });

      if (!existingKey) {
        if (flags.dryRun) {
          resources.logger.dryRun("Dry run: would log in to Poe.");
        } else {
          resources.logger.intro("login");
          await container.options.resolveApiKey({ dryRun: false });
          resources.logger.success("Logged in.");
        }
      }

      const resolvedAgent = support.id ?? agent;
      await configure(resolvedAgent, createMcpServerEntry(support.config?.mcpOutputFormat), {
        fs: container.fs,
        homeDir: container.env.homeDir,
        platform: process.platform as "darwin" | "linux" | "win32",
        dryRun: flags.dryRun,
        observers: {
          onStart: (details: { label: string }) => {
            if (flags.dryRun) {
              resources.logger.dryRun(`Would ${details.label.toLowerCase()}`);
            }
          },
          onComplete: (details: { label: string }, outcome: { changed: boolean }) => {
            if (!flags.dryRun && outcome.changed) {
              resources.logger.verbose(details.label);
            }
          }
        }
      });

      resources.context.complete({
        success: `Configured MCP for ${resolvedAgent}.`,
        dry: `Would configure MCP for ${resolvedAgent}.`
      });
      resources.context.finalize();
    });

  mcp
    .command("unconfigure")
    .description("Remove poe-code from MCP client.")
    .argument("<agent>", `Agent to unconfigure (${supportedAgents.join(" | ")})`)
    .action(async (agent) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "mcp");

      resources.logger.intro(`mcp unconfigure ${agent}`);

      const support = resolveAgentSupport(agent);
      if (support.status === "unknown") {
        throw new Error(`Unknown agent: ${agent}`);
      }
      if (support.status === "unsupported") {
        throw new Error(`MCP not supported for ${support.id}.`);
      }

      const resolvedAgent = support.id ?? agent;
      let removed = false;
      await unconfigure(resolvedAgent, createMcpServerEntry(support.config?.mcpOutputFormat), {
        fs: container.fs,
        homeDir: container.env.homeDir,
        platform: process.platform as "darwin" | "linux" | "win32",
        dryRun: flags.dryRun,
        observers: {
          onStart: (details: { label: string }) => {
            if (flags.dryRun) {
              resources.logger.dryRun(`Would ${details.label.toLowerCase()}`);
            }
          },
          onComplete: (details: { label: string }, outcome: { changed: boolean }) => {
            removed ||= outcome.changed;
            if (!flags.dryRun && outcome.changed) {
              resources.logger.verbose(details.label);
            }
          }
        }
      });

      resources.context.complete({
        success: removed
          ? `Removed MCP configuration from ${resolvedAgent}.`
          : `No MCP configuration found for ${resolvedAgent}.`,
        dry: `Would remove MCP configuration from ${resolvedAgent}.`
      });
      resources.context.finalize();
    });
}

async function runMcpServer(
  container: CliContainer,
  options: { outputFormat?: string; dryRun?: boolean }
): Promise<void> {
  const outputFormatPreferences = parseMcpOutputFormatPreferences(
    options.outputFormat
  );

  if (options.dryRun) {
    process.stderr.write("Dry run: would start MCP server.\n");
    return;
  }

  const apiKey = await resolvePoeCredential(container);
  if (!apiKey) {
    process.stderr.write("No API key found. Run 'poe-code login' first.\n");
    process.exit(1);
  }

  await initializeClient({
    apiKey,
    baseUrl: container.env.poeApiBaseUrl,
    httpClient: container.httpClient
  });

  await runMcpServerWithTransport(outputFormatPreferences);
}

async function resolvePoeCredential(
  container: CliContainer,
  options: { readOnly?: boolean } = {}
): Promise<string | null> {
  try {
    return await container.providerRegistry.resolveCredential(POE_PROVIDER_ID, undefined, {
      envVars: container.env.variables,
      readOnly: options.readOnly
    });
  } catch {
    return null;
  }
}
