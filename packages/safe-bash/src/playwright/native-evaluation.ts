import type { PlaywrightAbilityRequest } from './abilities.js';
import { capabilityAction, requirePage, requireSession } from './capability-result.js';
import { playwrightLocatorSelector } from './locator-selector.js';
import { isPlaywrightSnapshotRef } from './targets.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';

export interface NativeEvaluationValue {
  readonly status: 'value' | 'error';
  readonly text: string;
  readonly isFunction: boolean;
  readonly executed: boolean;
  readonly rawErrorHeader?: boolean;
}

interface Capsule { readonly result?: unknown; readonly failed?: boolean; readonly error?: unknown; readonly isFunction: boolean }
interface Serialized { readonly status: 'value' | 'error' | 'limit'; readonly text: string; readonly isFunction: boolean; readonly executed: boolean }
interface NativeHandle {
  evaluate<Result, Input>(callback: (capsule: Capsule, input: Input) => Result, input: Input): Promise<Result>;
  dispose(): Promise<void>;
}
interface NativeEvaluator {
  evaluateHandle(callback: (expression: string) => Promise<Capsule>, expression: string): Promise<NativeHandle>;
}
interface NativeElementEvaluator {
  evaluateHandle(callback: (element: unknown, expression: string) => Promise<Capsule>, expression: string, options?: { timeout: number }): Promise<NativeHandle>;
}

async function evaluatePage(expression: string): Promise<Capsule> {
  'use strict';
  try {
    const value: unknown = (0, eval)(`(${expression})`);
    const isFunction = typeof value === 'function';
    const result: unknown = await (isFunction ? value() : value);
    return { result, isFunction };
  } catch (error) { return { failed: true, error, isFunction: false }; }
}

async function evaluateElement(element: unknown, expression: string): Promise<Capsule> {
  'use strict';
  try {
    const value: unknown = (0, eval)(`(${expression})`);
    const isFunction = typeof value === 'function';
    const result: unknown = await (isFunction ? value(element) : value);
    return { result, isFunction };
  } catch (error) { return { failed: true, error, isFunction: false }; }
}

function serializeCapsule(capsule: Capsule, limits: { maxBytes: number; maxEntries: number }): Serialized {
  'use strict';
  const stringify = JSON.stringify;
  const objectKeys = Object.keys;
  const globals = globalThis as unknown as { Window?: new () => object; Document?: new () => object; Node?: new () => object };
  const seen = new Map<object, unknown>();
  let entries = 0;
  let characters = 0;
  let exceeded = false;
  const operations = {
    normalize(value: unknown, depth = 0): unknown {
      if (++entries > limits.maxEntries || depth > 100) { exceeded = true; throw null; }
      if (typeof value === 'string') {
        characters += value.length;
        if (characters > limits.maxBytes) { exceeded = true; throw null; }
        return value;
      }
      if (typeof value === 'function' || typeof value === 'symbol') return undefined;
      if (value === null || typeof value !== 'object') return value;
      if (seen.has(value)) return seen.get(value);
      if (typeof globals.Window === 'function' && value instanceof globals.Window) return 'ref: <Window>';
      if (typeof globals.Document === 'function' && value instanceof globals.Document) return 'ref: <Document>';
      if (typeof globals.Node === 'function' && value instanceof globals.Node) return 'ref: <Node>';
      if (value instanceof Date) return new Date(value.toJSON() ?? 0);
      if (typeof URL !== 'undefined' && value instanceof URL) return new URL(value.href);
      if (value instanceof RegExp || value instanceof ArrayBuffer) return {};
      if (value instanceof Error) return { name: this.normalize(value.name, depth + 1) };
      if (Array.isArray(value)) {
        if (value.length > limits.maxEntries - entries) { exceeded = true; throw null; }
        const array: unknown[] = [];
        seen.set(value, array);
        for (let index = 0; index < value.length; index++) array.push(this.normalize(value[index], depth + 1));
        return array;
      }
      const object: Record<string, unknown> = {};
      seen.set(value, object);
      const keys = objectKeys(value);
      if (keys.length > limits.maxEntries - entries) { exceeded = true; throw null; }
      for (const key of keys) {
        let child: unknown;
        try { child = (value as Record<string, unknown>)[key]; } catch { continue; }
        characters += key.length;
        if (characters > limits.maxBytes) { exceeded = true; throw null; }
        if (key === '__proto__') continue;
        object[key] = key === 'toJSON' && typeof child === 'function' ? {} : this.normalize(child, depth + 1);
      }
      let wrapper: { value: unknown } | undefined;
      try {
        const jsonValue = (value as { toJSON?: () => unknown }).toJSON;
        if (objectKeys(object).length === 0 && typeof jsonValue === 'function') wrapper = { value: jsonValue.call(value) };
      } catch {}
      if (wrapper) return this.normalize(wrapper.value, depth + 1);
      return object;
    },
  };
  let status: Serialized['status'] = capsule.failed ? 'error' : 'value';
  let text: unknown;
  try {
    if (capsule.failed) {
      const error = capsule.error;
      text = error instanceof Error ? error.stack ?? `${error.name}: ${error.message}` : String(error);
    } else text = stringify(operations.normalize(capsule.result), null, 2) ?? 'undefined';
  } catch (error) {
    status = 'error';
    text = exceeded ? '' : error instanceof Error ? error.message : String(error);
  }
  if (exceeded || typeof text !== 'string' || text.length > limits.maxBytes) return { status: 'limit', text: 'Evaluation result byte/entry limit exceeded', isFunction: capsule.isFunction, executed: !capsule.failed };
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character <= '\u007f') bytes++;
    else if (character <= '\u07ff') bytes += 2;
    else if (character >= '\ud800' && character <= '\udbff' && text[index + 1]! >= '\udc00' && text[index + 1]! <= '\udfff') { bytes += 4; index++; }
    else bytes += 3;
    if (bytes > limits.maxBytes) return { status: 'limit', text: 'Evaluation result byte limit exceeded', isFunction: capsule.isFunction, executed: !capsule.failed };
  }
  return { status, text, isFunction: capsule.isFunction, executed: !capsule.failed };
}

