import {CsvkitBlocked} from './errors.js';
import type {Endpoint, Message} from './python-worker-contract.js';

export function createPythonWorker(source: string): Endpoint {
  if (typeof globalThis.Worker !== 'function') throw new CsvkitBlocked('csvpy requires a dedicated worker');
  const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
  let worker: Worker;
  try {worker = new Worker(url, {type: 'module'});}
  catch (error) {URL.revokeObjectURL(url); throw error;}
  return {postMessage: message => worker.postMessage(message), terminate() {worker.terminate(); URL.revokeObjectURL(url);}, onMessage(callback, failure) {worker.onmessage = event => callback(event.data as Message); worker.onerror = failure;}};
}
