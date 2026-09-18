import { PlaywrightResourceLimitError } from './resource-limit.js';
import type { PlaywrightAbility, PlaywrightAbilityRequest } from './abilities.js';
import type { PlaywrightConsoleMessage, PlaywrightContext, PlaywrightNetworkRequest, PlaywrightNetworkResponse, PlaywrightPage } from './adapter.js';
import type { PlaywrightCommand } from './catalog.js';
import { capabilityArtifact, capabilityArtifactName, capabilityResult, numeric, requirePage, requireSession, unsupported } from './capability-result.js';
import type { PlaywrightSessionConfiguration } from './session-configuration.js';

interface RequestRecord {
  index: number; native: PlaywrightNetworkRequest; url: string; method: string; type: string; headers: Record<string, string>;
  response?: { native: PlaywrightNetworkResponse; status: number; statusText: string; headers: Record<string, string> };
}
interface ConsoleRecord { index: number; type: string; text: string; location: string; generation: number; timestamp: number }
interface ConsoleLog { filename: string; content: string; lines: number }
interface PageEvents {
  requests: RequestRecord[]; generation: number; console: ConsoleRecord[];
  startedAt: number; nextRequestIndex: number; nextConsoleIndex: number; consoleCursor: number; log?: ConsoleLog;
}
interface EventState { pages: WeakMap<object, PageEvents>; failure?: Error; maxBytes: number; maxArtifactBytes: number; forget(record: object): void }
const states = new WeakMap<PlaywrightContext, EventState>();

// A host may wrap Page navigation methods while native events retain the raw Page.
// Playwright's main frame remains stable across those wrappers and navigations.
function pageIdentity(page: PlaywrightPage): object { return page.mainFrame?.() ?? page; }

export function observePlaywrightCapabilities(context: PlaywrightContext, registerCleanup: (cleanup: () => Promise<void>) => void,
  limits: { maxCommandBytes: number; maxArtifactBytes: number }): void {
  if (states.has(context)) return;
  const requests = new WeakMap<PlaywrightNetworkRequest, RequestRecord>();
  const history = new Map<object, { bytes: number; evict(): void }>();
  let bytes = 0, closed = false;
  const forget = (record: object) => {
    const retained = history.get(record);
    if (!retained) return;
    history.delete(record); bytes -= retained.bytes; retained.evict();
  };
  const state: EventState = { pages: new WeakMap(), maxBytes: limits.maxCommandBytes, maxArtifactBytes: limits.maxArtifactBytes, forget };
  states.set(context, state);
  // Diagnostic retention rolls independently of browser traffic and session lifetime.
  const retain = (record: object, size: number, evict: () => void): void => {
    const previous = history.get(record);
    bytes += size - (previous?.bytes ?? 0);
    history.set(record, { bytes: size, evict });
    if (size > state.maxBytes) forget(record);
    while (history.size > 4096 || bytes > state.maxBytes) forget(history.keys().next().value!);
  };
  const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;
  const pageEvents = (page: PlaywrightPage): PageEvents => {
    const identity = pageIdentity(page);
    let events = state.pages.get(identity);
    if (!events) { events = { requests: [], generation: 0, console: [], startedAt: Date.now(), nextRequestIndex: 0, nextConsoleIndex: 0, consoleCursor: 0 }; state.pages.set(identity, events); }
    return events;
  };
  const observe = (action: () => void) => {
    if (closed || state.failure) return;
    try { action(); } catch (error) { state.failure = error instanceof Error ? error : new Error(String(error)); }
  };
  const onRequest = (native: PlaywrightNetworkRequest) => observe(() => {
    let frame: ReturnType<PlaywrightNetworkRequest['frame']>;
    try { frame = native.frame(); } catch { return; } // Worker-only requests have no selected page.
    const page = frame.page();
    const events = pageEvents(page);
    if (native.isNavigationRequest() && frame.parentFrame() === null) {
      for (const record of [...events.requests]) forget(record);
      events.nextRequestIndex = 0; events.generation++; events.startedAt = Date.now(); delete events.log; events.consoleCursor = events.nextConsoleIndex;
    }
    const record: RequestRecord = { index: ++events.nextRequestIndex, native, url: native.url(), method: native.method(), type: native.resourceType(), headers: { ...native.headers() } };
    requests.set(native, record);
    events.requests.push(record);
    // Keep native body access lazy: copying postData here turns uploads into a
    // diagnostic byte quota even when no command asks to inspect their content.
    retain(record, byteLength(JSON.stringify({ url: record.url, method: record.method, type: record.type, headers: record.headers })), () => {
      requests.delete(native); events.requests.splice(events.requests.indexOf(record), 1);
    });
  });
  const onResponse = (native: PlaywrightNetworkResponse) => observe(() => {
    const record = requests.get(native.request());
    if (!record) return;
    const response = { native, status: native.status(), statusText: native.statusText(), headers: { ...native.headers() } };
    record.response = response;
    const retained = history.get(record)!;
    retain(record, retained.bytes + byteLength(JSON.stringify({ status: response.status, statusText: response.statusText, headers: response.headers })), retained.evict);
  });
  const onConsole = (message: PlaywrightConsoleMessage) => observe(() => {
    const page = message.page();
    if (!page) return;
    const events = pageEvents(page);
    const location = message.location();
    const timestamp = (message as PlaywrightConsoleMessage & { timestamp?(): number }).timestamp?.() ?? Date.now();
    const record = { index: ++events.nextConsoleIndex, type: message.type(), text: message.text(), location: `${location.url}:${location.lineNumber}`, generation: events.generation, timestamp };
    events.console.push(record);
    retain(record, byteLength(record.type + record.text + record.location), () => events.console.splice(events.console.indexOf(record), 1));
  });
  const close = async () => {
    if (closed) return;
    closed = true;
    context.off('request', onRequest); context.off('response', onResponse); context.off('console', onConsole);
    history.clear(); states.delete(context);
  };
  registerCleanup(close);
  try { context.on('request', onRequest); context.on('response', onResponse); context.on('console', onConsole); }
  catch (error) { void close(); throw error; }
}

