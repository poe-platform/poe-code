import type { Command } from "commander";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import type { CliContainer } from "../container.js";
import {
  buildProviderContext,
  createExecutionResources,
  formatServiceList,
  listServiceNames,
  resolveCommandFlags,
  resolveDefaultAgent,
  resolveServiceAdapter,
  applyIsolatedConfiguration,
  type CommandFlags
} from "./shared.js";
import { saveConfiguredService } from "../../services/config.js";
import { OperationCancelledError } from "../errors.js";
import {
  combineMutationObservers,
  createMutationReporter
} from "../../services/mutation-events.js";
import type { MutationObservers } from "@poe-code/config-mutations";
import { createConfigurePayload } from "./configure-payload.js";

const serviceSelectionPrompt = (action: string) => `Pick an agent to ${action}:`;
const DEFAULT_SERVICE_AGENT = "claude-code";

export interface ConfigureCommandOptions {
  apiKey?: string;
  model?: string;
  reasoningEffort?: string;
  provider?: string;
}

export function registerConfigureCommand(program: Command, container: CliContainer): Command {
  const serviceNames = listServiceNames(container.registry.list());
  const serviceDescription = `Agent to configure${formatServiceList(serviceNames)}`;
  const configureCommand = program
    .command("configure")
    .alias("c")
    .description("Configure developer tooling for Poe API.")
    .argument("[agent]", serviceDescription)
    .option("-y, --yes", "Accept defaults, skip prompts")
    .option("--api-key <key>", "Poe API key")
    .option("--model <model>", "Model identifier")
    .option("--reasoning-effort <level>", "Reasoning effort level")
    .option("--provider <id>", "Provider to use for this agent")
    .action(async (service: string | undefined, options: ConfigureCommandOptions) => {
      const resolved = await resolveServiceArgument(program, container, service, {
        action: "configure"
      });
      await executeConfigure(program, container, resolved, options);
    });

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
  const resources = createExecutionResources(container, flags, `configure:${canonicalService}`);

  resources.logger.intro(`configure ${canonicalService}`);

  const providerId = await resolveProvider(canonicalService, options, container, flags);

  const providerContext = buildProviderContext(container, adapter, resources);

  const payload = await createConfigurePayload({
    container,
    flags,
    options,
    context: providerContext,
    adapter,
    logger: resources.logger,
    providerId
  });

  await container.registry.invoke(canonicalService, "configure", async (entry) => {
    if (!entry.configure) {
      throw new Error(`Agent "${canonicalService}" does not support configure.`);
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
        filePath: providerContext.env.configPath,
        projectFilePath: providerContext.env.projectConfigPath,
        service: canonicalService,
        metadata: {
          files: tracker.files(),
          provider: providerId
        }
      });
    }

    const isolated = adapter.isolatedEnv;
    if (isolated && isolated.requiresConfig !== false) {
      const isolatedTracker = createMutationTracker();
      const isolatedLogger = createMutationReporter(resources.logger);
      const isolatedObservers = combineMutationObservers(isolatedTracker.observers, isolatedLogger);
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

  resources.context.complete({
    success: `Configured ${adapter.label}.`,
    dry: `Dry run: would configure ${adapter.label}.`
  });

  if (!flags.dryRun) {
    resources.logger.nextSteps(adapter.postConfigureMessages ?? []);
  }

  resources.context.finalize();
}

async function resolveProvider(
  agentId: string,
  options: Pick<ConfigureCommandOptions, "provider">,
  container: CliContainer,
  flags: CommandFlags
): Promise<string> {
  if (options.provider) {
    return options.provider;
  }

  const envProvider = container.env.getVariable("POE_CODE_PROVIDER");
  if (envProvider) {
    return envProvider;
  }

  const candidates = container.providerRegistry.forAgent(agentId);

  if (flags.dryRun) {
    if (candidates.length === 0) {
      throw new Error(`No providers support agent "${agentId}".`);
    }
    return candidates[0]!.id;
  }

  const loggedIn: typeof candidates[number][] = [];
  for (const candidate of candidates) {
    if (await container.providerRegistry.isLoggedIn(candidate.id)) {
      loggedIn.push(candidate);
    }
  }

  if (loggedIn.length === 0) {
    throw new Error(
      `No logged-in providers support agent "${agentId}". Run \`poe-code provider login\` to authenticate.`
    );
  }

  if (loggedIn.length === 1) {
    return loggedIn[0]!.id;
  }

  if (flags.assumeYes) {
    throw new Error(
      `Multiple providers support "${agentId}". Use --provider <id> to select one.`
    );
  }

  const choices = loggedIn.map((p) => ({ title: p.label, value: p.id }));
  const descriptor = container.promptLibrary.serviceSelection({
    message: `Which provider powers ${agentId}?`,
    choices
  });
  const response = await container.prompts(descriptor);
  const selected = response[descriptor.name];
  if (typeof selected !== "string") {
    throw new OperationCancelledError();
  }
  return selected;
}

function createMutationTracker(): {
  observers: MutationObservers;
  files(): string[];
} {
  const targets = new Set<string>();
  const observers: MutationObservers = {
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

export async function resolveServiceArgument(
  program: Command,
  container: CliContainer,
  provided?: string,
  selectionContext?: { action: string }
): Promise<string> {
  if (provided) {
    return provided;
  }
  const fromConfig = await resolveDefaultAgent(container);
  if (fromConfig !== null) {
    return parseAgentSpecifier(fromConfig).agent;
  }
  const services = container.registry.list();
  const action = selectionContext?.action ?? "configure";
  if (services.length === 0) {
    throw new Error(`No agents available to ${action}.`);
  }
  const flags = resolveCommandFlags(program);
  if (flags.assumeYes) {
    return DEFAULT_SERVICE_AGENT;
  }
  const selectionLogger = container.loggerFactory.create({
    dryRun: flags.dryRun,
    verbose: flags.verbose,
    scope: action
  });
  selectionLogger.intro(action);
  const choices = services.map((service) => ({
    title: service.label,
    value: service.name
  }));
  const descriptor = container.promptLibrary.serviceSelection({
    message: serviceSelectionPrompt(action),
    choices
  });
  const response = await container.prompts(descriptor);
  const selectionValue = response[descriptor.name];
  if (typeof selectionValue !== "string") {
    throw new OperationCancelledError();
  }
  const resolved = services.find((service) => service.name === selectionValue);
  if (!resolved) {
    throw new Error("Invalid agent selection.");
  }
  return resolved.name;
}
