import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repository = '/Users/kjopek/Workspace/safe-bash';
const own = path.dirname(fileURLToPath(import.meta.url));
const successor = 'tests/comparison/breadth-continuation-20260828/executor-v7-r1';
const candidate = '230ed3c6e15617b312760367adf9ede4e5c7ff6a';
const evidence = 'fedfca3c445696a19aaf84ac85bc74cff229d5c2';
const recipeHash = '05aa8dce295c507fd605c93aa113ba2ecd5605064dc0f6dfe3a20aa6dc6bf04d';
const interfaceHash = '913d051875c60492cce06937ff33b85bb4c9b36085b79169d5e51e87852880c4';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, label) => { if (!condition) throw new Error(label); };
const sealBytes = fs.readFileSync(path.join(repository, successor, 'SEAL.json'));
assert(hash(sealBytes) === recipeHash, 'live seal binding');
const seal = JSON.parse(sealBytes);
const bound = seal.files.map(entry => ({ ...entry, absolute: path.resolve(repository, successor, entry.path) }));
assert(bound.length === 322, '322 bound inputs');
assert(bound.every(entry => !entry.path.toLowerCase().includes('agents.md')), 'instruction metadata only');
const local = bound.filter(entry => entry.absolute.startsWith(`${repository}/`));
const requests = [...local.map(entry => `${candidate}:${path.relative(repository, entry.absolute)}`), `${candidate}:${successor}/SEAL.json`, ...['HANDOFF.json', 'README.md'].map(name => `${evidence}:${successor}/runs/handoff-01/${name}`), ...['RESULT.json', 'B16-r1.json', 'G08-r1.json'].map(name => `${evidence}:${successor}/runs/focused-r1-01/${name}`)];
const mode = process.argv[2];
if (mode === 'requests') {
  process.stdout.write(`${requests.join('\n')}\n`);
} else if (mode === 'tree') {
  const wanted = new Set(local.map(entry => path.relative(repository, entry.absolute)));
  const output = Buffer.from(`${fs.readFileSync(0, 'utf8').split('\n').filter(line => wanted.has(line.split('\t')[1])).join('\n')}\n`);
  assert(output.length <= 262144, 'tree record cap');
  fs.writeFileSync(path.join(own, 'CANDIDATE-TREE.txt'), output, { flag: 'wx', mode: 0o644 });
} else {
  assert(['before', 'after'].includes(mode), 'capture phase');
  const input = fs.readFileSync(0);
  assert(input.length <= 64 * 1024 * 1024, 'metadata transport bound');
  const blobs = new Map();
  let offset = 0;
  for (const request of requests) {
    const end = input.indexOf(10, offset);
    const header = input.subarray(offset, end).toString();
    if (header === `${request} missing`) { offset = end + 1; continue; }
    const match = /^([0-9a-f]{40}) blob ([0-9]+)$/.exec(header);
    assert(match, `committed blob ${request}`);
    const bytes = Number(match[2]);
    const body = input.subarray(end + 1, end + 1 + bytes);
    assert(body.length === bytes && input[end + 1 + bytes] === 10, 'batch framing');
    blobs.set(request, { body, oid: match[1] });
    offset = end + 2 + bytes;
  }
  assert(offset === input.length, 'batch exhausted');
  const tree = new Map(fs.readFileSync(path.join(own, 'CANDIDATE-TREE.txt'), 'utf8').trimEnd().split('\n').map(line => {
    const match = /^(\d+) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    return match ? [match[3], { mode: match[1], oid: match[2] }] : [line, null];
  }));
  const results = { schema: 'INDEPENDENT_SOURCE_DATA_ONLY', phase: mode, candidate, evidence, recipeHash, interfaceHash, checks: [], files: [], namespaces: [], imports: {}, dynamicImports: [], engineImports: 0, executorChildren: 0, grantsMintedOrConsumed: 0 };
  const check = (name, condition) => { results.checks.push({ name, pass: Boolean(condition) }); };
  check('committed seal body', hash(blobs.get(`${candidate}:${successor}/SEAL.json`).body) === recipeHash);
  for (const entry of bound) {
    const info = fs.lstatSync(entry.absolute);
    const bytes = fs.readFileSync(entry.absolute);
    const relative = path.relative(repository, entry.absolute);
    const blob = blobs.get(`${candidate}:${relative}`);
    const git = tree.get(relative);
    const bodyMatches = blob ? hash(blob.body) === entry.sha256 && blob.body.length === entry.bytes && git?.oid === blob.oid && git.mode === ((entry.mode & 0o111) ? '100755' : '100644') : null;
    const row = { path: entry.path, bytes: bytes.length, mode: info.mode & 0o7777, sha256: hash(bytes), committed: bodyMatches, provenance: blob ? 'exact-git-blob-and-seal' : entry.absolute.startsWith(`${repository}/`) ? 'materialized-bytes-bound-by-committed-seal-not-git-blob' : 'external-tool-bound-by-committed-seal', gitMode: git?.mode ?? null, pass: info.isFile() && !info.isSymbolicLink() && bytes.length === entry.bytes && (info.mode & 0o7777) === entry.mode && hash(bytes) === entry.sha256 && (blob ? bodyMatches : true) };
    results.files.push(row);
  }
  for (const [request, blob] of blobs) {
    const filename = request.slice(41);
    check(`live committed ${filename}`, hash(fs.readFileSync(path.join(repository, filename))) === hash(blob.body));
  }
  for (const namespace of seal.namespaces) {
    const base = path.resolve(repository, successor, namespace.path);
    const actual = [];
    const walk = relative => {
      for (const name of fs.readdirSync(path.join(base, relative)).sort()) {
        const member = path.join(relative, name);
        const info = fs.lstatSync(path.join(base, member));
        actual.push({ path: member, directory: info.isDirectory() });
        assert(!info.isSymbolicLink(), 'namespace symlink');
        if (info.isDirectory() && !namespace.excludedDescendants.includes(member)) walk(member);
      }
    };
    walk('');
    const normalized = entries => JSON.stringify([...entries].sort((left, right) => left.path.localeCompare(right.path)));
    results.namespaces.push({ path: namespace.path, entries: actual.length, excludedDescendants: namespace.excludedDescendants, pass: normalized(actual) === normalized(namespace.entries) });
  }
  const get = name => blobs.get(`${candidate}:${successor}/${name}`).body;
  const contract = JSON.parse(get('INTERFACE.json'));
  const plan = JSON.parse(get('OPERATION-PLAN.json'));
  check('interface exact committed hash', hash(get('INTERFACE.json')) === interfaceHash);
  check('phase plan hash is serialized projection not raw file', hash(JSON.stringify({ limits: plan.limits, command: plan.command, phase: 'admission', operations: plan.admission })) === contract.planSha256);
  check('aggregate 248+8 MiB', contract.outputs.bodyBudget === 248 * 1024 * 1024 && contract.outputs.collectorBudget === 8 * 1024 * 1024 && contract.outputs.combinedBudget === 256 * 1024 * 1024);
  check('record and streams', contract.outputs.perRecordBytes === 262144 && contract.outputs.stdoutBytes === 65536 && contract.outputs.stderrBytes === 65536 && contract.outputs.metadataStreamBytes === 262144);
  check('14 planned admission operations', plan.admission.length === 14 && contract.lifecycle.workersPlanned === 14);
  for (const entry of [...contract.executableBindings, contract.outerCommand.entry, contract.innerCommand.entry]) {
    const source = bound.find(item => item.path === entry.path);
    check(`interface source ${entry.path}`, source && source.sha256 === entry.sha256 && source.mode === entry.mode && source.bytes === entry.bytes);
  }
  const parser = createRequire(import.meta.url)(path.join(repository, 'node_modules/typescript'));
  results.parser = { version: parser.version, purpose: 'existing parser only; no reviewed module execution' };
  const allPaths = new Set(local.map(entry => entry.absolute));
  const closure = new Map();
  const missing = [];
  let parsed = 0;
  for (const entry of local.filter(item => item.path.endsWith('.mjs'))) {
    const relative = path.relative(repository, entry.absolute);
    const source = parser.createSourceFile(relative, (blobs.get(`${candidate}:${relative}`)?.body ?? fs.readFileSync(entry.absolute)).toString('utf8'), parser.ScriptTarget.Latest, true, parser.ScriptKind.JS);
    check(`parse ${relative}`, source.parseDiagnostics.length === 0);
    parsed++;
    const dependencies = [];
    const visit = node => {
      let specifier;
      if (parser.isImportDeclaration(node) || parser.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (parser.isCallExpression(node) && node.expression.kind === parser.SyntaxKind.ImportKeyword) {
        specifier = node.arguments[0];
        if (!specifier || !parser.isStringLiteral(specifier)) results.dynamicImports.push({ path: relative, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
      }
      if (specifier && parser.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
        const resolved = path.resolve(path.dirname(entry.absolute), specifier.text);
        dependencies.push(resolved);
        if (!allPaths.has(resolved)) missing.push({ path: relative, specifier: specifier.text });
      }
      parser.forEachChild(node, visit);
    };
    visit(source);
    closure.set(entry.absolute, dependencies);
  }
  const reached = new Set();
  const visit = filename => { if (reached.has(filename)) return; reached.add(filename); for (const dependency of closure.get(filename) ?? []) visit(dependency); };
  for (const name of ['launch.mjs', 'coordinator.mjs', 'production.mjs', 'worker.mjs', 'synthetic-worker.mjs']) visit(path.join(repository, successor, name));
  const activeMissing = missing.filter(entry => reached.has(path.join(repository, entry.path)));
  results.imports = { parsed, reached: reached.size, reachedPaths: [...reached].map(filename => path.relative(repository, filename)).sort(), missing, activeMissing, dynamicEdgesNotCertified: true };
  check('all static relative imports bound', missing.length === 0);
  check('admission seeded static relative imports bound', activeMissing.length === 0);
  const handoff = JSON.parse(blobs.get(`${evidence}:${successor}/runs/handoff-01/HANDOFF.json`).body);
  const focused = JSON.parse(blobs.get(`${evidence}:${successor}/runs/focused-r1-01/RESULT.json`).body);
  check('original author 31/33 preserved', handoff.originalSyntheticRun.pass === 31 && handoff.originalSyntheticRun.fail === 2 && handoff.originalSyntheticRun.reaped.total === 28);
  check('focused 2/2 not replay', focused.pass === 2 && focused.fail === 0 && focused.newChildLaunches === 0 && focused.wholeCohortRerun === false);
  const b16 = focused.rows.find(row => row.id === 'B16-r1').observation;
  check('B16 explicitly postcapture', b16.newChildren === 0 && b16.qualificationTiming === 'POST_CAPTURE_PRESEALED_OBSERVER_RECONCILIATION');
  if (mode === 'after') {
    const before = JSON.parse(fs.readFileSync(path.join(own, 'BEFORE.json')));
    check('before-after source mode/hash stable', JSON.stringify(before.files) === JSON.stringify(results.files));
    check('before-after namespaces stable', JSON.stringify(before.namespaces) === JSON.stringify(results.namespaces));
  }
  results.pass = results.files.every(row => row.pass) && results.namespaces.every(row => row.pass) && results.checks.every(row => row.pass);
  const output = Buffer.from(`${JSON.stringify(results, null, 2)}\n`);
  assert(output.length <= 262144, 'evidence record cap');
  fs.writeFileSync(path.join(own, `${mode.toUpperCase()}.json`), output, { flag: 'wx', mode: 0o644 });
  console.log(JSON.stringify({ phase: mode, pass: results.pass, files: results.files.length, checks: results.checks.length, failures: results.checks.filter(row => !row.pass), imports: results.imports, bytes: output.length }));
  if (!results.pass) process.exitCode = 1;
}
