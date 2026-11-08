import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { installLoader } from '../../breadth-continuation-20260828/executor-v3/loader.mjs';
import { transport } from '../../breadth-continuation-20260828/executor-v3/transport.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const freeze = JSON.parse(fs.readFileSync(path.join(own, 'FREEZE.json')));
const binding = freeze.files.find(entry => entry.path.endsWith('/executor-v4-review/fixtures/outcomes.mjs'));
const entry = { ...binding, path: 'outcomes.mjs' };
const writer = transport();
assert(process.execArgv.includes('--unhandled-rejections=strict'));
assert(process.execArgv.includes('--max-old-space-size=64'));
const loader = installLoader({ root: path.join(own, 'fixtures'), files: [entry] }, value => writer.emit(value));
try {
  const loaded = await import(pathToFileURL(path.join(own, 'fixtures/outcomes.mjs')).href);
  const observation = loaded.execute(process.argv[2]);
  writer.emit({ kind: 'final', report: { evaluated: true, entrySha256: binding.sha256, observation, execArgv: process.execArgv, observationSha256: createHash('sha256').update(JSON.stringify(observation)).digest('hex') } });
} finally { loader.close(); }
