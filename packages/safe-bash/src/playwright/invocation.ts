import type { BrowserEngine, PlaywrightAdapter } from './adapter.js';
import { playwrightCommandCatalog, type PlaywrightCommand } from './catalog.js';
import type { RegisteredPlaywrightAbility } from './abilities.js';
import { playwrightCommandReference } from './command-reference.js';
import type { PlaywrightMouseButton, PlaywrightModifier } from './adapter.js';

export interface PlaywrightInvocation {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  write(text: string): Promise<void>;
  readonly readArtifact?: ((filename: string, maxBytes: number) => Promise<Uint8Array>) | undefined;
  readonly writeArtifact?: ((bytes: Uint8Array, filename?: string) => Promise<void>) | undefined;
  readonly registerCleanup?: ((cleanup: () => Promise<void>) => void) | undefined;
  readonly workspace?: {
    readonly cwd: string;
    readonly home?: string;
    mkdir(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    listFiles?(directory: string, maxEntries: number): Promise<readonly { readonly filename: string; readonly size: number; readonly mtimeMs: number }[]>;
    removeFile?(filename: string): Promise<void>;
  };
}

export type ParsedInvocation = {
  command: PlaywrightCommand;
  json: boolean;
  raw: boolean;
  session: string;
  args: readonly string[];
  options: Readonly<Record<string, string | boolean | readonly string[]>>;
  browser: BrowserEngine;
  headless: boolean;
  url?: string;
  ref?: string;
  value?: string;
  tab?: number;
  filename?: string;
  fullPage: boolean;
  imageType: 'png' | 'jpeg';
  button?: PlaywrightMouseButton;
  modifiers?: PlaywrightModifier[];
  scale: 'css' | 'device';
};

export function validatePlaywrightSessionName(session: unknown): asserts session is string {
  if (typeof session !== 'string' || !session || session.length > 128 || [...session].some(char => !'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.includes(char))) throw new Error('Invalid session name');
}

export function parseInvocation(invocation: PlaywrightInvocation, abilities: ReadonlyMap<PlaywrightCommand, RegisteredPlaywrightAbility>, adapter?: PlaywrightAdapter): ParsedInvocation | { command: 'help'; topic?: PlaywrightCommand | 'tab'; json: boolean; raw: boolean } | { command: 'version'; json: boolean; raw: boolean } {
  const positional: string[] = [];
  const supplied = new Map<string, (string | boolean)[]>();
  const knownOptions = new Map(Object.values(playwrightCommandCatalog).flatMap(command => Object.entries(command.options)));
  knownOptions.set('headless', { type: 'boolean', description: '' });
  knownOptions.set('session', { type: 'string', description: '' });
  for (const flag of ['json', 'raw', 'version']) knownOptions.set(flag, { type: 'boolean', description: '' });
  let help = false;
  let literal = false;
  for (let index = 0; index < invocation.args.length; index++) {
    const arg = invocation.args[index]!;
    if (typeof arg !== 'string' || arg.includes('\0')) throw new Error('Invalid Playwright argument');
    if (arg === '--' && !literal) { literal = true; continue; }
    const numeric = arg.startsWith('-') && arg.length > 1 && '0123456789.'.includes(arg[1]!) && Number.isFinite(Number(arg));
    if (literal || !arg.startsWith('-') || numeric) { positional.push(arg); continue; }
    const separator = arg.indexOf('=');
    const flag = separator === -1 ? arg : arg.slice(0, separator);
    const key = flag === '-s' ? 'session' : flag === '-g' ? 'global' : flag === '-v' ? 'version' : flag.slice(2);
    if ((flag === '-h' || flag === '--help') && separator === -1) { help = true; continue; }
    const definition = knownOptions.get(key);
    if (!definition || flag !== '-s' && flag !== '-g' && flag !== '-v' && !flag.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    let value: string | boolean;
    if (definition.type === 'boolean') {
      if (separator !== -1) throw new Error(`Invalid option: ${arg}`);
      value = true;
    } else if (definition.optionalValue && separator === -1 && (invocation.args[index + 1] === undefined || invocation.args[index + 1]!.startsWith('-'))) {
      value = true;
    } else {
      const candidate = separator === -1 ? invocation.args[++index] : arg.slice(separator + 1);
      if (candidate === undefined || candidate.includes('\0') || separator === -1 && candidate.startsWith('-') && !Number.isFinite(Number(candidate))) throw new Error(`Missing or invalid value: ${flag}`);
      value = candidate;
    }
    const values = supplied.get(key) ?? [];
    values.push(value);
    supplied.set(key, values);
  }
  if (positional[0] === 'help') { help = true; positional.shift(); }
  const json = supplied.has('json');
  const raw = supplied.has('raw');
  if (supplied.has('version')) return { command: 'version', json, raw };
  supplied.delete('json'); supplied.delete('raw');
  if (!positional.length) help = true;
  if (help && (positional.length === 0 || positional.length === 1 && positional[0] === 'tab')) return { command: 'help', json, raw, ...(positional[0] === 'tab' ? { topic: 'tab' } : {}) };
  if (positional[0] === 'tab') positional.splice(0, 2, `tab-${positional[1] ?? ''}`);
  const command = positional.shift() as PlaywrightCommand;
  if (!Object.hasOwn(playwrightCommandCatalog, command)) throw new Error(`Unsupported command: ${command ?? ''}`);
  if (help) return { command: 'help', topic: command, json, raw };
  const ability = abilities.get(command);
  if (!ability) throw new Error(`Playwright ability not enabled: ${command}`);
  const sessionValues = supplied.get('session');
  if (sessionValues && sessionValues.length !== 1) throw new Error('Repeated option: --session');
  const session = (sessionValues?.[0] as string | undefined) ?? invocation.env.PLAYWRIGHT_CLI_SESSION ?? 'default';
  validatePlaywrightSessionName(session);
  supplied.delete('session');
  const options: Record<string, string | boolean | readonly string[]> = {};
  for (const [flag, values] of supplied) {
    const definition = ability.options[flag];
    if (!definition) throw new Error(`Unsupported option: --${flag}`);
    if (values.length > 1 && !definition.repeatable) throw new Error(`Repeated option: --${flag}`);
    options[flag] = definition.repeatable ? Object.freeze(values as string[]) : values[0]!;
  }
  const [min, max] = ability.arity;
  if (positional.length < min || positional.length > max) throw new Error(`Invalid arguments for ${command}`);
  const reference = playwrightCommandReference[command];
  const parsed: ParsedInvocation = { command, json, raw: raw || ('raw' in reference && reference.raw), session, args: Object.freeze(positional), options: Object.freeze(options), browser: 'chromium', headless: true, fullPage: false, imageType: 'png', scale: 'css' };
  if (ability.execute) return parsed;
  const browser = options.browser === 'chrome' ? 'chromium' : options.browser ?? 'chromium';
  if (browser !== 'chromium' && browser !== 'firefox' && browser !== 'webkit') throw new Error(`Unsupported browser: ${browser}`);
  parsed.browser = browser;
  if (options.headed && options.headless) throw new Error('Invalid option: --headless');
  parsed.headless = !options.headed;
  parsed.fullPage = options['full-page'] === true;
  parsed.scale = options.hires ? 'device' : 'css';
  if (options.filename !== undefined) {
    const filename = options.filename as string;
    if (!filename) throw new Error('Missing or invalid value: --filename');
    parsed.filename = filename;
  }
  if (command === 'screenshot' || parsed.filename !== undefined) {
    if (typeof invocation.writeArtifact !== 'function') throw new Error('Artifact byte destination unsupported');
  }
  if (command === 'open') {
    if (!adapter) throw new Error('An injected Playwright adapter is required');
    const capability = adapter.browsers[browser];
    if (!capability) throw new Error(`Unsupported browser: ${browser}`);
    if (!parsed.headless && !capability.headed) throw new Error(`Headed mode is unsupported for ${browser}`);
  }
  if (command === 'screenshot' && parsed.filename !== undefined) {
    const lower = parsed.filename.toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) parsed.imageType = 'jpeg';
    else if (!lower.endsWith('.png')) throw new Error('Unsupported screenshot extension; use png or jpeg');
  }
  if (command === 'screenshot') {
    if (options.type !== undefined) {
      if (options.type !== 'png' && options.type !== 'jpeg') throw new Error(`Unsupported screenshot type: ${String(options.type)}`);
      parsed.imageType = options.type;
    }
    if (positional[0]) parsed.ref = positional[0];
    if (parsed.ref && parsed.fullPage) throw new Error('fullPage cannot be used with element screenshots.');
  }
  const url = command === 'open' || command === 'goto' || command === 'tab-new' ? positional[0] : undefined;
  if (url !== undefined) {
    parsed.url = URL.canParse(url) ? url : `${url.startsWith('localhost') ? 'http' : 'https'}://${url}`;
  }
  if (command === 'click' || command === 'fill') {
    const ref = positional[0]!;
    if (!ref) throw new Error('Missing target');
    parsed.ref = ref;
  }
  if (command === 'click') {
    const button = positional[1] ?? 'left';
    if (!['left', 'right', 'middle'].includes(button)) throw new Error(`Unknown mouse button: ${button}`);
    parsed.button = button as PlaywrightMouseButton;
    const modifiers = options.modifiers === undefined ? [] : typeof options.modifiers === 'string' ? [options.modifiers] : options.modifiers;
    if (!Array.isArray(modifiers) || modifiers.some(modifier => !['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'].includes(modifier))) throw new Error('Invalid click modifiers');
    parsed.modifiers = modifiers as PlaywrightModifier[];
  }
  if (command === 'fill') parsed.value = positional[1]!;
  if (command === 'press') {
    if (!positional[0]) throw new Error('Missing press key');
    parsed.value = positional[0];
  }
  const tabValue = command === 'tab-select' || command === 'tab-close' ? positional[0] : undefined;
  if (tabValue !== undefined) {
    const tab = Number(tabValue);
    if (!tabValue || [...tabValue].some(char => !'0123456789'.includes(char)) || !Number.isSafeInteger(tab)) throw new Error('Invalid tab index');
    parsed.tab = tab;
  }
  return parsed;
}
