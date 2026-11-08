import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { allAgents, type ApiShapeId } from "@poe-code/agent-defs";
import { saveProviderShapeBaseUrls } from "@poe-code/poe-code-config/core";
import {
  apiKeyFlagDescription,
  createExecutionResources,
  createSecretPrompter,
  applyIsolatedConfiguration,
  buildProviderContext,
  parseProviderShapeBaseUrls,
  resolveProviderShapeBaseUrl,
  resolveCommandFlags,
  resolveNonEmpty,
  resolveServiceAdapter,
  warnApiKeyFlag
} from "./shared.js";
import { getTheme, loggerTableWidth, renderTable } from "toolcraft-design";
import type { AuthProvider } from "@poe-code/providers";
import { confirmDestructive } from "./confirm-destructive.js";
import { providerCredentialFileName } from "../provider-auth-storage.js";
import { createConfigurePayload } from "./configure-payload.js";
import { createOverlayFileSystem, type ConfigureCommandOptions } from "./configure.js";
import { loadConfiguredServices, unconfigureService } from "../../services/config.js";
import { createMutationReporter } from "../../services/mutation-events.js";
import { resolveIsolatedTargetDirectory } from "../isolated-env.js";
import type { ProviderContext } from "../service-registry.js";
import { jsonOptionDescription, writeJson, type JsonCommandOptions } from "./json-output.js";

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
    .description("Manage auth providers for coding agents.")
    .action(async () => {
      await executeProviderList(program, container, {});
    });

  providerCmd
    .command("list")
    .description("List available providers and their login status.")
    .option("--json", jsonOptionDescription)
    .action(async (options: JsonCommandOptions) => {
      await executeProviderList(program, container, options);
    });

  providerCmd
    .command("login")
    .description("Log in to a provider.")
    .argument("<id>", "Provider id (e.g. poe, anthropic)")
    .option(
      "--api-key <key>",
      apiKeyFlagDescription("the provider API key env var shown by `poe-code provider list`")
    )
    .option("--base-url <url>", "Provider gateway root URL")
    .option(
      "--shape-base-url <shape-id>=<url>",
      "Override --base-url for a single provider API shape, e.g. --shape-base-url anthropic-messages=https://gateway.example/anthropic. Repeatable; passing an unknown shape id lists the shapes the provider exposes.",
      collectRepeatedOption
    )
    .action(async (id: string, options: ProviderLoginOptions) => {
      await executeProviderLogin(program, container, id, options);
    });

  providerCmd
    .command("logout")
    .description(
      "Danger: deletes the provider's stored credential file and removes configuration for every agent configured with it. Requires --yes to run non-interactively; preview with --dry-run."
    )
    .argument("<id>", "Provider id (e.g. poe, anthropic)")
    .action(async (id: string) => {
      await executeProviderLogout(program, container, id);
    });
}

