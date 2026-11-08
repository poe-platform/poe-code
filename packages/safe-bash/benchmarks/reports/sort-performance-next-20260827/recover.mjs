import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const repo = '/Users/kjopek/Workspace/safe-bash';
const report = join(repo, 'benchmarks/reports/sort-performance-next-20260827');
const inputs = JSON.parse(readFileSync(join(report, 'inputs.json')));
const instrumentation = JSON.parse(readFileSync(join(report, 'instrumentation.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(join(repo, 'package.json'));
const ts = require('typescript');
assert.equal(hash(readFileSync(require.resolve('typescript'))), instrumentation.tools.typescriptSha256);
assert.equal(existsSync(inputs.scratch), false);
for (const variant of ['control', 'instrumented']) {
  for (const path of Object.keys(inputs.sourceFiles)) {
    let bytes = execFileSync('git', ['show', `${inputs.selectedObservedCommittedSnapshot}:${path}`], { cwd: repo, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(hash(bytes), inputs.sourceFiles[path].sha256);
    if (variant === 'instrumented' && ['src/commands/text.ts', 'src/commands/internal.ts'].includes(path)) bytes = readFileSync(join(report, path.endsWith('text.ts') ? 'instrumented-text.ts.txt' : 'instrumented-internal.ts.txt'));
    assert.equal(hash(bytes), instrumentation.trees[variant][path]);
    const target = join(inputs.scratch, variant, path);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' });
    if (!path.endsWith('.ts')) continue;
    const emitted = ts.transpileModule(bytes.toString(), { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } }).outputText;
    const output = path.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js');
    assert.equal(hash(emitted), instrumentation.trees[variant][output]);
    mkdirSync(dirname(join(inputs.scratch, variant, output)), { recursive: true });
    writeFileSync(join(inputs.scratch, variant, output), emitted, { flag: 'wx' });
  }
  writeFileSync(join(inputs.scratch, variant, 'package.json'), '{"type":"module"}\n', { flag: 'wx' });
}
writeFileSync('/tmp/sort-performance-next-independent-state.txt', inputs.scratch + '\n', { flag: 'wx' });
console.log('Reconstructed identical authenticated product/source/emitted trees after pre-import harness failure; no workload had executed.');
