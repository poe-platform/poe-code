import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const repository = '/Users/kjopek/Workspace/safe-bash';
const candidate = '5110550da057398fffd1fb77bf538121c67c731f';
const evidence = '8fc39a531780c8c9f50072e6c068068dd721cddd';
const launcher = '32581a276c50d73aab987880518ce04b77f5c631';
const relativeRoot = 'tests/comparison/breadth-continuation-20260828/executor-v7-r2';
const root = path.join(repository, relativeRoot);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const failures = [];
let assertions = 0;
const check = (condition, label) => { assertions++; if (!condition) failures.push(label); };
const git = args => {
  const result = spawnSync('git', args, { cwd: repository, maxBuffer: 2 * 1024 * 1024, encoding: null });
  if (result.status !== 0) throw new Error(`GIT_METADATA_FAILURE:${args[0]}`);
  return result.stdout;
};
const instruction = filename => filename.split(path.sep).some(member => member.toLowerCase() === 'agents.md');
const digestFile = filename => {
  if (instruction(filename)) throw new Error('INSTRUCTION_PLAINTEXT_FORBIDDEN');
  const digest = createHash('sha256');
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(65536);
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      digest.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(descriptor); }
  return digest.digest('hex');
};
const read = filename => {
  if (instruction(filename)) throw new Error('INSTRUCTION_PLAINTEXT_FORBIDDEN');
  const metadata = fs.lstatSync(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 2 * 1024 * 1024) throw new Error('SOURCE_READ_BOUND');
  return fs.readFileSync(filename);
};
const authenticate = (commit, relative, expectedHash, expectedBytes) => {
  const bytes = read(path.join(repository, relative));
  const frozen = git(['show', `${commit}:${relative}`]);
  check(bytes.equals(frozen), `git-byte-binding:${relative}`);
  if (expectedHash) check(hash(bytes) === expectedHash, `fixed-hash:${relative}`);
  if (expectedBytes !== undefined) check(bytes.length === expectedBytes, `fixed-bytes:${relative}`);
  return { path: relative, sha256: hash(bytes), bytes: bytes.length, mode: fs.lstatSync(path.join(repository, relative)).mode & 0o7777, commit };
};
const anchors = [
  authenticate(candidate, `${relativeRoot}/SEAL.json`, 'b19d04354088d31ac387c82606aaa0a7ce64cf26efd0ffbebcfc4f4e5969a03c', 93967),
  authenticate(candidate, `${relativeRoot}/INTERFACE.json`, '33e2c6ca9213f10645f2421e7390a2451d8e320d34cdfe3746366efffb1286b7', 10754),
  authenticate(evidence, `${relativeRoot}/runs/handoff-01/README.md`),
  authenticate(evidence, `${relativeRoot}/runs/handoff-01/HANDOFF.json`),
  authenticate(launcher, `${relativeRoot}/runs/launch-r2-01/launch.mjs`),
];
const seal = JSON.parse(read(path.join(root, 'SEAL.json')));
const iface = JSON.parse(read(path.join(root, 'INTERFACE.json')));
const handoff = JSON.parse(read(path.join(root, 'runs/handoff-01/HANDOFF.json')));
const evidenceBindings = [];
for (const [role, entry] of Object.entries(handoff.evidence)) {
  const filename = path.join(root, entry.path);
  const metadata = fs.lstatSync(filename);
  const sha256 = digestFile(filename);
  check(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size === entry.bytes && sha256 === entry.sha256, `handoff-evidence:${role}`);
  const relative = path.relative(repository, filename);
  const tree = git(['ls-tree', evidence, '--', relative]).toString().trim();
  if (tree) check(hash(git(['show', `${evidence}:${relative}`])) === sha256, `evidence-git-blob:${role}`);
  evidenceBindings.push({ role, path: entry.path, bytes: metadata.size, mode: metadata.mode & 0o7777, sha256, classification: tree ? 'evidence-git-blob' : 'handoff-bound-materialized-evidence' });
}
check(seal.files.length === 359, 'sealed-count359');
check(handoff.candidateCommit === candidate && handoff.launcherCommit === launcher, 'handoff-commits');
check(seal.interfaceSha256 === anchors[1].sha256 && handoff.bindings.recipe.sha256 === anchors[0].sha256 && handoff.bindings.interface.sha256 === anchors[1].sha256, 'handoff-hashes');
const bindings = [];
const sourceFiles = new Map();
for (const entry of seal.files) {
  const filename = path.resolve(root, entry.path);
  if (instruction(filename)) {
    bindings.push({ path: entry.path, classification: 'instruction-member-metadata-only', expected: entry });
    continue;
  }
  const metadata = fs.lstatSync(filename);
  const sha256 = digestFile(filename);
  check(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size === entry.bytes && (metadata.mode & 0o7777) === entry.mode && sha256 === entry.sha256, `sealed-file:${entry.path}`);
  let classification = 'external-tool';
  let gitMode = null;
  if (filename.startsWith(`${repository}/`)) {
    const relative = path.relative(repository, filename);
    const tree = git(['ls-tree', candidate, '--', relative]).toString().trim();
    if (tree) {
      classification = 'candidate-git-blob';
      gitMode = tree.split(' ')[0];
      const frozen = git(['show', `${candidate}:${relative}`]);
      check(hash(frozen) === sha256 && frozen.length === entry.bytes, `candidate-blob:${entry.path}`);
      check(gitMode === ((entry.mode & 0o111) ? '100755' : '100644'), `git-executable-bit:${entry.path}`);
      if (filename.endsWith('.mjs') && filename.startsWith(path.resolve(root, '..') + path.sep)) sourceFiles.set(filename, read(filename).toString());
    } else classification = 'sealed-materialized-prerequisite';
  }
  bindings.push({ path: entry.path, bytes: metadata.size, mode: metadata.mode & 0o7777, sha256, classification, gitMode });
}
const counts = Object.fromEntries([...new Set(bindings.map(entry => entry.classification))].map(kind => [kind, bindings.filter(entry => entry.classification === kind).length]));
check(counts['sealed-materialized-prerequisite'] === 7, 'seven-materialized-prerequisites');
check(counts['external-tool'] === 2, 'two-external-tools');
const namespaces = seal.namespaces.map(namespace => {
  const base = path.resolve(root, namespace.path);
  const actual = [];
  const walk = relative => {
    for (const name of fs.readdirSync(path.join(base, relative)).sort()) {
      const member = path.join(relative, name);
      const metadata = fs.lstatSync(path.join(base, member));
      check(!metadata.isSymbolicLink(), `namespace-no-symlink:${namespace.path}/${member}`);
      actual.push({ path: member, directory: metadata.isDirectory() });
      if (metadata.isDirectory() && !namespace.excludedDescendants.includes(member)) walk(member);
    }
  };
  walk('');
  const sort = rows => [...rows].sort((left, right) => left.path.localeCompare(right.path));
  check(JSON.stringify(sort(actual)) === JSON.stringify(sort(namespace.entries)), `namespace-census:${namespace.path}`);
  return { path: namespace.path, entries: actual.length, excludedDescendants: namespace.excludedDescendants, sha256: hash(JSON.stringify(sort(actual))) };
});
const planBytes = read(path.join(root, 'OPERATION-PLAN.json'));
const plan = JSON.parse(planBytes);
const admissionProjection = { limits: plan.limits, command: plan.command, phase: 'admission', operations: plan.admission };
const admissionPlanSha256 = hash(JSON.stringify(admissionProjection));
check(admissionPlanSha256 === iface.planSha256, 'admission-phase-projection-hash');
check(plan.admission.length === 14 && iface.lifecycle.workersPlanned === 14 && iface.lifecycle.workerCap === 27 && iface.lifecycle.C11EmptySetups === 2 && iface.lifecycle.semanticCalls === 0, 'admission-interface-counts');
check(iface.outputs.configBytesIncludingLF === 2097151 && iface.outputs.stagedBytesIncludingLF === 2097152 && iface.outputs.logicalDocumentBytes === 33554432 && iface.outputs.bodyBudget === 260046848 && iface.outputs.collectorBudget === 8388608 && iface.outputs.combinedBudget === 268435456, 'interface-byte-limits');
for (const entry of [iface.outerCommand.entry, iface.innerCommand.entry, ...iface.executableBindings]) {
  const bound = seal.files.find(item => item.path === entry.path);
  check(bound && ['bytes', 'mode', 'sha256'].every(key => bound[key] === entry[key]), `interface-source:${entry.path}`);
}
const graph = new Map();
const unresolvedDynamic = [];
const unboundEdges = [];
for (const [filename, text] of sourceFiles) {
  const syntax = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  check(syntax.parseDiagnostics.length === 0, `syntax:${path.relative(root, filename)}`);
  const targets = [];
  const visit = node => {
    let specifier;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      else unresolvedDynamic.push({ source: path.relative(root, filename), line: syntax.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    if (specifier?.startsWith('.')) {
      const target = path.resolve(path.dirname(filename), specifier);
      targets.push(target);
      if (!bindings.some(entry => path.resolve(root, entry.path) === target)) unboundEdges.push({ source: path.relative(root, filename), target: path.relative(root, target) });
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  graph.set(filename, targets);
}
const active = new Set();
const pending = ['launch.mjs', 'coordinator.mjs', 'worker.mjs', 'synthetic-worker.mjs'].map(name => path.join(root, name));
while (pending.length) {
  const filename = pending.pop();
  if (active.has(filename)) continue;
  active.add(filename);
  for (const target of graph.get(filename) ?? []) pending.push(target);
}
const activeMissing = unboundEdges.filter(edge => active.has(path.resolve(root, edge.source)));
check(activeMissing.length === 0, 'active-static-import-closure');
const inheritance = [];
for (const [name, origin] of Object.entries({ outer: 'executor-v7', launch: 'executor-v7-r1', body: 'executor-v7', report: 'executor-v7', records: 'executor-v7', authorization: 'executor-v7-r1', production: 'executor-v7-r1', coordinator: 'executor-v7-r1', worker: 'executor-v7-r1', 'synthetic-worker': 'executor-v7-r1' })) {
  inheritance.push({ file: `${name}.mjs`, origin: `../${origin}/${name}.mjs`, byteIdentical: read(path.join(root, `${name}.mjs`)).equals(read(path.resolve(root, '..', origin, `${name}.mjs`))) });
}
check(inheritance.find(entry => entry.file === 'outer.mjs').byteIdentical, 'outer-body-byte-identical-different-import-target');
check(planBytes.equals(read(path.resolve(root, '../executor-v7-r1/OPERATION-PLAN.json'))), 'plan-unchanged');
const priorBytes = read(path.resolve(root, '../executor-v7-r1/SEAL.json'));
const priorSeal = JSON.parse(priorBytes);
check(hash(priorBytes) === seal.originalSealSha256 && seal.originalSealSha256 === '05aa8dce295c507fd605c93aa113ba2ecd5605064dc0f6dfe3a20aa6dc6bf04d', 'immutable-prior-seal');
for (const prior of priorSeal.files) {
  const filename = path.resolve(root, '../executor-v7-r1', prior.path);
  const current = seal.files.find(entry => path.resolve(root, entry.path) === filename);
  check(current && ['bytes', 'mode', 'sha256'].every(key => current[key] === prior[key]), `preserved-r1-binding:${prior.path}`);
}
const sourceExpectations = [
  ['contracts.mjs', 'typeof value === \'string\' && /^[0-9a-f]{40}$/.test(value)', 'primitive-commit'],
  ['authorization.mjs', "requireThat(referenceData(value[key]), 'AUTH_REFERENCE_SCHEMA'", 'file-reference-boundary'],
  ['authorization.mjs', 'header && referenceData(header.review) && referenceData(header.grant)', 'authority-reference-boundary'],
  ['authorization.mjs', 'const reference = referenceData(binding);', 'load-reference-boundary'],
  ['authorization.mjs', 'reviewData(loadAuthorityReference(review', 'review-load-route'],
  ['authorization.mjs', 'grantData(loadAuthorityReference(grant', 'grant-load-route'],
  ['production.mjs', 'authority({ ...authorization, root, metadataChildren: context.metadataChildren, observe })', 'production-authority-route'],
  ['contracts.mjs', "const row = dataObject(value, ['code', 'signal']);", 'disposition-exact-fields'],
  ['contracts.mjs', 'const numeric = nonnegative(row.code) && row.code <= 255;', 'finite-status-domain'],
  ['contracts.mjs', "row.operationId === 'C09-deadline'", 'deadline-role'],
  ['contracts.mjs', "row.operationId === 'C09-status' ? 7 : 0", 'status7-role'],
  ['report.mjs', 'metadata.length !== 2 || records.length !== 3', 'two-observers-and-final'],
  ['report.mjs', 'finalReport.children !== accounting.enrolled', 'final-count-reconciliation'],
  ['report.mjs', 'childLedgerData(actualChildren[index], index + 1)', 'ledger-validation-route'],
  ['report.mjs', "JSON.parse(fs.readFileSync(new URL('./OPERATION-PLAN.json', import.meta.url))).admission", 'production-plan-reconciliation'],
  ['report.mjs', "['mode', 'runId', 'status', 'unsafe', 'result', 'children', 'allChildrenReaped']", 'seven-final-fields'],
  ['contracts.mjs', 'config: 2097151, staged: 2097152', 'inclusive-wire-limits'],
  ['records.mjs', "append('\\n');", 'encoder-counts-lf'],
  ['records.mjs', "name === 'STAGED.json' ? wireLimits.staged : wireLimits.config", 'writer-limit-route'],
  ['records.mjs', 'readDocument(root, name, sha256, wireLimits.config)', 'reader-limit-route'],
  ['body.mjs', 'saveInput(store, name, value)', 'body-input-writer-route'],
  ['worker.mjs', 'config = readConfig(path.dirname(configPath), path.basename(configPath), process.argv[3]);', 'worker-reader-route'],
  ['synthetic-worker.mjs', 'config = readConfig(path.dirname(configPath), path.basename(configPath), process.argv[3]);', 'control-reader-route'],
  ['body.mjs', "if (!Object.hasOwn(output, 'fatal'))", 'falsy-primary-presence'],
  ['outer.mjs', 'if (!primaryPresent)', 'outer-falsy-primary-presence'],
  ['records.mjs', 'if (primaryPresent) throw primary;', 'write-falsy-rethrow'],
  ['../executor-v7-r1/bootstrap.mjs', "args[0] !== ['module', 'worker_threads'][consumed]", 'bootstrap-ordered-profile'],
  ['../executor-v7-r1/bootstrap.mjs', 'if (consumed === 2) revoked = true;', 'bootstrap-second-query-revocation'],
  ['../executor-v7-r1/bootstrap.mjs', 'nativeDelegations: 0', 'bootstrap-no-native-delegation'],
  ['../executor-v7-r1/bootstrap.mjs', 'throw primary;', 'bootstrap-falsy-rethrow'],
  ['../executor-v3/offline.mjs', "['compile', 'instantiate', 'compileStreaming', 'instantiateStreaming', 'Module']", 'unchanged-wasm-module-guard'],
];
for (const [file, token, label] of sourceExpectations) check(read(path.resolve(root, file)).toString().includes(token), `source-token:${label}`);
const owned = path.resolve(root, '../../breadth-continuation-independent-20260828/executor-v7-r2-review/source-interface');
const priorObservations = [];
for (const name of ['BEFORE.json', 'AFTER.json']) {
  const bytes = read(path.join(owned, name));
  const previous = JSON.parse(bytes);
  check(JSON.stringify(previous.bindings) === JSON.stringify(bindings), `all359-observations-stable:${name}`);
  check(JSON.stringify(previous.namespaces) === JSON.stringify(namespaces), `namespace-censuses-stable:${name}`);
  priorObservations.push({ path: name, bytes: bytes.length, sha256: hash(bytes), assertions: previous.assertions, failures: previous.failures });
}
check(plan.limits.admissionChildren === 27 && plan.limits.admissionPlanned === 14 && plan.limits.admissionSetup === 2 && plan.limits.admissionSemantics === 0 && plan.admission.filter(entry => entry.kind === 'C11').length === 2 && plan.admission.every(entry => entry.kind !== 'case'), 'actual-plan-admission-limits');
const output = { schema: 'INDEPENDENT_R2_SOURCE_DATA_ONLY', candidate, evidence, launcher, parserVersion: ts.version, candidateExecutions: 0, childHarnesses: 0, grantsMintedOrConsumed: 0, assertions, failures, anchors, evidenceBindings, admissionPlanSha256, rawPlanSha256: hash(planBytes), counts, bindings, namespaces, parsedModules: sourceFiles.size, activeClosure: [...active].map(filename => path.relative(root, filename)).sort(), activeMissing, unboundEdges, unresolvedDynamic, inheritance, priorBindingsPreserved: priorSeal.files.length, sourceTokenAssertions: sourceExpectations.length, priorObservations, qualifications: ['Source/hash/schema only, not dynamic validation', 'Node checker and explicit Git metadata only; no candidate tool route, product/comparator execution/import/staging', 'Archived instruction plaintext never read', 'Full32MiB logical and248+8MiB quota boundaries STATIC_ONLY, not RSS', 'No positive review document or usable grant'] };
const result = Buffer.from(`${JSON.stringify(output, null, 2)}\n`);
if (result.length > 262144) throw new Error('OUTPUT_RECORD_CAP');
process.stdout.write(result);
process.exitCode = failures.length ? 1 : 0;
