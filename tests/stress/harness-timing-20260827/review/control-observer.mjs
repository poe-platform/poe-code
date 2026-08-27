import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ready } from './tools.mjs';

const records = [];
let mode = 'complete';
export const guardSettings = { suppressReadiness: false, withholdSuffix: false, holdClose: false };
export function configure(nextMode, settings = {}) {
  mode = nextMode;
  Object.assign(guardSettings, { suppressReadiness: false, withholdSuffix: false, holdClose: false }, settings);
}
export function spawnReviewChild(env) { return spawnControlled(mode, env).child; }
export function holdClose(child, callback, args) {
  const record = records.find(record => record.child === child);
  assert(record && record.closed, 'only delay the independently observed real close');
  record.deferredClose = { callback, args };
  record.events.push({ event: 'test-close-acknowledgement-held', ms: performance.now() - record.started });
}
export function releaseClose(record) {
  assert(record.deferredClose && record.closed);
  record.events.push({ event: 'test-real-close-acknowledgement-released', ms: performance.now() - record.started });
  const deferred = record.deferredClose;
  record.deferredClose = undefined;
  deferred.callback(...deferred.args);
}
export function spawnControlled(childMode, env = process.env) {
  ready();
  assert(records.filter(record => !record.closed).length < 2, 'native control plus sentinel only');
  const started = performance.now();
  const child = spawn(process.execPath, ['--unhandled-rejections=strict', fileURLToPath(new URL('controlled-child.mjs', import.meta.url)), childMode], {
    cwd: fileURLToPath(new URL('./', import.meta.url)), env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const record = { childMode, child, started, events: [], closed: false, exitSeen: false, listeners: [], outputBytes: 0 };
  const mark = (event, detail = {}) => record.events.push({ event, ms: performance.now() - started, ...detail });
  const listen = (target, event, callback) => { target.on(event, callback); record.listeners.push([target, event, callback]); };
  record.closedPromise = new Promise(resolve => { record.resolveClose = resolve; });
  listen(child, 'spawn', () => mark('spawn', { pid: child.pid, notInputConsumption: true }));
  listen(child, 'error', error => mark('error', { error: String(error) }));
  listen(child, 'exit', (code, signal) => { record.exitSeen = true; mark('exit', { code, signal }); });
  listen(child, 'close', (code, signal) => { record.closed = true; mark('close', { code, signal }); record.resolveClose(); });
  listen(child.stdin, 'error', error => mark('stdin-error', { error: String(error) }));
  for (const [label, stream] of [['stdin', child.stdin], ['stdout', child.stdout], ['stderr', child.stderr]]) {
    listen(stream, 'close', () => mark(`${label}-close`));
    if (label === 'stdin') continue;
    listen(stream, 'data', bytes => {
      record.outputBytes += bytes.length;
      mark(`${label}-data`, { hex: bytes.toString('hex') });
      if (record.outputBytes > 4096) { mark('observer-capture-limit'); child.kill('SIGKILL'); }
    });
  }
  records.push(record);
  record.baselineListeners = [child, child.stdin, child.stdout, child.stderr].flatMap(target => target.eventNames().flatMap(event => target.listeners(event).map(callback => [target, event, callback])));
  return record;
}
export function latest() { return records.at(-1); }
export function snapshot(record) {
  return {
    childMode: record.childMode, pid: record.child.pid, closed: record.closed, exitSeen: record.exitSeen,
    code: record.child.exitCode, signal: record.child.signalCode, events: record.events,
    streamDestroyed: [record.child.stdin, record.child.stdout, record.child.stderr].map(stream => stream.destroyed),
    observerListenersRemaining: record.listeners.filter(([target, event, callback]) => target.listeners(event).includes(callback)).length,
    additionalListeners: [record.child, record.child.stdin, record.child.stdout, record.child.stderr].flatMap((target, targetIndex) => target.eventNames().flatMap(event => target.listeners(event).filter(callback => !record.baselineListeners.some(([oldTarget, oldEvent, oldCallback]) => oldTarget === target && oldEvent === event && oldCallback === callback)).map(() => ({ targetIndex, event: String(event) })))),
  };
}
export async function retire(record) {
  let timer;
  if (!record.closed) {
    record.events.push({ event: 'independent-exact-kill', ms: performance.now() - record.started, pid: record.child.pid });
    record.child.kill('SIGKILL');
  }
  try {
    await Promise.race([record.closedPromise, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`independent cleanup missing for exact PID ${record.child.pid}`)), 2000);
    })]);
  } finally {
    clearTimeout(timer);
    for (const [target, event, callback] of record.listeners) target.off(event, callback);
  }
  return snapshot(record);
}
export async function retireAll() {
  const results = [];
  for (const record of records) results.push(await retire(record));
  return results;
}
