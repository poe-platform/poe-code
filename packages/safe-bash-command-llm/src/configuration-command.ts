import {sourceBytes} from "./request-source.js";
import {commandArguments} from "./command-arguments.js";
import { validateModelOptions } from "./model-options.js";
import type { CommandContext } from "safe-bash-contracts";
import { createLlmConfiguration, type LlmConfiguration } from "./configuration.js";
import type { LlmService } from "./service.js";

export async function configurationCommand(
  context: CommandContext, service: LlmService, args: readonly string[],
  output: (text: string) => Promise<void>, diagnostic: (text: string) => Promise<void>, admitInput: (size: number, materialized: boolean) => void, maxConfigurationBytes = Infinity, step: () => Promise<void> = async () => {context.signal.throwIfAborted();},
): Promise<number> {
  const keysCmd = args[0] === "keys";
  const aliases = args[0] === "aliases";
  const defaults = args[0] === "models" && args[1] === "default";
  const group = args.slice(0, keysCmd || aliases ? 1 : 2).join(" ");
  const parsed = await commandArguments(group, args.slice(keysCmd || aliases ? 1 : 2), defaults ? [] : keysCmd ? ["list", "path", "get", "set"] : aliases ? ["list", "path", "set", "remove"] : ["list", "set", "show", "clear"], output, diagnostic, step, async () => {
    const decoder = new TextDecoder();
    let value = "";
    await output("Enter key: ");
    const source = context.stdinInput ? {[Symbol.asyncIterator]: () => ({next: () => context.stdinInput!.read(1, context.signal)})} : context.stdin;
    for await (const bytes of sourceBytes(source, context.signal)) {
      await step();
      for (let offset = 0; offset < bytes.length;) {
        const newline = bytes.indexOf(10, offset), end = newline < 0 ? bytes.length : newline;
        admitInput(end - offset + (newline < 0 ? 0 : 1), true);
        value += decoder.decode(bytes.subarray(offset, end), {stream: true});
        if (newline < 0) break;
        value += decoder.decode();
        if (value.endsWith("\r")) value = value.slice(0, -1);
        await output("\n");
        if (value) return value;
        await output("Enter key: ");
        offset = newline + 1;
      }
    }
    await output("\n");
    return value + decoder.decode() || undefined;
  });
  if (typeof parsed === "number") return parsed;
  const {command, operands, values: flags} = parsed;
  const tokens = [command, ...operands];
  const configuration = createLlmConfiguration(context, maxConfigurationBytes);
  if (keysCmd) {
    const sub = command;
    if (sub === "path") {
      await output(`${configuration.directory}/keys.json\n`);
      return 0;
    }
    if (sub === "list") {
      const path = `${configuration.directory}/keys.json`;
      let exists = true;
      try { await context.fs.lstat(path, { signal: context.signal }); }
      catch { exists = false; }
      if (!exists) {
        await output("No keys found\n");
        return 0;
      }
      const stored = await configuration.keys();
      for (const key of Object.keys(stored).sort()) {
        await output(`${key}\n`);
      }
      return 0;
    }
    if (sub === "get") {
      await output(`${await configuration.getKey(tokens[1]!)}\n`);
      return 0;
    }
    await configuration.setKey(operands[0]!, flags.get("--value")!.at(-1)!);
    return 0;
  }
  const canonical = async (model: string): Promise<string> => {
    const resolved = await configuration.resolveAlias(model);
    try { return service.resolve(resolved).model.id; } catch { return resolved; }
  };
  if (defaults) {
    if (!operands[0]) await output(`${await configuration.defaultModel() ?? service.resolve().model.id}\n`);
    else {
      const model = service.resolve(await canonical(operands[0]!)).model.id;
      await configuration.setDefaultModel(model);
    }
    return 0;
  }
  if (aliases) {
    if (command === "path") await output(`${configuration.directory}/aliases.json\n`);
    else if (command === "set") {
      const queries = flags.get("--query") ?? [];
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
    } else if (command === "remove") await configuration.removeAlias(tokens[1]!);
    else {
      const values: Record<string, string> = {};
      for (const { model } of service.models) for (const alias of model.aliases ?? []) if (alias !== model.id) Object.defineProperty(values, alias, { value: model.id, enumerable: true, configurable: true, writable: true });
      const entries = Object.entries({ ...values, ...await configuration.aliases() });
      if (flags.has("--json")) await output(JSON.stringify(Object.fromEntries(entries), null, 4) + "\n");
      else {
        const width = Math.max(0, ...entries.map(([alias]) => [...alias].length));
        for (const [alias, model] of entries) await output(`${alias}${" ".repeat(width - [...alias].length)} : ${model}\n`);
      }
    }
    return 0;
  }
  if (command === "set") {
    const model = await canonical(tokens[1]!);
    const entry = service.models.find(entry => entry.model.id === model);
    if (entry) validateModelOptions(entry.model, { [tokens[2]!]: tokens[3]! });
    await configuration.setModelOption(model, tokens[2]!, tokens[3]!);
    await diagnostic(`Set default option ${tokens[2]}=${tokens[3]} for model ${model}\n`);
  } else if (command === "show") {
    const model = await canonical(tokens[1]!), values = await configuration.modelOptions(model);
    if (!Object.keys(values).length) await diagnostic(`No default options set for model '${model}'.\n`);
    else for (const [key, value] of Object.entries(values)) await output(`${key}: ${value}\n`);
  } else if (command === "clear") {
    const model = await canonical(tokens[1]!);
    const keys = !tokens[2] ? Object.keys(await configuration.modelOptions(model)) : [tokens[2]];
    await configuration.clearModelOption(model, tokens[2] || undefined);
    if (keys.length === 1) await output(`Cleared option '${keys[0]}' for model ${model}\n`);
    else if (keys.length > 1) await output(`Cleared ${keys.join(", ")} options for model ${model}\n`);
  } else await listOptions(configuration, output, diagnostic);
  return 0;
}

async function listOptions(configuration: LlmConfiguration, output: (text: string) => Promise<void>, diagnostic: (text: string) => Promise<void>): Promise<void> {
  const entries = Object.entries(await configuration.allModelOptions());
  if (!entries.length) await diagnostic("No default options set for any models.\n");
  for (const [model, values] of entries) {
    await output(`${model}:\n`);
    for (const [key, value] of Object.entries(values)) await output(`  ${key}: ${value}\n`);
  }
}
