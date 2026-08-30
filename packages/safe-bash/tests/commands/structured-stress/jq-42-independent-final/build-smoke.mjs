import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { bytesResult, digest, root, sourceSnapshot } from '../jq-42-independent-review/common.mjs';
import { loadEvidence } from '../jq-42-independent-review/evidence.mjs';
import { artifact, directory } from './artifacts.mjs';

const before = sourceSnapshot();
const config = ts.readConfigFile(resolve(root, 'tsconfig.build.json'), ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const outputDirectory = resolve(directory, 'in-memory-build');
const options = { ...parsed.options, outDir: outputDirectory };
const emitted = new Map();
const host = ts.createCompilerHost(options);
host.writeFile = (filename, text) => emitted.set(pathToFileURL(filename).href, text);
const program = ts.createProgram(parsed.fileNames, options, host);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
const result = program.emit();
diagnostics.push(...result.diagnostics);
const diagnosticText = ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root,
  getCanonicalFileName: filename => filename, getNewLine: () => '\n' });
const built = sourceSnapshot();
assert.equal(diagnostics.length, 0, diagnosticText);
assert.equal(result.emitSkipped, false);
assert.ok(emitted.size > 0);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') || specifier.startsWith('file:')) {
      const url = new URL(specifier, context.parentURL ?? pathToFileURL(`${root}/`).href).href;
      if (emitted.has(url)) return { url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (emitted.has(url)) return { format: 'module', source: emitted.get(url), shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { createStructuredCommands, MemoryFileSystem, Shell, structuredCommands } = await import(pathToFileURL(resolve(outputDirectory, 'index.js')).href);
const evidence = loadEvidence();
const identifiers = ['unicode-records', 'raw-nul', 'review-generator-prefix-next-record', 'review-entries-duplicate-integer-keys', 'review-fromjson-two-error-records'];
const rows = [];
for (const id of identifiers) {
  const vector = evidence.vectors.find(candidate => candidate.id === id);
  assert.ok(vector);
  for (const route of ['direct', 'shell']) {
    const stdout = [];
    const stderr = [];
    const fs = new MemoryFileSystem();
    const stdin = (async function* () { yield Buffer.from(vector.inputHex, 'hex'); })();
    const options = { stdin, stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } }, signal: AbortSignal.timeout(1500) };
    const command = createStructuredCommands().find(definition => definition.name === 'jq');
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const response = route === 'direct'
      ? await command.execute({ command: 'jq', args: vector.argv, fs, cwd: '/', env: {}, stdinIsDefault: false, ...options })
      : await new Shell({ fs, cwd: '/', env: {} }).use(structuredCommands()).exec(['jq', ...vector.argv.map(quote)].join(' '), options);
    const actual = { status: response.exitCode, stdoutHex: Buffer.concat(stdout).toString('hex'), stderrHex: Buffer.concat(stderr).toString('hex') };
    rows.push({ id, route, expected: bytesResult(vector.expected), actual,
      pass: JSON.stringify(actual) === JSON.stringify(bytesResult(vector.expected)) });
  }
}
hooks.deregister();
const after = sourceSnapshot();
const stable = before.productSha256 === built.productSha256 && built.productSha256 === after.productSha256;
artifact(process.argv[2], { recordedAt: new Date().toISOString(), before, built, after, stable,
  method: 'TypeScript compiler API uses tsconfig.build.json, changing only outDir; full ESM/declaration/maps emit retained in memory. Node synchronous module hooks load emitted root ESM, with no tsx and no writes to unowned dist. This is not an npm-script or packed-install test.',
  compilerVersion: ts.version, emitSkipped: result.emitSkipped, diagnostics: diagnosticText, emittedFiles: emitted.size,
  emittedSha256: Object.fromEntries([...emitted].map(([url, text]) => [url.slice(pathToFileURL(`${outputDirectory}/`).href.length), digest(text)])),
  smoke: { vectors: identifiers.length, executions: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length }, rows });
console.log(JSON.stringify({ stable, emittedFiles: emitted.size, smokePass: rows.filter(row => row.pass).length, smokeTotal: rows.length }));
process.exitCode = !stable ? 2 : rows.some(row => !row.pass) ? 1 : 0;
