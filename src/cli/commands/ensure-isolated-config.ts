import type { CliContainer } from "../container.js";
import type { ProviderService } from "../service-registry.js";
import {
  buildProviderContext,
  createExecutionResources,
  applyIsolatedConfiguration,
  type CommandFlags
} from "./shared.js";
import {
  isolatedConfigExists,
  resolveIsolatedEnvDetails
} from "../isolated-env.js";
import { createConfigurePayload } from "./configure-payload.js";
import type { ConfigureCommandOptions } from "./configure.js";
import {
  createMutationReporter
} from "../../services/mutation-events.js";

export async function ensureIsolatedConfigForService(input: {
  container: CliContainer;
  adapter: ProviderService;
  service: string;
  options?: ConfigureCommandOptions;
  flags: CommandFlags;
}): Promise<void> {
  const { container, adapter } = input;
  const canonicalService = adapter.name;
  const isolated = adapter.isolatedEnv;
  if (!isolated) {
    return;
  }

  const flags = input.flags;
  const resources = createExecutionResources(
    container,
    flags,
    `isolated:${canonicalService}`
  );
  const providerContext = buildProviderContext(container, adapter, resources);
  if (isolated.requiresConfig === false) {
    return;
  }
  const details = await resolveIsolatedEnvDetails(
    container.env,
    isolated,
    adapter.name,
    container.fs
  );
  const hasConfig = await isolatedConfigExists(
    container.fs,
    details.configProbePath!
  );
  if (hasConfig) {
    return;
  }

  const payload = await createConfigurePayload({
    container,
    flags: { ...flags, assumeYes: true },
    options: input.options ?? {},
    context: providerContext,
    adapter,
    logger: resources.logger
  });

  await container.registry.invoke(canonicalService, "configure", async (entry) => {
    if (!entry.configure) {
      throw new Error(`Service "${canonicalService}" does not support configure.`);
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
