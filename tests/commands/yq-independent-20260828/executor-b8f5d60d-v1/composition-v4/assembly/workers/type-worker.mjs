import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { canonical, checkedMaterialization, directory, finish, guard, inside, ownProjection, readPlan, regularBytes, requireFact, sha256, validateApi } from './worker-support.mjs';

async function toolsFor(api, plan) {
  const bindings = api.request.bindings;
  const tools = await api.readBoundJson('toolManifest');
  await directory(bindings.toolRoot);
  for (const name of ['node', 'typescript', 'nodeTypes', 'undiciTypes']) {
    const actual = tools[name];
    const expected = plan.tools[name];
    requireFact(actual && inside(bindings.toolRoot, actual.path) && actual.sha256 === expected.sha256, `Unbound copied tool ${name}`);
    if (expected.version) requireFact(actual.version === expected.version, `Wrong ${name} version`);
    if (expected.entries) requireFact(actual.entries === expected.entries, `Wrong ${name} tree count`);
    if (name !== 'node') await directory(actual.path);
  }
  requireFact(tools.typescript.path === bindings.typescriptRoot && tools.nodeTypes.path === bindings.nodeTypesRoot && tools.undiciTypes.path === bindings.undiciTypesRoot, 'Copied tool paths disagree');
  requireFact(basename(bindings.nodeTypesRoot) === 'node' && basename(dirname(bindings.nodeTypesRoot)) === '@types' && bindings.undiciTypesRoot === join(dirname(dirname(bindings.nodeTypesRoot)), 'undici-types'), 'Explicit copied type dependency layout required');
  await guard(api);
  return tools;
}

async function prepareFixture(api, plan, fixture, materialization, index) {
  const request = api.request;
  await directory(request.scratchRoot);
  for (const root of [materialization.root, request.bindings.sourceRoot, request.bindings.toolRoot]) {
    requireFact(root && request.scratchRoot !== root && !inside(root, request.scratchRoot) && !inside(request.scratchRoot, root), 'Scratch overlaps guarded input');
  }
  const folder = join(request.scratchRoot, `type-${index}-${fixture.name}`);
  await mkdir(folder, { mode: 493 });
  const fixturePath = join(folder, 'consumer.mts');
  const configPath = join(folder, 'tsconfig.json');
  const source = (await ownProjection(fixture.projection.path)).toString('utf8');
  requireFact(!/@ts-(?:ignore|expect-error|nocheck)/u.test(source), 'Suppressed fixture forbidden');
  const specifier = entry => {
    const path = relative(folder, join(materialization.root, entry)).split('\\').join('/');
    return path.startsWith('.') ? path : `./${path}`;
  };
  const bindings = { '@@YQ@@': specifier(plan.entry.yq), '@@CONTRACTS@@': specifier(plan.entry.contracts) };
  let projected = source;
  for (const [token, value] of Object.entries(bindings)) projected = projected.replaceAll(token, value);
  requireFact(!projected.includes('@@'), 'Unbound fixture token');
  const config = {
    compilerOptions: { ...plan.strict, target: 'ES2022', allowJs: false, checkJs: false, types: ['node'], typeRoots: [dirname(request.bindings.nodeTypesRoot)], pretty: false, incremental: false },
    files: [fixturePath],
  };
  const files = [];
  for (const [path, text] of [[fixturePath, projected], [configPath, `${JSON.stringify(config, null, 2)}\n`]]) {
    const bytes = Buffer.from(text);
    requireFact(bytes.length <= 65536, 'Generated type input overflow');
    await writeFile(path, bytes, { flag: 'wx', mode: 420 });
    const descriptor = { path, sha256: sha256(bytes), bytes: bytes.length, mode: 420, kind: 'file' };
    await regularBytes(path, 65536, descriptor);
    files.push(descriptor);
  }
  await api.note('generated-type-inputs', { directory: folder, files });
  await guard(api);
  return { fixturePath, configPath, config, files, bindings };
}

