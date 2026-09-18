import type { PlaywrightContext, PlaywrightElementHandle, PlaywrightPage, PlaywrightStorageState, PlaywrightArtifactCapture, PlaywrightCodeExecutor, PlaywrightTraceCapture, PlaywrightActionCodeGenerator } from './adapter.js';
import type { PlaywrightCommandResult } from './response.js';
import type { PlaywrightSessionConfiguration } from './session-configuration.js';
import { playwrightStandardAbilities } from './standard-capabilities.js';
import { playwrightCommandCatalog, type PlaywrightCommand, type PlaywrightCommandDefinition } from './catalog.js';
import { playwrightBuiltinCommands, limitedForms, type PlaywrightBuiltinCommand } from './builtins.js';

export interface PlaywrightAbilityRequest {
  readonly command: PlaywrightCommand;
  readonly session: string;
  readonly args: readonly string[];
  readonly options: Readonly<Record<string, string | boolean | readonly string[]>>;
  readonly signal: AbortSignal;
  readonly limits?: { readonly maxCommandBytes: number; readonly maxArtifactBytes: number; readonly actionTimeoutMs?: number; readonly navigationTimeoutMs?: number; readonly maxPages?: number };
  readonly browserSession?: {
    readonly configuration?: PlaywrightSessionConfiguration;
    readonly context: PlaywrightContext;
    readonly page: PlaywrightPage | undefined;
    resolveTarget(ref: string): Promise<PlaywrightElementHandle>;
    targetLocator?(target: string): string;
    selectPage(page: PlaywrightPage): Promise<void>;
    replaceContext?(state: PlaywrightStorageState): Promise<void>;
    invalidateTargets?(): Promise<void>;
    runAction?(action: () => Promise<void>): Promise<void>;
    readonly captureArtifact?: PlaywrightArtifactCapture;
    readonly captureTrace?: PlaywrightTraceCapture;
    readonly executeCode?: PlaywrightCodeExecutor;
    readonly generateActionCode?: PlaywrightActionCodeGenerator;
    readonly prepareFileBytes?: (bytes: Uint8Array) => Uint8Array;
    registerCleanup(cleanup: () => Promise<void>): void;
  };
  write(text: string): Promise<void>;
  readFile(filename: string): Promise<Uint8Array>;
  writeArtifact(bytes: Uint8Array, filename?: string): Promise<void>;
  registerCleanup(cleanup: () => Promise<void>): void;
}

export interface PlaywrightAbility {
  readonly options?: readonly string[] | 'all';
  readonly scope?: 'client' | 'session';
  readonly limitations?: string;
  execute(request: PlaywrightAbilityRequest): Promise<void | PlaywrightCommandResult>;
}

export type PlaywrightAbilities = {
  readonly [Command in PlaywrightCommand]?: PlaywrightAbility | true;
};

export interface RegisteredPlaywrightAbility {
  readonly execute?: (request: PlaywrightAbilityRequest) => Promise<void | PlaywrightCommandResult>;
  readonly scope: 'client' | 'session';
  readonly arity: readonly [number, number];
  readonly options: PlaywrightCommandDefinition['options'];
  readonly limitations?: string;
  readonly details?: string;
}

const builtinOptions: Partial<Record<PlaywrightBuiltinCommand, readonly string[]>> = {
  attach: ['cdp', 'endpoint', 'extension', 'config', 'idle-timeout'],
  install: ['skills', 'global'], 'install-browser': ['with-deps', 'dry-run', 'list', 'force', 'only-shell', 'no-shell'],
  open: ['browser', 'headed', 'headless', 'config', 'device', 'mobile', 'idle-timeout', 'persistent', 'profile'], snapshot: ['filename', 'depth', 'boxes'], screenshot: ['filename', 'full-page', 'type', 'hires'],
  click: ['modifiers'], fill: ['submit'], list: ['all'], find: ['regex'], highlight: ['hide', 'style'],
};

export function registerPlaywrightAbilities(abilities: PlaywrightAbilities | undefined, hasAdapter: boolean): ReadonlyMap<PlaywrightCommand, RegisteredPlaywrightAbility> {
  if (abilities !== undefined && (!abilities || typeof abilities !== 'object' || Array.isArray(abilities))) throw new TypeError('Invalid Playwright abilities');
  const entries = abilities === undefined
    ? [...Object.keys(playwrightBuiltinCommands), ...(hasAdapter ? Object.keys(playwrightStandardAbilities) : [])].filter(command => hasAdapter || ['list', 'close', 'close-all', 'kill-all', 'install'].includes(command)).map(command => [command, true] as const)
    : Object.entries(abilities);
  const registered = new Map<PlaywrightCommand, RegisteredPlaywrightAbility>();
  for (const [name, supplied] of entries) {
    if (!Object.hasOwn(playwrightCommandCatalog, name)) throw new TypeError(`Unknown Playwright ability: ${name}`);
    const command = name as PlaywrightCommand;
    const definition = playwrightCommandCatalog[command];
    const ability = supplied === true && playwrightStandardAbilities[command] ? playwrightStandardAbilities[command]! : supplied;
    if (ability === true) {
      if (!Object.hasOwn(playwrightBuiltinCommands, name)) throw new TypeError(`No built-in Playwright ability: ${name}`);
      if (!hasAdapter && !['list', 'close', 'close-all', 'kill-all', 'install'].includes(name)) throw new TypeError(`An injected Playwright adapter is required for ${name}`);
      const builtin = name as PlaywrightBuiltinCommand;
      const metadata = playwrightBuiltinCommands[builtin];
      const options = Object.fromEntries((builtinOptions[builtin] ?? []).map(flag => [flag, definition.options[flag] ?? { type: 'boolean' as const, description: 'run browser in headless mode' }]));
      registered.set(command, Object.freeze({ scope: 'session', arity: Object.freeze(metadata.arity.map(value => value - 1) as [number, number]), options: Object.freeze(options), details: metadata.details, ...(limitedForms[builtin] ? { limitations: limitedForms[builtin] } : {}) }));
      continue;
    }
    if (!ability || typeof ability !== 'object' || Array.isArray(ability) || typeof ability.execute !== 'function'
      || Object.keys(ability).some(key => !['execute', 'scope', 'options', 'limitations'].includes(key))
      || ability.scope !== undefined && !['client', 'session'].includes(ability.scope)
      || ability.limitations !== undefined && (typeof ability.limitations !== 'string' || !ability.limitations.trim())) throw new TypeError(`Invalid Playwright ability: ${name}`);
    if (ability.scope === 'session' && !hasAdapter) throw new TypeError(`An injected Playwright adapter is required for ${name}`);
    const flags = ability.options === 'all' ? Object.keys(definition.options) : ability.options ?? [];
    if (!Array.isArray(flags) || flags.some(flag => typeof flag !== 'string' || !Object.hasOwn(definition.options, flag)) || new Set(flags).size !== flags.length) throw new TypeError(`Invalid Playwright ability options: ${name}`);
    registered.set(command, Object.freeze({ execute: ability.execute.bind(ability), scope: ability.scope ?? 'client', arity: definition.arity, options: Object.freeze(Object.fromEntries(flags.map(flag => [flag, definition.options[flag]!]))), ...(ability.limitations === undefined ? {} : { limitations: ability.limitations }) }));
  }
  return registered;
}
