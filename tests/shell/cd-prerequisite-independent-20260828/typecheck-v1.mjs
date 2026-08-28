import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { blob, directory, evidence, exclusiveJson, root, sha256 } from './audit.mjs';

const compilerPath = resolve(root, 'node_modules/typescript/lib/typescript.js');
const compilerHash = sha256(readFileSync(compilerPath));
assert.equal(compilerHash, '3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675');
const ts = (await import(pathToFileURL(compilerPath).href)).default;
const evidencePath = 'tests/integration/combined77-stage2-independent-20260828/actual-01.json.gz.base64';
const encoded = blob(evidence, evidencePath);
assert.equal(sha256(encoded), '583f870007f3fe4cd2f9d1b8e979e715b0d8bd975e486a88d2716d705063d0e6');
const compressedEvidence = Buffer.from(encoded.toString().trim(), 'base64');
assert.equal(sha256(compressedEvidence), '88fadf81a9ab984e4c25ff26f9f1d13331967549c0dbe08fbce268ee7ed1da12');
const retained = JSON.parse(gunzipSync(compressedEvidence));
const packageBytes = Buffer.from(retained.package.base64, 'base64');
assert.equal(sha256(packageBytes), '13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9');
const tar = gunzipSync(packageBytes);
const virtualRoot = resolve(directory, '__in_memory_only__');
const packageRoot = resolve(virtualRoot, 'node_modules/virtual-bash');
const virtualFiles = new Map();
const declarations = {};
let authenticatedPackageEntries = 0;
const tarString = (header, offset, size) => header.subarray(offset, offset + size).toString().replace(/\0.*$/su, '');
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every(byte => byte === 0)) break;
  const name = tarString(header, 0, 100);
  const prefix = tarString(header, 345, 155);
  const path = prefix ? `${prefix}/${name}` : name;
  const size = Number.parseInt(tarString(header, 124, 12).trim(), 8) || 0;
  const kind = tarString(header, 156, 1);
  const data = tar.subarray(offset + 512, offset + 512 + size);
  assert(path.startsWith('package/') && !path.split('/').includes('..'), path);
  assert(kind === '0' || kind === '', `unexpected package tar entry kind ${kind}`);
  const relativePath = path.slice(8);
  assert.equal(sha256(data), retained.packageInventory[relativePath].sha256, relativePath);
  authenticatedPackageEntries++;
  if (relativePath.endsWith('.d.ts') || relativePath === 'package.json') {
    virtualFiles.set(resolve(packageRoot, relativePath), data.toString());
    declarations[relativePath] = { sha256: sha256(data), bytes: data.length };
  }
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.equal(authenticatedPackageEntries, 846);
assert.equal(authenticatedPackageEntries, Object.keys(retained.packageInventory).length);
const virtualDirectories = new Set([virtualRoot]);
for (const path of virtualFiles.keys()) {
  let parent = dirname(path);
  while (parent.startsWith(virtualRoot)) { virtualDirectories.add(parent); parent = dirname(parent); }
}
const tools = new Map();
const allowedToolRoots = ['typescript', '@types/node', 'undici-types'].map(name => resolve(root, 'node_modules', name));
const isTool = path => allowedToolRoots.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
const results = [];

for (const polarity of ['positive', 'negative']) {
  const fixtureName = `types-${polarity}-v1.mts.fixture`;
  const source = readFileSync(resolve(directory, fixtureName), 'utf8');
  const virtualConsumer = resolve(virtualRoot, `${polarity}.mts`);
  virtualFiles.set(virtualConsumer, source);
  const options = {
    strict: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, lib: ['lib.es2023.d.ts'],
    types: ['node'], typeRoots: [resolve(root, 'node_modules/@types')],
  };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => virtualRoot;
  host.fileExists = path => virtualFiles.has(resolve(path)) || isTool(resolve(path)) && existsSync(path) && statSync(path).isFile();
  host.readFile = path => {
    const full = resolve(path);
    if (virtualFiles.has(full)) return virtualFiles.get(full);
    if (!isTool(full) || !existsSync(full) || !statSync(full).isFile()) return undefined;
    const bytes = readFileSync(full);
    tools.set(full.slice(root.length + 1), { sha256: sha256(bytes), bytes: bytes.length });
    return bytes.toString();
  };
  host.directoryExists = path => virtualDirectories.has(resolve(path))
    || (isTool(resolve(path)) || allowedToolRoots.some(prefix => prefix.startsWith(`${resolve(path)}/`)))
      && existsSync(path) && statSync(path).isDirectory();
  host.realpath = path => path;
  host.getSourceFile = (path, languageVersion) => {
    const text = host.readFile(path);
    return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true);
  };
  const program = ts.createProgram([virtualConsumer], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ({
    code: diagnostic.code,
    file: diagnostic.file ? diagnostic.file.fileName.slice(virtualRoot.length + 1) : null,
    line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : null,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
  if (polarity === 'positive') assert.deepEqual(diagnostics, []);
  else {
    const lines = source.split('\n').flatMap((line, index) => line.startsWith('export const Negative') ? [index + 1] : []);
    assert.equal(lines.length, 10);
    assert.equal(diagnostics.length, 10, JSON.stringify(diagnostics));
    assert.deepEqual(diagnostics.map(item => item.line).sort((left, right) => left - right), lines);
    assert(diagnostics.every(item => item.file === 'negative.mts' && [2322, 2375].includes(item.code)), JSON.stringify(diagnostics));
  }
  const loadedDeclarations = program.getSourceFiles().filter(file => file.fileName.startsWith(packageRoot)).map(file => file.fileName.slice(packageRoot.length + 1)).sort();
  assert(loadedDeclarations.includes('dist/index.d.ts'));
  assert(loadedDeclarations.includes('dist/shell/types.d.ts'));
  assert(program.getSourceFiles().every(file => file.fileName === virtualConsumer || file.fileName.endsWith('.d.ts')), 'implementation source loaded by typecheck');
  results.push({ polarity, fixtureName, fixtureSha256: sha256(source), assertions: 10, diagnostics, loadedDeclarations });
}

const report = {
  schema: 'cd-independent-baseline-types/v1', checkedAt: new Date().toISOString(),
  kind: 'Static accepted-baseline declaration binding, not candidate execution/build/install/move',
  compiler: { version: ts.version, path: 'node_modules/typescript/lib/typescript.js', sha256: compilerHash },
  package: { sha256: sha256(packageBytes), authenticatedEntries: authenticatedPackageEntries, materializedToDisk: false, runtimeModulesImported: 0 },
  declarationInputs: declarations, toolInputs: Object.fromEntries([...tools].sort()), results,
  positiveAssertions: 10, negativeAssertions: 10,
  futureNegativeInversionsExecuted: false,
};
if (process.argv[2] === '--capture') exclusiveJson('TYPE-BINDING-v1.json', report);
console.log(JSON.stringify({ baselinePositive: 10, intendedNegativeDiagnostics: 10, packageEntriesAuthenticated: authenticatedPackageEntries, runtimeImports: 0, productBuilds: 0 }));