function validateProvenance(api, raw, tools, prepared) {
  const provenance = raw.provenance;
  requireFact(provenance && raw.reaped === true, 'Missing compiler provenance or known reap');
  const expectedArgv = [join(tools.typescript.path, 'lib/tsc.js'), '--project', prepared.configPath, '--pretty', 'false'];
  requireFact(canonical(provenance.argv) === canonical(expectedArgv) && provenance.cwd === api.request.scratchRoot, 'Compiler argv/cwd mismatch');
  requireFact(provenance.executable?.path === tools.node.path && provenance.executable?.sha256 === tools.node.sha256, 'Compiler Node identity mismatch');
  requireFact(provenance.typescript?.path === tools.typescript.path && provenance.typescript?.sha256 === tools.typescript.sha256 && provenance.typescript?.version === '5.9.3', 'Compiler TypeScript identity mismatch');
  requireFact(canonical(provenance.environment) === canonical({ LANG: 'C', LC_ALL: 'C' }), 'Ambient compiler environment');
  for (const name of ['startedNs', 'endedNs', 'reapedNs']) requireFact(/^[1-9][0-9]*$/.test(provenance[name] ?? ''), 'Missing parent time evidence');
  requireFact(BigInt(provenance.startedNs) <= BigInt(provenance.endedNs) && BigInt(provenance.endedNs) <= BigInt(provenance.reapedNs), 'Reversed compiler time facts');
  return BigInt(provenance.reapedNs) <= BigInt(api.request.deadline.workNs);
}

function classify(fixture, raw, stdout, stderr, fixturePath, withinDeadline) {
  const failure = (classification, details = {}) => ({ status: 'FAIL', classification, ...details });
  if (!withinDeadline || raw.signal !== null || raw.timedOut !== false || raw.provenance.overflow !== false || ![0, 1, 2].includes(raw.code)) return failure('COMPILER_PROCESS_FAILURE');
  let text;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    text = decoder.decode(stdout);
    decoder.decode(stderr);
  } catch {
    return failure('MALFORMED_COMPILER_OUTPUT');
  }
  if (stderr.length !== 0) return failure('UNEXPECTED_COMPILER_STDERR');
  if (fixture.outcome === 'accept' && raw.code === 0 && text === '') return { status: 'PASS', classification: 'ACCEPTED_COMPILE' };
  const diagnostics = [];
  const continuationLines = fixture.name === 'replace-undefined' && fixture.diagnostic?.code === 2379
    ? ["  Types of property 'replace' are incompatible.", "    Type 'undefined' is not assignable to type 'boolean'."]
    : [];
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  let unexpectedOutput = lines.length !== 1 + continuationLines.length;
  for (const [index, line] of lines.entries()) {
    const match = /^(.+)\((\d+),(\d+)\): error TS(\d+): (.+)$/u.exec(line);
    if (match) diagnostics.push({ file: resolve(raw.provenance.cwd, match[1]), line: Number(match[2]), column: Number(match[3]), code: Number(match[4]), message: match[5] });
    else if (index === 0 || line !== continuationLines[index - 1]) unexpectedOutput = true;
  }
  const expected = fixture.diagnostic;
  if (fixture.outcome === 'reject' && [1, 2].includes(raw.code) && !unexpectedOutput && diagnostics.length === 1 && diagnostics[0].file === fixturePath && diagnostics[0].line === expected.line && diagnostics[0].column > 0 && diagnostics[0].code === expected.code) {
    return { status: 'PASS', classification: 'ACCEPTED_COMPILE_REJECTION', diagnostics };
  }
  const bindingCodes = new Set([2307, 2688, 2792, 2834, 2835, 5012, 5023, 6053, 18003]);
  const fixtureDefect = unexpectedOutput || diagnostics.some(item => bindingCodes.has(item.code) || item.code >= 1000 && item.code < 2000 || item.file !== fixturePath);
  return failure(fixtureDefect ? 'FIXTURE_TOOL_OR_BINDING_DEFECT' : 'DECLARATION_CONTRADICTION_REQUIRES_REVIEW', { diagnostics, unexpectedOutput });
}

