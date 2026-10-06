import {loadLlmHelp} from './help-text.js';
import type {LlmHelpName} from './help-data.js';
import {chatOptionSuggestion} from './chat-options.js';

/** Click's default-group routing and leaf parsing, before command I/O. */
export async function commandArguments(
  group: string, tokens: readonly string[], commands: readonly string[],
  emit: (text: string) => Promise<void>, diagnostic: (text: string) => Promise<void>, step: () => Promise<void>, prompt?: () => Promise<string | undefined>,
  help: (name:string)=>string|Promise<string> = name => loadLlmHelp(name.replaceAll(' ', '-') as LlmHelpName),
): Promise<number | {command: string; operands: string[]; values: Map<string, string[]>}> {
  if (commands.length) {
    let groupHelp = false;
    for (const token of tokens) {
      await step();
      if (token === '--' || !token.startsWith('-')) break;
      if (token.startsWith('--help=')) {await diagnostic("Error: Option '--help' does not take a value.\n"); return 2;}
      if (token === '--help' || !token.startsWith('--') && token.includes('h')) groupHelp = true;
    }
    if (groupHelp) {await emit(await help(group)); return 0;}
    if (tokens[0] === '--') tokens = tokens.slice(1);
  }
  const command = commands.length ? commands.includes(tokens[0] ?? '') ? tokens[0]! : 'list' : '';
  if (command && tokens[0] === command) tokens = tokens.slice(1);
  const path = group + (command ? ' ' + command : '');
  const text = await help(path), usage = text.slice(0, text.indexOf('\n'));
  const fail = async (message: string, withUsage = true) => {
    await diagnostic((withUsage ? usage + `\nTry 'llm ${path} -h' for help.\n\n` : '') + `Error: ${message}\n`); return 2;
  };
  // The fixed native catalog already declares aliases and value arity.
  const specs=new Map<string,{name:string;value:boolean}>();
  for(const line of text.slice(text.indexOf('Options:\n')).split('\n')){
    if(!line.startsWith('  -'))continue;
    const declaration=line.trim().split('  ')[0]!;
    const aliases=declaration.split(', ').map(part=>part.split(' ')[0]!);
    const spec={name:aliases.at(-1)!,value:declaration.split(', ').at(-1)!.includes(' ')};
    for(const alias of aliases)specs.set(alias,spec);
  }
  const values = new Map<string, string[]>(), operands: string[] = [];
  let ended = false, wantsHelp = false;
  for (let index = 0; index < tokens.length; index++) {
    await step(); const token = tokens[index]!;
    if (!ended && token === '--') {ended = true; continue;}
    if (ended || !token.startsWith('-') || token === '-') {operands.push(token); continue;}
    const long = token.startsWith('--'), equals = token.indexOf('=');
    for (let cursor = long ? 0 : 1; cursor < token.length; cursor++) {
      const flag = long ? token.slice(0, equals < 0 ? undefined : equals) : '-' + token[cursor];
      const spec=specs.get(flag);
      if(!spec)return fail(`No such option: ${flag}` + await chatOptionSuggestion(flag,step,[...specs.keys()]));
      if (!spec.value) {
        if (long && equals >= 0) return fail(`Option '${flag}' does not take a value.`, false);
        if(spec.name==='--help')wantsHelp=true;else values.set(spec.name,[]);
        if (long) break; continue;
      }
      const value = (long ? equals < 0 ? undefined : token.slice(equals + 1) : token.slice(cursor + 1) || undefined) ?? tokens[++index];
      if (value === undefined) return fail(`Option '${flag}' requires an argument.`, false);
      const key = spec.name;
      const list = values.get(key) ?? [];
      list.push(value); values.set(key, list); break;
    }
  }
  if (wantsHelp) {await emit(text); return 0;}
  const parameters = usage.split('[OPTIONS]')[1]!.trim().split(' ').filter(Boolean);
  for (let index = operands.length; index < parameters.length; index++) {
    if (!parameters[index]!.startsWith('[')) return fail(`Missing argument '${parameters[index]}'.`);
  }
  if (path === "keys set" && !values.has("--value")) {
    const value = await prompt!();
    if (value === undefined) {await diagnostic("Aborted!\n"); return 1;}
    values.set("--value", [value]);
  }
  const extra = parameters.at(-1)?.endsWith('...') ? [] : operands.slice(parameters.length);
  if (extra.length) return fail(`Got unexpected extra argument${extra.length === 1 ? '' : 's'} (${extra.join(' ')})`);
  return {command, operands, values};
}
