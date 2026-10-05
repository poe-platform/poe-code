import { referenceJson } from "./reference-json.js";
import { selectLlmTools, type LlmRegisteredTool } from "./tool-registry.js";

const usage = "Usage: llm tools list [OPTIONS] [TOOL_DEFS]...\n";
const groupHelp =
  "Usage: llm tools [OPTIONS] COMMAND [ARGS]...\n\n  Manage tools that can be made available to LLMs\n\nOptions:\n  -h, --help  Show this message and exit.\n\nCommands:\n  list*  List available tools that have been provided by plugins\n";
const listHelp =
  usage +
  "\n  List available tools that have been provided by plugins\n\nOptions:\n  --json            Output as JSON\n  --functions TEXT  Python code block or file path defining functions to\n                    register as tools\n  -h, --help        Show this message and exit.\n";

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

/** Inspect explicit host registrations without running tools or loading plugins. */
export async function toolsCommand(
  tokens: readonly string[],
  registry: ReadonlyMap<string, LlmRegisteredTool>,
  output: (text: string) => Promise<void>,
  diagnostic: (text: string) => Promise<void>,
  step: () => Promise<void>,
  signal: AbortSignal
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
    await output(groupHelp);
    return 0;
  }
  const groupArgs = tokens.filter((_, index) => index !== separator);
  const args = groupArgs[0] === "list" ? groupArgs.slice(1) : groupArgs;
  const names: string[] = [];
  let json = false,
    help = false,
    ended = false,
    functions = false;
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
      functions = true;
      continue;
    }
    return error(`No such option '${flag}'.`, true);
  }
  if (help) {
    await output(listHelp);
    return 0;
  }
  if (functions) {
    await diagnostic("Error: Python tool loading is not configured\n");
    return 1;
  }
  let selected: ReadonlyMap<string, LlmRegisteredTool> = registry;
  if (names.length) {
    try {
      selected = new Map(selectLlmTools(registry, names).map((tool) => [tool.name, tool]));
    } catch (error) {
      await diagnostic("Error: " + (error as Error).message + "\n");
      return 1;
    }
  }
  const entries = [...selected].sort(([left], [right]) => compareNames(left, right));
  if (json) {
    const tools = entries.map(([name, tool]) => ({
      name,
      description: tool.description ?? null,
      arguments: tool.inputSchema,
      plugin: tool.plugin ?? null
    }));
    for await (const bytes of referenceJson({ tools, toolboxes: [] }, signal, true)) {
      await step();
      await output(new TextDecoder().decode(bytes));
    }
    await output("\n");
    return 0;
  }
  for (const [, tool] of entries) {
    await step();
    await output(
      tool.name +
        (tool.signature ?? "()") +
        (tool.plugin ? ` (plugin: ${tool.plugin})` : "") +
        "\n\n"
    );
    if (tool.description) {
      const description = tool.description.trim();
      let start = 0;
      while (start <= description.length) {
        await step();
        const newline = description.indexOf("\n", start),
          end = newline < 0 ? description.length : newline;
        const line = description.slice(start, end);
        await output((line.trim() ? "  " : "") + line + "\n");
        if (newline < 0) break;
        start = end + 1;
      }
      await output("\n");
    }
  }
  return 0;
}
