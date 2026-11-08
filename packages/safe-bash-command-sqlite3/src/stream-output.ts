import {yieldTurn} from "safe-bash-contracts/yield";
import {resolvePath} from '@poe-code/safe-fs/core';
import {FsError, type CommandContext, type FileStaging} from 'safe-bash-contracts';
import {writeFileOutput} from 'safe-bash-contracts/filesystem-output-budget';
import {openFileOutput} from 'safe-bash-contracts/filesystem-output';
import type {SqlValue} from './engine.js';

export async function* encodeOutput(parts: Iterable<string> | AsyncIterable<string>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  let high = '', steps = 0;
  for await (const part of parts) {
    signal?.throwIfAborted();
    if (signal && ++steps % 256 === 0) await yieldTurn(signal);
    for (let offset = 0; offset < part.length; offset += 4096) {
      let value = high + part.slice(offset, offset + 4096); high = '';
      const last = value.charCodeAt(value.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) { high = value.at(-1)!; value = value.slice(0, -1); }
      if (value) yield encoder.encode(value);
    }
  }
  if (high) yield encoder.encode(high);
}

export function* sqlQuoteParts(value: SqlValue, newlines = true): Generator<string> {
  if (typeof value === 'string' || value instanceof String) {
    const text = String(value), zero = text.indexOf('\0'), end = zero < 0 ? text.length : zero;
    const escapes = new Map<string, string>();
    if (!newlines) {
      const literal = text.slice(0, end);
      for (const [character, preferred, fallback] of [["\n", "\\n", "\\012"], ["\r", "\\r", "\\015"]] as const) {
        if (!literal.includes(character)) continue;
        let marker: string = preferred;
        if (literal.includes(marker)) {
          marker = fallback;
          for (let i = 0; literal.includes(marker); i++) marker = `(${preferred}${i})`;
        }
        escapes.set(character, marker);
        yield "replace(";
      }
    }
    yield "'";
    for (let offset = 0; offset < end; offset += 4096) {
      let chunk = text.slice(offset, Math.min(end, offset + 4096)).replaceAll("'", "''");
      for (const [character, marker] of escapes) chunk = chunk.replaceAll(character, marker);
      yield chunk;
    }
    yield "'";
    for (const [character, marker] of [...escapes].reverse()) yield `,'${marker}',char(${character.charCodeAt(0)}))`;
  } else if (value instanceof Uint8Array) {
    yield "X'";
    for (let offset = 0; offset < value.length; offset += 4096) {
      let text = '';
      for (const byte of value.subarray(offset, offset + 4096)) text += byte.toString(16).padStart(2, '0');
      yield text;
    }
    yield "'";
  } else yield formatSqlQuote(value);
}

export async function publishSqliteOutput(context: CommandContext, path: string, chunks: AsyncIterable<Uint8Array>, append = false): Promise<void> {
  if (append) {
    const output = await openFileOutput(context, path, {flag: 'a', descriptor: true});
    try { for await (const bytes of chunks) await output.sink.write(bytes); await output.finish(); }
    catch (error) { await output.abort(error).catch(() => {}); throw error; }
    return;
  }
  const {fs, signal} = context;
  const capabilities = await fs.capabilitiesFor?.(path, {signal, stagingResolution: true, followFinalSymlink: true}) ?? fs.capabilities;
  if (!capabilities.atomicFileStaging || !capabilities.retainedStagingWrite || !capabilities.retainedStagingCleanup || !capabilities.atomicStagingAncestry || !capabilities.atomicStagedFileMutation || !capabilities.synchronousFollowedStagingResolution || !capabilities.guardedStagingPublication
    || !fs.prepareStagingResolution || !fs.createStagedFile || !fs.publishStagedFile || !fs.removeStagedFile)
    throw new FsError('ENOTSUP', {path, message: 'SQLite output requires retained atomic staging'});
  const resolution = await fs.prepareStagingResolution(path, {signal, followFinalSymlink: true});
  if (resolution.destination && resolution.destination.type !== 'file') throw new FsError('EISDIR', {path});
  let staging: FileStaging | undefined, failed = true;
  try {
    staging = await fs.createStagedFile(`${resolvePath(resolution.path, '..')}/.sqlite-output-${crypto.randomUUID()}`, 'output', {type: 'file', data: new Uint8Array()},
      {parent: resolution.parent, retainCleanup: true, mode: resolution.destination ? resolution.destination.mode & 0o7777 : 0o666, signal});
    if (!staging.writer || !staging.cleanup) throw new FsError('ENOTSUP', {path, message: 'SQLite output requires retained staging handles'});
    for await (const bytes of chunks) await writeFileOutput(context, bytes, data => staging!.writer!.write(data, {signal}));
    const stat = await staging.writer.finish({signal}); signal.throwIfAborted();
    await fs.publishStagedFile({...staging, file: {...staging.file, stat}}, resolution.path,
      {parent: resolution.parent, destination: resolution.destination, ancestors: resolution.ancestors, commitGuard: resolution.validate, preserveIdentity: resolution.destination !== null, signal});
    failed = false;
  } finally {
    let failure: {error: unknown} | undefined;
    if (staging?.cleanup) {
      try { await staging.cleanup.remove(); } catch (error) { failure = {error}; }
      try { await staging.cleanup.close(); } catch (error) { failure ??= {error}; }
    } else if (staging) {
      try { await fs.removeStagedFile(staging); } catch (error) { failure = {error}; }
    }
    if (!failed && failure) await Promise.reject(failure.error);
  }
}

export function formatSqlQuote(v: SqlValue): string {
  if (v === null || v === undefined) {
    return "NULL";
  }
  if (typeof v === "bigint") {
    return v.toString();
  }
  if (v instanceof Number) {
    const n = v.valueOf();
    const text = String(n);
    return Number.isFinite(n) && Number.isInteger(n) && !text.includes("e") ? `${text}.0` : text;
  }
  if (typeof v === "number") {
    return String(v);
  }
  if (typeof v === "string" || v instanceof String) {
    return `'${String(v).replace(/'/g, "''")}'`;
  }
  let hex = "";
  for (const b of v) {
    hex += b.toString(16).toUpperCase().padStart(2, "0");
  }
  return `X'${hex}'`;
}

