import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { allAgents, type ApiShapeId } from "@poe-code/agent-defs";
import { saveProviderShapeBaseUrls } from "@poe-code/poe-code-config";
import {
  createExecutionResources,
  createSecretPrompter,
  parseProviderShapeBaseUrls,
  resolveCommandFlags,
  resolveNonEmpty,
  resolveShapeBaseUrl
} from "./shared.js";
import { getTheme, renderTable } from "@poe-code/design-system";
import type { AuthProvider } from "@poe-code/providers";

const apiShapeLabels: Record<ApiShapeId, string> = {
  "openai-chat-completions": "chat-completions",
  "openai-responses": "responses",
  "anthropic-messages": "messages",
  "google-generations": "generations"
};

export interface ProviderLoginOptions {
  apiKey?: string;
  baseUrl?: string;
  shapeBaseUrl?: string[];
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
    .option("--base-url <url>", "Provider gateway root URL")
    .option(
      "--shape-base-url <shape-id>=<url>",
      "Base URL for one provider API shape",
      collectRepeatedOption
    )
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
      const loggedIn = await container.providerRegistry.isLoggedIn(provider.id, {
        readOnly: flags.dryRun
      });
      const apiShapes = provider.apiShapes?.map((shape) => shape.id) ?? [];
      return {
        Provider: theme.accent(provider.id),
        Status: loggedIn ? theme.success("[logged in]") : theme.muted("[-]"),
        Env: formatProviderEnv(provider),
        "API shapes": formatProviderApiShapes(apiShapes),
        Agents: listShapeCompatibleAgents(apiShapes).join(", ")
      };
    })
  );

  const columns = [
    { name: "Provider", title: "Provider", alignment: "left" as const, maxLen: 20 },
    { name: "Status", title: "Status", alignment: "left" as const, maxLen: 14 },
    { name: "Env", title: "Env", alignment: "left" as const, maxLen: 34 },
    { name: "API shapes", title: "API shapes", alignment: "left" as const, maxLen: 52 },
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
    throw new Error(
      `Unknown provider "${id}". Run \`poe-code provider list\` to see available providers.`
    );
  }

  const parsedShapeBaseUrls = parseProviderShapeBaseUrls(provider, options.shapeBaseUrl ?? []);
  validateProviderLoginBaseUrlOptions({
    provider,
    options,
    container,
    flags,
    parsedShapeBaseUrls
  });

  if (!flags.dryRun) {
    await container.providerRegistry.login(
      id,
      { apiKey: options.apiKey },
      {
        envVars: flags.assumeYes ? container.env.variables : {},
        promptForSecret: flags.assumeYes ? undefined : createSecretPrompter(container),
        resolvePreferredLogin: async (input) =>
          container.options.resolveApiKey({
            value: input.apiKey,
            envValue: input.envValue,
            dryRun: flags.dryRun,
            assumeYes: flags.assumeYes,
            allowStored: false
          })
      }
    );

    const shapeBaseUrls = await resolveProviderLoginShapeBaseUrls({
      provider,
      options,
      container,
      flags,
      logger: resources.logger,
      parsedShapeBaseUrls
    });

    await saveProviderShapeBaseUrls({
      fs: container.fs,
      filePath: container.env.servicesConfigPath,
      providerId: id,
      shapeBaseUrls
    });
  }

  resources.context.complete({
    success: `Saved credential for ${id}.`,
    dry: `Dry run: would save credential for ${id}.`
  });

  resources.context.finalize();
}

function validateProviderLoginBaseUrlOptions(input: {
  provider: AuthProvider;
  options: ProviderLoginOptions;
  container: CliContainer;
  flags: ReturnType<typeof resolveCommandFlags>;
  parsedShapeBaseUrls: Partial<Record<ApiShapeId, string>>;
}): void {
  const explicitBaseUrl = resolveNonEmpty(input.options.baseUrl);
  if (explicitBaseUrl !== undefined) {
    assertHttpBaseUrl(input.provider.id, explicitBaseUrl);
    return;
  }

  if (
    input.flags.assumeYes &&
    input.provider.requiresBaseUrl === true &&
    Object.keys(input.parsedShapeBaseUrls).length === 0 &&
    resolveProviderBaseUrlEnv(input.container, input.provider) === undefined
  ) {
    throw new Error(
      `Provider "${input.provider.id}" requires a base URL. Pass --base-url or set ${input.provider.baseUrlEnvVar ?? "the provider base URL env var"}.`
    );
  }
}

