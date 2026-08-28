import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = readFileSync(process.argv[2]);
assert.equal(hash(bytes), process.env.CD_REVIEW_CONFIG_SHA256);
const config = JSON.parse(bytes);
assert.equal(config.authorization, 'ROOT_EXECUTION_AUTHORIZED');
assert.equal(config.binding.state, 'routed-candidate');
assert.equal(config.route.bindingSha256, hash(JSON.stringify(config.binding)));
assert.equal(config.route.authorization, config.authorization);
assert.equal(config.route.candidateCommit, config.binding.candidateCommit);
assert(/^[a-f0-9]{40}$/u.test(config.binding.candidateCommit) && config.route.reference);
assert.equal(hash(readFileSync(config.compiler)), config.allowed[config.compiler]);
const compiler = (await import(pathToFileURL(config.compiler).href)).default;
const options = { strict: true, exactOptionalPropertyTypes: true, skipLibCheck: true, noEmit: true, target: compiler.ScriptTarget.ES2023, module: compiler.ModuleKind.NodeNext, moduleResolution: compiler.ModuleResolutionKind.NodeNext, types: ['node'], lib: ['lib.es2023.d.ts'] };
if (config.mode === 'source') options.paths = { 'virtual-bash': [resolve(config.packageRoot, 'dist/index.d.ts')] };
const allReads = new Set();
const deniedReads = new Set();
function check(file, replacement) {
  const host = compiler.createCompilerHost(options);
  const read = host.readFile;
  host.readFile = path => {
    const normalized = resolve(path);
    if (!config.allowed[normalized]) { deniedReads.add(normalized); return undefined; }
    const content = read(path);
    assert.equal(hash(content), config.allowed[normalized], `TYPE_HASH:${path}`);
    allReads.add(normalized);
    return normalized === file && replacement !== undefined ? replacement : content;
  };
  host.fileExists = path => Boolean(config.allowed[resolve(path)]);
  host.getSourceFile = (path, languageVersion) => {
    const content = host.readFile(path);
    return content === undefined ? undefined : compiler.createSourceFile(path, content, languageVersion);
  };
  const program = compiler.createProgram([file], options, host);
  return compiler.getPreEmitDiagnostics(program).map(diagnostic => ({ code: diagnostic.code, file: diagnostic.file?.fileName, line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined, message: compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n') }));
}
const positive = resolve(config.consumer, 'types-positive-v1.mts');
const negative = resolve(config.consumer, 'types-negative-v1.mts');
assert.deepEqual(check(positive), []);
const original = readFileSync(negative, 'utf8');
const lines = original.split('\n');
const locations = lines.flatMap((line, index) => /^export const Negative\d\d:/u.test(line) ? [index + 1] : []);
assert.equal(locations.length, 10);
const diagnostics = check(negative);
const admitted = entries => entries.forEach(entry => { assert.equal(resolve(entry.file), negative); assert([2322, 2375].includes(entry.code)); });
admitted(diagnostics);
assert.deepEqual(diagnostics.map(entry => entry.line).sort((left, right) => left - right), locations);
const inversions = [];
for (const line of locations) {
  const altered = [...lines];
  altered[line - 1] = altered[line - 1].replace(/ = .*;$/u, ' = undefined as never;');
  const remaining = check(negative, altered.join('\n'));
  admitted(remaining);
  assert.deepEqual(remaining.map(entry => entry.line).sort((left, right) => left - right), locations.filter(location => location !== line));
  inversions.push({ line, classification: 'single-negative-input-neutralized-in-memory', remaining: remaining.length });
}
assert([...allReads].some(path => path === resolve(config.packageRoot, 'dist/index.d.ts')), 'actual candidate root declaration must be read');
writeFileSync(config.resultPath, JSON.stringify({ classification: 'future-candidate-declaration-evidence', mode: config.mode, positive: 10, negative: 10, diagnostics, inversions, reads: [...allReads].sort(), deniedReads: [...deniedReads].sort() }), { flag: 'wx' });
