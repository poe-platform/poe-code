import {loadLlmHelp} from './help-text.js';
import { referenceJson } from "./reference-json.js";
import { selectLlmTools, type LlmRegisteredTool, type LlmToolboxDescription } from "./tool-registry.js";

const usage = "Usage: llm tools list [OPTIONS] [TOOL_DEFS]...\n";



function compareNames(left: string, right: string): number {
  let a = 0,
    b = 0;
  while (a < left.length && b < right.length) {
    const x = left.codePointAt(a)!,
      y = right.codePointAt(b)!;
    if (x !== y) return x - y;
    a += x > 65535 ? 2 : 1;
    b += y > 65535 ? 2 : 1;
  }
  return left.length - a - (right.length - b);
}

/** Inspect host registrations and explicit invocation-owned Python definitions. */
export async function toolsCommand(
  tokens: readonly string[],
  registry: ReadonlyMap<string, LlmRegisteredTool>,
  output: (text: string) => Promise<void>,
  diagnostic: (text: string) => Promise<void>,
  step: () => Promise<void>,
  signal: AbortSignal,
  load?: (definitions: readonly string[], names: readonly string[], discovery: boolean) => Promise<{readonly tools: readonly LlmRegisteredTool[]; readonly toolboxes?: readonly LlmToolboxDescription[]}>
): Promise<number> {
  let groupEager = false,
    separator = -1;
  const error = async (message: string, withUsage = false): Promise<number> => {
    await diagnostic(
      (withUsage ? usage + "Try 'llm tools list --help' for help.\n\n" : "") +
        "Error: " +
        message +
        "\n"
    );
    return 2;
  };
  for (let index = 0; index < tokens.length; index++) {
    await step();
    const token = tokens[index]!;
    if (token === "--") {
      separator = index;
      break;
    }
    if (!token.startsWith("-") || token === "-") break;
    if (token.startsWith("--help=")) return error("Option '--help' does not take a value.");
    if (token === "--help" || (!token.startsWith("--") && token.slice(1).includes("h")))
      groupEager = true;
  }
  if (groupEager) {
    await output(await loadLlmHelp("tools"));
    return 0;
  }
  const groupArgs = tokens.filter((_, index) => index !== separator);
  const args = groupArgs[0] === "list" ? groupArgs.slice(1) : groupArgs;
  const names: string[] = [];
  let json = false,
    help = false,
    ended = false;
  const functions: string[] = [];
  for (let index = 0; index < args.length; index++) {
    await step();
    const token = args[index]!;
    if (ended || !token.startsWith("-") || token === "-") {
      names.push(token);
      continue;
    }
    if (token === "--") {
      ended = true;
      continue;
    }
    const equals = token.indexOf("="),
      flag = equals < 0 ? token : token.slice(0, equals);
    if (["--json", "--help"].includes(flag) && equals >= 0)
      return error(`Option '${flag}' does not take a value.`);
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (flag === "--functions") {
      if (equals < 0 && args[++index] === undefined)
        return error("Option '--functions' requires an argument.");
      functions.push(equals < 0 ? args[index]! : token.slice(equals + 1));
      continue;
    }
    return error(`No such option '${flag}'.`, true);
  }
  if (help) {
    await output(await loadLlmHelp("tools-list"));
    return 0;
  }
  if (functions.length && !load) {
    await diagnostic("Error: Python tool loading is not configured\n");
    return 1;
  }
  let selected: ReadonlyMap<string, LlmRegisteredTool>;
  let toolboxes: readonly LlmToolboxDescription[] = [];
  try {
    const dynamicNames = names.filter(name => !registry.has(name));
    const loaded = load && (!names.length || functions.length || dynamicNames.length)
      ? await load(functions, dynamicNames, !names.length || dynamicNames.length > 0) : {tools: []};
    toolboxes = [...loaded.toolboxes ?? []].sort((left, right) => compareNames(left.name, right.name));
    selected = new Map(names.length
      ? [...loaded.tools, ...selectLlmTools(registry, load ? names.filter(name => registry.has(name)) : names)].map(tool => [tool.name, tool] as const)
      : [...registry, ...loaded.tools.map(tool => [tool.registryKey ?? tool.name, tool] as const)]);
  } catch (failure) {
    await diagnostic("Error: " + (failure instanceof Error ? failure.message : String(failure)) + "\n");
    return 1;
  }
  const entries = [...selected].sort(([left], [right]) => compareNames(left, right));
  if (json) {
    const tools = entries.map(([name, tool]) => ({
      name,
      description: tool.description ?? null,
      arguments: tool.inputSchema,
      plugin: tool.plugin ?? null
    }));
    for await (const bytes of referenceJson({ tools, toolboxes: toolboxes.map(box => ({name: box.name, tools: box.tools.map(tool => ({
      name: tool.name, description: tool.description ?? null, arguments: tool.inputSchema
    }))})) }, signal, true)) {
      await step();
      await output(new TextDecoder().decode(bytes));
    }
    await output("\n");
    return 0;
  }
  const describe = async (tool: Pick<LlmRegisteredTool, "name" | "signature" | "description" | "plugin">, indent: string) => {
    await step();
    await output(indent + tool.name + (tool.signature ?? "()") +
      (tool.plugin ? ` (plugin: ${tool.plugin})` : "") + "\n\n");
    if (tool.description) {
      const description = tool.description.trim();
      let start = 0;
      while (start <= description.length) {
        await step();
        const newline = description.indexOf("\n", start), end = newline < 0 ? description.length : newline;
        const line = description.slice(start, end);
        await output((line.trim() ? indent + "  " : "") + line + "\n");
        if (newline < 0) break;
        start = end + 1;
      }
      await output("\n");
    }
  };
  for (const [, tool] of entries) await describe(tool, "");
  for (const box of toolboxes) {
    await step();
    await output(box.name + ":\n\n");
    for (const tool of box.tools) await describe(tool, "  ");
  }
  return 0;
}
