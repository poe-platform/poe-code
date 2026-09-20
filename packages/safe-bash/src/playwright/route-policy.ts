import type { PlaywrightPolicyRequest, PlaywrightPolicyResponse } from './network-policy.js';
import type { PlaywrightRouteHandler } from './route-capabilities.js';

export interface PlaywrightRoutePolicyHost {
  ownsRequest(request: PlaywrightPolicyRequest): boolean;
  admit(request: PlaywrightPolicyRequest): Promise<void>;
  fetch(request: PlaywrightPolicyRequest): Promise<PlaywrightPolicyResponse>;
}

export interface PlaywrightRoutePolicyLimits {
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxHeaderBytes?: number;
  readonly maxRetainedBytes?: number;
  readonly maxConcurrentRequests?: number;
  readonly maxPatternSteps?: number;
}

export interface PlaywrightRoutePolicyBinding {
  fetch(request: PlaywrightPolicyRequest): Promise<PlaywrightPolicyResponse>;
  dispose(): Promise<void>;
}

type Token = { literal: string } | { repeat: 'segment' | 'all' | 'directory' | 'optionalDirectory' };

function compilePattern(pattern: string): Token[][] {
  if (pattern.length > 4096) throw new Error('Network route pattern limit exceeded');
  let variants = [''];
  let group: string[] | undefined;
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === '\\' && index + 1 < pattern.length) {
      const escaped = character + pattern[++index]!;
      if (group) group[group.length - 1] += escaped;
      else variants = variants.map(value => value + escaped);
    } else if (character === '{') {
      if (group) throw new Error('Nested route glob groups are unsupported');
      group = [''];
    } else if (character === '}') {
      if (!group) throw new Error('Unmatched route glob group');
      if (variants.length * group.length > 256) throw new Error('Network route pattern limit exceeded');
      variants = variants.flatMap(prefix => group!.map(suffix => prefix + suffix));
      group = undefined;
    } else if (character === ',' && group) group.push('');
    else if (group) group[group.length - 1] += character;
    else variants = variants.map(value => value + character);
  }
  if (group) throw new Error('Unmatched route glob group');
  return variants.map(variant => {
    const tokens: Token[] = [];
    for (let index = 0; index < variant.length; index++) {
      const character = variant[index]!;
      if (character === '\\' && index + 1 < variant.length) tokens.push({ literal: variant[++index]! });
      else if (character === '*') {
        const before = variant[index - 1];
        let count = 1;
        while (variant[index + 1] === '*') { index++; count++; }
        if (count > 1 && variant[index + 1] === '/') {
          tokens.push({ repeat: before === '/' ? 'optionalDirectory' : 'directory' });
          index++;
        } else tokens.push({ repeat: count > 1 ? 'all' : 'segment' });
      } else tokens.push({ literal: character });
    }
    return tokens;
  });
}

function matches(tokens: Token[][], url: string, budget: { remaining: number }): boolean {
  for (const variant of tokens) {
    budget.remaining -= (variant.length + 1) * (url.length + 1);
    if (budget.remaining < 0) throw new Error('Network route matching limit exceeded');
    let next = new Uint8Array(url.length + 1);
    next[url.length] = 1;
    for (let index = variant.length - 1; index >= 0; index--) {
      const token = variant[index]!;
      const current = new Uint8Array(url.length + 1);
      const directory = new Uint8Array(url.length + 1);
      for (let offset = url.length; offset >= 0; offset--) {
        if ('literal' in token) current[offset] = Number(offset < url.length && url[offset] === token.literal && next[offset + 1] === 1);
        else {
          const character = url[offset];
          const available = character !== undefined && !['\n', '\r', '\u2028', '\u2029'].includes(character);
          if (token.repeat === 'directory' || token.repeat === 'optionalDirectory') {
            directory[offset] = Number(available && (character === '/' && next[offset + 1] === 1 || directory[offset + 1] === 1));
            current[offset] = token.repeat === 'directory' ? directory[offset]! : Number(next[offset] === 1 || available && directory[offset + 1] === 1);
          } else current[offset] = Number(next[offset] === 1 || available && (token.repeat === 'all' || character !== '/') && current[offset + 1] === 1);
        }
      }
      next = current;
    }
    if (next[0]) return true;
  }
  return false;
}