export async function runWorker(api) {
  const request = validateApi(api);
  await api.phase('setup', { component: 'TYPE' });
  await api.phase('admission');
  await guard(api);
  const plan = await readPlan(api, 'typePlan', 'TYPE-PLAN.json');
  const slot = plan.slots.find(item => item.id === request.job.id);
  requireFact(slot && (request.job.environment == null || request.job.environment === slot.environment), 'Unknown TYPE slot/profile');
  const results = [];
  const artifacts = [];
  if (slot.conditional) {
    requireFact(plan.publicExports.state === 'PUBLIC_EXPORT_GAP', 'Public export plan needs separately reviewed successor');
    await api.phase('operation', { compilerRequests: 0 });
    await api.phase('capture');
    for (const name of slot.fixtures) results.push({ name, status: 'UNRUN', classification: 'UNRUN_PUBLIC_EXPORT_GAP' });
    artifacts.push(await api.writeJson('types/public-gap.json', { results, compilerRequests: 0 }));
    return finish(api, { status: 'UNRUN', proofRole: 'TYPE_NOT_SEMANTIC', details: { results, compilerRequests: 0, semanticPasses: 0 }, artifacts });
  }
  const tools = await toolsFor(api, plan);
  const materialization = await checkedMaterialization(api, slot);
  for (const [name, descriptor] of Object.entries(plan.declarations)) {
    await regularBytes(join(materialization.root, plan.entry[name].replace(/\.js$/u, '.d.ts')), 16777216, descriptor);
  }
  await api.phase('operation', { environment: slot.environment, compilerRequests: slot.fixtures.length });
  for (const [index, name] of slot.fixtures.entries()) {
    const fixture = plan.fixtures.find(item => item.name === name);
    requireFact(fixture && fixture.mode === 'DIRECT_AND_FUTURE_PUBLIC', 'Wrong direct fixture');
    const prepared = await prepareFixture(api, plan, fixture, materialization, index);
    await api.note('compiler-admission', { fixture: name, configPath: prepared.configPath, timeoutMs: 60000 });
    const raw = await api.runTool({ kind: 'compiler', configPath: prepared.configPath, timeoutMs: 60000 });
    artifacts.push(await api.writeJson(`types/${index}-${name}-raw.json`, { fixture: name, raw, prepared }));
    requireFact(raw.reaped === true, 'Unknown compiler reap');
    for (const stream of ['stdout', 'stderr']) {
      requireFact(Number.isSafeInteger(raw[`${stream}Bytes`]) && raw[`${stream}Bytes`] >= 0 && /^[a-f0-9]{64}$/u.test(raw[`${stream}Sha256`] ?? '') && inside(request.evidenceRoot, raw[`${stream}Path`]), 'Unbound raw compiler stream');
    }
    requireFact(raw.stdoutBytes + raw.stderrBytes <= 8388608, 'Compiler capture overflow');
    const stdout = await regularBytes(raw.stdoutPath, 8388608);
    const stderr = await regularBytes(raw.stderrPath, 8388608);
    requireFact(stdout.length === raw.stdoutBytes && stderr.length === raw.stderrBytes && sha256(stdout) === raw.stdoutSha256 && sha256(stderr) === raw.stderrSha256, 'Raw compiler capture mismatch');
    const withinDeadline = validateProvenance(api, raw, tools, prepared);
    await guard(api);
    const result = { name, ...classify(fixture, raw, stdout, stderr, prepared.fixturePath, withinDeadline) };
    artifacts.push(await api.writeJson(`types/${index}-${name}-classification.json`, result));
    results.push(result);
    await api.note('compiler-classified', { fixture: name, status: result.status, classification: result.classification });
  }
  await api.phase('capture');
  return finish(api, { status: results.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL', proofRole: 'TYPE_NOT_SEMANTIC', details: { environment: slot.environment, results, compilerRequests: results.length, semanticPasses: 0, publicExport: 'PUBLIC_EXPORT_GAP' }, artifacts });
}
