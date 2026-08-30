import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { save, sha256 } from './review-lib.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const [mode, target, output, scratch] = process.argv.slice(2);
const probes = JSON.parse(fs.readFileSync(new URL('./type-probes.json', import.meta.url), 'utf8'));
fs.mkdirSync(scratch, { recursive: false });
fs.symlinkSync(target, path.join(scratch, 'candidate'), 'dir');
const results = [];
const compile = (group) => {
  const files = group.map((probe) => {
    const filename = path.join(scratch, `${probe.id}.mts`);
    fs.writeFileSync(filename, probes.prelude + probe.code + '\n', { flag: 'wx' }); return filename;
  });
  const options = { noEmit: true, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true, types: ['node'],
    typeRoots: [path.dirname(path.dirname(require.resolve('@types/node/package.json')))] };
  const program = ts.createProgram(files, options);
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    file: diagnostic.file?.fileName ?? null, code: diagnostic.code, category: ts.DiagnosticCategory[diagnostic.category],
    line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : null,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
  const external = diagnostics.filter((diagnostic) => !files.includes(diagnostic.file));
  const inputFiles = program.getSourceFiles().map((file) => ({ filename: file.fileName, bytes: Buffer.byteLength(file.text), sha256: sha256(Buffer.from(file.text)) }));
  for (const [ordinal, probe] of group.entries()) {
    const own = diagnostics.filter((diagnostic) => diagnostic.file === files[ordinal]);
    const negative = probes.negative.some((entry) => entry.id === probe.id);
    const expectedLine = probes.prelude.split('\n').length;
    const pass = external.length === 0 && (negative ? own.length > 0 && own.every((entry) => entry.line >= expectedLine && ([2345, 2322, 2554, 2741, 2739].includes(entry.code) || (probe.id === 'T20' && entry.code === 2740 && entry.message.includes("type 'AbortSignal'")))) : own.length === 0);
    results.push({ id: probe.id, negative, status: pass ? 'pass' : 'fail', reason: probe.reason ?? 'valid private API consumer', diagnostics: own, externalDiagnostics: external });
  }
  return { inputFiles, diagnostics, options, roots: files };
};
const positive = compile(probes.positive);
assert(results.every((result) => result.status === 'pass'), 'positive type controls must pass before negative claims');
const negative = compile(probes.negative);
save(output, { mode, target, compiler: { version: ts.version, resolved: require.resolve('typescript'), sha256: sha256(fs.readFileSync(require.resolve('typescript'))) },
  counts: { total: results.length, pass: results.filter((result) => result.status === 'pass').length, fail: results.filter((result) => result.status === 'fail').length },
  results, positive, negative });
console.log(JSON.stringify({ mode, total: results.length, fail: results.filter((result) => result.status === 'fail').length }));
process.exitCode = results.some((result) => result.status === 'fail') ? 1 : 0;
