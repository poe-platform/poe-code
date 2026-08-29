import * as fs from 'node:fs';
import { grant, sha } from './controller-core.mjs';
import path from 'node:path';
import { runOwnedCell } from './owner.mjs';
import { createHash } from 'node:crypto';
const started = Date.now();
const [sealPath, grantPath, confirmedGrantSha, capturePath] = process.argv.slice(2);
const output = fs.openSync(capturePath, 'wx');
fs.writeSync(output, `${JSON.stringify({ event: 'startup', pid: process.pid })}\n`);
try {
  const bytes = fs.readFileSync(sealPath);
  const seal = JSON.parse(bytes);
  const verifyBound = row => {
    const stat = fs.lstatSync(row.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.size || (stat.mode & 0o777) !== row.mode) throw new Error('tool/controller stat');
    const descriptor = fs.openSync(row.path, 'r'), digest = createHash('sha256'), chunk = Buffer.alloc(65536);
    try { let count; while ((count = fs.readSync(descriptor, chunk))) digest.update(chunk.subarray(0, count)); } finally { fs.closeSync(descriptor); }
    if (digest.digest('hex') !== row.sha256) throw new Error('tool/controller hash');
  };
  if (process.execPath !== seal.node.path) throw new Error('coordinator binary path');
  verifyBound(seal.node);
  for (const row of seal.controller) verifyBound(row);
  const rawGrant = fs.readFileSync(grantPath);
  grant(JSON.parse(rawGrant), sha(bytes), confirmedGrantSha, rawGrant);
  if (seal.deferredCells.length) throw new Error(`RUNTIME_GATES_UNSATISFIED: ${seal.deferredCells.join(',')}`);
  const emit = row => fs.writeSync(output, `${JSON.stringify(row)}\n`);
  const state = { starts: 0, capture: 0, workerStarts: 0, owned: [], maximumStarts: seal.futureCaps.childMaximum, maximumCapture: seal.futureCaps.captureBytes, maximumWorkers: seal.futureCaps.workerStartsMaximum, deadline: started + seal.futureCaps.totalMilliseconds };
  const rows = [];
  for (const layout of seal.layouts) {
    const manifestBytes = fs.readFileSync(layout.manifest.path);
    if (sha(manifestBytes) !== layout.manifest.sha256) throw new Error('layout manifest binding');
    const manifest = JSON.parse(manifestBytes);
    const verify = () => {
      if (Date.now() >= state.deadline) throw new Error('admission/publication deadline');
      for (const row of manifest.rows) {
        const filename = path.join(layout.app, row.path), stat = fs.lstatSync(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.size || (stat.mode & 0o777) !== row.mode || sha(fs.readFileSync(filename)) !== row.sha256) throw new Error('layout member drift');
      }
      const allowed = new Set([...manifest.rows.map(row => row.path), ...layout.cells.flatMap(cell => [cell.capture, `${cell.capture}.stdout`, `${cell.capture}.stderr`].map(filename => path.relative(layout.app, filename)))]);
      function walk(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const filename = path.join(directory, entry.name); if (entry.isSymbolicLink()) throw new Error('layout linked entry'); if (entry.isDirectory()) walk(filename); else if (!allowed.has(path.relative(layout.app, filename))) throw new Error('layout extra member'); } }
      walk(layout.app);
    };
    verify();
    for (const cell of layout.cells) { rows.push(await runOwnedCell(cell, state, emit)); verify(); }
  }
  if (rows.length !== 210 || state.owned.some(row => !row.retired)) throw new Error('terminal cohort/ownership');
  emit({ event: 'complete', rows, state });
  if (Date.now() >= state.deadline) throw new Error('final publication deadline');
  if (rows.some(row => row.status !== 'PASS')) process.exitCode = 1;
} catch (error) {
  fs.writeSync(output, `${JSON.stringify({ event: 'REFUSED_BEFORE_PRODUCT', message: String(error) })}\n`);
  process.exitCode = 78;
} finally { fs.closeSync(output); }
