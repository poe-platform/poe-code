import { getLlmModelAliases } from "./model-selection.js";
export { getLlmModelAliases } from "./model-selection.js";
import type { CommandContext } from "safe-bash-contracts";
import type { LlmService } from "./service.js";
import { createLlmConfiguration } from "./configuration.js";

export const modelsGroupHelp = "Usage: llm models [OPTIONS] COMMAND [ARGS]...\n\n  Manage available models\n\nOptions:\n  -h, --help  Show this message and exit.\n\nCommands:\n  list*    List available models\n  default  Show or set the default model\n  options  Manage default options for models\n";

export class LlmModelsUsageError extends Error {
  constructor(message: string, usage = true) {
    super((usage ? "Usage: llm models list [OPTIONS]\nTry 'llm models list -h' for help.\n\n" : "") + `Error: ${message}`);
  }
}

function wrapDescription(description: string): string {
  const lines: string[] = [];
  let line = "";
  for (const word of description.split(" ")) {
    if (!word) continue;
    if (line && line.length + word.length + 1 > 70) {
      lines.push(line);
      line = "";
    }
    line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return lines.join("\n      ");
}

/** Reference model-list query semantics for the configured host catalog. */
export async function listLlmModels(context: CommandContext, service: LlmService, tokens: readonly string[], emit: (text: string) => Promise<void>, step: () => Promise<void>): Promise<void> {
  const explicit = tokens[0] === "list";
  const terminator = tokens.indexOf("--");
  const groupFlags = terminator < 0 ? tokens : tokens.slice(0, terminator);
  if (!explicit && groupFlags.some(token => token === "--help" || token.startsWith("-") && !token.startsWith("--") && token.slice(1).includes("h"))) {
    await emit(modelsGroupHelp);
    return;
  }
  const queries: string[] = [], selected: string[] = [];
  let schemas = false, tools = false, asyncModels = false, options = false, help = false, ended = false;
  const unexpected: string[] = [];
  const args = explicit ? tokens.slice(1) : tokens.filter((_, index) => index !== terminator);
  for (let index = 0; index < args.length; index++) {
    await step();
    const argument = args[index]!;
    if (ended) { unexpected.push(argument); continue; }
    if (argument === "--") { ended = true; continue; }
    if (argument === "--help" || argument === "-h") { help = true; continue; }
    if (argument === "--options") { options = true; continue; }
    if (argument === "--schemas") { schemas = true; continue; }
    if (argument === "--tools") { tools = true; continue; }
    if (argument === "--async") { asyncModels = true; continue; }
    if (!argument.startsWith("-") || argument === "-") { unexpected.push(argument); continue; }
    const equals = argument.indexOf("=");
    const long = argument.startsWith("--");
    const flag = long ? argument.slice(0, equals < 0 ? undefined : equals) : argument.slice(0, 2);
    const attached = long ? equals < 0 ? undefined : argument.slice(equals + 1) : argument.length > 2 ? argument.slice(2) : undefined;
    if (equals >= 0 && ["--schemas", "--tools", "--async", "--options", "--help", "-h"].includes(flag)) throw new LlmModelsUsageError(`Option '${flag}' does not take a value.`, false);
    if (!["-q", "--query", "-m", "--model"].includes(flag)) throw new LlmModelsUsageError(`No such option: ${flag}`);
    const value = attached ?? args[++index];
    if (value === undefined) throw new LlmModelsUsageError(`Option '${flag}' requires an argument.`, false);
    (flag === "-q" || flag === "--query" ? queries : selected).push(value);
  }
  if (help) {
    await emit("Usage: llm models list [OPTIONS]\n\n  List available models\n\nOptions:\n  --options         Show options for each model, if available\n  --async           List async models\n  --schemas         List models that support schemas\n  --tools           List models that support tools\n  -q, --query TEXT  Search for models matching these strings\n  -m, --model TEXT  Specific model IDs\n  -h, --help        Show this message and exit.\n");
    return;
  }
  if (unexpected.length) throw new LlmModelsUsageError(`Got unexpected extra argument${unexpected.length === 1 ? "" : "s"} (${unexpected.join(" ")})`);
  const configuration = createLlmConfiguration(context);
  const configuredAliases = await configuration.aliases();
  const shownDescriptions = new Set<string>();
  for (const { provider, model } of service.models) {
    await step();
    const aliases = getLlmModelAliases({ provider, model }, configuredAliases);
    const description = `${provider.name}: ${model.id}`;
    const terms = [description, ...aliases].map(value => value.toLowerCase());
    if (!queries.every(query => terms.some(term => term.includes(query.toLowerCase())))) continue;
    if (selected.length && !selected.some(value => value === model.id || aliases.includes(value))) continue;
    if (schemas && !model.capabilities?.includes("schema") || tools || asyncModels) continue;
    let output = description + (aliases.length ? ` (aliases: ${aliases.join(", ")})` : "");
    if (options && Object.keys(model.options ?? {}).length) {
      output += "\n  Options:";
      for (const [name, rule] of Object.entries(model.options!)) {
        const type = { number: "float", integer: "int", boolean: "boolean", string: "str" }[rule.type];
        output += `\n    ${name}: ${type}`;
        if (rule.description && !shownDescriptions.has(provider.name)) output += `\n      ${wrapDescription(rule.description)}`;
      }
      shownDescriptions.add(provider.name);
    }
    if (options && model.attachmentTypes?.length) output += `\n  Attachment types:\n    ${[...model.attachmentTypes].sort().join(", ")}`;
    if (options && model.capabilities?.includes("schema")) output += "\n  Features:\n  - schemas";
    await emit(output + "\n");
  }
  if (!queries.length && !selected.length && !schemas && !options) {
    const configured = await configuration.defaultModel();
    let model: string | undefined = configured;
    if (model === undefined) { try { model = service.resolve().model.id; } catch { /* An injected catalog may have no default. */ } }
    if (model !== undefined) await emit(`Default: ${model}\n`);
  }
}
