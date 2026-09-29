import type { CommandContext } from "safe-bash-contracts";
import { createLlmConfiguration, type LlmConfiguration } from "./configuration.js";
import type { LlmService } from "./service.js";

export async function configurationCommand(
  context: CommandContext, service: LlmService, args: readonly string[],
  output: (text: string) => Promise<void>, diagnostic: (text: string) => Promise<void>,
): Promise<boolean> {
  if (args.length === 1 && args[0] === "--version") { await output("llm, version 0.27.1\n"); return true; }
  const aliases = args[0] === "aliases";
  const defaults = args[0] === "models" && args[1] === "default";
  const options = args[0] === "models" && args[1] === "options";
  if (!aliases && !defaults && !options) return false;
  const configuration = createLlmConfiguration(context);
  const canonical = async (model: string): Promise<string> => {
    const resolved = await configuration.resolveAlias(model);
    try { return service.resolve(resolved).model.id; } catch { return resolved; }
  };
  const tokens = args.slice(aliases ? 1 : 2), command = tokens[0];
  if (defaults) {
    if (tokens.length > 1) throw new Error("Unexpected extra arguments");
    if (command === undefined) await output(`${await configuration.defaultModel() ?? service.resolve().model.id}\n`);
    else {
      const model = service.resolve(await canonical(command)).model.id;
      await configuration.setDefaultModel(model);
    }
    return true;
  }
  if (aliases) {
    if (command === "path" && tokens.length === 1) await output(`${configuration.directory}/aliases.json\n`);
    else if (command === "set" && tokens.length === 3) await configuration.setAlias(tokens[1]!, await canonical(tokens[2]!));
    else if (command === "remove" && tokens.length === 2) await configuration.removeAlias(tokens[1]!);
    else if (command === "list" && tokens.length === 2 && tokens[1] === "--json") {
      const values: Record<string, string> = {};
      for (const { model } of service.models) for (const alias of model.aliases ?? []) Object.defineProperty(values, alias, { value: model.id, enumerable: true, configurable: true, writable: true });
      await output(JSON.stringify({ ...values, ...await configuration.aliases() }, null, 4) + "\n");
    } else throw new Error("Invalid aliases command");
    return true;
  }
  if (command === "set" && tokens.length === 4) {
    const model = await canonical(tokens[1]!);
    await configuration.setModelOption(model, tokens[2]!, tokens[3]!);
    await diagnostic(`Set default option ${tokens[2]}=${tokens[3]} for model ${model}\n`);
  } else if (command === "show" && tokens.length === 2) {
    const model = await canonical(tokens[1]!), values = await configuration.modelOptions(model);
    if (!Object.keys(values).length) await diagnostic(`No default options set for model '${model}'.\n`);
    else for (const [key, value] of Object.entries(values)) await output(`${key}: ${value}\n`);
  } else if (command === "clear" && tokens.length === 3) {
    const model = await canonical(tokens[1]!);
    await configuration.clearModelOption(model, tokens[2]!);
    await output(`Cleared option '${tokens[2]}' for model ${model}\n`);
  } else if (command === "list" && tokens.length === 1) {
    await listOptions(configuration, output);
  } else throw new Error("Invalid models options command");
  return true;
}

async function listOptions(configuration: LlmConfiguration, output: (text: string) => Promise<void>): Promise<void> {
  for (const [model, values] of Object.entries(await configuration.allModelOptions())) {
    await output(`${model}:\n`);
    for (const [key, value] of Object.entries(values)) await output(`  ${key}: ${value}\n`);
  }
}
