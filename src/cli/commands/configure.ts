import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter,
  applyIsolatedConfiguration
} from "./shared.js";
import { renderServiceMenu } from "../ui/service-menu.js";
import { createMenuTheme } from "../ui/theme.js";
import { saveConfiguredService } from "../../services/credentials.js";
import {
  combineMutationObservers,
  createMutationReporter
} from "../../services/mutation-events.js";
import type { ServiceMutationObservers } from "../../services/service-manifest.js";
import { createConfigurePayload } from "./configure-payload.js";
import type { ProviderService } from "../service-registry.js";

export interface ConfigureCommandOptions {
  apiKey?: string;
  model?: string;
  reasoningEffort?: string;
}

export function registerConfigureCommand(
  program: Command,
  container: CliContainer
): Command {
  const configureCommand = program
    .command("configure")
    .description("Configure developer tooling for Poe API.")
    .argument(
      "[service]",
      "Service to configure (claude-code | codex | opencode)"
    )
    .option("--api-key <key>", "Poe API key")
    .option("--model <model>", "Model identifier")
    .option("--reasoning-effort <level>", "Reasoning effort level")
    .action(
      async (service: string | undefined, options: ConfigureCommandOptions) => {
        const resolved = await resolveServiceArgument(
          program,
          container,
          service
        );
        await executeConfigure(program, container, resolved, options);
      }
    );

  return configureCommand;
}

export async function executeConfigure(
  program: Command,
  container: CliContainer,
  service: string,
  options: ConfigureCommandOptions
): Promise<void> {
  const adapter = resolveServiceAdapter(container, service);
  const canonicalService = adapter.name;
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(
    container,
    flags,
    `configure:${canonicalService}`
  );
  const providerContext = buildProviderContext(
    container,
    adapter,
    resources
  );

  const payload = await createConfigurePayload({
    container,
    flags,
    options,
    context: providerContext,
    adapter
  });

  await container.registry.invoke(canonicalService, "configure", async (entry) => {
    if (!entry.configure) {
      throw new Error(`Service "${canonicalService}" does not support configure.`);
    }
    const tracker = createMutationTracker();
    const mutationLogger = createMutationReporter(resources.logger);
    const observers = combineMutationObservers(tracker.observers, mutationLogger);

    await entry.configure(
      {
        fs: providerContext.command.fs,
        env: providerContext.env,
        command: providerContext.command,
        options: payload
      },
      observers
        ? {
            observers
          }
        : undefined
    );

    if (!flags.dryRun) {
      await saveConfiguredService({
        fs: container.fs,
        filePath: providerContext.env.credentialsPath,
        service: canonicalService,
        metadata: {
          files: tracker.files()
        }
      });
    }

    const isolated = adapter.isolatedEnv;
    if (isolated && isolated.requiresConfig !== false) {
      const isolatedTracker = createMutationTracker();
      const isolatedLogger = createMutationReporter(resources.logger);
      const isolatedObservers = combineMutationObservers(
        isolatedTracker.observers,
        isolatedLogger
      );
      await applyIsolatedConfiguration({
        adapter: entry,
        providerContext,
        payload,
        isolated,
        providerName: adapter.name,
        observers: isolatedObservers
      });
    }
  });

  const dryMessage =
    canonicalService === "claude-code"
      ? `${adapter.label} (dry run)`
      : `Dry run: would configure ${adapter.label}.`;

  resources.context.complete({
    success: `Configured ${adapter.label}.`,
    dry: dryMessage
  });

  if (!flags.dryRun) {
    for (const message of resolvePostConfigureMessages(adapter)) {
      resources.logger.info(message);
    }
  }
}

function createMutationTracker(): {
  observers: ServiceMutationObservers;
  files(): string[];
} {
  const targets = new Set<string>();
  const observers: ServiceMutationObservers = {
    onComplete(details, outcome) {
      if (!outcome.changed || !details.targetPath) {
        return;
      }
      if (outcome.effect !== "write" && outcome.effect !== "delete") {
        return;
      }
      targets.add(details.targetPath);
    }
  };

  return {
    observers,
    files() {
      return Array.from(targets).sort();
    }
  };
}

function resolvePostConfigureMessages(provider: ProviderService): string[] {
  return provider.postConfigureMessages ?? [];
}

export async function resolveServiceArgument(
  program: Command,
  container: CliContainer,
  provided?: string
): Promise<string> {
  if (provided) {
    return provided;
  }
  const services = container.registry.list();
  if (services.length === 0) {
    throw new Error("No services available to configure.");
  }
  const flags = resolveCommandFlags(program);
  const logger = container.loggerFactory.create({
    dryRun: flags.dryRun,
    verbose: true,
    scope: "configure"
  });
  const menuTheme = createMenuTheme(container.env);
  const menuLines = renderServiceMenu(services, { theme: menuTheme });
  menuLines.forEach((line) => logger.info(line));
  const descriptor = container.promptLibrary.serviceSelection();
  const response = await container.prompts(descriptor);
  const selection = response[descriptor.name];
  const normalized =
    typeof selection === "number"
      ? selection
      : typeof selection === "string"
      ? Number.parseInt(selection, 10)
      : NaN;
  if (!Number.isInteger(normalized)) {
    throw new Error("Invalid service selection.");
  }
  const index = normalized - 1;
  if (index < 0 || index >= services.length) {
    throw new Error("Invalid service selection.");
  }
  return services[index].name;
}
