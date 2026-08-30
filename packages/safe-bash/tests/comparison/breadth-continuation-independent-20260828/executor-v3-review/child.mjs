import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { installLoader } from '../../breadth-continuation-20260828/executor-v3/loader.mjs';
import { installOffline } from '../../breadth-continuation-20260828/executor-v3/offline.mjs';
import { transport } from '../../breadth-continuation-20260828/executor-v3/transport.mjs';
import { hash } from '../../breadth-continuation-20260828/executor-v3/safety.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
const writer = transport();
if (mode === 'late-rejection') {
  writer.emit({ kind: 'final', report: { deliberatelyPremature: true } });
  Promise.reject(new Error('PRESEALED_LATE_REJECTION'));
} else if (mode === 'output-overflow') {
  writer.emit({ kind: 'final', report: { deliberatelyOversized: true } });
  process.stdout.write(Buffer.alloc(65537, 97));
} else {
  const view = { root: path.join(own, 'fixtures'), files: ['entry.mjs', 'value.cjs'].map(name => {
    const bytes = fs.readFileSync(path.join(own, 'fixtures', name));
    return { path: name, bytes: bytes.length, mode: 0o644, sha256: hash(bytes) };
  }) };
  let loader;
  let offline;
  try {
    loader = installLoader(view, event => writer.emit(event));
    offline = installOffline(view, event => writer.emit(event));
    if (mode === 'load') {
      const module = await import(pathToFileURL(path.join(view.root, 'entry.mjs')).href);
      writer.emit({ kind: 'final', report: { observation: module.observation, loads: loader.loaded, resources: offline.receipt() } });
    } else if (mode === 'deny') {
      const denied = [];
      for (const operation of [
        () => fs.readFileSync(path.join(view.root, 'AGENTS.md')),
        () => new Worker(path.join(view.root, 'entry.mjs')),
        () => WebAssembly.compile(new Uint8Array()),
        () => import(pathToFileURL(path.join(view.root, 'unlisted.mjs')).href),
      ]) {
        try { await operation(); denied.push('UNEXPECTED_SUCCESS'); }
        catch (error) { denied.push(error.code); }
      }
      writer.emit({ kind: 'final', report: { denied, loads: loader.loaded, resources: offline.receipt() } });
    } else throw new Error('UNKNOWN_PRESEALED_MODE');
  } finally { offline?.close(); loader?.close(); }
}
