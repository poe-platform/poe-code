import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const repo = '/Users/kjopek/Workspace/safe-bash';
const report = join(repo, 'benchmarks/reports/sort-performance-next-20260827');
const inputs = JSON.parse(readFileSync(join(report, 'inputs.json')));
const scratch = inputs.scratch;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(join(repo, 'package.json'));
const ts = require('typescript');
const edits = [];
function instrument(path, transform) {
  const target = join(scratch, 'instrumented', path);
  let text = readFileSync(target, 'utf8');
  assert.equal(hash(text), inputs.sourceFiles[path].sha256);
  const replace = (before, after) => { assert.equal(text.split(before).length - 1, 1, before); text = text.replace(before, after); edits.push({ path, before, after }); };
  transform(replace);
  writeFileSync(target, text);
  writeFileSync(join(report, path.endsWith('text.ts') ? 'instrumented-text.ts.txt' : 'instrumented-internal.ts.txt'), text, { flag: 'wx' });
}
instrument('src/commands/text.ts', replace => {
  replace('function compareBytes', 'const profile = () => (globalThis as any).__sortProfile;\nfunction compareBytes');
  replace('return Buffer.compare(left, right);', 'profile()?.count("byteCompare"); return Buffer.compare(left, right);');
  replace('  const parse = (bytes: Uint8Array) => {', '  profile()?.count("numericCompare");\n  const parse = (bytes: Uint8Array) => {');
  replace('    return { whole, fraction, negative:', '    profile()?.numeric(bytes, whole, fraction);\n    return { whole, fraction, negative:');
  replace('    const firstFraction = first.fraction.padEnd(width, "0");', '    profile()?.count("fractionPadEndCalls", 2);\n    profile()?.count("fractionPaddedLogicalCharacters", width * 2);\n    const firstFraction = first.fraction.padEnd(width, "0");');
  replace('  return line.subarray(Math.min(start, line.length), Math.max(start, end));', '  const selected = line.subarray(Math.min(start, line.length), Math.max(start, end));\n  profile()?.key(line, selected, fields.length);\n  return selected;');
  replace('    let start = 0;\n    for (let offset = 0; offset < chunk.length; offset++) {', '    profile()?.count("collectorChunks"); profile()?.count("collectorScannedBytes", chunk.length);\n    let start = 0;\n    for (let offset = 0; offset < chunk.length; offset++) {');
  replace('      else accept(new Uint8Array(part));', '      else { profile()?.count("collectorDirectCopyBytes", part.length); accept(new Uint8Array(part)); }');
  replace('      pending.push(new Uint8Array(chunk.subarray(start)));', '      profile()?.count("collectorTailCopyBytes", chunk.length - start);\n      pending.push(new Uint8Array(chunk.subarray(start)));');
  replace('      if (pending.length) { pending.push(part); accept(concatenate(pending, size)); }', '      if (pending.length) { profile()?.count("collectorConcatCopyBytes", size); pending.push(part); accept(concatenate(pending, size)); }');
  replace('  if (size) accept(concatenate(pending, size));', '  if (size) { profile()?.count("collectorConcatCopyBytes", size); accept(concatenate(pending, size)); }');
  replace('compareBytes(left, right) * direction : (left: Uint8Array, right: Uint8Array) => {', '(profile()?.count("keyCompare"), compareBytes(left, right) * direction) : (left: Uint8Array, right: Uint8Array) => {\n        profile()?.count("keyCompare");');
  replace('              records.push(bytes);', '              profile()?.count("collectedRecords"); profile()?.count("collectedPayloadBytes", bytes.length);\n              records.push(bytes);');
  replace('      records.sort(compare);', '      profile()?.phase("sort");\n      records.sort(compare);\n      profile()?.phase("emit");');
});
instrument('src/commands/internal.ts', replace => {
  replace('export async function output(context: CommandContext, text: string | Uint8Array): Promise<void> {', 'export async function output(context: CommandContext, text: string | Uint8Array): Promise<void> {\n  (globalThis as any).__sortProfile?.count("outputCalls." + context.command);');
  replace('export async function* lines(source: ByteSource, separator = 10): AsyncGenerator<Line> {', 'export async function* lines(source: ByteSource, separator = 10): AsyncGenerator<Line> {\n  (globalThis as any).__sortProfile?.count("linesInvocations");');
  replace('      yield { bytes: concatenate(pending, size), terminated: true };', '      (globalThis as any).__sortProfile?.count("linesYieldRecords");\n      (globalThis as any).__sortProfile?.count("linesConcatBytes", size);\n      yield { bytes: concatenate(pending, size), terminated: true };');
  replace('  if (size) yield { bytes: concatenate(pending, size), terminated: false };', '  if (size) { (globalThis as any).__sortProfile?.count("linesYieldRecords"); (globalThis as any).__sortProfile?.count("linesConcatBytes", size); yield { bytes: concatenate(pending, size), terminated: false }; }');
});
const manifest = { tools: { node: process.version, nodeSha256: hash(readFileSync(process.execPath)), typescript: ts.version, typescriptPath: require.resolve('typescript'), typescriptSha256: hash(readFileSync(require.resolve('typescript'))) }, options: { target: 'ES2023', module: 'ES2022', isolatedTranspilation: true, typechecking: false }, edits, trees: {} };
for (const variant of ['control', 'instrumented']) {
  const tree = manifest.trees[variant] = {};
  for (const path of Object.keys(inputs.sourceFiles)) {
    const original = readFileSync(join(scratch, variant, path));
    if (variant === 'control' || !edits.some(edit => edit.path === path)) assert.equal(hash(original), inputs.sourceFiles[path].sha256);
    tree[path] = hash(original);
    if (!path.endsWith('.ts')) continue;
    const emitted = ts.transpileModule(original.toString(), { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } }).outputText;
    const output = path.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js');
    mkdirSync(dirname(join(scratch, variant, output)), { recursive: true });
    writeFileSync(join(scratch, variant, output), emitted, { flag: 'wx' });
    tree[output] = hash(emitted);
  }
  writeFileSync(join(scratch, variant, 'package.json'), '{"type":"module"}\n', { flag: 'wx' });
  tree['package.json'] = hash(readFileSync(join(scratch, variant, 'package.json')));
}
writeFileSync(join(report, 'instrumentation.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ modules: Object.keys(manifest.trees.control).filter(path => path.endsWith('.js')).length, edits: edits.length, tools: manifest.tools }));
