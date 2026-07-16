import { Option, type Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter,
  resolveActiveProviderForService,
  formatServiceList,
  listServiceNames
} from "./shared.js";
import { resolveServiceArgument } from "./configure.js";
import { type CommandCheck } from "../../utils/command-checks.js";
import { withSpinner } from "toolcraft-design";
import {
  resolveIsolatedEnvDetails,
  resolveProviderRuntimeEnv,
  resolveCliSettings
} from "../isolated-env.js";
import { buildArgsWithMergedSettings } from "../../utils/cli-settings-merge.js";
import type { HookBridgeOptions } from "@poe-code/agent-spawn";

export function registerTestCommand(program: Command, container: CliContainer): Command {
  const serviceNames = container.registry
    .list()
    .filter((service) => typeof service.test === "function");
  const serviceDescription = `Agent to test${formatServiceList(listServiceNames(serviceNames))}`;
  return program
    .command("test")
    .description("Run agent health checks.")
    .argument("[agent]", serviceDescription)
    .option("--isolated", "Run the health check using isolated configuration.")
    .option("--model <model>", "Model override passed to the agent for the health check")
    .option("--hooks-from <agentId>", "Agent hook configuration to bridge for this health check")
    .addOption(
      new Option("--hooks-strategy <strategy>", "Hook bridge strategy (default: auto)").choices([
        "auto",
        "symlink",
        "transform"
      ])
    )
    .addOption(
      new Option("--hooks-scope <scope>", "Hook bridge scope (default: merged)").choices([
        "project",
        "user",
        "merged"
      ])
    )
    .action(async function (this: Command, service: string | undefined) {
      const resolved = await resolveServiceArgument(program, container, service, {
        action: "test"
      });
      const opts = this.opts<{
        isolated?: boolean;
        model?: string;
        hooksFrom?: string;
        hooksStrategy?: "auto" | "symlink" | "transform";
        hooksScope?: HookBridgeOptions["scope"];
      }>();
      if (!opts.hooksFrom && opts.hooksStrategy) {
        this.outputHelp({ error: true });
        this.error("error: option '--hooks-strategy <strategy>' requires '--hooks-from <agentId>'");
      }
      if (!opts.hooksFrom && opts.hooksScope) {
        this.outputHelp({ error: true });
        this.error("error: option '--hooks-scope <scope>' requires '--hooks-from <agentId>'");
      }
      await executeTest(this, container, resolved, {
        isolated: Boolean(opts.isolated),
        model: opts.model,
        hooks: opts.hooksFrom
          ? {
              from: opts.hooksFrom,
              strategy: opts.hooksStrategy ?? "auto",
              ...(opts.hooksScope ? { scope: opts.hooksScope } : {})
            }
          : undefined
      });
    });
}

export async function executeTest(
  program: Command,
  container: CliContainer,
  service: string,
  options: {
    isolated?: boolean;
    model?: string;
    hooks?: HookBridgeOptions;
  } = {}
): Promise<void> {
  const adapter = resolveServiceAdapter(container, service, "test");
  const canonicalService = adapter.name;
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, `test:${canonicalService}`);

  resources.logger.intro(`test ${canonicalService}`);

  const providerContext = buildProviderContext(container, adapter, resources, {
    model: options.model,
    hooks: options.hooks
  });

  const useIsolated = Boolean(options.isolated && adapter.isolatedEnv);
  let runtimeEnvPromise: Promise<Record<string, string>> | undefined;

  const resolveRuntimeEnv = adapter.runtimeEnv
    ? () => {
        runtimeEnvPromise ??= resolveActiveProviderForService(container, canonicalService, {
          readOnly: flags.dryRun
        }).then(
          (activeProvider) =>
            resolveProviderRuntimeEnv(
              container.env,
              adapter.runtimeEnv!,
              canonicalService,
              activeProvider
            ).then((runtimeEnv) => ({
              ...(activeProvider?.extraEnv ?? {}),
              ...runtimeEnv
            }))
        );
        return runtimeEnvPromise;
      }
    : undefined;

  if (useIsolated) {
    const { ensureIsolatedConfigForService } = await import("./ensure-isolated-config.js");
    await ensureIsolatedConfigForService({
      container,
      adapter,
      service: canonicalService,
      flags
    });
  }

  await withSpinner({
    message: `Testing ${adapter.label}...`,
    fn: () =>
      container.registry.invoke(canonicalService, "test", async (entry) => {
        if (!entry.test) {
          throw new Error(`Agent "${canonicalService}" does not support test.`);
        }
        const activeContext = useIsolated
          ? {
              ...providerContext,
              runCheck: async (check: CommandCheck) => {
                await check.run({
                  isDryRun: providerContext.logger.context.dryRun,
                  runCommand: async (command: string, args: string[], runOptions) => {
                    const activeProvider = await resolveActiveProviderForService(
                      container,
                      canonicalService,
                      { readOnly: flags.dryRun }
                    );
                    const details = await resolveIsolatedEnvDetails(
                      container.env,
                      adapter.isolatedEnv!,
                      canonicalService,
                      activeProvider
                    );
                    const runtimeEnv = adapter.runtimeEnv
                      ? await resolveProviderRuntimeEnv(
                          container.env,
                          adapter.runtimeEnv,
                          canonicalService,
                          activeProvider
                        )
                      : {};
                    let forwarded = args;
                    if (adapter.isolatedEnv?.cliSettings) {
                      const resolvedSettings = await resolveCliSettings(
                        adapter.isolatedEnv.cliSettings,
                        container.env,
                        activeProvider
                      );
                      forwarded = buildArgsWithMergedSettings(args, resolvedSettings);
                    }
                    return resources.context.runCommand(details.agentBinary, forwarded, {
                      ...runOptions,
                      env: {
                        ...(activeProvider?.extraEnv ?? {}),
                        ...details.env,
                        ...runtimeEnv,
                        ...(runOptions?.env ?? {})
                      }
                    });
                  },
                  logDryRun: (message: string) => providerContext.logger.dryRun(message),
                  logWarning: (message: string) => providerContext.logger.warn(message)
                });
              }
            }
          : resolveRuntimeEnv
            ? {
                ...providerContext,
                runCheck: async (check: CommandCheck) => {
                  await check.run({
                    isDryRun: providerContext.logger.context.dryRun,
                    runCommand: async (command, args, runOptions) => {
                      const runtimeEnv = await resolveRuntimeEnv();
                      return resources.context.runCommand(command, args, {
                        ...runOptions,
                        env: {
                          ...(runOptions?.env ?? {}),
                          ...runtimeEnv
                        }
                      });
                    },
                    logDryRun: (message) => providerContext.logger.dryRun(message),
                    logWarning: (message) => providerContext.logger.warn(message)
                  });
                }
              }
            : providerContext;

        await entry.test(activeContext);
      }),
    stopMessage: () => `${adapter.label} health check`
  });

  const dryMessage =
    canonicalService === "claude-code"
      ? `${adapter.label} test (dry run)`
      : `Dry run: would test ${adapter.label}.`;

  resources.context.complete({
    success: `Tested ${adapter.label}.`,
    dry: dryMessage
  });

  resources.context.finalize();
}
