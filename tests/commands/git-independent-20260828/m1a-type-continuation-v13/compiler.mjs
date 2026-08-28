import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import workerThreads from 'node:worker_threads';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { checkFile, hash } from './guard.mjs';

const root = dirname(fileURLToPath(import.meta.url));
let nestedProcessAttempts = 0, networkAttempts = 0;
const denyProcess = () => { nestedProcessAttempts++; throw new Error('UNDECLARED_CHILD_REFUSED'); };
const denyNetwork = () => { networkAttempts++; throw new Error('NETWORK_REFUSED'); };
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[key] = denyProcess;
workerThreads.Worker = denyProcess;
net.connect = denyNetwork; net.createConnection = denyNetwork; net.Socket.prototype.connect = denyNetwork;
tls.connect = denyNetwork; http.request = denyNetwork; http.get = denyNetwork;
https.request = denyNetwork; https.get = denyNetwork; dgram.createSocket = denyNetwork;
syncBuiltinESMExports();
try {
  const sealBytes = readFileSync(root + '/PRESEAL.json');
  assert.equal(hash(sealBytes), process.env.M1A_SEAL_SHA256);
  const seal = JSON.parse(sealBytes);
  assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
  checkFile(seal.node);
  for (const row of seal.files) checkFile(row);
  const bindings = JSON.parse(readFileSync(root + '/INPUT-BINDINGS.json'));
  const role = seal.roles.find(entry => entry.id === process.argv[2]);
  assert.ok(role);
  const routes = new Map(bindings.routes.map(entry => [entry.logical, entry]));
  assert.equal(routes.size, bindings.routes.length);
  const directories = new Set(), reads = new Map(), missing = new Set();
  for (const logical of routes.keys()) {
    let directory = dirname(logical);
    while (!directories.has(directory)) {
      directories.add(directory);
      if (directory === '/') break;
      directory = dirname(directory);
    }
  }
  const normalize = path => resolve(seal.logicalCwd, path);
  const read = path => {
    const logical = normalize(path), row = routes.get(logical);
    if (!row) { missing.add(logical); return undefined; }
    const bytes = checkFile(row, row.physical);
    reads.set(logical, row);
    return bytes.toString('utf8');
  };
  checkFile(seal.compiler, seal.compiler.entry);
  const ts = createRequire(import.meta.url)(seal.compiler.entry);
  assert.equal(ts.version, seal.compiler.version);
  const parsed = ts.parseCommandLine(role.args);
  assert.deepEqual(parsed.errors, []); assert.deepEqual(parsed.fileNames, [role.consumer]);
  assert.equal(parsed.options.noEmit, true); assert.equal(parsed.options.strict, true);
  assert.equal(parsed.options.exactOptionalPropertyTypes, true); assert.equal(parsed.options.skipLibCheck, false);
  const host = ts.createCompilerHost(parsed.options, true);
  host.readFile = read;
  host.fileExists = path => routes.has(normalize(path));
  host.directoryExists = path => directories.has(normalize(path));
  host.getDirectories = path => [...directories].filter(entry => entry !== normalize(path) && dirname(entry) === normalize(path));
  host.readDirectory = () => { throw new Error('UNSEALED_DIRECTORY_ENUMERATION'); };
  host.realpath = normalize;
  host.getCurrentDirectory = () => seal.logicalCwd;
  host.getEnvironmentVariable = () => '';
  host.writeFile = () => { throw new Error('NO_EMIT_WRITE_REFUSED'); };
  host.createDirectory = () => { throw new Error('DIRECTORY_WRITE_REFUSED'); };
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, host });
  const beforeEmit = ts.getPreEmitDiagnostics(program);
  const emitted = program.emit();
  assert.equal(emitted.emitSkipped, true);
  const nativeDiagnostics = ts.sortAndDeduplicateDiagnostics([...beforeEmit, ...emitted.diagnostics]);
  const diagnostic = entry => {
    const position = entry.file && entry.start !== undefined ? entry.file.getLineAndCharacterOfPosition(entry.start) : undefined;
    return { code: entry.code, category: entry.category, file: entry.file?.fileName ?? null, start: entry.start ?? null, length: entry.length ?? null, line: position ? position.line + 1 : null, column: position ? position.character + 1 : null, message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'), related: (entry.relatedInformation ?? []).map(diagnostic) };
  };
  const sourceFiles = program.getSourceFiles().map(source => {
    const row = routes.get(source.fileName);
    assert.ok(row, 'unrouted source ' + source.fileName);
    assert.equal(hash(Buffer.from(source.text)), row.sha256, source.fileName);
    if (row.group === 'package' || row.group === 'type-scaffold') assert.ok(source.fileName.endsWith('.d.ts'));
    return row;
  });
  assert.ok(sourceFiles.some(row => row.logical === role.consumer));
  assert.ok(sourceFiles.some(row => row.logical === seal.logicalPackage + (role.id === 'positive' ? '/dist/commands/git/index.d.ts' : '/dist/index.d.ts')));
  assert.equal(nestedProcessAttempts, 0); assert.equal(networkAttempts, 0);
  const code = nativeDiagnostics.length ? ts.ExitStatus.DiagnosticsPresent_OutputsSkipped : ts.ExitStatus.Success;
  const formatted = ts.formatDiagnostics(nativeDiagnostics, { getCurrentDirectory: () => seal.logicalCwd, getCanonicalFileName: path => path, getNewLine: () => '\n' });
  console.log(JSON.stringify({ schema: 'M1A-v13-compiler-result', role: role.id, pid: process.pid, ppid: process.ppid, node: seal.node, compiler: seal.compiler, args: role.args, parsedOptions: parsed.options, consumerSha256: hash(checkFile(routes.get(role.consumer), role.consumer)), logicalCwd: seal.logicalCwd, physicalCwd: process.cwd(), nativeExitCode: code, diagnostics: nativeDiagnostics.map(diagnostic), formatted, sourceFiles, reads: [...reads.values()], missing: [...missing].sort(), nestedProcessAttempts, networkAttempts, noEmit: true }));
  process.exitCode = code;
} catch (error) {
  console.error(JSON.stringify({ schema: 'M1A-v13-wrapper-failure', message: error.message, stack: error.stack, nestedProcessAttempts, networkAttempts }));
  process.exitCode = 1;
}