async function executeProviderList(
  program: Command,
  container: CliContainer,
  options: JsonCommandOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);

  const entries = await Promise.all(
    container.providerRegistry.list().map(async (provider) => {
      const apiShapes = provider.apiShapes?.map((shape) => shape.id) ?? [];
      return {
        id: provider.id,
        loggedIn: await container.providerRegistry.isLoggedIn(provider.id, {
          readOnly: flags.dryRun
        }),
        env: listProviderEnvVars(provider),
        apiShapes,
        agents: listShapeCompatibleAgents(apiShapes)
      };
    })
  );

  if (options.json === true) {
    writeJson(entries);
    return;
  }

  const resources = createExecutionResources(container, flags, "provider:list");

  resources.logger.intro("provider list");

  const theme = getTheme();
  const rows = entries.map((entry) => ({
    Provider: theme.accent(entry.id),
    Status: entry.loggedIn ? theme.success("[logged in]") : theme.muted("[-]"),
    Env: entry.env.join(", "),
    "API shapes": formatProviderApiShapes(entry.apiShapes),
    Agents: entry.agents.join(", ")
  }));

  const columns = [
    { name: "Provider", title: "Provider", alignment: "left" as const, maxLen: 20 },
    { name: "Status", title: "Status", alignment: "left" as const, maxLen: 14 },
    { name: "Env", title: "Env", alignment: "left" as const, maxLen: 34 },
    { name: "API shapes", title: "API shapes", alignment: "left" as const, maxLen: 52 },
    { name: "Agents", title: "Agents", alignment: "left" as const, maxLen: 60 }
  ];

  resources.logger.info(renderTable({ theme, columns, rows, maxWidth: loggerTableWidth() }));
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
    throw new ValidationError(
      `Unknown provider "${id}". Run \`poe-code provider list\` to see available providers.`
    );
  }

  warnApiKeyFlag(
    resources.logger,
    options.apiKey,
    provider.auth.kind === "api-key" ? provider.auth.envVar : "the provider API key env var"
  );

  const parsedShapeBaseUrls = parseProviderShapeBaseUrls(provider, options.shapeBaseUrl ?? []);
  validateProviderLoginBaseUrlOptions({
    provider,
    options,
    container,
    flags,
    parsedShapeBaseUrls
  });

  const shapeBaseUrls = await resolveProviderLoginShapeBaseUrls({
    provider,
    options,
    container,
    flags,
    logger: resources.logger,
    parsedShapeBaseUrls
  });

  let rollbackCredential: (() => Promise<void>) | undefined;
  const transaction = flags.dryRun ? undefined : createOverlayFileSystem(resources.context.fs);
  const executionFs = transaction?.fs ?? resources.context.fs;
  let credential: string | undefined;
  try {
    if (flags.dryRun) {
      validateDryRunCredentialAvailability({ provider, options, container, flags });
    } else {
      const staged = await stageProviderLogin({
        id,
        options,
        container,
        flags,
        fs: executionFs
      });
      credential = staged.credential;
      rollbackCredential = staged.rollback;
    }

    await saveProviderShapeBaseUrls({
      fs: executionFs,
      filePath: container.env.servicesConfigPath,
      providerId: id,
      shapeBaseUrls
    });

    await refreshConfiguredServicesForProvider({
      container,
      providerId: id,
      credential,
      flags,
      resources,
      fs: executionFs
    });

    await transaction?.commit();
  } catch (error) {
    await rollbackCredential?.().catch(() => undefined);
    throw error;
  }

  const dryMessage =
    flags.dryRun && provider.auth.kind === "api-key" && provider.auth.preferredLogin === "oauth" &&
    resolveNonEmpty(options.apiKey) === undefined &&
    resolveNonEmpty(container.env.getVariable(provider.auth.envVar)) === undefined
      ? `Dry run: would authenticate with ${provider.label}.`
      : `Dry run: would save credential for ${id}.`;

  resources.context.complete({
    success: `Saved credential for ${id}.`,
    dry: dryMessage
  });

  resources.context.finalize();
}

function validateDryRunCredentialAvailability(input: {
  provider: AuthProvider;
  options: ProviderLoginOptions;
  container: CliContainer;
  flags: ReturnType<typeof resolveCommandFlags>;
}): void {
  if (!input.flags.assumeYes || input.provider.auth.kind !== "api-key") {
    return;
  }
  if (input.provider.auth.preferredLogin === "oauth") {
    return;
  }
  if (
    resolveNonEmpty(input.options.apiKey) === undefined &&
    resolveNonEmpty(input.container.env.getVariable(input.provider.auth.envVar)) === undefined
  ) {
    throw new Error(
      `No API key available for provider "${input.provider.id}". Pass --api-key or run interactively.`
    );
  }
}

