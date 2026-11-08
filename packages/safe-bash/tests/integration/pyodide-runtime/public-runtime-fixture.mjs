import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createNodePythonWorker } from 'poe-code/safe-bash/commands/python/node';

export const runtimeModuleURL = process.env.SAFE_BASH_PYODIDE_RUNTIME_URL
  ?? new URL('./node_modules/pyodide/pyodide.mjs', import.meta.url).href;

export function createWorker() {
  return createNodePythonWorker({ trustedPython: true, runtimeModuleURL });
}

// Provisioning is a separate maintained command. Acceptance never downloads or
// changes the host cache: interpreter manifest updates live in this owned map.
export async function createOfflineCache() {
  const directory = process.env.SAFE_BASH_PYTHON_CACHE;
  if (!directory) throw new Error('SAFE_BASH_PYTHON_CACHE must name the directory created by provision:python:integration');
  const entries = new Map();
  for (const name of await readdir(directory)) {
    entries.set(decodeURIComponent(name), new Uint8Array(await readFile(join(directory, name))));
  }
  if (!entries.size) throw new Error('Preprovisioned Python cache is empty: ' + directory);
  return {
    entries,
    async get(key) { return entries.get(key)?.slice(); },
    async set(key, bytes) { entries.set(key, bytes.slice()); },
  };
}

export function delayedFileSystem(storage, delayMs = 1) {
  const handles = new Set();
  let count = 0;
  const wait = async () => { count++; if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs)); };
  const fs = new Proxy(storage, {
    get(target, member) {
      const value = Reflect.get(target, member, target);
      if (typeof value !== 'function') return value;
      return async (...args) => {
        await wait();
        const result = await value.apply(target, args);
        if (member !== 'open') return result;
        handles.add(result);
        return new Proxy(result, {
          get(handle, operation) {
            const method = Reflect.get(handle, operation, handle);
            if (typeof method !== 'function') return method;
            return async (...parameters) => {
              await wait();
              try { return await method.apply(handle, parameters); }
              finally { if (operation === 'close') handles.delete(result); }
            };
          },
        });
      };
    },
  });
  return { fs, handles, operations: () => count };
}
