import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertBound, assertPublicAdmission, authorizeCandidate, canonical, copyRegularTree, inspectTree, materializeCandidate, preparationRoot, regularRoot, requireFact, sha256, verifyPreseal, within, workspaceRoot } from './guards.mjs';

export function compilerTreeIdentity(root) {
  const tree = inspectTree(root);
  const rows = [];
  const visit = path => {
    for (const name of readdirSync(join(root, path)).sort()) {
      const child = path ? `${path}/${name}` : name;
      if (Object.hasOwn(tree.directories, child)) { rows.push([child, 'directory', tree.directories[child]]); visit(child); }
      else { const file = tree.files[child]; rows.push([child, file.sha256, file.bytes, file.mode]); }
    }
  };
  visit('');
  return { sha256: sha256(JSON.stringify(rows)), entries: rows.length };
}

export function classifyCompilerOutcome(job, result, files) {
  requireFact(result.error === null && result.signal === null && Number.isInteger(result.status) && (job.outcome === 'accept' ? result.status === 0 : [1, 2].includes(result.status)), 'COMPILER_STATUS', job.name);
  requireFact(result.stderr.length === 0, 'COMPILER_DIAGNOSTICS', 'unexpected stderr');
  const diagnostics = [];
  const consumed = [];
  for (const line of result.stdout.split(/\r?\n/u).filter(Boolean)) {
    const diagnostic = /^(.*?)\((\d+),(\d+)\): error TS(\d+): (.*)$/u.exec(line);
    if (diagnostic) diagnostics.push({ path: resolve(files.cwd, diagnostic[1]), line: Number(diagnostic[2]), code: Number(diagnostic[4]), message: diagnostic[5] });
    else if (isAbsolute(line)) consumed.push(line);
    else requireFact(/^\s+/u.test(line) && diagnostics.length > 0, 'COMPILER_DIAGNOSTICS', line);
  }
  requireFact(consumed.includes(files.fixture), 'COMPILER_BINDING', 'fixture absent from compiler file list');
  requireFact(files.requiredDeclarations.every(path => consumed.includes(path)), 'COMPILER_BINDING', 'required candidate declarations absent');
  for (const path of consumed) {
    const fixture = path === files.fixture;
    const candidate = within(files.candidate, path) && path.endsWith('.d.ts') && Object.hasOwn(files.candidateFiles, relative(files.candidate, path));
    const tool = files.tools.some(root => within(root, path) && path.endsWith('.d.ts'));
    requireFact(fixture || candidate || tool, 'COMPILER_BINDING', path);
  }
  if (job.outcome === 'accept') requireFact(diagnostics.length === 0, 'COMPILER_DIAGNOSTICS');
  else requireFact(diagnostics.length === 1 && diagnostics[0].path === files.fixture && diagnostics[0].line === job.diagnostic.line && diagnostics[0].code === job.diagnostic.code, 'COMPILER_DIAGNOSTICS', canonical(diagnostics));
  return { classification: job.outcome === 'accept' ? 'ACCEPTED_COMPILE' : 'ACCEPTED_COMPILE_REJECTION', proofRole: 'TYPE_NOT_SEMANTIC', compilerStatus: result.status, diagnostics, consumed };
}

export function assertWorkerExit(result) {
  requireFact(result.status === 0 && result.signal === null && !result.error, 'WORKER_EXIT', 'Every nonzero worker child is aggregate failure; expected compiler rejection is interpreted inside the worker only');
}

export function renderFixture(template, bindings) {
  requireFact(!/@ts-(?:ignore|expect-error|nocheck)/u.test(template), 'FIXTURE_SUPPRESSION');
  const rendered = template.replace(/@@([A-Z]+)@@/gu, (token, key) => {
    requireFact(['YQ', 'CONTRACTS', 'ROOT'].includes(key) && typeof bindings[key] === 'string', 'FIXTURE_TOKEN', token);
    requireFact(!/["\\\n\r]/u.test(bindings[key]), 'FIXTURE_TOKEN');
    return bindings[key];
  });
  requireFact(!rendered.includes('@@'), 'FIXTURE_TOKEN');
  return rendered;
}

function capture(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 420 });
}

