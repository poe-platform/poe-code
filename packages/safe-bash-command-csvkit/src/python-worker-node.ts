import {Worker} from 'node:worker_threads';
import {createPythonWorker as createBrowserWorker} from './python-worker-browser.js';
import type {Endpoint} from './python-worker-contract.js';

export function createPythonWorker(source: string): Endpoint {
  if (typeof globalThis.Worker === 'function') return createBrowserWorker(source);
  const worker = new Worker(source, {eval: true});
  return {postMessage: message => worker.postMessage(message), terminate: () => worker.terminate(), onMessage(callback, failure) {worker.on('message', callback); worker.on('error', failure); worker.on('exit', code => failure(new Error('Python worker exited before settlement: ' + code)));}};
}
