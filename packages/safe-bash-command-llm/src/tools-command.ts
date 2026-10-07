import {LlmPluginExit} from './loader-provider.js';
import {unicodeOrder} from "./python-unicode.js";
import {commandArguments} from './command-arguments.js';
import { referenceJson } from "./reference-json.js";
import { selectLlmTools, type LlmRegisteredTool, type LlmToolboxDescription } from "./tool-registry.js";




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
  const parsed=await commandArguments('tools',tokens,['list'],output,diagnostic,step);
  if(typeof parsed==='number')return parsed;
  const names=parsed.operands,functions=parsed.values.get('--functions')??[],json=parsed.values.has('--json');
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
    toolboxes = [...loaded.toolboxes ?? []].sort((left, right) => unicodeOrder(left.name, right.name));
    selected = new Map(names.length
      ? [...loaded.tools, ...selectLlmTools(registry, load ? names.filter(name => registry.has(name)) : names)].map(tool => [tool.name, tool] as const)
      : [...registry, ...loaded.tools.map(tool => [tool.registryKey ?? tool.name, tool] as const)]);
  } catch (failure) {
    if(failure instanceof LlmPluginExit)throw failure;
    await diagnostic("Error: " + (failure instanceof Error ? failure.message : String(failure)) + "\n");
    return 1;
  }
  const entries = [...selected].sort(([left], [right]) => unicodeOrder(left, right));
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