const consoleLevels = ['error', 'warning', 'info', 'debug'] as const;
function consoleLevel(type: string): typeof consoleLevels[number] {
  if (type === 'assert' || type === 'error') return 'error';
  if (type === 'warning') return 'warning';
  if (['clear', 'debug', 'endGroup', 'profile', 'profileEnd', 'startGroup', 'startGroupCollapsed', 'trace'].includes(type)) return 'debug';
  return 'info';
}
function includeConsole(level: typeof consoleLevels[number], message: ConsoleRecord): boolean {
  return consoleLevels.indexOf(consoleLevel(message.type)) <= consoleLevels.indexOf(level);
}
function consoleText(message: ConsoleRecord): string { return `[${message.type.toUpperCase()}] ${message.text} @ ${message.location}`; }

/** Publish new retained console entries; explicit queries read the rolling history. */
export async function flushPlaywrightConsole(context: PlaywrightContext, page: PlaywrightPage, options: {
  configuration?: PlaywrightSessionConfiguration;
  writeArtifact(bytes: Uint8Array, filename: string): Promise<void>;
}): Promise<string | undefined> {
  const state = states.get(context);
  if (!state) return;
  if (state.failure) throw state.failure;
  const events = state.pages.get(pageIdentity(page));
  if (!events) return;
  const cursor = events.nextConsoleIndex;
  const messages = events.console.filter(message => message.index > events.consoleCursor && message.index <= cursor && includeConsole(options.configuration?.console?.level ?? 'info', message));
  if (!messages.length) { events.consoleCursor = cursor; return; }
  const chunk = messages.map(message => `[${String(Math.round(message.timestamp - events.startedAt)).padStart(8, ' ')}ms] ${consoleText(message)}\n`).join('');
  const chunkBytes = new TextEncoder().encode(chunk).byteLength;
  if (chunkBytes > state.maxArtifactBytes) throw new PlaywrightResourceLimitError('Playwright console log byte limit exceeded');
  const log = events.log && new TextEncoder().encode(events.log.content).byteLength + chunkBytes <= state.maxArtifactBytes
    ? events.log : { filename: capabilityArtifactName('console', 'log', options.configuration), content: '', lines: 0 };
  const content = log.content + chunk;
  const bytes = new TextEncoder().encode(content);
  await options.writeArtifact(bytes, log.filename);
  const firstLine = log.lines + 1;
  log.content = content; log.lines += chunk.split('\n').length - 1; events.log = log; events.consoleCursor = cursor;
  return `${log.filename}#L${firstLine}${firstLine === log.lines ? '' : `-L${log.lines}`}`;
}

