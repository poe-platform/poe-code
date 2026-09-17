import type { BrowserEngine, PlaywrightAdapter } from './adapter.js';

export interface PlaywrightInvocation {
  readonly args: readonly string[];
  /** Only exported shell variables. Never read the host environment. */
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  write(text: string): Promise<void>;
  /** Byte destination: optional guest filename, resolved by the injected VFS. */
  readonly writeArtifact?: ((bytes: Uint8Array, filename?: string) => Promise<void>) | undefined;
  readonly registerCleanup?: ((cleanup: () => Promise<void>) => void) | undefined;
}
export type ParsedInvocation = {
  command: 'open' | 'goto' | 'list' | 'close' | 'close-all' | 'snapshot' | 'click' | 'fill' | 'press' | 'screenshot' | 'tab-list' | 'tab-new' | 'tab-select' | 'tab-close';
  session: string;
  browser: BrowserEngine;
  headless: boolean;
  url?: string;
  ref?: string;
  value?: string;
  tab?: number;
  filename?: string;
  fullPage: boolean;
  imageType: 'png' | 'jpeg';
};

export function parseInvocation(invocation: PlaywrightInvocation, adapter: PlaywrightAdapter): ParsedInvocation {
  let session: string | undefined;
  let browser: string = 'chromium';
  let headless = true;
  let filename: string | undefined;
  let fullPage = false;
  let browserOption = false;
  let modeOption = false;
  const positional: string[] = [];
  const seen = new Set<string>();
  let literal = false;
  for (let i = 0; i < invocation.args.length; i++) {
    const arg = invocation.args[i]!;
    if (arg === '--' && !literal) { literal = true; continue; }
    if (literal || !arg.startsWith('-')) { positional.push(arg); continue; }
    const separator = arg.indexOf('=');
    const flag = separator === -1 ? arg : arg.slice(0, separator);
    const key = flag === '-s' ? '--session' : flag;
    if (seen.has(key)) throw new Error(`Repeated option: ${flag}`);
    seen.add(key);
    if (key === '--session' || key === '--browser' || key === '--filename') {
      const value = separator === -1 ? invocation.args[++i] : arg.slice(separator + 1);
      if (!value || value.startsWith('-') || value.includes('\0')) throw new Error(`Missing or invalid value: ${flag}`);
      if (key === '--session') session = value;
      else if (key === '--filename') filename = value;
      else { browser = value; browserOption = true; }
    } else if (key === '--headed' || key === '--headless') {
      if (separator !== -1 || modeOption) throw new Error(`Invalid option: ${arg}`);
      headless = key === '--headless'; modeOption = true;
    } else if (key === '--full-page' && separator === -1) fullPage = true;
    else throw new Error(`Unsupported option: ${arg}`);
  }
  session ??= invocation.env.PLAYWRIGHT_CLI_SESSION ?? 'default';
  if (!session || session.length > 128 || [...session].some(char => !'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.includes(char))) throw new Error('Invalid session name');
  // Accept both agent-oriented CLI tab-* spellings and tab <operation>.
  if (positional[0] === 'tab') positional.splice(0, 2, `tab-${positional[1] ?? ''}`);
  const command = positional[0] as ParsedInvocation['command'];
  const arity: Record<ParsedInvocation['command'], readonly [number, number]> = {
    open: [1, 2], goto: [2, 2], list: [1, 1], close: [1, 1], 'close-all': [1, 1], snapshot: [1, 1], click: [2, 2], fill: [3, 3], press: [2, 2], screenshot: [1, 1], 'tab-list': [1, 1], 'tab-new': [1, 2], 'tab-select': [2, 2], 'tab-close': [1, 2],
  };
  if (!Object.hasOwn(arity, command)) throw new Error(`Unsupported command in qualified subset: ${command ?? ''}`);
  const [min, max] = arity[command];
  if (positional.length < min || positional.length > max) throw new Error(`Invalid arguments for ${command}`);
  if (command !== 'open' && (browserOption || modeOption)) throw new Error('Browser options require open');
  if (filename !== undefined && command !== 'snapshot' && command !== 'screenshot') throw new Error('Filename requires snapshot or screenshot');
  if (fullPage && command !== 'screenshot') throw new Error('Full page requires screenshot');
  if (command === 'screenshot' || filename !== undefined) {
    if (typeof invocation.writeArtifact !== 'function') throw new Error('Artifact byte destination unsupported');
  }
  if (browser !== 'chromium' && browser !== 'firefox' && browser !== 'webkit') throw new Error(`Unsupported browser: ${browser}`);
  if (command === 'open') {
    const capability = adapter.browsers[browser];
    if (!capability) throw new Error(`Unsupported browser: ${browser}`);
    if (!headless && !capability.headed) throw new Error(`Headed mode is unsupported for ${browser}`);
  }
  let imageType: 'png' | 'jpeg' = 'png';
  if (command === 'screenshot' && filename !== undefined) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) imageType = 'jpeg';
    else if (!lower.endsWith('.png')) throw new Error('Unsupported screenshot extension; use png or jpeg');
  }
  const url = command === 'open' || command === 'goto' || command === 'tab-new' ? positional[1] : undefined;
  if (url !== undefined) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && url !== 'about:blank') throw new Error('Unsupported navigation URL');
  }
  const ref = command === 'click' || command === 'fill' ? positional[1] : undefined;
  if (ref !== undefined && (ref[0] !== 'e' || ref.length < 2 || [...ref.slice(1)].some(char => !'0123456789'.includes(char)))) throw new Error('Action requires a snapshot ref');
  const value = command === 'fill' ? positional[2] : command === 'press' ? positional[1] : undefined;
  if (command === 'press' && !value) throw new Error('Missing press key');
  const tabValue = command === 'tab-select' || command === 'tab-close' ? positional[1] : undefined;
  const tab = tabValue === undefined ? undefined : Number(tabValue);
  if (tabValue !== undefined && (!tabValue || [...tabValue].some(char => !'0123456789'.includes(char)) || !Number.isSafeInteger(tab))) throw new Error('Invalid tab index');
  return { command, session, browser, headless, fullPage, imageType, ...(url === undefined ? {} : { url }), ...(ref === undefined ? {} : { ref }), ...(value === undefined ? {} : { value }), ...(tab === undefined ? {} : { tab }), ...(filename === undefined ? {} : { filename }) };
}