async function resolveProviderLoginShapeBaseUrls(input: {
  provider: AuthProvider;
  options: ProviderLoginOptions;
  container: CliContainer;
  flags: ReturnType<typeof resolveCommandFlags>;
  logger: ReturnType<typeof createExecutionResources>["logger"];
  parsedShapeBaseUrls: Partial<Record<ApiShapeId, string>>;
}): Promise<Partial<Record<ApiShapeId, string>>> {
  const shapeBaseUrls = input.parsedShapeBaseUrls;
  const explicitBaseUrl = resolveNonEmpty(input.options.baseUrl);
  if (explicitBaseUrl !== undefined) {
    assertHttpBaseUrl(input.provider.id, explicitBaseUrl);
    return {
      ...deriveShapeBaseUrls(input.provider, explicitBaseUrl),
      ...shapeBaseUrls
    };
  }

  if (Object.keys(shapeBaseUrls).length > 0 || input.provider.requiresBaseUrl !== true) {
    return shapeBaseUrls;
  }

  if (resolveProviderBaseUrlEnv(input.container, input.provider) !== undefined) {
    return shapeBaseUrls;
  }

  if (input.flags.assumeYes) {
    throw new Error(
      `Provider "${input.provider.id}" requires a base URL. Pass --base-url or set ${input.provider.baseUrlEnvVar ?? "the provider base URL env var"}.`
    );
  }

  const descriptor = input.container.promptLibrary.providerBaseUrl(input.provider.label);
  while (true) {
    const baseUrl = await input.container.options.ensure({ descriptor });
    if (isHttpBaseUrl(baseUrl)) {
      return deriveShapeBaseUrls(input.provider, baseUrl);
    }
    input.logger.warn(
      "Base URL must start with http:// or https://. Paste the Cloudflare gateway URL, not the API token."
    );
  }
}

function deriveShapeBaseUrls(
  provider: AuthProvider,
  baseUrl: string
): Partial<Record<ApiShapeId, string>> {
  const result: Partial<Record<ApiShapeId, string>> = {};
  for (const shape of provider.apiShapes ?? []) {
    result[shape.id] = resolveShapeBaseUrl(baseUrl, shape.baseUrlPath) ?? baseUrl;
  }
  return result;
}

function resolveProviderBaseUrlEnv(
  container: CliContainer,
  provider: AuthProvider
): string | undefined {
  const envVar = provider.baseUrlEnvVar;
  return envVar ? resolveNonEmpty(container.env.getVariable(envVar)) : undefined;
}

function assertHttpBaseUrl(providerId: string, baseUrl: string): void {
  if (!isHttpBaseUrl(baseUrl)) {
    throw new Error(`Provider "${providerId}" base URL must be an http(s) URL.`);
  }
}

function isHttpBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function collectRepeatedOption(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function formatProviderApiShapes(apiShapes: readonly ApiShapeId[]): string {
  return apiShapes.map((shapeId) => apiShapeLabels[shapeId]).join(", ");
}

function formatProviderEnv(provider: {
  auth: { kind: string; envVar?: string };
  baseUrlEnvVar?: string;
}): string {
  const envVars = [
    provider.auth.kind === "api-key" ? provider.auth.envVar : undefined,
    provider.baseUrlEnvVar
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return envVars.join(", ");
}

function listShapeCompatibleAgents(providerApiShapes: readonly ApiShapeId[]): string[] {
  const shapeIds = new Set(providerApiShapes);
  return allAgents
    .filter((agent) => agent.apiShapes?.some((shapeId) => shapeIds.has(shapeId)))
    .map((agent) => agent.id)
    .sort();
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
    throw new Error(
      `Unknown provider "${id}". Run \`poe-code provider list\` to see available providers.`
    );
  }

  if (!flags.dryRun) {
    await container.providerRegistry.logout(id);
  }

  const credentialEnvVar = provider.auth.kind === "api-key" ? provider.auth.envVar : undefined;
  const environmentCredential = credentialEnvVar
    ? container.env.getVariable(credentialEnvVar)
    : undefined;
  const hasEnvironmentCredential = typeof environmentCredential === "string"
    && environmentCredential.trim().length > 0;

  resources.context.complete({
    success: hasEnvironmentCredential
      ? `Stored credential removed, but ${credentialEnvVar} remains set; unset it to log out from ${id}.`
      : `Logged out from ${id}.`,
    dry: `Dry run: would log out from ${id}.`
  });

  resources.context.finalize();
}
