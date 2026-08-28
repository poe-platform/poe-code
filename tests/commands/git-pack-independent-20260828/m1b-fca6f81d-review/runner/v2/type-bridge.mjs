import fs from 'node:fs/promises';
import path from 'node:path';
import { demand, regular, guard, inventory, writeExclusive, sha256, under } from './primitives.mjs';
import { supervise } from './supervisor.mjs';
import { materializeFiles, packageGuard } from './materialize.mjs';
import { materializedFixture, validateResult, diagnosticsMatch } from '../mechanical-type-api-v2/protocol.mjs';

export async function prepareTypeTools(state, manifest) {
  const rows = [...manifest.files, manifest.node].map(({ path, mode, bytes, sha256 }) => ({ path, mode, bytes, sha256 }));
  const root = path.join(state.root, 'type-tools');
  const before = await inventory(path.join(state.root, 'tools'));
  await materializeFiles(root, rows, row => regular(under(path.join(state.root, 'tools'), row.path), row).then(value => value.body), state.budget);
  for (const directory of manifest.directories) {
    await fs.mkdir(under(root, directory.path), { recursive: true, mode: directory.mode });
    await fs.chmod(under(root, directory.path), directory.mode);
  }
  await guard(path.join(state.root, 'tools'), before);
  const snapshot = await inventory(root);
  demand(snapshot.filter(row => row.kind === 'file').length === rows.length, 'TYPE_TOOLS_MEMBERSHIP');
  for (const row of rows) await regular(under(root, row.path), row);
  return { root, snapshot, rows };
}

