import type { PlaywrightArtifactCapture, PlaywrightDownloadCapture, PlaywrightContext, PlaywrightDownload, PlaywrightPage } from './adapter.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';
import { capabilityOutputPath, unsupported } from './capability-result.js';
import type { PlaywrightSessionConfiguration } from './session-configuration.js';

interface DownloadEntry { native: PlaywrightDownload; filename: string; capture?: Promise<Uint8Array>; retirement?: Promise<void> }
interface DownloadState { queues: Map<object, DownloadEntry[]>; all: Set<DownloadEntry>; failure?: Error; closed: boolean; collecting: Set<object> }
const pages = new WeakMap<object, DownloadState>();
const contexts = new WeakSet<PlaywrightContext>();
let sequence = 0;
function identity(page: PlaywrightPage): object { return page.mainFrame?.() ?? page; }

function retire(entry: DownloadEntry, cancel: boolean): Promise<void> {
  entry.retirement ??= (async () => {
    const failures: unknown[] = [];
    if (cancel) { try { await entry.native.cancel(); } catch (error) { failures.push(error); } }
    await entry.capture?.catch(() => {});
    try { await entry.native.delete(); } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Native download cleanup failed');
  })();
  return entry.retirement;
}

export function observePlaywrightDownloads(context: PlaywrightContext, registerCleanup: (cleanup: () => Promise<void>) => void,
  limits: { maxCount?: number; maxMetadataBytes?: number } = {}): void {
  if (contexts.has(context)) return;
  contexts.add(context);
  const state: DownloadState = { queues: new Map(), all: new Set(), closed: false, collecting: new Set() };
  const attached = new Map<object, { page: PlaywrightPage; listener: (download: PlaywrightDownload) => void }>();
  let count = 0, metadata = 0;
  const attach = (page: PlaywrightPage) => {
    const key = identity(page);
    if (state.closed || state.failure || attached.has(key)) return;
    const listener = (native: PlaywrightDownload) => {
      const entry: DownloadEntry = { native, filename: '' };
      state.all.add(entry);
      try {
        const suggestion = native.suggestedFilename();
        metadata += new TextEncoder().encode(suggestion).byteLength;
        if (state.closed || state.failure || ++count > (limits.maxCount ?? 128) || metadata > (limits.maxMetadataBytes ?? 1048576)) throw new PlaywrightResourceLimitError('Playwright download retention limit exceeded');
        const basename = suggestion.replaceAll('\\', '/').split('/').at(-1) ?? '';
        const safe = [...basename].map(character => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-'.includes(character) ? character : '_').join('');
        entry.filename = `download-${Date.now()}-${++sequence}-${safe && safe !== '.' && safe !== '..' ? safe : 'download.bin'}`;
        const queue = state.queues.get(key) ?? [];
        queue.push(entry); state.queues.set(key, queue);
      } catch (error) {
        state.failure ??= error instanceof Error ? error : new Error(String(error));
        context.off('page', attach);
        for (const { page, listener } of attached.values()) page.off?.('download', listener);
        void retire(entry, true).catch(() => {});
      }
    };
    attached.set(key, { page, listener }); pages.set(key, state);
    page.on?.('download', listener);
  };
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    state.closed = true;
    context.off('page', attach);
    for (const [key, { page, listener }] of attached) { page.off?.('download', listener); pages.delete(key); }
    closing = (async () => {
      const outcomes = await Promise.allSettled([...state.all].map(entry => retire(entry, true)));
      state.all.clear(); state.queues.clear(); attached.clear(); contexts.delete(context);
      const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected').map(outcome => outcome.reason as unknown);
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, 'Native download observer cleanup failed');
    })();
    return closing;
  };
  registerCleanup(close);
  try { context.on('page', attach); for (const page of context.pages()) attach(page); }
  catch (error) { void close().catch(() => {}); throw error; }
}

export async function collectPlaywrightDownloads(page: PlaywrightPage, captureArtifact: PlaywrightArtifactCapture | undefined,
  options: { signal: AbortSignal; maxBytes: number; configuration?: PlaywrightSessionConfiguration }, captureDownload?: PlaywrightDownloadCapture): Promise<{ filename: string; bytes: Uint8Array }[]> {
  options.signal.throwIfAborted();
  const key = identity(page), state = pages.get(key);
  if (!state || state.closed) return [];
  if (state.failure) throw state.failure;
  const queue = state.queues.get(key);
  if (!queue?.length) return [];
  if (state.collecting.has(key)) throw new Error('Download collection is already in progress');
  state.collecting.add(key);
  let remaining = options.maxBytes;
  const results: { filename: string; bytes: Uint8Array }[] = [];
  try {
    for (const entry of [...queue]) {
      try {
        options.signal.throwIfAborted();
        if (remaining <= 0) throw new PlaywrightResourceLimitError('Playwright download byte limit exceeded');
        if (!captureDownload && !captureArtifact) unsupported('download artifact capture');
        entry.capture = captureDownload
          ? captureDownload(entry.native, { signal: options.signal, maxBytes: remaining })
          : captureArtifact!(path => entry.native.saveAs(path), { signal: options.signal, maxBytes: remaining, extension: 'bin' });
        const bytes = await entry.capture;
        options.signal.throwIfAborted();
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > remaining) throw new PlaywrightResourceLimitError('Playwright download byte limit exceeded');
        remaining -= bytes.byteLength;
        await retire(entry, false);
        results.push({ filename: capabilityOutputPath(entry.filename, options.configuration), bytes });
      } catch (error) {
        try { await retire(entry, true); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Native download capture and cleanup failed'); }
        throw error;
      } finally {
        state.all.delete(entry);
        const index = queue.indexOf(entry);
        if (index !== -1) queue.splice(index, 1);
      }
    }
    return results;
  } finally { state.collecting.delete(key); }
}
