import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  renderAcpStream,
  getSpawnConfig,
  type SpawnMode
} from "@poe-code/agent-spawn";
import { loadConfiguredServices } from "../../services/config.js";
import { research } from "../../sdk/research.js";
import { OperationCancelledError } from "../errors.js";
import {
  buildResumeCommand,
  createExecutionResources,
  formatServiceList,
  resolveCommandFlags,
  resolveServiceAdapter
} from "./shared.js";

export interface ResearchCommandOptions {
  agent?: string;
  model?: string;
  mode?: string;
  cwd?: string;
  path?: string;
  github?: string;
  stdin?: boolean;
  keep?: boolean;
}

export function registerResearchCommand(
  program: Command,
  container: CliContainer
): void {
  const spawnServices = container.registry
    .list()
    .filter((service) =>
      typeof service.spawn === "function" || getSpawnConfig(service.name)
    )
    .map((service) => service.name);
  const serviceDescription =
    `Agent to research with${formatServiceList(spawnServices)}`;

  program
    .command("research")
    .description("Research a codebase using a coding agent.")
    .option("--agent <agent>", serviceDescription)
    .option("--model <model>", "Model identifier override passed to the agent CLI")
    .option("--mode <mode>", "Permission mode: yolo | edit | read (default: read)")
    .option("-C, --cwd <path>", "Working directory override")
    .option("--path <path>", "Local directory to research")
    .option("--github <repo>", "Clone and research a GitHub repo")
    .option("--stdin", "Read the prompt from stdin")
    .option("--keep", "Keep the cloned repo when using --github")
    .argument("[prompt]", "Prompt text to send (or '-' / stdin)")
    .argument("[agentArgs...]", "Additional arguments forwarded to the agent CLI")
    .action(async function (
      this: Command,
      promptText: string | undefined,
      agentArgs: string[] = []
    ) {
      const flags = resolveCommandFlags(program);
      const commandOptions = this.opts<ResearchCommandOptions>();

      const wantsStdinFlag = commandOptions.stdin === true;
      const shouldReadFromStdin =
        wantsStdinFlag ||
        promptText === "-" ||
        (!promptText && !process.stdin.isTTY);

      const forwardedArgs = wantsStdinFlag
        ? [...(promptText ? [promptText] : []), ...agentArgs]
        : agentArgs;

      if (wantsStdinFlag) {
        promptText = undefined;
      }

      if (promptText === "-") {
        promptText = undefined;
      }

      if (!promptText && shouldReadFromStdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        promptText = Buffer.concat(chunks).toString("utf8").trim();
      }

      if (!promptText) {
        throw new Error("No prompt provided via argument or stdin");
      }

      const resolvedAgent = await resolveResearchAgent({
        container,
        flags,
        agent: commandOptions.agent
      });
      const adapter = resolveServiceAdapter(container, resolvedAgent);
      const canonicalService = adapter.name;

      const resources = createExecutionResources(
        container,
        flags,
        `research:${canonicalService}`
      );
      resources.logger.intro(`research ${canonicalService}`);

      const model = await resolveResearchModel({
        container,
        flags,
        adapter,
        value: commandOptions.model
      });

      try {
        const { events, result } = await research(container, {
          prompt: promptText,
          agent: canonicalService,
          agentLabel: adapter.label,
          model,
          mode: commandOptions.mode as SpawnMode | undefined,
          args: forwardedArgs,
          cwd: commandOptions.cwd,
          path: commandOptions.path,
          github: commandOptions.github,
          keep: commandOptions.keep,
          logger: resources.logger,
          resolveResumeCommand: (threadId, cwdValue) =>
            buildResumeCommand(canonicalService, threadId, cwdValue)
        });
        await renderAcpStream(events);
        await result;
      } finally {
        resources.context.finalize();
      }
    });
}

async function resolveResearchAgent(input: {
  container: CliContainer;
  flags: ReturnType<typeof resolveCommandFlags>;
  agent?: string;
}): Promise<string> {
  if (input.agent) {
    return input.agent;
  }

  const spawnable = input.container.registry
    .list()
    .filter((service) =>
      typeof service.spawn === "function" || getSpawnConfig(service.name)
    );

  if (spawnable.length === 0) {
    throw new Error("No spawn-capable agents available.");
  }

  if (input.flags.assumeYes) {
    const configured = await loadConfiguredServices({
      fs: input.container.fs,
      filePath: input.container.env.configPath
    });

    const configuredService = spawnable.find(
      (service) => service.name in configured
    );

    return configuredService?.name ?? spawnable[0]!.name;
  }

  const choices = spawnable.map((service) => ({
    title: service.label,
    value: service.name
  }));
  const descriptor = input.container.promptLibrary.serviceSelection({
    message: "Pick an agent to research with:",
    choices
  });
  const response = await input.container.prompts(descriptor);
  const selectionValue = response[descriptor.name];
  if (typeof selectionValue !== "string") {
    throw new OperationCancelledError();
  }

  const resolved = spawnable.find((service) => service.name === selectionValue);
  if (!resolved) {
    throw new Error("Invalid agent selection.");
  }

  return resolved.name;
}

async function resolveResearchModel(input: {
  container: CliContainer;
  flags: ReturnType<typeof resolveCommandFlags>;
  adapter: ReturnType<typeof resolveServiceAdapter>;
  value?: string;
}): Promise<string | undefined> {
  if (input.value) {
    return input.value;
  }

  const modelPrompt = input.adapter.configurePrompts?.model;
  if (modelPrompt) {
    return await input.container.options.resolveModel({
      value: input.value,
      assumeDefault: input.flags.assumeYes,
      defaultValue: modelPrompt.defaultValue,
      choices: modelPrompt.choices,
      label: modelPrompt.label
    });
  }

  if (input.flags.assumeYes) {
    return undefined;
  }

  const descriptor = {
    name: "model",
    message: "Model identifier",
    type: "text"
  } as const;
  const response = await input.container.prompts(descriptor);
  const result = response[descriptor.name];
  if (typeof result !== "string") {
    throw new OperationCancelledError();
  }
  const trimmed = result.trim();
  if (trimmed.length === 0) {
    throw new Error("Model identifier is required.");
  }
  return trimmed;
}
