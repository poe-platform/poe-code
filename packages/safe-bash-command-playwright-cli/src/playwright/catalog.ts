import { playwrightCommandReference } from './command-reference.js';
import { playwrightHelpReference } from './help-reference.js';

export type PlaywrightCommand = keyof typeof playwrightCommandReference;
export type PlaywrightOptionType = 'string' | 'boolean';

export interface PlaywrightCommandDefinition {
  readonly usage: string;
  readonly description: string;
  readonly section: string;
  readonly referenceLine: string;
  readonly arguments: readonly string[];
  readonly arity: readonly [number, number];
  readonly options: Readonly<Record<string, { readonly type: PlaywrightOptionType; readonly description: string; readonly repeatable?: boolean; readonly optionalValue?: boolean }>>;
}

const definitions = {} as Record<PlaywrightCommand, PlaywrightCommandDefinition>;
for (const [name, reference] of Object.entries(playwrightCommandReference)) {
  const usage = reference.help.split('\n')[0]!.slice('playwright-cli '.length).trimEnd();
  const args = usage.split(' ').slice(1).filter(Boolean);
  let section = 'Additional commands';
  let referenceLine = '';
  let currentSection = '';
  for (const line of playwrightHelpReference.split('\n')) {
    if (line.endsWith(':')) currentSection = line.slice(0, -1);
    if (line.startsWith('  ') && line.trimStart().split(' ')[0] === name) { section = currentSection; referenceLine = line; break; }
  }
  const description = referenceLine ? referenceLine.trimStart().slice(usage.length).trimStart() : reference.help.split('\n')[2] ?? '';
  const options: Record<string, { type: PlaywrightOptionType; description: string; repeatable: boolean; optionalValue: boolean }> = {};
  for (const [flag, type] of Object.entries(reference.flags)) {
    const line = reference.help.split('\n').find(line => line.trimStart().split(' ')[0] === `--${flag}`);
    options[flag] = Object.freeze({ type, description: line?.trimStart().slice(flag.length + 2).trimStart() ?? '', repeatable: line?.includes('(repeatable)') ?? false, optionalValue: name === 'attach' && flag === 'extension' || name === 'install' && flag === 'skills' });
  }
  definitions[name as PlaywrightCommand] = Object.freeze({
    usage, description, section, referenceLine: referenceLine || `  ${usage.padEnd(28)}${description}`,
    arguments: Object.freeze([...reference.args]),
    arity: Object.freeze([args.filter(arg => arg.startsWith('<')).length, args.some(arg => arg.includes('...')) ? Infinity : args.length] as const),
    options: Object.freeze(options),
  });
}
const visible = playwrightHelpReference.split('\n').filter(line => line.startsWith('  ') && !line.trimStart().startsWith('--')).map(line => line.trimStart().split(' ')[0]! as PlaywrightCommand);
const ordered = [...visible, ...Object.keys(definitions).filter(name => !visible.includes(name as PlaywrightCommand)) as PlaywrightCommand[]];
export const playwrightCommandCatalog: Readonly<Record<PlaywrightCommand, PlaywrightCommandDefinition>> = Object.freeze(Object.fromEntries(ordered.map(name => [name, definitions[name]])) as Record<PlaywrightCommand, PlaywrightCommandDefinition>);
