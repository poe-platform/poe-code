export const playwrightBuiltinCommands = {
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

export type PlaywrightBuiltinCommand = keyof typeof playwrightBuiltinCommands;

export const limitedForms: Partial<Record<PlaywrightBuiltinCommand, string>> = {
  click: 'click: <target> must be an issued snapshot ref; the optional button argument is unsupported.',
  fill: 'fill: <target> must be an issued snapshot ref, not a selector or text target.',
  snapshot: 'snapshot: the optional target argument is unsupported; only full-page snapshots are available.',
  screenshot: 'screenshot: the optional target argument is unsupported; element screenshots are unavailable.',
};