function observed(request: PlaywrightAbilityRequest) {
  const session = requireSession(request);
  const state = states.get(session.context);
  if (!state) unsupported('browser event observation');
  if (state.failure) throw state.failure;
  const events: PageEvents = state.pages.get(pageIdentity(requirePage(request))) ?? {
    requests: [], generation: 0, console: [], startedAt: Date.now(), nextRequestIndex: 0, nextConsoleIndex: 0, consoleCursor: 0,
  };
  return { state, events };
}

async function textResult(request: PlaywrightAbilityRequest, text: string, label: string, prefix: string) {
  const max = request.limits?.maxCommandBytes ?? 1048576;
  if (text.length > max || new TextEncoder().encode(text).length > max) throw new PlaywrightResourceLimitError('Playwright result byte limit exceeded');
  if (request.options.filename) return capabilityArtifact(request, new TextEncoder().encode(text), prefix, 'txt', label, () => '', request.options.filename as string);
  return capabilityResult('', text);
}

function headers(values: Record<string, string>): string { return Object.entries(values).map(([key, value]) => `${key}: ${value}`).join('\n'); }
function requestLine(record: RequestRecord): string {
  const response = record.response;
  const failure = record.native.failure();
  return `[${record.method.toUpperCase()}] ${record.url}${response ? ` => [${response.status}] ${response.statusText}` : failure ? ` => [FAILED] ${failure.errorText}` : ''}`;
}

const requestsAbility: PlaywrightAbility = { scope: 'session', options: 'all', async execute(request) {
  const { state, events } = observed(request);
  if (request.options.clear) {
    for (const record of [...events.requests]) state.forget(record);
    events.nextRequestIndex = 0;
    return capabilityResult('');
  }
  let matches: boolean[] | undefined;
  if (request.options.filter !== undefined) {
    const page = requirePage(request);
    if (!page.evaluate) unsupported('request filter evaluation');
    // User regular expressions run in the isolated browser, never on the host event loop.
    matches = await page.evaluate(({ pattern, urls }) => {
      const regex = new RegExp(pattern);
      return urls.map(url => regex.test(url));
    }, { pattern: request.options.filter as string, urls: events.requests.map(record => record.url) });
  }
  const lines: string[] = [];
  let hidden = 0;
  for (const [index, record] of events.requests.entries()) {
    if (!request.options.static && !['fetch', 'xhr'].includes(record.type) && record.response && record.response.status < 400) { hidden++; continue; }
    if (matches && !matches[index]) continue;
    lines.push(`${record.index}. ${requestLine(record)}`);
  }
  if (hidden) lines.push(`\nNote: ${hidden} static request${hidden === 1 ? '' : 's'} not shown, run with --static option to see ${hidden === 1 ? 'it' : 'them'}.`);
  return textResult(request, lines.join('\n'), 'Network', 'network');
} };

