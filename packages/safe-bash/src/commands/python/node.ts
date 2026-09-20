import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { PythonWorkerEndpoint } from './index.js';

export interface NodePythonWorkerOptions {
  /** Required acknowledgement: guest JavaScript interoperability is not host isolation. */
  readonly trustedPython: true;
  /** Explicit trusted Pyodide ES module URL; no installation or host Python fallback. */
  readonly runtimeModuleURL: string;
  /** Runtime asset directory, defaulting to the module's containing directory. */
  readonly indexURL?: string;
}

/** Each endpoint owns a new worker and a new interpreter, including module state. */
export function createNodePythonWorker(options: NodePythonWorkerOptions): PythonWorkerEndpoint {
  if (options.trustedPython !== true) throw new TypeError('Node Python requires trustedPython: true; Pyodide JavaScript interoperability is not a sandbox');
  const runtimeModuleURL = new URL(options.runtimeModuleURL).href;
  const worker = new Worker(`
    import('node:worker_threads').then(({ parentPort, workerData }) => {
    parentPort.once('message', async start => {
      try {
        const { runPythonWorker } = await import(workerData.runner);
        const { loadPyodide } = await import(workerData.runtimeModuleURL);
        await runPythonWorker({ start, loadRuntime: configuration => loadPyodide({...configuration, indexURL: workerData.indexURL}),
          postMessage: message => parentPort.postMessage(message) });
      } catch (error) { parentPort.postMessage({type:'error', category:'runtime-assets', message:String(error)}); }
    });
    });
  `, {eval:true, workerData:{runner:new URL('./worker.js', import.meta.url).href,
    runtimeModuleURL, indexURL:options.indexURL ?? (runtimeModuleURL.startsWith('file:') ? fileURLToPath(new URL('.',runtimeModuleURL)) : new URL('.',runtimeModuleURL).href)}});
  return {
    postMessage(message) { worker.postMessage(message); },
    subscribe(onMessage, onError) {
      const onExit = (code: number) => onError(new Error(`Python worker exited unexpectedly (${code})`));
      worker.on('message', onMessage); worker.on('error', onError); worker.on('exit', onExit);
      return () => { worker.off('message', onMessage); worker.off('error', onError); worker.off('exit', onExit); };
    },
    async terminate() { await worker.terminate(); },
  };
}