export function typeCompiler(state, tools, packageMap, verifyOrigins) {
  return async (fixtureId, candidateRoot, item, deadline, caseRoot, layout) => {
    const { budget, recipe } = state;
    demand(item.role === 'TYPE' && item.id === fixtureId && ['S', 'M'].includes(layout), 'TYPE_CASE_ROUTE');
    const selected = recipe.typeFixtures.find(row => row.id === fixtureId && row.caseId === item.id);
    demand(selected, 'TYPE_FIXTURE_ENROLLMENT');
    const template = (await regular(under(state.harnessRoot, selected.path), selected)).body;
    const fixtureBytes = materializedFixture(fixtureId, candidateRoot);
    demand(template.length === selected.bytes && sha256(template) === selected.sha256 && fixtureBytes.length <= 16384, 'TYPE_TEMPLATE_BINDING');
    const fixturePath = path.join(caseRoot, fixtureId + '.mts');
    const fixtureIdentity = { mode: 0o600, bytes: fixtureBytes.length, sha256: sha256(fixtureBytes) };
    const request = { schema: 'm1b-type-api-request-v2', fixtureId, layout, caseRoot, subjectRoot: candidateRoot, toolsRoot: tools.root };
    const requestBytes = Buffer.from(JSON.stringify(request) + '\n');
    demand(requestBytes.length <= 16384, 'TYPE_REQUEST_LIMIT');
    const requestPath = path.join(caseRoot, 'type-api-request.json');
    const requestIdentity = { mode: 0o600, bytes: requestBytes.length, sha256: sha256(requestBytes) };
    await writeExclusive(fixturePath, fixtureBytes);
    await writeExclusive(requestPath, requestBytes);
    await budget.raw('type-fixture.mts.data', fixtureBytes);
    await budget.raw('type-request.json', requestBytes);
    const caseBefore = await inventory(caseRoot);
    demand(caseBefore.length === 2, 'TYPE_INITIAL_MEMBERSHIP');
    await packageGuard(candidateRoot, packageMap.files);
    await guard(tools.root, tools.snapshot);
    await verifyOrigins();
    budget.reserveCapture(1048576);
    const child = await supervise(budget, {
      id: 'type-api-' + layout + '-' + fixtureId,
      executable: path.join(tools.root, 'bin/node'),
      argv: [path.join(state.harnessRoot, 'mechanical-type-api-v2/compiler-api-worker.mjs'), '--request', requestPath, '--sha256', requestIdentity.sha256],
      cwd: caseRoot,
      env: { PATH: path.join(tools.root, 'bin'), HOME: caseRoot, TMPDIR: caseRoot, TZ: 'UTC', LANG: 'C', LC_ALL: 'C', UV_THREADPOOL_SIZE: '1' },
      streamBytes: { stdout: 65536, stderr: 65536 }, deadline
    });
    demand(child.closed && budget.unsafe === null && budget.active.size === 1, 'TYPE_CHILD_REAP');
    const rawPath = path.join(caseRoot, 'type-api-raw.json');
    const resultPath = path.join(caseRoot, 'type-api-result.json');
    const observed = await inventory(caseRoot, { maxFiles: 4, maxBytes: 1081344 });
    const names = observed.map(row => row.path).sort();
    demand(observed.every(row => row.kind === 'file') && names.every(name => [fixtureId + '.mts', 'type-api-request.json', 'type-api-raw.json', 'type-api-result.json'].includes(name)), 'TYPE_OUTPUT_MEMBERSHIP');
    const adopted = new Map();
    for (const [name, filename] of [['raw', rawPath], ['result', resultPath]]) {
      const observedRow = observed.find(row => row.path === path.basename(filename));
      if (!observedRow) continue;
      demand(observedRow.mode === 0o600 && observedRow.bytes <= 524288, 'TYPE_PUBLICATION_BOUND');
      const value = await regular(filename, observedRow);
      const relative = 'raw/' + String(++budget.sequence).padStart(6, '0') + '-type-api-' + layout + '-' + fixtureId + '-' + name + '.json';
      const destination = under(state.root, relative);
      budget.reserveWork(value.bytes);
      await fs.link(filename, destination);
      await fs.unlink(filename);
      budget.releaseDeletedWork(value.bytes);
      await regular(destination, value);
      adopted.set(name, { ...value, path: relative, originalPath: filename });
    }
    await budget.record('type-api-publications', { fixtureId, layout, childStatus: child.code, signal: child.signal, timedOut: child.timedOut, closed: child.closed, artifacts: [...adopted.entries()].map(([name, row]) => ({ name, path: row.path, originalPath: row.originalPath, mode: row.mode, bytes: row.bytes, sha256: row.sha256 })) });
    await regular(fixturePath, fixtureIdentity);
    await regular(requestPath, requestIdentity);
    await guard(caseRoot, caseBefore);
    await packageGuard(candidateRoot, packageMap.files);
    await guard(tools.root, tools.snapshot);
    await verifyOrigins();
    demand(child.code === 0 && child.signal === null && !child.timedOut && !child.spawnError && !child.captureError, 'TYPE_WORKER_NONZERO');
    demand(adopted.has('raw') && adopted.has('result'), 'TYPE_REQUIRED_PUBLICATIONS');
    const raw = JSON.parse(adopted.get('raw').body.toString('utf8'));
    const result = validateResult(JSON.parse(adopted.get('result').body.toString('utf8')));
    demand(result.fixtureId === fixtureId && result.layout === layout && result.fixture.path === fixturePath && result.fixture.subjectRoot === candidateRoot && result.fixture.sha256 === fixtureIdentity.sha256 && result.fixture.bytes === fixtureIdentity.bytes && result.fixture.templateSha256 === selected.sha256, 'TYPE_RESULT_ROUTE');
    demand(result.compiler.options.typeRoots[0] === path.join(tools.root, 'node_modules/@types'), 'TYPE_OPTIONS_ROOT');
    demand(result.raw.path === rawPath && result.raw.mode === 0o600 && result.raw.bytes === adopted.get('raw').bytes && result.raw.sha256 === adopted.get('raw').sha256, 'TYPE_RAW_REFERENCE');
    demand(raw.schema === 'm1b-type-api-raw-v2' && raw.fixtureId === fixtureId && raw.layout === layout && raw.predicateEvaluated === false && Array.isArray(raw.deniedOperations) && raw.deniedOperations.length === 0, 'TYPE_RAW_ROLE');
    for (const field of ['compiler', 'fixture', 'diagnostics', 'sourceFiles', 'guards']) demand(JSON.stringify(raw[field]) === JSON.stringify(result[field]), 'TYPE_RAW_RESULT_BINDING');
    const readable = new Map([...tools.rows.filter(row => row.path.endsWith('.d.ts') || row.path.endsWith('.json')).map(row => [under(tools.root, row.path), row]), ...packageMap.files.filter(row => row.path.endsWith('.d.ts') || row.path === 'package.json').map(row => [under(candidateRoot, row.path), row]), [fixturePath, fixtureIdentity]]);
    const seen = new Set();
    for (const identity of result.sourceFiles) {
      const expected = readable.get(identity.path);
      demand(expected && !seen.has(identity.path) && identity.bytes === expected.bytes && identity.sha256 === expected.sha256, 'TYPE_READ_CLOSURE');
      seen.add(identity.path);
      await regular(identity.path, expected);
    }
    demand(seen.has(fixturePath) && result.completed === true && result.guards.before === true && result.guards.after === true, 'TYPE_COMPLETION');
    demand(result.matched === diagnosticsMatch(fixtureId, fixturePath, candidateRoot, result.diagnostics), 'TYPE_PREDICATE_BINDING');
    state.typeCaseRows.set(caseRoot, caseBefore);
    budget.admit(deadline);
    return result;
  };
}
