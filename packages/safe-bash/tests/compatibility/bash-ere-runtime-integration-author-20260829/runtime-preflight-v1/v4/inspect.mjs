import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
const base = '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-ere-runtime-integration-author-20260829';
const scope = base + '/runtime-preflight-v1/v4';
const read = file => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2097152) throw new Error('regular bounded source');
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size) throw new Error('source size drift');
  return bytes;
};
const phase = JSON.parse(read(scope + '/START.json'));
if (!Number.isSafeInteger(phase.deadlineMs) || Date.now() >= phase.deadlineMs) throw new Error('phase deadline');
const source = read(base + '/rebind-v1/SEAL.json');
if (createHash('sha256').update(source).digest('hex') !== 'b3a3844213fe34017bb4b413bafda2433fd52a0d9165aed5810b01db245dfe95') throw new Error('seal identity');
const seal = JSON.parse(source);
if (seal.sources.length !== 305) throw new Error('source census');
const selection = [
  ['src/shell/arrays/ledger.ts', [[1, 270]]],
  ['src/shell/arrays/bindings.ts', [[1, 170]]],
  ['src/commands/regex-execution/ere/transport/worker-entry.ts', [[1, 100]]],
  ['src/commands/regex-execution/ere/transport/owner.ts', [[1, 170]]],
  ['src/commands/regex-execution/ere/transport/validation.ts', [[1, 260]]],
  ['src/commands/regex-execution/ere/limits.ts', [[1, 100]]],
  ['src/commands/regex-execution/ere/syntax.ts', [[75, 180]]],
];
const records = [];
for (const [name, windows] of selection) {
  const authority = seal.sources.find(row => row.path === name);
  if (!authority) throw new Error('unselected source');
  const bytes = read(base + '/rebind-v1/candidate/' + name);
  if (bytes.length !== authority.bytes || createHash('sha256').update(bytes).digest('hex') !== authority.sha256) throw new Error('source binding');
  records.push(authority);
  const lines = bytes.toString('utf8').split('\n');
  console.log('\nFILE', name);
  for (const [start, end] of windows) for (let index = start - 1; index < Math.min(end, lines.length); index++) console.log(`${index + 1}: ${lines[index]}`);
}
fs.writeFileSync(scope + '/SOURCE-INSPECTION.json', JSON.stringify({ phase, selectedTree: seal.selectedTree, records, pid: process.pid, productImports: 0 }, null, 2) + '\n', { flag: 'wx' });
