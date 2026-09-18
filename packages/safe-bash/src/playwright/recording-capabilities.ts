import { PlaywrightResourceLimitError } from './resource-limit.js';
import type { PlaywrightAbility } from './abilities.js';
import type { PlaywrightContext, PlaywrightRecorderSink } from './adapter.js';
import { capabilityResult, requireSession, unsupported } from './capability-result.js';

interface Recording { actions: string[]; failure?: Error; stop(): Promise<void> }
const recordings = new WeakMap<PlaywrightContext, Recording>();

const start: PlaywrightAbility = { scope: 'session', async execute(request) {
  const session = requireSession(request), context = session.context;
  if (recordings.has(context)) throw new Error('Recording is already in progress.');
  const modern = Boolean(context._startRecording && context._stopRecording);
  if (!modern && !(context._enableRecorder && context._disableRecorder)) unsupported('native action recording');
  const maximum = request.limits?.maxCommandBytes ?? 1048576;
  let bytes = 0, admitted = false;
  let started: Promise<void> = Promise.resolve(), stopping: Promise<void> | undefined;
  const recording: Recording = { actions: [], stop() {
    stopping ??= (async () => {
      await started.catch(() => {});
      if (admitted) {
        admitted = false;
        if (modern) await context._stopRecording!();
        else await context._disableRecorder!();
      }
      if (recordings.get(context) === recording) recordings.delete(context);
    })();
    return stopping;
  } };
  const add = (code: string | undefined, update: boolean) => {
    if (!admitted || stopping || recording.failure || code === undefined) return;
    if (typeof code !== 'string') { recording.failure = new Error('Invalid native recorder code'); return; }
    const previous = update && recording.actions.length ? recording.actions.at(-1)! : undefined;
    const size = new TextEncoder().encode(code).byteLength;
    const next = bytes + size - (previous === undefined ? 0 : new TextEncoder().encode(previous).byteLength);
    if (next > maximum || previous === undefined && recording.actions.length >= 4096) { recording.failure = new PlaywrightResourceLimitError('Playwright recording byte limit exceeded'); return; }
    bytes = next;
    if (previous === undefined) recording.actions.push(code);
    else recording.actions[recording.actions.length - 1] = code;
  };
  const sink: PlaywrightRecorderSink = {
    actionAdded: (_page, _action, code) => add(code, false),
    actionUpdated: (_page, _action, code) => add(code, true),
    signalAdded: (_page, _signal, code) => add(code, true),
  };
  recordings.set(context, recording);
  session.registerCleanup(recording.stop);
  admitted = true;
  started = modern ? context._startRecording!({ language: 'playwright-test' }, sink) : context._enableRecorder!({ language: 'playwright-test', mode: 'recording', recorderMode: 'api' }, sink);
  try { await started; }
  catch (error) {
    try { await recording.stop(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Native recording startup and cleanup failed'); }
    throw error;
  }
  return capabilityResult('', 'Recording started. Call browser_stop_recording to retrieve the recorded actions.');
} };

const stop: PlaywrightAbility = { scope: 'session', async execute(request) {
  const recording = recordings.get(requireSession(request).context);
  if (!recording) throw new Error('No recording in progress, use browser_start_recording to start one.');
  await recording.stop();
  if (recording.failure) throw recording.failure;
  const code = recording.actions.filter(value => value.trim()).join('\n');
  return capabilityResult('', code ? `Recording stopped. Recorded actions:\n\n\`\`\`js\n${code}\n\`\`\`` : 'Recording stopped. No actions were recorded.');
} };

export const playwrightRecordingAbilities = { 'recording-start': start, 'recording-stop': stop };
