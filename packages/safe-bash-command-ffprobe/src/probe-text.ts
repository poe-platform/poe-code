import type { MediaProbeText } from '@poe-code/mp4-ast';
import { yieldTurn } from 'safe-bash-contracts/yield';

export type ProbeTextStep = { text: MediaProbeText; mode: 'json' | 'plain' | 'flat' | 'csv' | 'compact' | 'ini' | 'xml'; separator?: string };
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
  yield array ? (compact ? '[\n' : '[') : (compact ? '{ ' : '{');
  let first = true;
  for (const [key, item] of entries()) {
    if (compact) {
      // Native JSON keeps scalar fields inline, but starts child sections on new lines.
      const section = item !== null && typeof item === 'object' && !isProbeText(item);
      yield (first ? '' : array || section ? ',\n' : ', ') +
        (array || section ? '    '.repeat(depth + 1) : '');
    } else yield (first ? '' : ',') + '\n' + '  '.repeat(depth + 1);
    first = false;
    if (!array) yield JSON.stringify(key) + ': ';
    yield* probeJsonSteps(item, compact, depth + 1);
  }
  if (compact) yield array ? '\n' + '    '.repeat(depth) : ' ';
  else if (!first) yield '\n' + '  '.repeat(depth);
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
    if (step.mode === 'xml') { yield escapeXml(chunk); continue; }
    if (step.mode === 'ini') { yield escapeIni(chunk); continue; }
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

export function escapeIni(text: string): string {
  let escaped = "";
  for (const character of text) {
    const control = "\b\f\n\r\t".indexOf(character);
    if (control >= 0) escaped += "\\" + "bfnrt"[control];
    else if (character.charCodeAt(0) < 32) escaped += "\\x" + character.charCodeAt(0).toString(16).padStart(4, "0");
    else if ("\\=#:".includes(character)) escaped += "\\" + character;
    else escaped += character;
  }
  return escaped;
}

export function* iniSection(row: Record<string, unknown>, path: string, nested = false): Generator<ProbeOutputPart> {
  yield `${nested ? "" : "\n"}[${path}]\n`;
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    if (value && typeof value === "object" && !isProbeText(value)) continue;
    yield escapeIni(key) + "=";
    yield isProbeText(value) ? { text: value, mode: "ini" } : escapeIni(String(value));
    yield "\n";
  }
  for (const [key, value] of Object.entries(row)) {
    if (value && typeof value === "object" && !isProbeText(value))
      yield* iniSection(value as Record<string, unknown>, `${path}.${key}`, true);
  }
}

/** Format seconds only; integer ticks and nested metadata retain their original values. */
export function sexagesimalRow<T extends Record<string, unknown>>(row: T, section: string): T {
  const result = { ...row };
  for (const [key, value] of Object.entries(row)) {
    if (!(key.endsWith("_time") || key === "duration" && ["stream", "format"].includes(section))) continue;
    if (typeof value !== "string" || value === "" || !Number.isFinite(Number(value))) continue;
    const seconds = Number(value), micros = Math.round(Math.abs(seconds) * 1_000_000);
    const hours = Math.floor(micros / 3_600_000_000);
    const minutes = Math.floor(micros / 60_000_000) % 60;
    const remainder = ((micros % 60_000_000) / 1_000_000).toFixed(6).padStart(9, "0");
    Object.assign(result, { [key]: `${seconds < 0 ? "-" : ""}${hours}:${String(minutes).padStart(2, "0")}:${remainder}` });
  }
  return result;
}

export function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function* xmlSection(row: Record<string, unknown>, name: string, depth: number): Generator<ProbeOutputPart> {
  const indent = "    ".repeat(depth);
  yield `${indent}<${name} `;
  let firstAttribute = true;
  const children: [string, unknown][] = [];
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === "object" && !isProbeText(value)) {
      if (key !== "tags" || Object.keys(value).length) children.push([key, value]);
      continue;
    }
    yield `${firstAttribute ? "" : " "}${key}="`;
    firstAttribute = false;
    yield isProbeText(value) ? { text: value, mode: "xml" } : escapeXml(String(value));
    yield '"';
  }
  if (!children.length) { yield "/>\n"; return; }
  yield ">\n";
  for (const [key, value] of children) {
    if (key === "tags") {
      yield `${indent}    <tags>\n`;
      for (const [tag, text] of Object.entries(value as Record<string, unknown>))
        yield* xmlSection({ key: tag, value: text }, "tag", depth + 2);
      yield `${indent}    </tags>\n`;
    } else if (Array.isArray(value)) {
      yield `${indent}    <${key}>\n`;
      for (const item of value) yield* xmlSection(item as Record<string, unknown>, key === "streams" ? "stream" : key.endsWith("_list") ? key.slice(0, -5) : key, depth + 2);
      yield `${indent}    </${key}>\n`;
    } else yield* xmlSection(value as Record<string, unknown>, key, depth + 1);
  }
  yield `${indent}</${name}>\n`;
}