function validateProviderLoginBaseUrlOptions(input: {
  provider: AuthProvider;
  options: ProviderLoginOptions;
  container: CliContainer;
  flags: ReturnType<typeof resolveCommandFlags>;
  parsedShapeBaseUrls: Partial<Record<ApiShapeId, string>>;
}): void {
  for (const baseUrl of Object.values(input.parsedShapeBaseUrls)) {
    if (baseUrl !== undefined) {
      assertHttpBaseUrl(input.provider.id, baseUrl);
    }
  }

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
    result[shape.id] = resolveProviderShapeBaseUrl(provider, shape, baseUrl) ?? baseUrl;
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

function listProviderEnvVars(provider: {
  auth: { kind: string; envVar?: string };
  baseUrlEnvVar?: string;
}): string[] {
  return [
    provider.auth.kind === "api-key" ? provider.auth.envVar : undefined,
    provider.baseUrlEnvVar
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
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
    throw new ValidationError(
      `Unknown provider "${id}". Run \`poe-code provider list\` to see available providers.`
    );
  }

  await confirmDestructive({
    logger: resources.logger,
    flags,
    action: `provider logout ${id}`,
    summary: await describeProviderLogoutBlastRadius({ container, provider }),
    message: `Log out from ${id}?`
  });

  let rollbackCredential: (() => Promise<void>) | undefined;
  const transaction = flags.dryRun ? undefined : createOverlayFileSystem(resources.context.fs);
  const executionFs = transaction?.fs ?? resources.context.fs;
  try {
    if (flags.dryRun) {
      const previewStore = container.createPreviewProviderStore(id, executionFs);
      if (previewStore) {
        await container.providerRegistry.logout(id, { store: previewStore });
      }
    } else {
      rollbackCredential = await stageProviderLogout({ id, container, fs: executionFs });
    }

    await unconfigureServicesForProvider({
      container,
      providerId: id,
      flags,
      resources,
      fs: executionFs
    });
    await transaction?.commit();
  } catch (error) {
    await rollbackCredential?.().catch(() => undefined);
    throw error;
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

async function stageProviderLogin(input: {
  id: string;
  options: ProviderLoginOptions;
  container: CliContainer;
  flags: ReturnType<typeof resolveCommandFlags>;
  fs: CliContainer["fs"];
}): Promise<{ credential: string; rollback?: () => Promise<void> }> {
  const loginContext = {
    envVars: input.flags.assumeYes ? input.container.env.variables : {},
    promptForSecret: input.flags.assumeYes ? undefined : createSecretPrompter(input.container),
    resolvePreferredLogin: async (preferred: {
      provider: AuthProvider;
      apiKey?: string;
      envValue?: string;
    }) =>
      input.container.options.resolveApiKey({
        value: preferred.apiKey,
        envValue: preferred.envValue,
        dryRun: true,
        assumeYes: input.flags.assumeYes,
        // Non-interactive runs cannot authenticate, so reuse the stored credential
        // instead of failing; an interactive login always establishes a fresh one.
        allowStored: input.flags.assumeYes
      })
  };
  const previewStore = input.container.createPreviewProviderStore(input.id, input.fs);
  if (previewStore) {
    await input.container.providerRegistry.login(input.id, { apiKey: input.options.apiKey }, {
      ...loginContext,
      store: previewStore
    });
    const credential = await previewStore.get() ?? resolveNonEmpty(input.options.apiKey);
    if (typeof credential !== "string" || credential.trim().length === 0) {
      throw new Error(`No API key available for provider "${input.id}".`);
    }
    return { credential: credential.trim() };
  }

  const previousCredential = await input.container.providerRegistry
    .resolveCredential(input.id, {}, { envVars: {} })
    .catch(() => undefined);
  await input.container.providerRegistry.login(input.id, { apiKey: input.options.apiKey }, loginContext);
  const credential = await input.container.providerRegistry.resolveCredential(input.id, {}, { envVars: {} });
  return {
    credential,
    rollback: () => restoreProviderCredential(input.container, input.id, previousCredential)
  };
}

async function describeProviderLogoutBlastRadius(input: {
  container: CliContainer;
  provider: AuthProvider;
}): Promise<string[]> {
  const summary =
    input.provider.auth.kind === "api-key"
      ? [
          `Deletes the stored credential ${input.container.env.homeDir}/.poe-code/${providerCredentialFileName(input.provider)}.`
        ]
      : [`Deletes the stored credential for ${input.provider.id}.`];

  const configuredServices = await loadConfiguredServices({
    fs: input.container.fs,
    filePath: input.container.env.configPath,
    projectFilePath: input.container.env.projectConfigPath,
    readOnly: true
  });
  const affectedAgents = Object.entries(configuredServices)
    .filter(([, metadata]) => metadata.provider === input.provider.id)
    .map(([service]) => service);
  if (affectedAgents.length > 0) {
    summary.push(`Removes configuration for agents: ${affectedAgents.join(", ")}.`);
  }

  return summary;
}

async function stageProviderLogout(input: {
  id: string;
  container: CliContainer;
  fs: CliContainer["fs"];
}): Promise<(() => Promise<void>) | undefined> {
  const previewStore = input.container.createPreviewProviderStore(input.id, input.fs);
  if (previewStore) {
    await input.container.providerRegistry.logout(input.id, { store: previewStore });
    return undefined;
  }
  const previousCredential = await input.container.providerRegistry
    .resolveCredential(input.id, {}, { envVars: {} })
    .catch(() => undefined);
  await input.container.providerRegistry.logout(input.id);
  return () => restoreProviderCredential(input.container, input.id, previousCredential);
}

async function restoreProviderCredential(
  container: CliContainer,
  providerId: string,
  credential: string | undefined
): Promise<void> {
  if (credential === undefined) {
    await container.providerRegistry.logout(providerId);
    return;
  }
  await container.providerRegistry.login(providerId, { apiKey: credential });
}

async function refreshConfiguredServicesForProvider(input: {
  container: CliContainer;
  providerId: string;
  credential?: string;
  flags: ReturnType<typeof resolveCommandFlags>;
  resources: ReturnType<typeof createExecutionResources>;
  fs: CliContainer["fs"];
}): Promise<void> {
  const configuredServices = await loadConfiguredServices({
    fs: input.fs,
    filePath: input.container.env.configPath,
    projectFilePath: input.container.env.projectConfigPath,
    readOnly: input.flags.dryRun
  });
  const stagedContainer = { ...input.container, fs: input.fs };
  for (const [service, metadata] of Object.entries(configuredServices)) {
    if (metadata.provider !== input.providerId) {
      continue;
    }
    const adapter = resolveServiceAdapter(input.container, service);
    const providerContext = createProviderContextWithFileSystem(input.container, adapter, input.resources, input.fs);
    const options: ConfigureCommandOptions = {
      reasoningEffort: metadata.reasoningEffort,
      baseUrl: metadata.baseUrl,
      shapeBaseUrl: metadata.shapeBaseUrl,
      apiKey: input.credential
    };
    const payload = await createConfigurePayload({
      container: stagedContainer,
      flags: { ...input.flags, assumeYes: true },
      options,
      context: providerContext,
      adapter,
      logger: input.resources.logger,
      providerId: input.providerId
    });
    await input.container.registry.invoke(service, "configure", async (entry) => {
      await entry.configure(
        { fs: input.fs, env: providerContext.env, command: providerContext.command, options: payload },
        { observers: createMutationReporter(input.resources.logger) }
      );
      if (adapter.isolatedEnv && adapter.isolatedEnv.requiresConfig !== false) {
        await applyIsolatedConfiguration({
          adapter: entry,
          providerContext,
          payload,
          isolated: adapter.isolatedEnv,
          providerName: adapter.name,
          observers: createMutationReporter(input.resources.logger)
        });
      }
    });
  }
}

async function unconfigureServicesForProvider(input: {
  container: CliContainer;
  providerId: string;
  flags: ReturnType<typeof resolveCommandFlags>;
  resources: ReturnType<typeof createExecutionResources>;
  fs: CliContainer["fs"];
}): Promise<void> {
  const configuredServices = await loadConfiguredServices({
    fs: input.fs,
    filePath: input.container.env.configPath,
    projectFilePath: input.container.env.projectConfigPath,
    readOnly: input.flags.dryRun
  });
  for (const [service, metadata] of Object.entries(configuredServices)) {
    if (metadata.provider !== input.providerId) {
      continue;
    }
    const adapter = resolveServiceAdapter(input.container, service);
    const providerContext = createProviderContextWithFileSystem(input.container, adapter, input.resources, input.fs);
    const payload = { env: providerContext.env, provider: { id: input.providerId } };
    await input.container.registry.invoke(service, "unconfigure", async (entry) => {
      const observers = createMutationReporter(input.resources.logger);
      await entry.unconfigure(
        { fs: input.fs, env: providerContext.env, command: providerContext.command, options: payload },
        { observers }
      );
      if (adapter.isolatedEnv && adapter.isolatedEnv.requiresConfig !== false) {
        await entry.unconfigure(
          {
            fs: input.fs,
            env: providerContext.env,
            command: providerContext.command,
            options: payload,
            pathMapper: {
              mapTargetDirectory: ({ targetDirectory }) => resolveIsolatedTargetDirectory({
                targetDirectory,
                isolated: adapter.isolatedEnv!,
                env: providerContext.env,
                providerName: adapter.name
              })
            }
          },
          { observers }
        );
      }
      if (!input.flags.dryRun) {
        await unconfigureService({
          fs: input.fs,
          filePath: input.container.env.configPath,
          projectFilePath: input.container.env.projectConfigPath,
          service
        });
      }
    });
  }
}

function createProviderContextWithFileSystem(
  container: CliContainer,
  adapter: ReturnType<typeof resolveServiceAdapter>,
  resources: ReturnType<typeof createExecutionResources>,
  fs: CliContainer["fs"]
): ProviderContext {
  const providerContext = buildProviderContext(container, adapter, resources);
  return {
    ...providerContext,
    command: { ...providerContext.command, fs }
  };
}