const requestAbility: PlaywrightAbility = { scope: 'session', options: 'all', async execute(request) {
  const { state, events } = observed(request);
  const index = numeric(request.args[0], 'request index');
  const record = Number.isSafeInteger(index) && index > 0 ? events.requests.find(record => record.index === index) : undefined;
  if (!record) throw new Error(`Request #${index} not found. Use browser_network_requests to see available indexes.`);
  if (request.command === 'request-headers') return textResult(request, headers(record.headers), 'Request headers', 'request');
  if (request.command === 'request-body') return textResult(request, record.native.postData() ?? '', 'Request body', 'request');
  const response = record.response;
  if (request.command === 'response-headers') return textResult(request, response ? headers(response.headers) : '', 'Response headers', 'response');
  if (request.command === 'response-body') {
    if (!response || response.status === 204 || response.status === 304 || response.status < 200) return capabilityResult('');
    const maximum = Math.min(state.maxArtifactBytes, request.limits?.maxArtifactBytes ?? state.maxArtifactBytes);
    const declared = response.headers['content-length'];
    if (declared !== undefined && Number(declared) > maximum) throw new PlaywrightResourceLimitError('Playwright response body byte limit exceeded');
    const data = await response.native.body();
    request.signal.throwIfAborted();
    if (data.length > maximum) throw new PlaywrightResourceLimitError('Playwright response body byte limit exceeded');
    const mime = response.headers['content-type']?.split(';')[0]?.trim() ?? '';
    if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript') || mime === 'application/x-www-form-urlencoded') return textResult(request, new TextDecoder().decode(data), 'Response body', 'response');
    const extension = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'application/pdf' ? 'pdf' : 'bin';
    return capabilityArtifact(request, data, 'response', extension, 'Response body', () => '', request.options.filename as string | undefined);
  }
  const lines = [`#${index} [${record.method.toUpperCase()}] ${record.url}`, '', '  General'];
  if (response) lines.push(`    status:    [${response.status}] ${response.statusText}`);
  else if (record.native.failure()) lines.push(`    status:    [FAILED] ${record.native.failure()!.errorText}`);
  const timing = record.native.timing?.();
  if (timing && timing.responseEnd >= 0) lines.push(`    duration:  ${Math.round(timing.responseEnd)}ms`);
  lines.push(`    type:      ${record.type}`);
  if (response?.headers['content-type']) lines.push(`    mimeType:  ${response.headers['content-type'].split(';')[0]!.trim()}`);
  for (const [label, values] of [['Request headers', record.headers], ['Response headers', response?.headers]] as const) {
    if (values && Object.keys(values).length) lines.push('', `  ${label}`, ...Object.entries(values).map(([key, value]) => `    ${key}: ${value}`));
  }
  const hints: string[] = [];
  if (record.native.postData()) hints.push(`Run \`request-body ${index}\` to read the request body.`);
  if (response && response.status >= 200 && response.status !== 204 && response.status !== 304) hints.push(`Run \`response-body ${index}\` to read the response body.`);
  if (hints.length) lines.push('', ...hints);
  return textResult(request, lines.join('\n'), 'Request', 'request');
} };

const consoleAbility: PlaywrightAbility = { scope: 'session', options: 'all', async execute(request) {
  const { state, events } = observed(request);
  if (request.options.clear) {
    for (const record of [...events.console]) state.forget(record);
    events.consoleCursor = events.nextConsoleIndex;
    delete events.log;
    return capabilityResult('');
  }
  const level = request.args[0] ?? 'info';
  if (!consoleLevels.includes(level as typeof consoleLevels[number])) throw new Error(`Invalid console level: ${level}`);
  const all = request.options.all ? events.console : events.console.filter(message => message.generation === events.generation);
  const filtered = all.filter(message => includeConsole(level as typeof consoleLevels[number], message));
  const lines = [`Total messages: ${all.length} (Errors: ${all.filter(message => message.type === 'error').length}, Warnings: ${all.filter(message => ['warning', 'warn'].includes(message.type)).length})`];
  if (filtered.length !== all.length) lines.push(`Returning ${filtered.length} messages for level "${level}"`);
  lines.push('', ...filtered.map(consoleText));
  return textResult(request, lines.join('\n'), 'Console', 'console');
} };

export const playwrightEventAbilities: Partial<Record<PlaywrightCommand, PlaywrightAbility>> = {
  requests: requestsAbility, console: consoleAbility,
  ...Object.fromEntries(['request', 'request-headers', 'request-body', 'response-headers', 'response-body'].map(command => [command, requestAbility])),
};
