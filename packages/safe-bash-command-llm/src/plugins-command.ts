import {commandArguments} from './command-arguments.js';
import {referenceJson} from './reference-json.js';
import type {LlmPluginInfo, LlmPluginQuery} from './tool-registry.js';



export async function pluginsCommand(args: readonly string[], output: (text: string) => Promise<void>,
  diagnostic: (text: string) => Promise<void>, step: () => Promise<void>, signal: AbortSignal,
  load?: (query: LlmPluginQuery) => Promise<readonly LlmPluginInfo[]>): Promise<number> {
  const parsed=await commandArguments('plugins',args,[],output,diagnostic,step);
  if(typeof parsed==='number')return parsed;
  const all=parsed.values.has('--all'),hooks=parsed.values.get('--hook')??[];
  if (!load) {await diagnostic('Error: Python plugin discovery is not configured\n'); return 1;}
  const plugins = await load({all, hooks});
  for await (const bytes of referenceJson(plugins, signal, true)) {
    await step(); await output(new TextDecoder().decode(bytes));
  }
  await output('\n');
  return 0;
}
