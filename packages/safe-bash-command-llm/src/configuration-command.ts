import { validateModelOptions } from "./model-options.js";
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
    else if (command === "set") {
      const operands: string[] = [], queries: string[] = [];
      for (let index = 1; index < tokens.length; index++) {
        const token = tokens[index]!;
        if (token === "-q" || token === "--query") {
          const query = tokens[++index];
          if (query === undefined) throw new Error(`Option '${token}' requires an argument`);
          queries.push(query);
        } else if (token.startsWith("--query=")) queries.push(token.slice(8));
        else if (token.startsWith("-q") && token.length > 2) queries.push(token.slice(2));
        else if (token.startsWith("-")) throw new Error(`No such option: ${token}`);
        else operands.push(token);
      }
      if (!operands.length || operands.length > 2) throw new Error("Invalid aliases set arguments");
      let model = operands[1];
      const queried = model === undefined;
      if (model === undefined) {
        if (!queries.length) throw new Error("You must provide a model_id or at least one -q option");
        const persisted = await configuration.aliases();
        const found = service.models.find(entry => queries.every(query => [entry.provider.name, entry.model.id, ...(entry.model.aliases ?? []), ...Object.entries(persisted).filter(([, id]) => id === entry.model.id).map(([alias]) => alias)].some(text => text.toLowerCase().includes(query.toLowerCase()))));
        if (!found) throw new Error(`No model found matching query: ${queries.join(", ")}`);
        model = found.model.id;
      }
      await configuration.setAlias(operands[0]!, await canonical(model));
      if (queried) await diagnostic(`Alias '${operands[0]}' set to model '${model}'\n`);
    } else if (command === "remove" && tokens.length === 2) await configuration.removeAlias(tokens[1]!);
    else if ((command === undefined || command === "list" || command === "--json") && tokens.slice(command === undefined ? 0 : 1).every(token => token === "--json")) {
      const values: Record<string, string> = {};
      for (const { model } of service.models) for (const alias of model.aliases ?? []) if (alias !== model.id) Object.defineProperty(values, alias, { value: model.id, enumerable: true, configurable: true, writable: true });
      const entries = Object.entries({ ...values, ...await configuration.aliases() });
      if (tokens.includes("--json")) await output(JSON.stringify(Object.fromEntries(entries), null, 4) + "\n");
      else {
        const width = Math.max(0, ...entries.map(([alias]) => [...alias].length));
        for (const [alias, model] of entries) await output(`${alias}${" ".repeat(width - [...alias].length)} : ${model}\n`);
      }
    } else throw new Error("Invalid aliases command");
    return true;
  }
  if (command === "set" && tokens.length === 4) {
    const model = await canonical(tokens[1]!);
    const entry = service.models.find(entry => entry.model.id === model);
    if (entry) validateModelOptions(entry.model, { [tokens[2]!]: tokens[3]! });
    await configuration.setModelOption(model, tokens[2]!, tokens[3]!);
    await diagnostic(`Set default option ${tokens[2]}=${tokens[3]} for model ${model}\n`);
  } else if (command === "show" && tokens.length === 2) {
    const model = await canonical(tokens[1]!), values = await configuration.modelOptions(model);
    if (!Object.keys(values).length) await diagnostic(`No default options set for model '${model}'.\n`);
    else for (const [key, value] of Object.entries(values)) await output(`${key}: ${value}\n`);
  } else if (command === "clear" && (tokens.length === 2 || tokens.length === 3)) {
    const model = await canonical(tokens[1]!);
    const keys = tokens[2] === undefined ? Object.keys(await configuration.modelOptions(model)) : [tokens[2]];
    await configuration.clearModelOption(model, tokens[2]);
    if (keys.length === 1) await output(`Cleared option '${keys[0]}' for model ${model}\n`);
    else if (keys.length > 1) await output(`Cleared ${keys.join(", ")} options for model ${model}\n`);
  } else if ((command === "list" && tokens.length === 1) || command === undefined) {
    await listOptions(configuration, output, diagnostic);
  } else throw new Error("Invalid models options command");
  return true;
}

async function listOptions(configuration: LlmConfiguration, output: (text: string) => Promise<void>, diagnostic: (text: string) => Promise<void>): Promise<void> {
  const entries = Object.entries(await configuration.allModelOptions());
  if (!entries.length) await diagnostic("No default options set for any models.\n");
  for (const [model, values] of entries) {
    await output(`${model}:\n`);
    for (const [key, value] of Object.entries(values)) await output(`  ${key}: ${value}\n`);
  }
}
