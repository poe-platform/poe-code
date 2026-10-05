import {referenceJson} from './reference-json.js';
import type {LlmPluginInfo, LlmPluginQuery} from './tool-registry.js';

const usage = 'Usage: llm plugins [OPTIONS]\n';
const help = usage + '\n  List installed plugins\n\nOptions:\n  --all        Include built-in default plugins\n  --hook TEXT  Filter for plugins that implement this hook\n  -h, --help   Show this message and exit.\n';

export async function pluginsCommand(args: readonly string[], output: (text: string) => Promise<void>,
  diagnostic: (text: string) => Promise<void>, step: () => Promise<void>, signal: AbortSignal,
  load?: (query: LlmPluginQuery) => Promise<readonly LlmPluginInfo[]>): Promise<number> {
  const error = async (message: string, withUsage = false) => {
    await diagnostic((withUsage ? usage + "Try 'llm plugins -h' for help.\n\n" : '') + 'Error: ' + message + '\n');
    return 2;
  };
  const hooks: string[] = [], extra: string[] = [];
  let all = false, showHelp = false, ended = false;
  for (let index = 0; index < args.length; index++) {
    await step();
    const token = args[index]!;
    if (ended || !token.startsWith('-') || token === '-') {extra.push(token); continue;}
    if (token === '--') {ended = true; continue;}
    const equals = token.indexOf('='), flag = equals < 0 ? token : token.slice(0, equals);
    if (flag === '--all' || flag === '--help') {
      if (equals >= 0) return error(`Option '${flag}' does not take a value.`);
      if (flag === '--all') all = true; else showHelp = true;
    } else if (flag === '--hook') {
      if (equals < 0 && args[++index] === undefined) return error("Option '--hook' requires an argument.");
      hooks.push(equals < 0 ? args[index]! : token.slice(equals + 1));
    } else if (!token.startsWith('--')) {
      for (const letter of token.slice(1)) {
        if (letter !== 'h') return error(`No such option: -${letter}`, true);
        showHelp = true;
      }
    } else return error(`No such option: ${flag}`, true);
  }
  if (showHelp) {await output(help); return 0;}
  if (extra.length) return error(`Got unexpected extra argument${extra.length === 1 ? '' : 's'} (${extra.join(' ')})`, true);
  if (!load) {await diagnostic('Error: Python plugin discovery is not configured\n'); return 1;}
  const plugins = await load({all, hooks});
  for await (const bytes of referenceJson(plugins, signal, true)) {
    await step(); await output(new TextDecoder().decode(bytes));
  }
  await output('\n');
  return 0;
}
