import type { PlaywrightAbility } from './abilities.js';
import type { PlaywrightContext, PlaywrightTraceCapture } from './adapter.js';
import { capabilityArtifact, capabilityOutputPath, capabilityResult, requireSession, unsupported } from './capability-result.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';

interface TraceRecording { started: Promise<void>; active: boolean; directory: string; name?: string; stopping?: Promise<void>; releasing?: Promise<void> }
const recordings = new WeakMap<PlaywrightContext, TraceRecording>();
let sequence = 0;

function stopTrace(context: PlaywrightContext, recording: TraceRecording, path?: string): Promise<void> {
  recording.stopping ??= recording.started.catch(() => {}).then(async () => {
    if (!recording.active) return;
    recording.active = false;
    await context.tracing!.stop(path === undefined ? undefined : { path });
  });
  return recording.stopping;
}

export function preparePlaywrightTraceRelease(context: PlaywrightContext): Promise<void> {
  const recording = recordings.get(context);
  if (!recording) return Promise.resolve();
  recording.releasing ??= stopTrace(context, recording).finally(() => {
    if (recordings.get(context) === recording) recordings.delete(context);
  });
  return recording.releasing;
}

export async function flushPlaywrightTrace(context: PlaywrightContext, capture: PlaywrightTraceCapture | undefined,
  options: { signal: AbortSignal; maxBytes: number; writeArtifact(bytes: Uint8Array, filename?: string): Promise<void>; mkdir?(path: string): Promise<void> }): Promise<string[]> {
  const recording = recordings.get(context);
  if (!recording?.name || !capture) return [];
  const result = await capture(context, { signal: options.signal, maxBytes: options.maxBytes });
  if (!Array.isArray(result.files) || result.files.length > 1024) throw new PlaywrightResourceLimitError('Playwright trace file count limit exceeded');
  let total = 0;
  const paths = new Set<string>();
  for (const file of result.files) {
    if (typeof file.path !== 'string' || file.path.length > 256 || paths.has(file.path)) throw new Error('Invalid native trace path');
    const resource = file.path.startsWith('resources/') ? file.path.slice('resources/'.length) : undefined;
    if (resource !== undefined ? !resource || resource === '.' || resource === '..' || [...resource].some(char => !'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-@'.includes(char))
      : ![`${recording.name}.trace`, `${recording.name}.network`].includes(file.path)) throw new Error('Invalid native trace path');
    if (!(file.bytes instanceof Uint8Array)) throw new Error('Invalid native trace bytes');
    total += file.bytes.byteLength;
    if (total > options.maxBytes) throw new PlaywrightResourceLimitError('Playwright trace byte limit exceeded');
    paths.add(file.path);
  }
  if (!paths.has(`${recording.name}.trace`) || !paths.has(`${recording.name}.network`)) throw new Error('Native trace logs are missing');
  const directory = recording.directory;
  for (const file of result.files) {
    options.signal.throwIfAborted();
    await options.writeArtifact(file.bytes, `${directory}/${file.path}`);
  }
  if (options.mkdir) await options.mkdir(`${directory}/resources`);
  const links = [`- [${recording.active ? 'Action log' : 'Trace'}](${directory}/${recording.name}.trace)`, `- [Network log](${directory}/${recording.name}.network)`];
  if (options.mkdir || [...paths].some(path => path.startsWith('resources/'))) links.push(`- [Resources](${directory}/resources)`);
  if (!recording.active) recordings.delete(context);
  return links;
}

export const playwrightTracingStart: PlaywrightAbility = { scope: 'session', async execute(request) {
  const session = requireSession(request);
  const tracing = session.context.tracing;
  if (!tracing || !session.captureArtifact && !session.captureTrace) unsupported('trace artifact capture');
  if (recordings.has(session.context)) throw new Error('Tracing is already started');
  const recording = { started: Promise.resolve(), active: false, directory: capabilityOutputPath('traces', session.configuration), ...(session.captureTrace ? { name: `trace-${Date.now()}-${++sequence}` } : {}) };
  recordings.set(session.context, recording);
  session.registerCleanup(() => preparePlaywrightTraceRelease(session.context));
  recording.started = tracing.start({ screenshots: true, snapshots: true, ...(recording.name ? { name: recording.name, live: true, _live: true } : {}) }).then(() => { recording.active = true; });
  try { await recording.started; }
  catch (error) { recordings.delete(session.context); throw error; }
  return capabilityResult('', 'Trace recording started');
} };

export const playwrightTracingStop: PlaywrightAbility = { scope: 'session', async execute(request) {
  const session = requireSession(request);
  const recording = recordings.get(session.context);
  if (!recording?.active) throw new Error('Tracing is not started');
  if (!session.context.tracing || !session.captureArtifact && !session.captureTrace) unsupported('trace artifact capture');
  if (session.captureTrace) {
    await stopTrace(session.context, recording);
    return capabilityResult('', 'Trace recording stopped.');
  }
  const bytes = await session.captureArtifact!(path => stopTrace(session.context, recording, path), {
    signal: request.signal, maxBytes: request.limits?.maxArtifactBytes ?? 1048576, extension: 'zip',
  });
  recordings.delete(session.context);
  return capabilityArtifact(request, bytes, 'trace', 'zip', 'Trace', () => '');
} };