export async function evaluateNativeExpression(request: PlaywrightAbilityRequest): Promise<NativeEvaluationValue | undefined> {
  request.signal.throwIfAborted();
  const maxInputBytes = Math.min(65_536, request.limits?.maxCommandBytes ?? 1048576);
  const maxBytes = Math.min(1048576, request.limits?.maxCommandBytes ?? 1048576, request.options.filename ? request.limits?.maxArtifactBytes ?? 1048576 : 1048576);
  let inputBytes = 0;
  for (const input of [...request.args, ...(typeof request.options.filename === 'string' ? [request.options.filename] : [])]) {
    if (typeof input !== 'string' || input.length > maxInputBytes - inputBytes) throw new PlaywrightResourceLimitError('Evaluation input byte limit exceeded');
    inputBytes += new TextEncoder().encode(input).byteLength;
    if (inputBytes > maxInputBytes) throw new PlaywrightResourceLimitError('Evaluation input byte limit exceeded');
  }
  if (request.args.length < 1 || request.args.length > 2) throw new Error('Invalid eval arguments');
  const session = requireSession(request);
  let accepting = true;
  let active = false;
  let handle: NativeHandle | undefined;
  let cleanup: Promise<void> | undefined;
  const pending: Promise<unknown>[] = [];
  const drain = () => {
    accepting = false;
    cleanup ??= Promise.allSettled(pending).then(async () => { await handle?.dispose(); });
    return cleanup;
  };
  request.registerCleanup(() => active && session.runAction ? Promise.resolve() : drain());
  const call = async <Result>(action: () => Promise<Result>): Promise<Result> => {
    request.signal.throwIfAborted();
    if (!accepting) throw new Error('Evaluation invocation has finished');
    const operation = Promise.resolve().then(() => { request.signal.throwIfAborted(); return action(); });
    pending.push(operation);
    const result = await operation;
    request.signal.throwIfAborted();
    if (!accepting) throw new Error('Evaluation invocation has finished');
    return result;
  };
  let value: NativeEvaluationValue | undefined;
  await capabilityAction(request, async () => {
    active = true;
    const evaluate = async (): Promise<NativeEvaluationValue> => {
      const page = requirePage(request);
      if (!session.context.pages().includes(page)) throw new Error('Page does not belong to this session');
      const expression = request.args[0]!;
      const target = request.args[1];
      if (target !== undefined) {
        if (!isPlaywrightSnapshotRef(target)) {
          const locator = page.locator(playwrightLocatorSelector(page, target)) as unknown as { count(): Promise<number> };
          if (typeof locator.count !== 'function') throw new Error('Native selector count is required for eval');
          if (await call(() => locator.count()) === 0) {
            const text = 'Error: ' + JSON.stringify(target) + ' does not match any elements.';
            if (text.length > maxBytes || new TextEncoder().encode(text).byteLength > maxBytes) throw new PlaywrightResourceLimitError('Evaluation result byte limit exceeded');
            return { status: 'error', text, executed: false, isFunction: false, rawErrorHeader: true };
          }
        }
        const element = await call(() => session.resolveTarget(target)) as unknown as NativeElementEvaluator;
        if (typeof element.evaluateHandle !== 'function') throw new Error('Native element evaluateHandle is required for eval');
        await call(async () => { handle = await element.evaluateHandle(evaluateElement, expression); });
      } else {
        const evaluator = page as unknown as NativeEvaluator;
        if (typeof evaluator.evaluateHandle !== 'function') throw new Error('Native page evaluateHandle is required for eval');
        await call(async () => { handle = await evaluator.evaluateHandle(evaluatePage, expression); });
      }
      const result = await call(() => handle!.evaluate(serializeCapsule, { maxBytes, maxEntries: 10000 }));
      if (!result || typeof result.text !== 'string' || typeof result.isFunction !== 'boolean' || typeof result.executed !== 'boolean' || !['value', 'error', 'limit'].includes(result.status)) throw new Error('Invalid native evaluation envelope');
      if (result.status === 'limit' || result.text.length > maxBytes || new TextEncoder().encode(result.text).byteLength > maxBytes) throw new PlaywrightResourceLimitError('Evaluation result byte/entry limit exceeded');
      return { status: result.status, text: result.text, isFunction: result.isFunction, executed: result.executed };
    };
    const result = await evaluate().then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }));
    const retired = await drain().then(() => ({ status: 'fulfilled' as const }), reason => ({ status: 'rejected' as const, reason }));
    active = false;
    if (result.status === 'rejected' && retired.status === 'rejected') throw new AggregateError([result.reason, retired.reason], 'Native evaluation and cleanup failed');
    if (retired.status === 'rejected') throw retired.reason;
    if (result.status === 'rejected') throw result.reason;
    value = result.value;
  });
  return value;
}
