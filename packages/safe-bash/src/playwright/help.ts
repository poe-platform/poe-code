import { playwrightHelpReference } from './help-reference.js';

export const playwrightCommands = {
  open: { arity: [1, 2], details: '--browser <chromium|firefox|webkit> selects an injected engine (default: chromium).\n--headed or --headless selects the mode (default: headless); host support is required.' },
  goto: { arity: [2, 2], details: 'Navigation accepts http:, https:, and about:blank. It invalidates snapshot refs.' },
  list: { arity: [1, 1], details: 'Lists sessions owned by this controller. States: acquiring, open, closing, closed.' },
  close: { arity: [1, 1], details: 'Closes the selected owned session. Closing an absent session is safe; use open to start it again.' },
  'close-all': { arity: [1, 1], details: 'Closes sessions owned by this controller, not unrelated host browsers.' },
  snapshot: { arity: [1, 1], details: '--filename <path> writes UTF-8 snapshot text to the virtual filesystem instead of stdout.\nUse the emitted refs (for example e1) with click/fill; snapshot again after changes.\nA new snapshot, navigation or tab change invalidates old refs. Byte/ref limits apply.' },
  click: { arity: [2, 2], details: 'The target must still be connected to the current page.' },
  fill: { arity: [3, 3], details: 'Quote text containing spaces; use -- before literal arguments beginning with -.' },
  press: { arity: [2, 2], details: 'Acts on the selected tab through the injected keyboard capability.' },
  screenshot: { arity: [1, 1], details: '--filename <path.png|path.jpg|path.jpeg> writes to the virtual filesystem.\nWithout --filename, raw PNG bytes go to stdout; use shell redirection.\n--full-page captures the whole page instead of the viewport. Byte limits apply.' },
  'tab-list': { arity: [1, 1], details: 'Tabs have zero-based indexes; the selected tab is marked selected.' },
  'tab-new': { arity: [1, 2], details: 'Opens and selects a tab, defaulting to about:blank. The host tab limit applies.' },
  'tab-select': { arity: [2, 2], details: 'Use tab-list to discover indexes. Selecting a tab invalidates snapshot refs.' },
  'tab-close': { arity: [1, 2], details: 'Closes the selected tab when no index is given. Use tab-list to discover remaining tabs.' },
} as const;

export type PlaywrightCommand = keyof typeof playwrightCommands;

const limitedForms: Partial<Record<PlaywrightCommand, string>> = {
  click: 'click: <target> must be an issued snapshot ref; the optional button argument is unsupported.',
  fill: 'fill: <target> must be an issued snapshot ref, not a selector or text target.',
  snapshot: 'snapshot: the optional target argument is unsupported; only full-page snapshots are available.',
  screenshot: 'screenshot: the optional target argument is unsupported; element screenshots are unavailable.',
};

export function formatPlaywrightHelp(topic?: PlaywrightCommand | 'tab'): string {
  const lines = playwrightHelpReference.split('\n');
  const commands = lines.filter(line => line.startsWith('  ')).map(line => ({ name: line.trimStart().split(' ')[0]!, line }));
  let text: string;
  if (topic === undefined) {
    text = lines.map(line => {
      if (!line.startsWith('  ')) return line;
      const name = line.trimStart().split(' ')[0]!;
      if (name === '--help') return line;
      if (!Object.hasOwn(playwrightCommands, name)) return `${line} [unsupported]`;
      return limitedForms[name as PlaywrightCommand] ? `${line} [limited]` : line;
    }).join('\n').replace('\nCore:\n', '\nAvailability: [unsupported] is not implemented; [limited] has restrictions explained below.\n\nCore:\n');
  } else {
    const selected = commands.filter(command => topic === 'tab' ? command.name.startsWith('tab-') : command.name === topic);
    const usage = topic === 'tab' ? 'tab <list|new|select|close> [args]' : selected[0]!.line.trimStart().split('  ')[0]!.trimEnd();
    text = `${lines[0]}\n\nUsage: playwright-cli ${usage}\nUsage: playwright-cli -s=<session> ${usage}\n\n`;
    for (const command of selected) {
      const name = command.name as PlaywrightCommand;
      text += `${command.line}${limitedForms[name] ? ' [limited]' : ''}\n\n${playwrightCommands[name].details}\n`;
    }
  }
  text += '\nCompatibility notes:\nUnsupported entries above are reference-only and cannot be executed.\nUnlisted command options are also unsupported; use --help <command> for supported options.\n';
  text += Object.entries(limitedForms).filter(([name]) => topic === undefined || topic === name).map(([, note]) => `  ${note}\n`).join('');
  if (topic === undefined) text += '\nSupported command options:\n  open:       --browser <chromium|firefox|webkit>, --headed, --headless\n  snapshot:   --filename <path> (UTF-8 text; default: stdout)\n  screenshot: --filename <path.png|path.jpg|path.jpeg>, --full-page\n              Default: raw PNG on stdout; use shell redirection.\n';
  text += '\nSession selection and lifecycle:\n  -s, --session <name>  Select a session (also accepts -s=<name> or --session=<name>).\n  Precedence: explicit option > exported PLAYWRIGHT_CLI_SESSION > default.\n  Commands reuse the selected open session; repeated open is an error.\n  Sessions live only in this retained controller, not across independent owners.\n  close/close-all release owned sessions; remote loss requires an explicit open.\n\nHost limits and discovery:\n  Snapshot byte/ref, screenshot byte, session and tab limits are host-configured.\n  Snapshot refs are temporary handles, not selectors; recapture after changes.\n  Browser commands require an injected adapter; help does not allocate a browser.\n  -h and help [command] are also accepted, as is tab <list|new|select|close>.\n';
  return text;
}
