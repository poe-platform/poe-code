import type { PlaywrightAbility, PlaywrightAbilityRequest } from './abilities.js';
import type { PlaywrightContext } from './adapter.js';
import type { PlaywrightCommand } from './catalog.js';
import { capabilityResult, requireSession, unsupported } from './capability-result.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';

export interface PlaywrightRoute {
  request(): { headers(): Record<string, string> };
  fulfill(options: { status: number; body?: string; contentType?: string }): Promise<void>;
  continue(options: { headers: Record<string, string> }): Promise<void>;
}
export type PlaywrightRouteHandler = (route: PlaywrightRoute) => Promise<void>;
export interface PlaywrightRoutingContext {
  route(pattern: string, handler: PlaywrightRouteHandler): Promise<unknown>;
  unroute(pattern: string, handler: PlaywrightRouteHandler): Promise<void>;
}
interface Entry {
  pattern: string;
  status: number | undefined;
  body: string | undefined;
  contentType: string | undefined;
  addHeaders: Record<string, string> | undefined;
  removeHeaders: string[] | undefined;
  handler: PlaywrightRouteHandler;
  bytes: number;
}
interface Registry { entries: Entry[]; closed: boolean }
const registries = new WeakMap<PlaywrightContext, Registry>();
const MAX_ROUTES = 64;

async function installRoute(context: PlaywrightRoutingContext, registry: Registry, entry: Entry, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (registry.closed) throw new Error('Browser context is closed');
  await context.route(entry.pattern, entry.handler);
  try {
    signal?.throwIfAborted();
    if (registry.closed) throw new Error('Browser context is closed');
    registry.entries.push(entry);
  } catch (error) {
    try { await context.unroute(entry.pattern, entry.handler); }
    finally { signal?.throwIfAborted(); }
    throw error;
  }
}

function routingFor(input: PlaywrightContext, registerCleanup: (cleanup: () => Promise<void>) => void) {
  const context = input as PlaywrightContext & Partial<PlaywrightRoutingContext>;
  if (!context.route || !context.unroute) unsupported('network routes');
  let registry = registries.get(context);
  if (!registry) {
    registry = { entries: [], closed: false };
    registries.set(context, registry);
    const owned = registry;
    const onClose = () => { owned.closed = true; owned.entries.length = 0; registries.delete(context); };
    context.on?.('close', onClose);
    registerCleanup(async () => {
      try {
        for (const entry of [...owned.entries]) {
          try { await context.unroute!(entry.pattern, entry.handler); }
          catch (error) { if (!owned.closed) throw error; }
        }
      } finally { context.off?.('close', onClose); onClose(); }
    });
  }
  if (registry.closed) throw new Error('Browser context is closed');
  return { context: context as PlaywrightContext & PlaywrightRoutingContext, registry };
}

function routing(request: PlaywrightAbilityRequest) {
  const session = requireSession(request);
  return routingFor(session.context, session.registerCleanup);
}

/** Native state replacement must retain the routes of the logical CLI session. */
export function capturePlaywrightRoutes(context: PlaywrightContext) {
  const entries = [...registries.get(context)?.entries ?? []];
  if (!entries.length) return;
  return async (replacement: PlaywrightContext, registerCleanup: (cleanup: () => Promise<void>) => void) => {
    const { context, registry } = routingFor(replacement, registerCleanup);
    for (const entry of entries) {
      await installRoute(context, registry, entry);
    }
  };
}

const route: PlaywrightAbility = { scope: 'session', options: 'all', async execute(request) {
  const { context, registry } = routing(request);
  const pattern = request.args[0]!;
  const body = request.options.body as string | undefined;
  const contentType = request.options['content-type'] as string | undefined;
  const status = request.options.status === undefined ? undefined : Number(request.options.status);
  if (status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599)) throw new Error('Invalid route status');
  if (!pattern || pattern.length > 4096) throw new Error('Invalid route pattern');
  const headers = request.options.header;
  let addHeaders: Record<string, string> | undefined;
  if (headers !== undefined) {
    addHeaders = Object.create(null) as Record<string, string>;
    for (const header of Array.isArray(headers) ? headers : [headers]) {
      if (typeof header !== 'string') throw new Error('Invalid route header');
      const colon = header.indexOf(':');
      if (colon <= 0) throw new Error('Invalid route header');
      const name = header.slice(0, colon).trim().toLowerCase(), value = header.slice(colon + 1).trim();
      // Native Fetch validates header names and rejects CR/LF injection.
      new Headers([[name, value]]);
      addHeaders[name] = value;
    }
  }
  const removeHeaders = typeof request.options['remove-header'] === 'string' ? request.options['remove-header'].split(',').map(name => name.trim().toLowerCase()) : undefined;
  const data = { pattern, status, body, contentType, addHeaders, removeHeaders };
  const bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
  if (registry.entries.length >= MAX_ROUTES) throw new PlaywrightResourceLimitError('Playwright route count limit exceeded');
  if (bytes + registry.entries.reduce((sum, entry) => sum + entry.bytes, 0) > (request.limits?.maxCommandBytes ?? 1048576)) throw new PlaywrightResourceLimitError('Playwright route byte limit exceeded');
  const handler: PlaywrightRouteHandler = async native => {
    if (body !== undefined || status !== undefined) {
      await native.fulfill({ status: status ?? 200, ...(body === undefined ? {} : { body }), ...(contentType === undefined ? {} : { contentType }) });
      return;
    }
    const updated = { ...native.request().headers(), ...addHeaders };
    for (const name of removeHeaders ?? []) delete updated[name];
    await native.continue({ headers: updated });
  };
  await installRoute(context, registry, { ...data, handler, bytes }, request.signal);
  return capabilityResult(`await page.context().route(${JSON.stringify(pattern)}, async route => { /* route handler */ });`, `Route added for pattern: ${pattern}`);
} };

export const playwrightRouteAbilities: Partial<Record<PlaywrightCommand, PlaywrightAbility>> = {
  route,
  'route-list': { scope: 'session', async execute(request) {
    const { registry } = routing(request);
    const lines = registry.entries.map((entry, index) => {
      const details: string[] = [];
      if (entry.status !== undefined) details.push(`status=${entry.status}`);
      if (entry.body !== undefined) details.push(`body=${entry.body.length > 50 ? entry.body.slice(0, 50) + '...' : entry.body}`);
      if (entry.contentType) details.push(`contentType=${entry.contentType}`);
      if (entry.addHeaders) details.push(`addHeaders=${JSON.stringify(entry.addHeaders)}`);
      if (entry.removeHeaders) details.push(`removeHeaders=${entry.removeHeaders.join(',')}`);
      return `${index + 1}. ${entry.pattern}${details.length ? ` (${details.join(', ')})` : ''}`;
    });
    return capabilityResult('', lines.join('\n') || 'No active routes');
  } },
  unroute: { scope: 'session', async execute(request) {
    const { context, registry } = routing(request);
    const pattern = request.args[0];
    let removed = 0;
    for (const entry of [...registry.entries]) {
      if (pattern !== undefined && entry.pattern !== pattern) continue;
      request.signal.throwIfAborted();
      await context.unroute(entry.pattern, entry.handler);
      registry.entries.splice(registry.entries.indexOf(entry), 1);
      removed++;
    }
    return capabilityResult('', pattern === undefined ? `Removed all ${removed} route(s)` : `Removed ${removed} route(s) for pattern: ${pattern}`);
  } },
};
