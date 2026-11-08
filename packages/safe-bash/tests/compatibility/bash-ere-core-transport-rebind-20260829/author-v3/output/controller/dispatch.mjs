import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ownProcess } from './owner.mjs';
import { createCoreClock } from './core-guard-v8.mjs';
const started = Date.now();
const [sealPath, expectedSeal, grantPath, expectedGrant, collector, outerStartedMilliseconds] = process.argv.slice(2);
const monotonicNow = () => Number(process.hrtime.bigint() / 1000000n);
const outerStarted = Number(outerStartedMilliseconds);
if (!Number.isSafeInteger(outerStarted) || outerStarted < 0 || outerStarted > monotonicNow()) throw new Error('outer monotonic start binding');
const clock = createCoreClock({ started: outerStarted, now: monotonicNow });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const bounded = (file, limit) => { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('bounded regular file'); const bytes = fs.readFileSync(file); if (bytes.length !== stat.size) throw new Error('read drift'); return bytes; };
for (const [descriptor, suffix] of [[1, '.stdout'], [2, '.stderr']]) { const actual = fs.fstatSync(descriptor), declared = fs.lstatSync(collector + suffix); if (!actual.isFile() || !declared.isFile() || declared.isSymbolicLink() || actual.ino !== declared.ino || actual.dev !== declared.dev) throw new Error('external collector not connected'); }
let published = 0;
const emit = row => { const bytes = Buffer.from(JSON.stringify(row) + '\n'); if (bytes.length > 8388608 - published) throw new Error('coordinator capture cap'); let offset = 0; while (offset < bytes.length) { const written = fs.writeSync(1, bytes, offset, bytes.length - offset); if (!Number.isSafeInteger(written) || written <= 0) throw new Error('coordinator short write'); offset += written; } published += bytes.length; };
emit({ event: 'startup', pid: process.pid, execPath: process.execPath, started });
const bytes = bounded(sealPath, 8388608); if (digest(bytes) !== expectedSeal) throw new Error('seal hash');
const seal = JSON.parse(bytes), rawGrant = bounded(grantPath, 8192);
if (digest(rawGrant) !== expectedGrant) throw new Error('root confirmed raw grant hash');
const grant = JSON.parse(rawGrant), keys = ['action', 'sealSha256', 'rootReceipt', 'privateTransportReceipt', 'corePreexecReceipt', 'uniqueLabel', 'candidate', 'packageSha256'];
if (Object.keys(grant).join('\0') !== keys.join('\0') || grant.action !== 'execute-core70-v8' || grant.sealSha256 !== expectedSeal || grant.candidate !== seal.sourceTree || grant.packageSha256 !== seal.archive.sha256 || !/^[A-Z0-9-]{1,80}$/.test(grant.uniqueLabel)) throw new Error('ROOT grant shape/identity');
for (const key of ['rootReceipt', 'privateTransportReceipt', 'corePreexecReceipt']) if (typeof grant[key] !== 'string' || !/^[a-f0-9]{40}$/.test(grant[key])) throw new Error('required durable receipt absent');
for (const key of ['childMaximum', 'totalMilliseconds', 'captureBytes', 'workerStartsMaximum', 'workingBytes']) if (!Number.isSafeInteger(seal.futureCaps[key]) || seal.futureCaps[key] < 1) throw new Error('finite runtime caps');
if (seal.futureCaps.childMaximum !== 210 || seal.futureCaps.totalMilliseconds !== 1800000 || seal.futureCaps.captureBytes !== 134217728 || seal.futureCaps.workingBytes !== 536870912 || seal.layouts.flatMap(layout => layout.cells).length !== 210) throw new Error('fixed role/cap census');
const deadline = Date.now() + Math.max(0, clock.remaining() - 180000);
const verifyBinding = row => { const stat = fs.lstatSync(row.path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.size || (stat.mode & 511) !== row.mode) throw new Error('binding shape'); const hash = createHash('sha256'), descriptor = fs.openSync(row.path, 'r'), buffer = Buffer.alloc(65536); try { let count; while ((count = fs.readSync(descriptor, buffer))) hash.update(buffer.subarray(0, count)); } finally { fs.closeSync(descriptor); } if (hash.digest('hex') !== row.sha256) throw new Error('binding content'); };
if (process.execPath !== seal.node.path) throw new Error('Node selection'); verifyBinding(seal.node); for (const entry of seal.controller) verifyBinding(entry);
const state = { deadline, starts: 0, maximumStarts: 210, capture: 0, maximumCapture: 125829120, owned: [], secondary: [] };
const outcomes = []; let workers = 0;
const remainingUnrun = () => { const seen = new Set(outcomes.map(row => row.id)); for (const cell of seal.layouts.flatMap(layout => layout.cells)) if (!seen.has(cell.id)) outcomes.push({ id: cell.id, status: 'UNRUN', reason: 'case+cleanup+180s-publication-do-not-fit' }); };
layoutLoop: for (const layout of seal.layouts) {
  verifyBinding(layout.manifest); const manifest = JSON.parse(bounded(layout.manifest.path, 4194304));
  const allowed = new Set(manifest.rows.map(row => row.path));
  for (const cell of layout.cells) for (const file of [cell.capture, cell.stdout, cell.stderr]) allowed.add(path.relative(layout.app, file));
  function verify() {
    if (Date.now() >= deadline) throw new Error('whole-run deadline');
    for (const row of manifest.rows) verifyBinding({ ...row, path: path.join(layout.app, row.path) });
    const walk = directory => { for (const name of fs.readdirSync(directory)) { const file = path.join(directory, name), stat = fs.lstatSync(file); if (stat.isSymbolicLink()) throw new Error('layout symlink'); if (stat.isDirectory()) { if (!manifest.directories.includes(path.relative(layout.app, file))) throw new Error('extra directory'); walk(file); } else if (!stat.isFile() || !allowed.has(path.relative(layout.app, file))) throw new Error('extra member'); } }; walk(layout.app);
  }
  for (const cell of layout.cells) {
    const reserve = { requiredCaseMilliseconds: cell.caseMs, cleanupMilliseconds: cell.retireMs };
    if (!clock.admit(reserve).admitted) { remainingUnrun(); break layoutLoop; }
    verify();
    if (!clock.admit(reserve).admitted) { remainingUnrun(); break layoutLoop; }
    const receipt = await ownProcess(cell, state, emit);
    if (!receipt.retired || state.unknownRetirement) throw new Error('unknown retirement STOP');
    const raw = bounded(cell.capture, cell.childCapture); if (raw.length > state.maximumCapture - state.capture) throw new Error('terminal capture cap'); state.capture += raw.length;
    const records = raw.toString('utf8').trimEnd().split('\n').map(JSON.parse), terminals = records.filter(row => row.event === 'result');
    if (terminals.length !== 1 || terminals[0].id !== cell.originalId || !terminals[0].retired || records.some(row => row.event === 'unsafe-retirement')) throw new Error('terminal/cleanup identity');
    const result = terminals[0];
    const startups = records.filter(row => row.event === 'startup');
    if (startups.length !== 1 || records[0] !== startups[0] || records.at(-1) !== result || startups[0].pid !== receipt.pid || startups[0].execPath !== seal.node.path) throw new Error('cell startup/terminal capture continuity');
    const auditLines = bounded(cell.stderr, cell.childCapture).toString('utf8').split('\n').filter(line => line.startsWith('{"event":"cell-final",'));
    if (auditLines.length !== 1) throw new Error('final close-audit missing/duplicate');
    const audit = JSON.parse(auditLines[0]);
    if (audit.id !== cell.originalId || audit.status !== result.status || audit.retired !== true || audit.failure?.present !== (audit.status === 'FAIL')) throw new Error('final close-audit status/identity');
    const writer = audit.eventWriter;
    if (!writer || writer.failed !== false || writer.closed !== true || writer.byteLimit !== cell.childCapture || writer.admitted !== raw.length || writer.written !== raw.length) throw new Error('event capture incomplete/cap/close failure');
    if (!['PASS', 'FAIL'].includes(result.status) || receipt.code !== (result.status === 'PASS' ? 0 : 1) || receipt.signal !== null) throw new Error('nonzero-allPASS/malformed status');
    if (!Array.isArray(result.workers) || result.workers.length > cell.workerStartsMaximum) throw new Error('cell Worker census'); workers += result.workers.length;
    if (workers > seal.futureCaps.workerStartsMaximum) throw new Error('whole Worker census');
    outcomes.push({ id: cell.id, status: result.status }); verify();
  }
}
if (outcomes.length !== 210 || state.owned.some(row => !row.retired)) throw new Error('incomplete ownership/results');
verifyBinding(seal.node); for (const entry of seal.controller) verifyBinding(entry);
clock.assertBeforeDeadline();
emit({ event: 'complete', outcomes, workers, children: state.starts, childCapture: state.capture, coordinatorCapture: published, elapsed: Date.now() - started });
clock.assertBeforeDeadline();
process.exitCode = outcomes.some(row => row.status === 'UNRUN') ? 2 : outcomes.some(row => row.status === 'FAIL') ? 1 : 0;
