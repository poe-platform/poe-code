export const playwrightBuiltinCommands = {
  open: { arity: [1, 2], details: '--browser <chromium|firefox|webkit> selects an injected engine (default: chromium).\n--headed or --headless selects the mode (default: headless); host support is required.' },
  goto: { arity: [2, 2], details: 'Navigation accepts http:, https:, and about:blank. It invalidates snapshot refs.' },
  list: { arity: [1, 1], details: 'Lists sessions owned by this controller. States: acquiring, open, closing, closed.' },
  close: { arity: [1, 1], details: 'Closes the selected owned session. Closing an absent session is safe; use open to start it again.' },
  attach: { arity: [1, 2], details: 'Attach to a browser provided by an authenticated attachment broker.' },
  detach: { arity: [1, 1], details: 'Detach from an attached browser.' },
  'close-all': { arity: [1, 1], details: 'Closes sessions owned by this controller, not unrelated host browsers.' },
  'kill-all': { arity: [1, 1], details: 'Forcefully retire all owned browser sessions.' },
  snapshot: { arity: [1, 2], details: '--filename <path> writes UTF-8 snapshot text to the virtual filesystem instead of stdout.\nUse the emitted refs (for example e1) with click/fill; snapshot again after changes.\nA new snapshot, navigation or tab change invalidates old refs. Byte/ref limits apply.' },
  find: { arity: [1, 2], details: 'Search the page snapshot for text or a regular expression.' },
  'generate-locator': { arity: [2, 2], details: 'Generate a Playwright locator for an element.' },
  highlight: { arity: [1, 2], details: 'Show or remove a persistent element highlight.' },
  click: { arity: [2, 3], details: 'The target must still be connected to the current page.' },
  fill: { arity: [3, 3], details: 'Quote text containing spaces; use -- before literal arguments beginning with -.' },
  press: { arity: [2, 2], details: 'Acts on the selected tab through the injected keyboard capability.' },
  screenshot: { arity: [1, 2], details: 'Save a page or element screenshot to a file.' },
  'tab-list': { arity: [1, 1], details: 'Tabs have zero-based indexes; the selected tab is marked selected.' },
  'tab-new': { arity: [1, 2], details: 'Opens and selects a tab, defaulting to about:blank. The host tab limit applies.' },
  'tab-select': { arity: [2, 2], details: 'Use tab-list to discover indexes. Selecting a tab invalidates snapshot refs.' },
  'tab-close': { arity: [1, 2], details: 'Closes the selected tab when no index is given. Use tab-list to discover remaining tabs.' },
  'delete-data': { arity: [1, 1], details: 'Delete session data.' },
  install: { arity: [1, 1], details: 'Initialize workspace and install standard skills.' },
  'install-browser': { arity: [1, 2], details: 'Use a browser installed by the configured provider.' },
  'config-print': { arity: [1, 1], details: 'Print effective browser configuration.' },
} as const;

export type PlaywrightBuiltinCommand = keyof typeof playwrightBuiltinCommands;

export const limitedForms: Partial<Record<PlaywrightBuiltinCommand, string>> = {};
