import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const evidence = path.dirname(fileURLToPath(import.meta.url));
const [mode, commit, name] = process.argv.slice(2);
assert.ok(['baseline', 'candidate'].includes(mode) && /^[a-f0-9]{40}$/u.test(commit) && /^[a-z0-9-]+$/u.test(name));
const output = path.join(evidence, name);
fs.mkdirSync(output);
const stage = fs.mkdtempSync(path.join(evidence, '.work-'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const commands = [];
function execute(binary, args, cwd = stage, extra = {}) {
  const result = spawnSync(binary, args, { cwd, timeout: 120000, maxBuffer: 12_000_000, killSignal: 'SIGKILL', ...extra });
  commands.push({ binary, args, cwd, status: result.status, signal: result.signal, failure: result.error?.message ?? null });
  assert.ifError(result.error); assert.equal(result.signal, null);
  return result;
}
function save(name, value) { fs.writeFileSync(path.join(output, name), value, { flag: 'wx' }); }
function inventory(directory = stage, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
    const relative = prefix + entry.name;
    if (relative === 'node_modules' || relative === 'dist') return [];
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [{ path: relative, symlink: fs.readlinkSync(file) }];
    return entry.isDirectory() ? inventory(file, `${relative}/`) : [{ path: relative, sha256: sha256(fs.readFileSync(file)) }];
  });
}
let before;
try {
  const archive = execute('git', ['archive', commit, 'src', 'tests/commands/expr', 'tests/commands/expr-author/regex-audit-cases.ts', 'package.json', 'tsconfig.json', 'tsconfig.build.json'], root);
  assert.equal(archive.status, 0);
  const unpack = execute('/usr/bin/tar', ['-xf', '-'], stage, { input: archive.stdout });
  assert.equal(unpack.status, 0);
  const regressionPaths = ['tests/commands/expr/diagnostics-regression.test.ts', 'tests/commands/expr/diagnostics/cases.ts'];
  if (mode === 'baseline') for (const file of regressionPaths) {
    fs.mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(stage, file), fs.constants.COPYFILE_EXCL);
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(stage, 'node_modules'));
  fs.mkdirSync(path.join(stage, 'tests/commands/metadata-stress'), { recursive: true });
  fs.symlinkSync(path.join(root, 'tests/commands/metadata-stress/.oracle'), path.join(stage, 'tests/commands/metadata-stress/.oracle'));
  fs.writeFileSync(path.join(stage, 'diagnostics-strict.json'), JSON.stringify({ extends: './tsconfig.json', compilerOptions: { noEmit: true, skipLibCheck: false }, include: ['src/**/*.ts', 'tests/commands/expr/**/*.ts', 'tests/commands/expr-author/regex-audit-cases.ts'], exclude: [] }, null, 2) + '\n');
  before = inventory();
  save('inputs-before.json', JSON.stringify({ commit, archiveSha256: sha256(archive.stdout), overlay: mode === 'baseline' ? regressionPaths : [], files: before }, null, 2) + '\n');
  const compiler = path.join(root, 'node_modules/typescript/bin/tsc');
  for (const [label, config] of [['build', 'tsconfig.build.json'], ['strict', 'diagnostics-strict.json']]) {
    const result = execute(process.execPath, [compiler, '-p', config]);
    save(`${label}.log`, Buffer.concat([result.stdout, result.stderr]));
    assert.equal(result.status, 0, `${label} failed`);
  }
  const receipt = mode === 'baseline' ? path.join(output, 'native.json') : path.join(evidence, 'baseline27a', 'native.json');
  const comparison = execute(process.execPath, ['--import', 'tsx', path.join(evidence, 'compare.mjs'), stage, mode === 'baseline' ? 'capture' : 'compare', receipt], root);
  save('comparison.json', comparison.stdout); save('comparison.stderr', comparison.stderr);
  assert.equal(comparison.status, 0, 'comparison driver failed');
  const focused = execute(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', 'tests/commands/expr/diagnostics-regression.test.ts']);
  save('focused.tap', Buffer.concat([focused.stdout, focused.stderr]));
  const legacyFiles = fs.readdirSync(path.join(stage, 'tests/commands/expr')).filter(file => file.endsWith('.test.ts') && file !== 'diagnostics-regression.test.ts').sort().map(file => `tests/commands/expr/${file}`);
  const legacy = execute(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...legacyFiles]);
  save('legacy.tap', Buffer.concat([legacy.stdout, legacy.stderr]));
  const after = inventory();
  assert.deepEqual(after, before, 'stage input inventory detects changed, removed, and appended inputs (dist and node_modules excluded)');
  save('inputs-after.json', JSON.stringify({ files: after, identical: true, newEntriesChecked: true, exclusions: ['dist', 'node_modules'] }, null, 2) + '\n');
  console.log(JSON.stringify({ output, commit, focusedStatus: focused.status, legacyStatus: legacy.status, counts: JSON.parse(comparison.stdout).counts }, null, 2));
} finally {
  save('commands.json', JSON.stringify(commands, null, 2) + '\n');
  fs.rmSync(stage, { recursive: true, force: true });
  save('cleanup.json', JSON.stringify({ stage, removed: !fs.existsSync(stage), subprocesses: 'all synchronous children settled; timeout uses SIGKILL', globalGatesRun: false }) + '\n');
}
