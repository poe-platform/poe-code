export const playwrightCommands = {
  open: { arity: [1, 2], usage: 'open [url]', description: 'Open a new session (about:blank when no URL is given).', details: '--browser <chromium|firefox|webkit> selects an injected engine (default: chromium).\n--headed or --headless selects the mode (default: headless); host support is required.' },
  goto: { arity: [2, 2], usage: 'goto <url>', description: 'Navigate the selected tab in an open session.', details: 'Navigation accepts http:, https:, and about:blank. It invalidates snapshot refs.' },
  list: { arity: [1, 1], usage: 'list', description: 'List named sessions and their lifecycle states.', details: 'States: acquiring, open, closing, closed.' },
  close: { arity: [1, 1], usage: 'close', description: 'Close the selected session.', details: 'Closing an absent session is safe. Use open to start it again.' },
  'close-all': { arity: [1, 1], usage: 'close-all', description: 'Close all sessions owned by this controller.', details: 'This does not terminate unrelated host browsers.' },
  snapshot: { arity: [1, 1], usage: 'snapshot', description: 'Read page text and capture actionable element refs.', details: '--filename <path> writes UTF-8 snapshot text to the virtual filesystem instead of stdout.\nUse the emitted refs (for example e1) with click/fill; snapshot again after changes.\nA new snapshot, navigation or tab change invalidates old refs. Byte/ref limits apply.' },
  click: { arity: [2, 2], usage: 'click <ref>', description: 'Click an element from the latest snapshot.', details: 'The ref must be an issued, still-connected element handle, not a CSS selector.' },
  fill: { arity: [3, 3], usage: 'fill <ref> <text>', description: 'Fill an element from the latest snapshot.', details: 'Quote text containing spaces; use -- before literal arguments beginning with -.' },
  press: { arity: [2, 2], usage: 'press <key>', description: 'Press a key, such as Enter or Control+a.', details: 'Acts on the selected tab through the injected keyboard capability.' },
  screenshot: { arity: [1, 1], usage: 'screenshot', description: 'Capture an image of the selected tab.', details: '--filename <path.png|path.jpg|path.jpeg> writes to the virtual filesystem.\nWithout --filename, raw PNG bytes go to stdout; use shell redirection.\n--full-page captures the whole page instead of the viewport. Byte limits apply.' },
  'tab-list': { arity: [1, 1], usage: 'tab-list', description: 'List tabs with zero-based indexes and URLs.', details: 'The selected tab is marked selected.' },
  'tab-new': { arity: [1, 2], usage: 'tab-new [url]', description: 'Open and select a new tab.', details: 'Defaults to about:blank. The host tab limit applies.' },
  'tab-select': { arity: [2, 2], usage: 'tab-select <index>', description: 'Select a tab by its zero-based index.', details: 'Use tab-list to discover indexes. Selecting a tab invalidates snapshot refs.' },
  'tab-close': { arity: [1, 2], usage: 'tab-close [index]', description: 'Close a tab (the selected tab by default).', details: 'Use tab-list to discover the remaining tabs after closing one.' },
} as const;

export type PlaywrightCommand = keyof typeof playwrightCommands;

export function formatPlaywrightHelp(topic?: PlaywrightCommand | 'tab'): string {
  const commands = Object.entries(playwrightCommands).filter(([name]) => topic === undefined || (topic === 'tab' ? name.startsWith('tab-') : name === topic));
  const usage = topic === undefined ? '[options] <command> [arguments]' : topic === 'tab' ? 'tab <list|new|select|close> [arguments]' : playwrightCommands[topic].usage;
  let text = `Usage: playwright-cli ${usage}\n\nSupported commands:\n`;
  for (const [, command] of commands) text += `  ${command.usage.padEnd(24)} ${command.description}\n`;
  if (topic !== undefined) text += `\n${commands.map(([, command]) => command.details).join('\n')}\n`;
  else text += '\nCommand options:\n  open:       --browser <engine>, --headed, --headless\n  snapshot:   --filename <path> (UTF-8 text; default: stdout)\n  screenshot: --filename <path.png|path.jpg|path.jpeg>, --full-page\n              Default: raw PNG on stdout; use shell redirection.\n';
  text += '\nSession selection:\n  -s, --session <name>  Select a session (also accepts --session=<name>).\n  Precedence: explicit option > exported PLAYWRIGHT_CLI_SESSION > default.\n  Commands reuse the selected open session; repeated open is an error.\n  Sessions live only in this retained controller, not across independent owners.\n  close/close-all release owned sessions; remote loss requires an explicit open.\n\nDiscovery and limits:\n  --help, -h, help [command]  Show help without allocating a browser.\n  playwright-cli <command> --help shows command arguments and options.\n  tab <list|new|select|close> is also accepted.\n  Snapshot refs are temporary handles, not selectors; recapture after changes.\n  Snapshot byte/ref, screenshot byte, session and tab limits are host-configured.\n  Browser commands require an injected adapter; help does not.\n\nUnsupported in this subset:\n  Arbitrary code/eval, uploads, downloads, PDF, video, tracing, install,\n  kill-all, persistent profiles and unlisted commands/options.\n';
  return text;
}