export function createPlaywrightRoutePolicyBackend(host: PlaywrightRoutePolicyHost, options: PlaywrightRoutePolicyLimits = {}) {
  if (!host || ['ownsRequest', 'admit', 'fetch'].some(key => typeof host[key as keyof PlaywrightRoutePolicyHost] !== 'function')) throw new TypeError('Invalid route policy host');
  const defaults = { maxRequestBytes: 1024 * 1024, maxResponseBytes: 8 * 1024 * 1024, maxHeaderBytes: 65536, maxRetainedBytes: 16 * 1024 * 1024, maxConcurrentRequests: 64, maxPatternSteps: 4_000_000 };
  const limits = { ...defaults, ...options };
  if (Object.entries(limits).some(([key, value]) => !Object.hasOwn(defaults, key) || !Number.isSafeInteger(value) || value < 1)) throw new TypeError('Invalid route policy limits');
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const routes = new Map<PlaywrightRouteHandler, { tokens: Token[][]; handler: PlaywrightRouteHandler; bytes: number }>();
  const work = new Set<Promise<unknown>>();
  const leases = new Set<() => Promise<void>>();
  let retained = 0, active = 0, offline = false;
  let disposal: Promise<void> | undefined;
  let releaseFailure: { reason: unknown } | undefined;
  const charge = (bytes: number) => {
    if (bytes > limits.maxRetainedBytes - retained) throw new Error('Network retained byte limit exceeded');
    retained += bytes;
  };
  const textBytes = (value: string, maximum = limits.maxHeaderBytes) => {
    if (typeof value !== 'string' || value.length > maximum) throw new Error('Network text byte limit exceeded');
    const bytes = encoder.encode(value).byteLength;
    if (bytes > maximum) throw new Error('Network text byte limit exceeded');
    return bytes;
  };
  const headersCopy = (headers: PlaywrightPolicyRequest['headers']) => {
    if (!Array.isArray(headers) || headers.length > 1024) throw new Error('Network header limit exceeded');
    let bytes = 0;
    const copy = headers.map(({ name, value }) => {
      bytes += textBytes(name) + textBytes(value);
      if (bytes > limits.maxHeaderBytes) throw new Error('Network header byte limit exceeded');
      new Headers([[name, value]]);
      return Object.freeze({ name, value });
    });
    return { bytes, copy: Object.freeze(copy) };
  };
  const check = (request: PlaywrightPolicyRequest) => {
    request.signal.throwIfAborted();
    controller.signal.throwIfAborted();
    if (host.ownsRequest(request) !== true) throw new Error('Network request does not belong to bound context');
  };
  const fetch = (input: PlaywrightPolicyRequest): Promise<PlaywrightPolicyResponse> => {
    const operation = (async () => {
      check(input);
      if (active >= limits.maxConcurrentRequests) throw new Error('Network concurrent request limit exceeded');
      active++;
      let held = 0;
      let downstream: (() => void | Promise<void>) | undefined;
      let releasing: Promise<void> | undefined;
      const reserve = (bytes: number) => { charge(bytes); held += bytes; };
      const release = () => releasing ??= (async () => {
        try { await downstream?.(); }
        catch (reason) { releaseFailure ??= { reason }; controller.abort(reason); throw reason; }
        finally { retained -= held; held = 0; active--; leases.delete(release); }
      })();
      try {
        if (!['http:', 'https:'].includes(new URL(input.url).protocol)) throw new Error('Unsupported browser network protocol');
        const headers = headersCopy(input.headers);
        if (input.body !== undefined && (!(input.body instanceof Uint8Array) || input.body.byteLength > limits.maxRequestBytes)) throw new Error('Network request body limit exceeded');
        reserve(headers.bytes + (input.body?.byteLength ?? 0) + [input.url, input.method, input.targetId, input.frameId, input.requestId, input.resourceType].reduce((total, value) => total + textBytes(value), 0));
        let candidate: PlaywrightPolicyRequest = Object.freeze({ ...input, headers: headers.copy, signal: AbortSignal.any([input.signal, controller.signal]), ...(input.body === undefined ? {} : { body: new Uint8Array(input.body) }) });
        await host.admit(candidate);
        check(candidate);
        const budget = { remaining: limits.maxPatternSteps };
        const route = [...routes.values()].reverse().find(entry => matches(entry.tokens, candidate.url, budget));
        let response: PlaywrightPolicyResponse | undefined;
        let handled = false;
        const forward = async () => {
          if (offline) throw new Error('Network is offline');
          response = await host.fetch(candidate);
          if (response.release !== undefined) {
            if (typeof response.release !== 'function') throw new Error('Invalid network response release');
            const owned = response;
            downstream = () => owned.release!();
          }
        };
        if (route) {
          reserve(route.bytes);
          await route.handler({
            request: () => ({ headers: () => Object.fromEntries(candidate.headers.map(({ name, value }) => [name.toLowerCase(), value])) }),
            async fulfill(options) {
              if (handled) throw new Error('Network route already handled');
              handled = true;
              const body = options.body ?? '';
              textBytes(body, limits.maxResponseBytes);
              response = { status: options.status, headers: [{ name: 'content-type', value: options.contentType ?? 'text/plain' }], body: encoder.encode(body) };
            },
            async continue(options) {
              if (handled) throw new Error('Network route already handled');
              handled = true;
              const rewritten = headersCopy(Object.entries(options.headers).map(([name, value]) => ({ name, value })));
              reserve(rewritten.bytes);
              candidate = Object.freeze({ ...candidate, headers: rewritten.copy });
              await host.admit(candidate);
              check(candidate);
              await forward();
            },
          });
        } else await forward();
        check(candidate);
        if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status > 599 || !(response.body instanceof Uint8Array) || response.body.byteLength > limits.maxResponseBytes) throw new Error('Network response status or body limit exceeded');
        const responseHeaders = headersCopy(response.headers);
        reserve(responseHeaders.bytes + response.body.byteLength);
        leases.add(release);
        return { status: response.status, headers: responseHeaders.copy, body: new Uint8Array(response.body), release };
      } catch (error) {
        try { await release(); }
        finally { input.signal.throwIfAborted(); controller.signal.throwIfAborted(); }
        throw error;
      }
    })();
    work.add(operation);
    void operation.then(() => work.delete(operation), () => work.delete(operation));
    return operation;
  };
  return {
    fetch,
    add(pattern: string, handler: PlaywrightRouteHandler, bytes: number) {
      controller.signal.throwIfAborted();
      if (routes.size >= 64 || routes.has(handler)) throw new Error('Network route count limit exceeded');
      charge(bytes);
      try {
        const tokens = compilePattern(pattern);
        const tokenBytes = tokens.reduce((total, variant) => total + variant.length * 16, 0);
        charge(tokenBytes);
        routes.set(handler, { tokens, handler, bytes: bytes + tokenBytes });
      } catch (error) { retained -= bytes; throw error; }
    },
    remove(handler: PlaywrightRouteHandler) {
      const route = routes.get(handler);
      if (route) { retained -= route.bytes; routes.delete(handler); }
    },
    setOffline(value: boolean) { controller.signal.throwIfAborted(); offline = value; },
    dispose() {
      return disposal ??= (async () => {
        controller.abort(new Error('Network route policy disposed'));
        await Promise.allSettled([...work]);
        await Promise.allSettled([...leases].map(release => release()));
        for (const route of routes.values()) retained -= route.bytes;
        routes.clear();
        if (releaseFailure) throw releaseFailure.reason;
      })();
    },
  };
}
