import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { command } from './stage.mjs';
import { addEvidence, owned, root, sha256 } from './review.mjs';

const stage = JSON.parse(readFileSync(`${owned}/candidate-fe7083d9-20260827/stage.json`));
const consumer = dirname(dirname(stage.installed));
const installed = realpathSync(stage.installed);
const output = `${owned}/distribution-fe7083d9`;
if (process.argv[2] !== 'capture') { console.log('Version-specific distribution audit: explicit capture required; no files written.'); process.exit(0); }
assert(!existsSync(output));
function create(path, text) {
  assert(path.startsWith(`${consumer}/`)); assert(!existsSync(path));
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', timeout: 10000 }); assert.equal(result.status, 0, result.stderr);
}
const source = `import { CommandRegistry, MemoryFileSystem, Shell } from "virtual-bash";
import { createExprCommand, type ExprLimits } from "./node_modules/virtual-bash/dist/commands/expr/index.js";
import { RegexExecutor } from "./node_modules/virtual-bash/dist/commands/regex-execution/client.js";
import { exprMatchCeilings, type ExprMatchDescriptor, type ExprMatchResult } from "./node_modules/virtual-bash/dist/commands/regex-execution/protocol.js";
const options: Partial<ExprLimits> = { maxSteps: 10000, maxRegexNodes: 100 };
const definition = createExprCommand({ limits: options });
const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([definition]) });
const executor = new RegexExecutor();
const session = executor.open(new AbortController().signal);
const descriptor: ExprMatchDescriptor = { kind: "expr-match", pattern: new Uint8Array([97]), profile: "byte", limits: exprMatchCeilings };
const result: Promise<ExprMatchResult> = session.matchExpr(descriptor, new Uint8Array([97]));
void result; void shell; void session.close(); void executor.dispose();
// @ts-expect-error expr wire offsets are byte, not UTF16.
const wrongUnit: ExprMatchResult["offsetUnit"] = "utf16";
// @ts-expect-error descriptor pattern is bytes, not a string.
const wrongPattern: ExprMatchDescriptor["pattern"] = "a";
// @ts-expect-error endpoints are numeric byte coordinates.
const wrongSpan: ExprMatchResult["overall"] = { start: "0", end: 1 };
// @ts-expect-error expr is not integrated into the public root export.
import { createExprCommand as nonexistentRootExport } from "virtual-bash";
void wrongUnit; void wrongPattern; void wrongSpan; void nonexistentRootExport;
`;
const config = { compilerOptions: { strict: true, noEmit: true, skipLibCheck: false, module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', types: ['node'], typeRoots: [join(stage.source, 'node_modules/@types')] }, files: ['./review-consumer.mts'] };
create(join(consumer, 'review-consumer.mts'), source);
create(join(consumer, 'review-tsconfig.json'), JSON.stringify(config, null, 2));
const typecheck = await command(process.execPath, [join(stage.source, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'review-tsconfig.json'), '--traceResolution'], consumer, 60000);
addEvidence(`${output}/declaration-check.json`, { commit: stage.commit, sourceSha256: sha256(source), source, config, ...typecheck, qualification: typecheck.status === 0 ? 'PASS strict moved installed declaration consumer; dev Node types explicitly external' : 'FAILED DECLARATION QUALIFICATION' });
const smoke = `import assert from 'node:assert/strict';
import * as api from 'virtual-bash';
import { createExprCommand } from './node_modules/virtual-bash/dist/commands/expr/index.js';
import { matchExpr } from './node_modules/virtual-bash/dist/commands/expr/bre-worker.js';
import { exprMatchCeilings } from './node_modules/virtual-bash/dist/commands/regex-execution/protocol.js';
assert.equal(typeof api.createExprCommand, 'undefined');
const shell = new api.Shell({ fs: new api.MemoryFileSystem(), commands: new api.CommandRegistry([...api.createStandardCommands(), createExprCommand()]), env: { LC_ALL: 'C' } });
try {
  const result = await shell.exec("expr 41 + 1; expr abc : a");
  assert.equal(result.stdout, '42\\n1\\n'); assert.equal(result.stderr, ''); assert.equal(result.exitCode, 0);
  let blocked = false;
  try { matchExpr({ kind: 'expr-match', pattern: new Uint8Array([91]), profile: 'byte', limits: exprMatchCeilings }, new Uint8Array()); } catch (error) { blocked = /worker/.test(error.message); }
  assert(blocked);
  console.log(JSON.stringify({ rootImport: 'virtual-bash', standalone: './node_modules/virtual-bash/dist/commands/expr/index.js', rootExprIntegrated: false, stdout: result.stdout, mainThreadCompilerBlockedBeforeInvalidPattern: blocked }));
} finally { await shell.dispose(); }
`;
create(join(consumer, 'review-runtime.mjs'), smoke);
const runtime = await command(process.execPath, ['--unhandled-rejections=strict', join(consumer, 'review-runtime.mjs')], consumer, 10000);
addEvidence(`${output}/plain-node.json`, { commit: stage.commit, scriptSha256: sha256(smoke), script: smoke, ...runtime, qualification: runtime.status === 0 ? 'PASS moved bare public root import plus physical standalone expr; not a public expr subpath' : 'FAILED PLAIN NODE QUALIFICATION' });
const declarations = ['dist/commands/expr/index.d.ts', 'dist/commands/expr/internal.d.ts', 'dist/commands/regex-execution/protocol.d.ts', 'dist/commands/regex-execution/client.d.ts'].map(path => ({ path, sha256: sha256(readFileSync(join(installed, path))), contents: readFileSync(join(installed, path), 'utf8') }));
const visited = new Set(), edges = [], pending = [join(installed, 'dist/commands/regex-execution/worker.js')];
while (pending.length) {
  const path = pending.pop(); if (visited.has(path)) continue; visited.add(path);
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier.startsWith('node:')) { edges.push({ path, specifier }); continue; }
    assert(specifier.startsWith('.'), `non-builtin worker dependency ${specifier}`);
    const target = realpathSync(fileURLToPath(new URL(specifier, pathToFileURL(path))));
    assert(target.startsWith(`${installed}/dist/`)); edges.push({ path, specifier, target }); pending.push(target);
  }
  assert(!source.includes('import('), 'dynamic worker import requires separate binding');
}
const packageJson = JSON.parse(readFileSync(join(installed, 'package.json')));
assert.deepEqual(packageJson.dependencies ?? {}, {});
assert.equal(packageJson.exports['./commands/expr'], undefined);
addEvidence(`${output}/binding.json`, { candidate: stage.commit, installed, declarations, packageExports: packageJson.exports, runtimeDependencies: packageJson.dependencies ?? {}, limits: 'Descriptor maxPatternBytes/maxSubjectBytes bytes; maxNodes includes AST+instructions; maxDepth nesting; maxSteps work; maxStates cumulative search; maxAllocatedUnits logical allocation, not RSS. Expr maxArgumentBytes sums UTF8 argv bytes without terminators. maxOutputBytes includes LF.', protocol: 'ExprMatchDescriptor kind expr-match, byte pattern, byte/utf8-scalar profile, exact limits object. Request id/descriptor/one bytes-all=false-terminated=false row. Reply id/operation=expr-match/result or category/error. Result offsetUnit=byte, booleans, nullable {start,end} spans, steps integer.', seam: 'Public installed validator/executor/session plus injected Worker constructor, preserving actual client implementation; separate unmodified worker runs.', workerGraph: { files: [...visited].map(path => ({ path, sha256: sha256(readFileSync(path)) })), edges, allStaticProductImportsConfined: true }, classification: 'Physical standalone installed dist module only; no expr public package-subpath/default/root integration.' });
console.log(JSON.stringify({ typecheck: typecheck.status, runtime: runtime.status, runtimeOutput: runtime.stdout, runtimeError: runtime.stderr, workerModules: visited.size }));
