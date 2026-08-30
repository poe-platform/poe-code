import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
const repo = '/Users/kjopek/Workspace/safe-bash';
const author = repo + '/tests/compatibility/bash-ere-runtime-integration-author-20260829';
const scope = author + '/runtime-preflight-v1/v3';
const candidate = author + '/rebind-v1/candidate';
const bindings = [];
function read(file, limit = 2097152) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('source shape/bound ' + file);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size) throw new Error('source size changed');
  bindings.push({ path: file, size: bytes.length, mode: stat.mode & 511, sha256: createHash('sha256').update(bytes).digest('hex') });
  return bytes;
}
const phase = JSON.parse(read(scope + '/START.json'));
if (!Number.isSafeInteger(phase.deadlineMs) || Date.now() >= phase.deadlineMs) throw new Error('phase time');
const compiledBytes = read(author + '/rebind-v1/COMPILED.json');
if (createHash('sha256').update(compiledBytes).digest('hex') !== 'f42f0008bf5939f28ccb7cd038b9f462a03efa38238709c97a7daab7c98e3035') throw new Error('compiled authority');
const sourceBytes = read(author + '/rebind-v1/SEAL.json');
if (createHash('sha256').update(sourceBytes).digest('hex') !== 'b3a3844213fe34017bb4b413bafda2433fd52a0d9165aed5810b01db245dfe95') throw new Error('source authority');
const source = JSON.parse(sourceBytes);
console.log('SEAL-SHAPE', JSON.stringify(Object.keys(source)));
function entries(value, result = []) {
  if (value && typeof value === 'object') {
    if (typeof value.path === 'string' && typeof value.sha256 === 'string') result.push(value);
    else for (const child of Object.values(value)) entries(child, result);
  }
  return result;
}
const declared = entries(source);
console.log('SOURCE-RECORDS', declared.length, JSON.stringify(declared.slice(0, 2)));
function windows(name, tests, before = 3, after = 15) {
  const file = candidate + '/' + name;
  if (!fs.existsSync(file)) { console.log('ABSENT', name); return; }
  const bytes = read(file);
  const binding = bindings.at(-1);
  const record = declared.find(row => row.path === name || row.path === file || row.path.endsWith('/candidate/' + name));
  if (record && (record.sha256 !== binding.sha256 || record.size !== binding.size)) throw new Error('source member identity ' + name);
  const lines = bytes.toString('utf8').split('\n');
  console.log('\nFILE', name, 'directMemberBound', Boolean(record), 'SHA', binding.sha256);
  const printed = new Set();
  for (let line = 0; line < lines.length; line++) if (tests.some(test => lines[line].includes(test))) {
    for (let index = Math.max(0, line - before); index <= Math.min(lines.length - 1, line + after); index++) if (!printed.has(index)) { printed.add(index); console.log(`${index + 1}: ${lines[index]}`); }
  }
}
console.log('CONTRACTS', fs.readdirSync(candidate + '/src/contracts'));
console.log('SHELL-DIR', fs.readdirSync(candidate + '/src/shell'));
console.log('CELL', read(author + '/runtime-preflight-v1/cell.mjs').toString('utf8'));
const cases = JSON.parse(read(author + '/CASEMAP.json'));
function findCases(value) {
  if (Array.isArray(value)) for (const child of value) findCases(child);
  else if (value && typeof value === 'object') {
    if (typeof value.id === 'string' && /^(H0[2-8]|EH0[45])$/.test(value.id)) console.log('OBLIGATION', JSON.stringify(value));
    else for (const child of Object.values(value)) findCases(child);
  }
}
findCases(cases);
windows('src/contracts/command.ts', ['interface Command', 'invoke', 'registerCleanup'], 1, 12);
windows('src/contracts/limits.ts', ['maxExpansion', 'ShellLimit'], 2, 10);
windows('src/shell/shell.ts', ['interface Shell', 'async exec', 'limits:', 'env:'], 1, 8);
windows('src/shell/runtime.ts', ['invokePromises', 'isInvocation', 'Promise.resolve', 'InvocationResult', 'registerCleanup', 'const watch = await store.watch', 'this.budget.expansion'], 3, 12);
windows('src/shell/arrays/ledger.ts', ['export class', 'reserve(', 'get ', 'snapshot', 'close('], 1, 9);
windows('src/shell/arrays/bindings.ts', ['export class', 'watch(', 'valid()', 'retain()', 'release()'], 1, 9);
windows('src/commands/regex-execution/ere/transport/wire-engine.ts', ['new EreLedger', 'compileEre', 'matchEre'], 1, 8);
windows('src/commands/regex-execution/ere/limits.ts', ['checkpoint(', 'admitInput('], 1, 12);
fs.writeFileSync(scope + '/SOURCE-READ.json', JSON.stringify({ status: 'SOURCE_ONLY', pid: process.pid, execPath: process.execPath, phase, bindings }, null, 2) + '\n', { flag: 'wx' });
