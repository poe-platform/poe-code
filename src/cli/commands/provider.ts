import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { getTheme, renderTable } from "@poe-code/design-system";
import { OperationCancelledError } from "../errors.js";

export interface ProviderLoginOptions {
  apiKey?: string;
}

export function registerProviderCommand(program: Command, container: CliContainer): void {
  const providerCmd = program
    .command("provider")
    .description("Manage auth providers for coding agents.");

  providerCmd
    .command("list")
    .description("List available providers and their login status.")
    .action(async () => {
      await executeProviderList(program, container);
    });

  providerCmd
    .command("login")
    .description("Log in to a provider.")
    .argument("<id>", "Provider id (e.g. poe, anthropic)")
    .option("--api-key <key>", "API key for the provider")
    .action(async (id: string, options: ProviderLoginOptions) => {
      await executeProviderLogin(program, container, id, options);
    });

  providerCmd
    .command("logout")
    .description("Log out from a provider.")
    .argument("<id>", "Provider id (e.g. poe, anthropic)")
    .action(async (id: string) => {
      await executeProviderLogout(program, container, id);
    });
}

async function executeProviderList(program: Command, container: CliContainer): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "provider:list");

  resources.logger.intro("provider list");

  const providers = container.providerRegistry.list();
  const theme = getTheme();

  const rows = await Promise.all(
    providers.map(async (provider) => {
      const loggedIn = await container.providerRegistry.isLoggedIn(provider.id);
      return {
        Provider: theme.accent(provider.id),
        Status: loggedIn ? theme.success("[logged in]") : theme.muted("[-]"),
        Agents: provider.supportsAgents.join(", ")
      };
    })
  );

  const columns = [
    { name: "Provider", title: "Provider", alignment: "left" as const, maxLen: 20 },
    { name: "Status", title: "Status", alignment: "left" as const, maxLen: 14 },
    { name: "Agents", title: "Agents", alignment: "left" as const, maxLen: 60 }
  ];

  resources.logger.info(renderTable({ theme, columns, rows }));
}

async function executeProviderLogin(
  program: Command,
  container: CliContainer,
  id: string,
  options: ProviderLoginOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, `provider:login:${id}`);

  resources.logger.intro(`provider login ${id}`);

  const provider = container.providerRegistry.get(id);
  if (!provider) {
    throw new Error(`Unknown provider "${id}". Run \`poe-code provider list\` to see available providers.`);
  }

  if (!flags.dryRun) {
    await container.providerRegistry.login(id, { apiKey: options.apiKey }, {
      envVars: container.env.variables,
      promptForSecret: async (prompt) => {
        const descriptor = {
          name: "apiKey" as const,
          message: prompt.title,
          type: "password"
        };
        const response = await container.prompts(descriptor);
        const value = response["apiKey"];
        if (typeof value !== "string" || !value.trim()) {
          throw new OperationCancelledError();
        }
        return value.trim();
      }
    });
  }

  resources.context.complete({
    success: `Saved credential for ${id}.`,
    dry: `Dry run: would save credential for ${id}.`
  });

  resources.context.finalize();
}

async function executeProviderLogout(
  program: Command,
  container: CliContainer,
  id: string
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, `provider:logout:${id}`);

  resources.logger.intro(`provider logout ${id}`);

  const provider = container.providerRegistry.get(id);
  if (!provider) {
    throw new Error(`Unknown provider "${id}". Run \`poe-code provider list\` to see available providers.`);
  }

  if (!flags.dryRun) {
    await container.providerRegistry.logout(id);
  }

  resources.context.complete({
    success: `Logged out from ${id}.`,
    dry: `Dry run: would log out from ${id}.`
  });

  resources.context.finalize();
}
