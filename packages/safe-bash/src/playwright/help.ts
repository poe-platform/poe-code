import { playwrightCommandCatalog, type PlaywrightCommand } from './catalog.js';
import { registerPlaywrightAbilities, type RegisteredPlaywrightAbility } from './abilities.js';

export function formatPlaywrightHelp(topic?: PlaywrightCommand | 'tab', abilities: ReadonlyMap<PlaywrightCommand, RegisteredPlaywrightAbility> = registerPlaywrightAbilities(undefined, true)): string {
  let text = 'playwright-cli - run playwright mcp commands from terminal\n\n';
  const usage = topic === undefined ? '<command> [args] [options]' : topic === 'tab' ? 'tab <list|new|select|close> [args]' : playwrightCommandCatalog[topic].usage;
  text += `Usage: playwright-cli ${usage}\nUsage: playwright-cli -s=<session> ${usage}\n`;
  const selected = Object.entries(playwrightCommandCatalog).filter(([name]) => topic === undefined ? abilities.has(name as PlaywrightCommand) : topic === 'tab' ? name.startsWith('tab-') && abilities.has(name as PlaywrightCommand) : name === topic);
  const sections = new Map<string, typeof selected>();
  for (const entry of selected) { const entries = sections.get(entry[1].section) ?? []; entries.push(entry); sections.set(entry[1].section, entries); }
  if (topic === undefined && !selected.length) text += '\nNo command abilities are enabled by this client.\n';
  for (const [section, entries] of sections) {
    if (topic === undefined) text += `\n${section}:\n`;
    for (const [name, definition] of entries) {
      const ability = abilities.get(name as PlaywrightCommand);
      if (topic !== undefined) text += '\n';
      text += `${definition.referenceLine}${ability?.limitations ? ' [limited]' : ''}\n`;
      if (topic !== undefined) {
        if (!ability) text += '\nNot enabled by this client. This command cannot be executed.\n';
        else {
          if (ability.details) text += `\n${ability.details}\n`;
          if (ability.limitations) text += `\n${ability.limitations}\n`;
          const flags = Object.entries(ability.options).filter(([flag]) => flag !== 'session');
          if (flags.length) text += '\nOptions:\n' + flags.map(([flag, option]) => `  --${flag}${option.type === 'string' ? option.optionalValue ? ' [value]' : ' <value>' : ''}  ${option.description}\n`).join('');
        }
      }
    }
  }
  text += '\nGlobal options:\n  --help [command]            print help\n  -s, --session <name>         select a session (also accepts -s=<name>)\n';
  if (topic === undefined) {
    const limited = [...abilities.entries()].filter(([, ability]) => ability.limitations);
    if (limited.length) text += '\nCompatibility notes:\n' + limited.map(([, ability]) => `  ${ability.limitations}\n`).join('');
    const flags = [...abilities.entries()].filter(([, ability]) => Object.keys(ability.options).some(flag => flag !== 'session'));
    if (flags.length) text += '\nSupported command options:\n' + flags.map(([name, ability]) => `  ${name}: ${Object.entries(ability.options).filter(([flag]) => flag !== 'session').map(([flag, option]) => `--${flag}${option.type === 'string' ? option.optionalValue ? ' [value]' : ' <value>' : ''}`).join(', ')}\n`).join('');
  }
  text += '\nClient capabilities:\n  Only enabled abilities and declared options are executable.\n  Client implementations own their backend effects; help never allocates a browser.\n  Use help <command> for supported options and limitations.\n\nSession selection and lifecycle:\n  Precedence: explicit option > exported PLAYWRIGHT_CLI_SESSION > default.\n  Client-scoped abilities own their sessions; session-scoped abilities borrow this controller.\n';
  if ([...abilities.values()].some(ability => !ability.execute || ability.scope === 'session')) text += '  Retained sessions require open; repeated open is an error.\n  close/close-all release owned sessions; remote loss requires an explicit open.\n  Snapshot refs are temporary handles; navigation, new snapshots and tab changes invalidate refs.\n';
  text += '\nHost limits:\n  Session, tab, snapshot byte/ref, artifact byte and command byte limits are host-configured.\n  Artifacts use supplied byte destinations or the virtual filesystem, never implicit native paths.\n';
  return text;
}
