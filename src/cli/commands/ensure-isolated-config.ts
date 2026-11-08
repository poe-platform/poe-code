import type { CliContainer } from "../container.js";
import type { ProviderService } from "../service-registry.js";
import {
  buildProviderContext,
  createExecutionResources,
  applyIsolatedConfiguration,
  resolveActiveProviderForService,
  resolveAgentDefinition,
  type CommandFlags
} from "./shared.js";
import {
  isolatedConfigExists,
  resolveIsolatedEnvDetails
} from "../isolated-env.js";
import { createConfigurePayload } from "./configure-payload.js";
import type { ConfigureCommandOptions } from "./configure.js";
import { createMutationReporter } from "../../services/mutation-events.js";
import { loadConfiguredServices } from "../../services/config.js";

export async function ensureIsolatedConfigForService(input: {
  container: CliContainer;
  adapter: ProviderService;
  service: string;
  options?: ConfigureCommandOptions;
  flags: CommandFlags;
  refresh?: boolean;
}): Promise<void> {
  const { container, adapter } = input;
  const canonicalService = adapter.name;
  const isolated = adapter.isolatedEnv;
  if (!isolated) {
    return;
  }

  const flags = input.flags;
  const shouldRefresh = input.refresh === true;
  const resources = createExecutionResources(
    container,
    flags,
    `isolated:${canonicalService}`
  );
  const providerContext = buildProviderContext(container, adapter, resources);
  if (isolated.requiresConfig === false) {
    return;
  }
  const activeProvider = await resolveActiveProviderForService(
    container,
    canonicalService,
    { readOnly: flags.dryRun }
  );
  const details = await resolveIsolatedEnvDetails(
    container.env,
    isolated,
    adapter.name,
    activeProvider
  );
  const hasConfig = await isolatedConfigExists(
    container.fs,
    details.configProbePath!
  );
  if (hasConfig && !shouldRefresh) {
    return;
  }

  const providerId = await resolveIsolatedServiceProvider(container, canonicalService, {
    readOnly: flags.dryRun
  });
  if (!providerId) {
    return;
  }

  const configuredServices = await loadConfiguredServices({
    fs: container.fs,
    filePath: container.env.configPath,
    projectFilePath: container.env.projectConfigPath,
    readOnly: flags.dryRun
  });
  const metadata = configuredServices[canonicalService];
  const payload = await createConfigurePayload({
    container,
    flags: { ...flags, assumeYes: true },
    options: {
      reasoningEffort: metadata?.reasoningEffort,
      baseUrl: metadata?.baseUrl,
      shapeBaseUrl: metadata?.shapeBaseUrl,
      ...input.options
    },
    context: providerContext,
    adapter,
    logger: resources.logger,
    providerId
  });

  await container.registry.invoke(canonicalService, "configure", async (entry) => {
    if (!entry.configure) {
      throw new Error(`Agent "${canonicalService}" does not support configure.`);
    }
    const mutationLogger = createMutationReporter(resources.logger);
    await applyIsolatedConfiguration({
      adapter: entry,
      providerContext,
      payload,
      isolated,
      providerName: adapter.name,
      observers: mutationLogger
    });
  });

  if (!flags.dryRun) {
    const refreshed = await isolatedConfigExists(
      container.fs,
      details.configProbePath!
    );
    if (!refreshed) {
      throw new Error(
        `${adapter.label} isolated configuration did not create ${details.configProbePath}.`
      );
    }
  }
}

async function resolveIsolatedServiceProvider(
  container: CliContainer,
  serviceName: string,
  options: { readOnly?: boolean } = {}
): Promise<string | undefined> {
  const configuredServices = await loadConfiguredServices({
    fs: container.fs,
    filePath: container.env.configPath,
    projectFilePath: container.env.projectConfigPath,
    readOnly: options.readOnly
  });
  const metadata = configuredServices[serviceName];
  if (metadata?.provider) {
    return metadata.provider;
  }
  const agent = resolveAgentDefinition(serviceName);
  if (!agent) {
    return undefined;
  }
  const providers = container.providerRegistry.forAgent(agent);
  const loggedIn: string[] = [];
  for (const provider of providers) {
    if (await isProviderAvailable(container, provider.id, options)) {
      loggedIn.push(provider.id);
    }
  }
  if (loggedIn.length === 1) {
    return loggedIn[0];
  }
  if (providers.length === 1) {
    return providers[0]!.id;
  }
  return providers[0]?.id;
}

async function isProviderAvailable(
  container: CliContainer,
  providerId: string,
  options: { readOnly?: boolean }
): Promise<boolean> {
  try {
    return await container.providerRegistry.isLoggedIn(providerId, options);
  } catch {
    return false;
  }
}
