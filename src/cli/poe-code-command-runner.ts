import type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunnerResult
} from "../utils/command-checks.js";
import {
  applyIsolatedEnvRepairs,
  resolveIsolatedEnvDetails,
  isolatedConfigExists
} from "./isolated-env.js";
import type { CliContainer } from "./container.js";
import { ensureIsolatedConfigForService } from "./commands/ensure-isolated-config.js";

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

    const details = await resolveIsolatedEnvDetails(
      container.env,
      adapter.isolatedEnv,
      adapter.name,
      container.fs
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
          flags: { dryRun: false, assumeYes: true, verbose: false }
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
