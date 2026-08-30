import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const privateRoot = '/tmp/safe-bash-stream-verifier-20260827-A';
const target = readFileSync(join(privateRoot, 'latest-snapshot.txt'), 'utf8').trim();
const ts = (await import(pathToFileURL(join(target, 'node_modules/typescript/lib/typescript.js')).href)).default;
const config = ts.readConfigFile(join(target, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, target);
const checks = [];
const output = join(target, 'isolated-build');
mkdirSync(output);
for (const [name, roots, options] of [
  ['scoped-noEmit', [join(target, 'tests/commands/stream-inspection-stress/holdouts.test.ts')], { ...parsed.options, noEmit: true }],
  ['isolated-source-factory-build', [join(target, 'src/commands/stream-inspection/index.ts')], { ...parsed.options, rootDir: join(target, 'src'), outDir: output, declaration: true, noEmitOnError: true }],
]) {
  const program = ts.createProgram(roots, options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const emitted = options.noEmit ? undefined : program.emit();
  const all = [...diagnostics, ...(emitted?.diagnostics ?? [])];
  checks.push({ name, at: new Date().toISOString(), roots, options, diagnostics: all.length, output: ts.formatDiagnostics(all, { getCurrentDirectory: () => target, getCanonicalFileName: value => value, getNewLine: () => '\n' }), emitSkipped: emitted?.emitSkipped ?? null });
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function hashes(directory) {
  const entries = {};
  function walk(path) { for (const entry of readdirSync(path, { withFileTypes: true })) { const child = join(path, entry.name); if (entry.isDirectory()) walk(child); else entries[child.slice(directory.length + 1)] = hash(readFileSync(child)); } }
  walk(directory);
  return entries;
}
const report = { target, at: new Date().toISOString(), argv: process.argv, checks, buildHashes: hashes(output), boundary: 'Selected stress harness noEmit and selected source factory isolated ESM/declaration build; not root npm test/build or public package export evidence' };
writeFileSync(join(target, 'validation.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report.checks, null, 2));
process.exitCode = checks.some(check => check.diagnostics || check.emitSkipped) ? 1 : 0;
