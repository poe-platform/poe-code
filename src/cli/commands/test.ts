import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter
} from "./shared.js";
import { resolveServiceArgument } from "./configure.js";
import { resolveIsolatedEnvDetails } from "../isolated-env.js";
import {
  type CommandCheck,
  type CommandRunnerResult,
  formatCommandRunnerResult,
  stdoutMatchesExpected
} from "../../utils/command-checks.js";

export function registerTestCommand(
  program: Command,
  container: CliContainer
): Command {
  return program
    .command("test")
    .description("Run service health checks.")
    .option("--stdin", "Verify stdin prompt support via spawn")
    .option("--model <model>", "Model identifier override (requires --stdin)")
    .argument(
      "[service]",
      "Service to test (claude-code | codex | opencode)"
    )
    .option("--isolated", "Run the health check using isolated configuration.")
    .action(async function (this: Command, service: string | undefined) {
      const resolved = await resolveServiceArgument(
        program,
        container,
        service
      );
      const opts = this.opts<{
        isolated?: boolean;
        stdin?: boolean;
        model?: string;
      }>();
      await executeTest(this, container, resolved, {
        isolated: Boolean(opts.isolated),
        stdin: Boolean(opts.stdin),
        model: opts.model
      });
    });
}

export async function executeTest(
  program: Command,
  container: CliContainer,
  service: string,
  options: { isolated?: boolean; stdin?: boolean; model?: string } = {}
): Promise<void> {
  const adapter = resolveServiceAdapter(container, service);
  const canonicalService = adapter.name;
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(
    container,
    flags,
      `test:${canonicalService}`
  );
  const providerContext = buildProviderContext(
    container,
    adapter,
    resources
  );

  if (options.model && !options.stdin) {
    throw new Error("The --model option requires --stdin.");
  }

  const isolatedDetails =
    options.isolated && adapter.isolatedEnv
      ? await resolveIsolatedEnvDetails(
          container.env,
          adapter.isolatedEnv,
          adapter.name,
          container.fs
        )
      : null;

  if (options.isolated && adapter.isolatedEnv) {
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

  if (options.stdin) {
    if (!adapter.supportsStdinPrompt) {
      throw new Error(`${adapter.label} does not support stdin prompts.`);
    }

    if (flags.dryRun) {
      resources.context.complete({
        success: `Tested ${adapter.label}.`,
        dry: `Dry run: would run a stdin spawn test for ${adapter.label}.`
      });
      return;
    }

    const expectedOutput = "STDIN_OK";
    const prompt = `Output exactly: ${expectedOutput}`;
    const result = (await container.registry.invoke(
      canonicalService,
      "spawn",
      async (entry) => {
        if (!entry.spawn) {
          throw new Error(`Service "${canonicalService}" does not support spawn.`);
        }
        const output = await entry.spawn(providerContext, {
          prompt,
          useStdin: true,
          model: options.model
        });
        return output as CommandRunnerResult | void;
      }
    )) as CommandRunnerResult | void;

    if (!result) {
      throw new Error(
        `Stdin spawn test for ${adapter.label} did not return command output.`
      );
    }

    if (result.exitCode !== 0) {
      throw new Error(
        [
          `Stdin spawn test for ${adapter.label} failed with exit code ${result.exitCode}.`,
          formatCommandRunnerResult(result)
        ].join("\n")
      );
    }

    if (!stdoutMatchesExpected(result.stdout, expectedOutput)) {
      throw new Error(
        [
          `Stdin spawn test for ${adapter.label} failed: expected "${expectedOutput}" but received "${result.stdout.trim()}".`,
          formatCommandRunnerResult(result)
        ].join("\n")
      );
    }
  } else {
    await container.registry.invoke(canonicalService, "test", async (entry) => {
      if (!entry.test) {
        throw new Error(`Service "${canonicalService}" does not support test.`);
      }
      const activeContext =
        isolatedDetails
          ? {
              ...providerContext,
              runCheck: async (check: CommandCheck) => {
                await check.run({
                  isDryRun: providerContext.logger.context.dryRun,
                  runCommand: (command: string, args: string[]) =>
                    resources.context.runCommandWithEnv(command, args, {
                      env: isolatedDetails.env
                    }),
                  logDryRun: (message: string) =>
                    providerContext.logger.dryRun(message)
                });
              }
            }
          : providerContext;

      await entry.test(activeContext);
    });
  }

  const dryMessage =
    canonicalService === "claude-code"
      ? `${adapter.label} test (dry run)`
      : `Dry run: would test ${adapter.label}.`;

  resources.context.complete({
    success: `Tested ${adapter.label}.`,
    dry: dryMessage
  });
}
