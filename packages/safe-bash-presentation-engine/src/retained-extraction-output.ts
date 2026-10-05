import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSink, ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import type { RetainedPackageContext } from './retained-package.js';
import type { RetainedPackageExtraction } from './retained-package-extraction.js';
import { RetainedValues, literal } from './retained-values.js';
import { streamJson, rawJson, boundedOutput } from './retained-output.js';

/** Store manifest fragments and prefix boundaries before publication. Diagnostic
 * storage survives publication cancellation so completed files can be reported. */
export async function stageRetainedExtractionOutput(extraction: RetainedPackageExtraction, settings: RetainedPackageContext,
  output: { readonly directory: string; readonly json: boolean; readonly maxOutputBytes: number; readonly allowPartialOutput: boolean }) {
  output = { ...output };
  const working = { ...settings.workingStorage }, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || typeof working.directory !== 'string' || !working.directory.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384 || typeof output.directory !== 'string' || !output.directory || typeof output.json !== 'boolean' || typeof output.allowPartialOutput !== 'boolean' || !(output.maxOutputBytes > 0 && (output.maxOutputBytes === Infinity || Number.isSafeInteger(output.maxOutputBytes)))) throw new OfficeError('invalid-value', 'Invalid extraction output storage or options.', 'usage');
  const signal = settings.signal ?? new AbortController().signal, controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  const context = { fs: working.fs, cwd: working.directory, env: {}, signal: controller.signal };
  const pages = new PagedStorage(context, cacheBytes / 16384), offsets = new PagedStorage(context, cacheBytes / 16384);
  let closed = false, closing: Promise<void> | undefined;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Extraction output is closed.', 'publish'); controller.signal.throwIfAborted(); };
  const values = new RetainedValues(pages, check, controller.signal);
  const close = () => { closed = true; signal.removeEventListener('abort', abort); return closing ??= (async () => { const results = await Promise.allSettled([pages.close(), offsets.close()]); for (const result of results) if (result.status === 'rejected') throw result.reason; })(); };
  try {
    const start = pages.allocate(0), offsetStart = offsets.allocate(0); let length = 0, count = 0;
    const path = (name: string) => `${output.directory}${output.directory.endsWith('/') ? '' : '/'}${name}`;
    for await (const member of extraction.members()) {
      check(); if (count++) { await pages.append(new Uint8Array([44])); length++; }
      const item = await values.store(boundedOutput(streamJson({ part: member.part, name: member.name, contentType: member.contentType, sha256: member.sha256, path: path(member.name), bytes: member.size }), controller.signal, output.maxOutputBytes));
      length += item.length;
      if (!Number.isSafeInteger(length) || length > output.maxOutputBytes) throw new OfficeError('resource-limit', 'Output limit exceeded.', 'publish');
      const end = new Uint8Array(8); new DataView(end.buffer).setFloat64(0, length, true); await offsets.append(end);
    }
    async function* manifest(count: number): ByteSource {
      check(); yield* literal('[');
      if (count) { const bytes = await offsets.read(offsetStart + (count - 1) * 8, 8), end = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true); yield* values.read({ start, length: end }); }
      yield* literal(']'); check();
    }
    function data(count: number) { return { outputs: { [rawJson]: () => manifest(count) }, dryRun: false }; }
    function envelope(code?: string, published = 0, reserve = false) {
      return { version: 1, operation: 'extract', ok: !code, warnings: [], errors: code ? [{ code, message: 'Output could not be published.', context: { phase: 'publish' } }] : [], locations: [],
        affected: code && output.allowPartialOutput ? published : 0,
        data: !code || reserve ? data(count) : output.allowPartialOutput && published > 0 ? data(published) : null };
    }
    async function* render(code?: string, published = 0): ByteSource {
      if (output.json) { yield* streamJson(envelope(code, published)); yield* literal('\n'); }
      else if (!code) yield* literal(`Extracted ${count} package part(s)\n`);
      else { yield* literal(`pptx: ${code}: Output could not be published.\n`); yield* streamJson(output.allowPartialOutput && published > 0 ? data(published) : null); yield* literal('\n'); }
    }
    // Admit success and the largest diagnostic before any file can be published.
    for await (const chunk of boundedOutput(render(), signal, output.maxOutputBytes)) void chunk;
    async function* reserve() { yield* streamJson(envelope('publication-unsupported', count, true)); yield* literal('\n'); }
    for await (const chunk of boundedOutput(reserve(), signal, output.maxOutputBytes)) void chunk;
    signal.throwIfAborted(); signal.removeEventListener('abort', abort);
    return Object.freeze({ close, path, async write(sink: ByteSink, failure?: { readonly code: string; readonly published: number }) {
      check();
      if (failure && (!['cancelled', 'resource-limit', 'stale-input', 'publication-unsupported', 'io-failure'].includes(failure.code) || !Number.isSafeInteger(failure.published) || failure.published < 0 || failure.published > count)) throw new OfficeError('invalid-value', 'Invalid extraction outcome.', 'usage');
      for await (const chunk of boundedOutput(render(failure?.code, failure?.published), failure ? controller.signal : signal, output.maxOutputBytes)) await sink.write(chunk);
    } });
  } catch (error) { await close().catch(() => {}); throw error; }
}
