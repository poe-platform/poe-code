import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter,
  formatServiceList,
  listServiceNames
} from "./shared.js";
import { resolveServiceArgument } from "./configure.js";
import {
  type CommandCheck
} from "../../utils/command-checks.js";
import { withSpinner } from "@poe-code/design-system";

export function registerTestCommand(
  program: Command,
  container: CliContainer
): Command {
  const serviceNames = container.registry
    .list()
    .filter((service) => typeof service.test === "function");
  const serviceDescription =
    `Agent to test${formatServiceList(listServiceNames(serviceNames))}`;
  return program
    .command("test")
    .description("Run agent health checks.")
    .argument(
      "[agent]",
      serviceDescription
    )
    .option("--isolated", "Run the health check using isolated configuration.")
    .option("--model <model>", "Model override passed to the agent for the health check")
    .action(async function (this: Command, service: string | undefined) {
      const resolved = await resolveServiceArgument(
        program,
        container,
        service,
        { action: "test" }
      );
      const opts = this.opts<{
        isolated?: boolean;
        model?: string;
      }>();
      await executeTest(this, container, resolved, {
        isolated: Boolean(opts.isolated),
        model: opts.model
      });
    });
}

export async function executeTest(
  program: Command,
  container: CliContainer,
  service: string,
  options: { isolated?: boolean; model?: string } = {}
): Promise<void> {
  const adapter = resolveServiceAdapter(container, service);
  const canonicalService = adapter.name;
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(
    container,
    flags,
    `test:${canonicalService}`
  );

  resources.logger.intro(`test ${canonicalService}`);

  const providerContext = buildProviderContext(
    container,
    adapter,
    resources,
    { model: options.model }
  );

  const useIsolated = Boolean(options.isolated && adapter.isolatedEnv);

  if (useIsolated) {
    const { ensureIsolatedConfigForService } = await import(
      "./ensure-isolated-config.js"
    );
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
        const activeContext =
          useIsolated
            ? {
                ...providerContext,
                runCheck: async (check: CommandCheck) => {
                  await check.run({
                    isDryRun: providerContext.logger.context.dryRun,
                    runCommand: (command: string, args: string[]) =>
                      resources.context.runCommand("poe-code", [
                        "wrap",
                        canonicalService,
                        "--",
                        ...args
                      ]),
                    logDryRun: (message: string) =>
                      providerContext.logger.dryRun(message)
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
