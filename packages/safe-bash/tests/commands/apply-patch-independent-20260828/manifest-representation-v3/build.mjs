import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [source, typescript, typeRoots, mockInput, mockOutput] = process.argv.slice(2);
const ts = (await import(pathToFileURL(typescript).href)).default;
assert.equal(ts.version, '5.9.3');
const config = ts.readConfigFile(path.join(source, 'tsconfig.build.json'), ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, source, { typeRoots: [typeRoots] });
assert.equal(parsed.errors.length, 0);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const emit = program.emit();
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emit.diagnostics];
for (const diagnostic of diagnostics) console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
console.log(JSON.stringify({ kind: 'build', typescript: ts.version, sources: parsed.fileNames, emitted: !emit.emitSkipped, diagnostics: diagnostics.length }));
if (diagnostics.length || emit.emitSkipped) process.exitCode = 1;
else fs.writeFileSync(mockOutput, ts.transpileModule(fs.readFileSync(mockInput, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 }, fileName: 'mock.ts' }).outputText, { flag: 'wx', mode: 0o644 });
