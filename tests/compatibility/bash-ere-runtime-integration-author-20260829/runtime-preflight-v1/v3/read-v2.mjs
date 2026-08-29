import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
const author = '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-ere-runtime-integration-author-20260829';
const scope = author + '/runtime-preflight-v1/v3';
const candidate = author + '/rebind-v1/candidate';
const bindings = [];
function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2097152) throw new Error('source shape/bound');
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size) throw new Error('read size drift');
  bindings.push({ path: file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  return bytes;
}
const phase = JSON.parse(read(scope + '/START.json'));
if (!Number.isSafeInteger(phase.deadlineMs) || Date.now() >= phase.deadlineMs) throw new Error('phase time');
const sealBytes = read(author + '/rebind-v1/SEAL.json');
if (bindings.at(-1).sha256 !== 'b3a3844213fe34017bb4b413bafda2433fd52a0d9165aed5810b01db245dfe95') throw new Error('seal identity');
const seal = JSON.parse(sealBytes);
if (!Array.isArray(seal.sources) || seal.sources.length !== 305) throw new Error('source schema');
function windows(name, terms, before = 2, after = 11) {
  const record = seal.sources.find(row => row.path === name);
  if (!record) { console.log('NOT SELECTED', name); return; }
  if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('source record schema');
  const bytes = read(candidate + '/' + name), actual = bindings.at(-1);
  if (actual.sha256 !== record.sha256 || actual.size !== record.bytes) throw new Error('actual source content/size mismatch');
  console.log('\nBOUND', name, actual.size, actual.sha256);
  const lines = bytes.toString('utf8').split('\n'), printed = new Set();
  for (let line = 0; line < lines.length; line++) if (terms.some(term => lines[line].includes(term))) for (let index = Math.max(0, line - before); index <= Math.min(lines.length - 1, line + after); index++) if (!printed.has(index)) { printed.add(index); console.log(`${index + 1}: ${lines[index]}`); }
}
windows('src/contracts/command.ts', ['interface CommandInvoke', 'invoke', 'registerCleanup'], 1, 13);
windows('src/shell/types.ts', ['interface Shell', 'maxExpansion', 'env?'], 1, 12);
windows('src/shell/shell.ts', ['readonly budget', 'maxExpansion', 'env:', 'cleanupFailures', 'registerCleanup', 'primary', 'async exec'], 1, 9);
windows('src/shell/runtime.ts', ['invokePromises', 'invokeResults', 'invocationPromises', 'invocationResults', 'registerCleanup', 'returned', 'thenable', 'cleanup.failure', 'session.execute', 'const supersede', 'this.budget.expansion'], 3, 15);
windows('src/shell/arrays/ledger.ts', ['export class', 'snapshot', 'get usage', 'get remaining', 'reserve(', 'close('], 1, 8);
windows('src/shell/arrays/state.ts', ['export class', 'watch(', 'epoch', 'snapshotState'], 1, 8);
windows('src/commands/regex-execution/ere/syntax.ts', ['4096', '64', '32', '255', 'nodes', 'depth'], 2, 8);
windows('src/commands/regex-execution/ere/transport/owner.ts', ['new Worker', 'PROTOCOL', 'WORKER_EXIT', 'REQUEST_TIMEOUT', 'messageerror', 'terminate', 'close()'], 2, 8);
windows('src/commands/regex-execution/ere/transport/root.ts', ['reserve', 'allowance', 'remaining', 'execute(', 'close('], 2, 8);
windows('src/shell/cleanup.ts', ['export class', 'failure', 'register(', 'close('], 1, 12);
windows('src/core/budget.ts', ['maxExpansion', 'expand', 'ShellLimitError'], 1, 8);
fs.writeFileSync(scope + '/SOURCE-READ-v2.json', JSON.stringify({ status: 'AUTHENTICATED_SOURCE_ONLY', pid: process.pid, bindings, correctedSchema: 'sources[].bytes; original helper incorrectly compared missing .size', runtimeImports: 0 }, null, 2) + '\n', { flag: 'wx' });
