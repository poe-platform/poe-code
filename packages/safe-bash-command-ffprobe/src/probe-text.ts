import type { MediaProbeText } from '@poe-code/mp4-ast';
import { yieldTurn } from 'safe-bash-contracts/yield';

export type ProbeTextStep = { text: MediaProbeText; mode: 'json' | 'plain' | 'flat' | 'csv' | 'compact'; separator?: string };
export type ProbeOutputPart = string | ProbeTextStep;
export function isProbeText(value: unknown): value is MediaProbeText {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'text' && 'chunks' in value && typeof value.chunks === 'function';
}

/** Scalar rows stay small; text fields are yielded as replayable source tokens. */
export function* probeJsonSteps(value: unknown, compact: boolean, depth: number): Generator<ProbeOutputPart> {
  if (isProbeText(value)) { yield { text: value, mode: 'json' }; return; }
  if (value === null || typeof value !== 'object') { yield JSON.stringify(value) ?? 'null'; return; }
  if ('toJSON' in value && typeof value.toJSON === 'function' || value instanceof Number || value instanceof String || value instanceof Boolean) {
    const text = JSON.stringify(value, null, compact ? undefined : 2) ?? 'null';
    yield compact ? text : text.replaceAll('\n', '\n' + '  '.repeat(depth)); return;
  }
  const array = Array.isArray(value);
  function* entries(): Generator<readonly [string, unknown]> {
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) yield [String(i), value[i]]; }
    else for (const key of Object.keys(value as object)) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined && typeof item !== 'function' && typeof item !== 'symbol') yield [key, item];
    }
  }
  yield array ? '[' : '{';
  let first = true;
  for (const [key, item] of entries()) {
    yield (first ? '' : ',') + (compact ? '' : '\n' + '  '.repeat(depth + 1)); first = false;
    if (!array) yield JSON.stringify(key) + (compact ? ':' : ': ');
    yield* probeJsonSteps(item, compact, depth + 1);
  }
  if (!first && !compact) yield '\n' + '  '.repeat(depth);
  yield array ? ']' : '}';
}

/** Own iterator retirement, including rejecting next() calls and early CSV preflight. */
async function* textChunks(text: MediaProbeText, signal?: AbortSignal): AsyncGenerator<string> {
  signal?.throwIfAborted();
  const source = text.chunks(), iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
  let ended = false, failed = false, pending = '', steps = 0;
  try {
    for (;;) {
      signal?.throwIfAborted(); const next = await iterator.next(); signal?.throwIfAborted();
      if (next.done) { ended = true; if (pending) yield pending; break; }
      const value = pending + next.value; pending = '';
      let end = value.length;
      if (end && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) pending = value[--end]!;
      for (let start = 0; start < end;) {
        let stop = Math.min(end, start + 1024);
        if (stop < end && value.charCodeAt(stop - 1) >= 0xd800 && value.charCodeAt(stop - 1) <= 0xdbff && value.charCodeAt(stop) >= 0xdc00 && value.charCodeAt(stop) <= 0xdfff) stop--;
        signal?.throwIfAborted(); yield value.slice(start, stop); start = stop;
        if (++steps % 256 === 0) await yieldTurn(signal);
      }
      if (++steps % 256 === 0) await yieldTurn(signal);
    }
  } catch (error) { failed = true; throw error; }
  finally {
    if (!ended) {
      if (failed) { try { await iterator.return?.(); } catch { /* Preserve the read/cancellation failure. */ } }
      else await iterator.return?.();
    }
  }
}

export async function* formatProbeText(step: ProbeTextStep, signal?: AbortSignal): AsyncGenerator<string> {
  const separator = step.separator ?? '.', quoted = step.mode === 'flat' || step.mode === 'json';
  let csvQuoted = step.mode === 'csv' && separator === '';
  if (step.mode === 'csv') {
    let tail = '';
    for await (const chunk of textChunks(step.text, signal)) {
      const text = tail + chunk;
      if ([separator, '"', '\n', '\r'].some(character => text.includes(character))) { csvQuoted = true; break; }
      tail = separator.length > 1 ? text.slice(-(separator.length - 1)) : '';
    }
  }
  if (quoted || csvQuoted) yield '"';
  for await (const chunk of textChunks(step.text, signal)) {
    if (step.mode === 'plain') { yield chunk; continue; }
    if (step.mode === 'json') { yield JSON.stringify(chunk).slice(1, -1); continue; }
    if (step.mode === 'csv') { yield chunk.replaceAll('"', '""'); continue; }
    let escaped = '';
    for (const character of chunk) {
      if (character === '\n') escaped += '\\n';
      else if (character === '\r') escaped += '\\r';
      else if (character === '\\' || (step.mode === 'flat' ? character === '"' : character === separator)) escaped += '\\' + character;
      else escaped += character;
    }
    yield escaped;
  }
  if (quoted || csvQuoted) yield '"';
}