export function runDeclarationConsumers(binding, evidenceRoot, mode = 'direct') {
  requireFact(mode === 'direct' || mode === 'public', 'CONSUMER_MODE');
  if (mode === 'public') assertPublicAdmission();
  verifyPreseal();
  const authority = assertBound(binding);
  evidenceRoot = resolve(evidenceRoot);
  requireFact(!within(workspaceRoot, evidenceRoot) && !within(binding.original, evidenceRoot) && !within(binding.root, evidenceRoot) && !within(evidenceRoot, binding.original) && !within(evidenceRoot, binding.root), 'EVIDENCE_LOCATION');
  regularRoot(dirname(evidenceRoot));
  requireFact(!existsSync(evidenceRoot), 'EVIDENCE_EXISTS');
  mkdirSync(evidenceRoot, { mode: 493 });
  const selected = JSON.parse(readFileSync(join(preparationRoot, 'SELECTED.json')));
  const assertNode = () => requireFact(process.execPath === selected.tools.node.path && process.version === selected.tools.node.version && sha256(readFileSync(process.execPath)) === selected.tools.node.sha256, 'COMPILER_TOOL');
  assertNode();
  const toolRoot = join(evidenceRoot, 'tools');
  mkdirSync(toolRoot, { mode: 493 });
  const typeRoots = join(toolRoot, 'types');
  mkdirSync(typeRoots, { mode: 493 });
  const copied = {};
  for (const [name, destination] of [['typescript', join(toolRoot, 'typescript')], ['nodeTypes', join(typeRoots, 'node')], ['undiciTypes', join(typeRoots, 'undici-types')]]) {
    const pin = selected.tools[name];
    const source = join(workspaceRoot, pin.path);
    requireFact(canonical(compilerTreeIdentity(source)) === canonical({ sha256: pin.sha256, entries: pin.entries }), 'COMPILER_TOOL', name);
    copyRegularTree(source, destination, inspectTree(source));
    requireFact(canonical(compilerTreeIdentity(destination)) === canonical({ sha256: pin.sha256, entries: pin.entries }), 'COMPILER_TOOL', name);
    copied[name] = destination;
  }
  const jobs = JSON.parse(readFileSync(join(preparationRoot, 'JOBS.json'))).jobs;
  const facts = [];
  const yqDeclaration = join(binding.root, authority.receipt.entries.yq.replace(/\.js$/u, '.d.ts'));
  const contractsDeclaration = join(binding.root, authority.receipt.entries.contracts.replace(/\.js$/u, '.d.ts'));
  let failure;
  try {
    for (const job of jobs.filter(job => job.mode !== 'PUBLIC_ONLY')) {
      assertBound(binding);
      assertNode();
      for (const [name, root] of Object.entries(copied)) requireFact(compilerTreeIdentity(root).sha256 === selected.tools[name].sha256, 'COMPILER_TOOL', name);
      const fixture = join(evidenceRoot, `${job.name}.mts`);
      const bindings = { YQ: relative(evidenceRoot, yqDeclaration).replace(/\.d\.ts$/u, '.js'), CONTRACTS: relative(evidenceRoot, contractsDeclaration).replace(/\.d\.ts$/u, '.js') };
      for (const key of Object.keys(bindings)) if (!bindings[key].startsWith('.')) bindings[key] = './' + bindings[key];
      writeFileSync(fixture, renderFixture(readFileSync(join(preparationRoot, job.fixture), 'utf8'), bindings), { flag: 'wx', mode: 420 });
      const args = [join(copied.typescript, 'lib/tsc.js'), '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess', '--verbatimModuleSyntax', '--forceConsistentCasingInFileNames', '--skipLibCheck', 'false', '--noEmit', '--types', 'node', '--typeRoots', typeRoots, '--pretty', 'false', '--listFiles', fixture];
      const result = spawnSync(process.execPath, args, { cwd: evidenceRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: evidenceRoot, TMPDIR: evidenceRoot } });
      const raw = { job: job.name, args, cwd: evidenceRoot, status: result.status, signal: result.signal, error: result.error ? { code: result.error.code ?? null, message: result.error.message } : null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
      capture(join(evidenceRoot, `${job.name}.compiler.json`), raw);
      assertBound(binding);
      assertNode();
      for (const [name, root] of Object.entries(copied)) requireFact(compilerTreeIdentity(root).sha256 === selected.tools[name].sha256, 'COMPILER_TOOL', name);
      const fact = classifyCompilerOutcome(job, raw, { cwd: evidenceRoot, fixture, candidate: binding.root, candidateFiles: authority.expected.files, tools: Object.values(copied), requiredDeclarations: job.name === 'positive' ? [yqDeclaration, contractsDeclaration] : [yqDeclaration] });
      facts.push({ id: job.id, name: job.name, ...fact });
      capture(join(evidenceRoot, `${job.name}.fact.json`), facts.at(-1));
    }
  } catch (error) {
    failure = error;
  } finally {
    try { assertBound(binding); } catch (error) { failure ??= error; }
    try { assertNode(); } catch (error) { failure ??= error; }
    capture(join(evidenceRoot, 'TYPE-RESULTS.json'), { schema: 1, proofRole: 'DIRECT_MATERIALIZED_DECLARATIONS_NOT_PUBLIC_PACKAGE', receiptHash: authority.receiptHash, facts, semanticResults: [], pendingPublic: jobs.map(job => job.name), failure: failure ? { code: failure.code ?? null, message: failure.message } : null, workerExit: failure ? 1 : 0 });
  }
  if (failure) throw failure;
  return facts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [receipt, receiptHash, original, destination, evidence, ...extra] = process.argv.slice(2);
    requireFact(receipt && receiptHash && original && destination && evidence && extra.length === 0, 'USAGE', 'node type-worker.mjs RECEIPT SHA256 COMPILED_PACKAGE MOVED_DEST NEW_EVIDENCE');
    const authority = authorizeCandidate(receipt, receiptHash, original);
    const binding = materializeCandidate(authority, original, destination);
    runDeclarationConsumers(binding, evidence);
  } catch (error) {
    console.error(`${error.code ?? 'FAIL'}: ${error.message}`);
    process.exitCode = 1;
  }
}
