import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recorder } from './capture-io.mjs';
import { sha256 } from './path-bytes.mjs';
const own = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(own, '../../../..');
const metadata = JSON.parse(fs.readFileSync(path.join(own, '../actual-v1/METADATA.json')));
const capture = recorder(path.join(own, 'inventory-v1'), repository);
try {
  const candidate = await capture.git('candidate', ['ls-tree', '-rz', '--full-tree', metadata.candidate]);
  await capture.git('base', ['ls-tree', '-rz', '--full-tree', metadata.baseManifest.base]);
  await capture.git('candidate-commit', ['cat-file', 'commit', metadata.candidate]);
  await capture.git('base-commit', ['cat-file', 'commit', metadata.baseManifest.base]);
  await capture.git('evidence-commit', ['cat-file', 'commit', metadata.evidence]);
  await capture.git('stored-root', ['cat-file', 'tree', '189bef24a927241d7c47a662f1ac447b56da1835']);
  const actual = [];
  let offset = 0, count = 0;
  while (offset < candidate.length) {
    const end = candidate.indexOf(0, offset), tab = candidate.indexOf(9, offset);
    if (end < offset || tab < offset || tab >= end) throw new Error('inventory framing');
    const bytes = candidate.subarray(tab + 1, end); count++;
    if (bytes.some(byte => byte < 32 || byte >= 127 || byte === 34 || byte === 92)) actual.push({ ordinal: count, pathBase64: bytes.toString('base64'), pathUtf8: bytes.toString('utf8'), header: candidate.subarray(offset, tab).toString('ascii') });
    offset = end + 1;
  }
  capture.put('ACTUAL98.json', { classification: 'raw inventory freeze only; NOT repaired authentication or controls', count, specialCount: actual.length, entries: actual });
  capture.put('TOOLS.json', [process.execPath, '/usr/bin/git'].map(filename => { const bytes = fs.readFileSync(filename), stat = fs.statSync(filename); return { path: filename, bytes: bytes.length, mode: stat.mode & 0o777, sha256: sha256(bytes) }; }));
  capture.put('FINAL.json', { status: 'INVENTORY_FROZEN_NOT_AUTHENTICATED', ...capture.finish(), builds: 0, productImports: 0, instructionPlaintextCaptured: false });
} catch (reason) {
  capture.put('FAILURE.json', { message: reason.message, ...capture.finish() }); process.exitCode = 1;
}
