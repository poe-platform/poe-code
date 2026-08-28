import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { admit, guard } from './boundary.mjs';

const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
try {
  const [manifestPath, manifestHash, goPath, goHash] = process.argv.slice(2);
  const bound = admit(manifestPath, manifestHash, goPath, goHash), loads = guard(bound, emit), { manifest } = bound;
  await import('virtual-bash');
  assert.equal(loads.get(manifest.rootModule), bound.allowed.get(manifest.rootModule));
  const forbidden = path.join(manifest.sourceRoot, 'src/shell/runtime.ts');
  let refused = false;
  try { await import(pathToFileURL(forbidden).href); }
  catch (reason) { assert.match(String(reason), /no source-tree module fallback/u); refused = true; }
  assert.equal(refused, true); assert.equal(loads.has(forbidden), false);
  emit({ observation: { id: 'G-FALLBACK', pass: true, settled: true, disposed: true, detail: 'real bound loader refuses readable admitted source as module fallback' } });
  emit({ summary: { cases: 1, pass: 1, failed: [] } });
} catch (reason) { emit({ diagnostic: String(reason?.stack ?? reason) }); process.exitCode = 78; }
