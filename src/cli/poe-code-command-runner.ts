import type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunnerResult
} from "../utils/command-checks.js";
import {
  applyIsolatedEnvRepairs,
  resolveIsolatedEnvDetails,
  resolveCliSettings,
  isolatedConfigExists
} from "./isolated-env.js";
import { buildArgsWithMergedSettings } from "../utils/cli-settings-merge.js";
import type { CliContainer } from "./container.js";
import { ensureIsolatedConfigForService } from "./commands/ensure-isolated-config.js";
import { buildActiveProvider } from "./commands/shared.js";
import { POE_PROVIDER_ID } from "@poe-code/providers";

export function createPoeCodeCommandRunner(input: {
  getContainer: () => CliContainer;
  baseRunner: CommandRunner;
}): CommandRunner {
  return async (
    command: string,
    args: string[],
    options?: CommandRunnerOptions
  ): Promise<CommandRunnerResult> => {
    const container = input.getContainer();
    if (command !== "poe-code" || args.length === 0) {
      return input.baseRunner(command, args, options);
    }
    if (args[0] !== "wrap") {
      return input.baseRunner(command, args, options);
    }

    const service = args[1];
    if (typeof service !== "string" || service.trim() === "") {
      return input.baseRunner(command, args, options);
    }

    const adapter = container.registry.get(service);
    if (!adapter?.isolatedEnv) {
      return input.baseRunner(command, args, options);
    }

    const envApiKey = container.env.getVariable("POE_API_KEY");
    const credential =
      typeof envApiKey === "string" && envApiKey.trim().length > 0
        ? envApiKey
        : (await container.readApiKey()) ?? "";
    const activeProvider = buildActiveProvider(POE_PROVIDER_ID, container.providerRegistry.get(POE_PROVIDER_ID)!.baseUrl, credential);

    const details = await resolveIsolatedEnvDetails(
      container.env,
      adapter.isolatedEnv,
      adapter.name,
      activeProvider
    );

    if (adapter.isolatedEnv.requiresConfig !== false) {
      const hasConfig = await isolatedConfigExists(
        container.fs,
        details.configProbePath!
      );
      if (!hasConfig) {
        await ensureIsolatedConfigForService({
          container,
          adapter,
          service,
          flags: { dryRun: false, assumeYes: true, verbose: false },
          refresh: true
        });
      }
    }

    await applyIsolatedEnvRepairs({
      fs: container.fs,
      env: container.env,
      providerName: adapter.name,
      isolated: adapter.isolatedEnv
    });

    let forwarded = args.slice(2);
    if (forwarded[0] === "--") {
      forwarded = forwarded.slice(1);
    }

    // Merge CLI settings if provider defines them
    if (adapter.isolatedEnv.cliSettings) {
      const resolvedSettings = await resolveCliSettings(
        adapter.isolatedEnv.cliSettings,
        container.env,
        activeProvider
      );
      forwarded = buildArgsWithMergedSettings(forwarded, resolvedSettings);
    }

    const mergedEnv = {
      ...(options?.env ?? {}),
      ...details.env
    };

    const runOptions: CommandRunnerOptions = { env: mergedEnv };
    if (options?.cwd) {
      runOptions.cwd = options.cwd;
    }
    if (options?.stdin != null) {
      runOptions.stdin = options.stdin;
    }

    return input.baseRunner(details.agentBinary, forwarded, runOptions);
  };
}
