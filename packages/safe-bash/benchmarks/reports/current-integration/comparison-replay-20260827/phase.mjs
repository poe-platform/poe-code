import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(await readFile(new URL('config.json', import.meta.url)));
const phase = process.argv[2];
const destination = join(config.output, phase);
const write = (name, value) => writeFile(join(destination, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const baselineRoot = join(config.source, 'benchmarks/node_modules/just-bash');
const engines = ['virtual-bash', 'just-bash'];
const load = (profile, name) => import(pathToFileURL(join(profile.harness, name)).href);

if (phase === 'controls') {
  for (const [name, profile] of Object.entries(config.profiles)) {
    const { inventory } = await load(profile, 'inventory.mjs');
    await write(`${name}-inventory.json`, await inventory(config.source, baselineRoot));
    const { session } = await load(profile, 'session.mjs');
    for (const engine of engines) { const worker = await session(engine, config.source, baselineRoot); await worker.close(); }
    await load(profile, 'harness.test.mjs');
  }
} else {
  const profile = config.profiles[phase];
  assert.ok(profile);
  const { hash, compare, environment, fixtureRoot, maximumBytes } = await load(profile, 'common.mjs');
  const { recipes, performanceRecipes } = await load(profile, 'recipes.mjs');
  const { inventory } = await load(profile, 'inventory.mjs');
  const { session } = await load(profile, 'session.mjs');
  const { localServer } = await load(profile, 'server.mjs');
  const { transportControls } = await load(profile, 'transport.mjs');
  const gold = JSON.parse(await readFile(profile.goldPath));
  const corpus = recipes();
  assert.equal(corpus.length, 224); assert.equal(new Set(corpus.map(row => row.id)).size, 224);
  for (const specimen of [...corpus, ...performanceRecipes()]) assert.equal(gold.observations.find(row => row.id === specimen.id)?.recipeHash, hash(JSON.stringify(specimen)), specimen.id);
  for (const [path, expected] of Object.entries(gold.sourceHashes)) assert.equal(hash(await readFile(join(profile.harness, path))), expected, path);
  const names = await inventory(config.source, baselineRoot);
  await write('inventory.json', names);
  await write('case-inputs.json', corpus);
  await write('setup.json', { phase, profile, source: config.source, baselineRoot, environment, cwd: fixtureRoot, provider: 'fresh in-memory filesystem per case for BOTH engines', maximumBytes,
    productLimits: { maxOutputBytes: maximumBytes, maxCommands: 10000, maxLoopIterations: 10000, pipeHighWaterMark: 4096, signalMs: 5000 },
    baselineLimits: { maxOutputSize: maximumBytes, maxCommandCount: 10000, maxLoopIterations: 10000, maxExecutionTimeMs: 5000, signalMs: 5000, networkTimeoutMs: 4000 },
    sessionLimits: { startupMs: 15000, caseMs: 10000, heapMiB: 256 },
    unchangedHarness: 'Committed engine/session/recipes/common/inventory/server/transport modules are byte-identical. New orchestration bypasses old archive/live-dependency setup and automatic performance; assertions, cases, order, and 24 neutrality controls preserved.',
    scratch: phase === 'original' ? 'Original virtual env omits TMPDIR and does not precreate /tmp; historical native TMPDIR was nonexistent fixture/tmp.' : 'Virtual TMPDIR=/tmp precreated outside fixture; captured native scratch was preexisting external unique directory projected to /tmp.',
    effects: 'Exact fixture entries: byte content, types, symlink targets; mode only on declared mode recipes. No ownership/timestamp/outside-fixture equality claim.',
    hostEnvironment: Object.fromEntries(Object.entries(process.env).filter(([key]) => !['NODE_OPTIONS'].includes(key))),
  });
  await write('transport-controls.json', await transportControls(baselineRoot));
  const server = await localServer();
  assert.equal(new URL(server.baseUrl).hostname, '127.0.0.1');
  await write('network-binding.json', { baseUrl: server.baseUrl, permittedOrigin: server.baseUrl, explicitOptionalPlugin: true });
  const sessions = new Map(), results = [], neutrality = [];
  const totals = engine => Object.fromEntries(['pass', 'fail', 'timeout', 'harness-or-engine-error', 'invalid-oracle'].map(status => [status, results.filter(row => row[engine].status === status).length]));
  const checkpoint = value => writeFile('/tmp/safe-bash-comparison-replay-checkpoint.txt', JSON.stringify({ phase, at: new Date().toISOString(), ...value }, null, 2) + '\n');
  async function run(engine, specimen, instrument = true, fresh = false) {
    let worker;
    try {
      worker = !fresh && sessions.get(engine);
      if (!worker) { worker = await session(engine, config.source, baselineRoot); if (!fresh) sessions.set(engine, worker); }
      const response = await worker.run(specimen, server.baseUrl, instrument, 0);
      if (response.error) { await worker.close(); sessions.delete(engine); }
      const expected = gold.observations.find(row => row.id === specimen.id);
      return { ...response, status: !expected.oracleValid ? 'invalid-oracle' : response.timeout ? 'timeout' : response.error ? 'harness-or-engine-error' : compare(expected, response.observation).pass ? 'pass' : 'fail', comparison: response.observation ? compare(expected, response.observation) : null };
    } catch (error) { return { status: 'harness-or-engine-error', error: String(error.stack ?? error), comparison: null }; }
    finally { if (fresh && worker) await worker.close(); }
  }
  try {
    for (const [index, specimen] of corpus.entries()) {
      const row = { id: specimen.id, group: specimen.group, command: specimen.command, optionFamily: specimen.optionFamily, expected: gold.observations.find(row => row.id === specimen.id), order: index % 2 ? [...engines].reverse() : engines };
      for (const engine of row.order) row[engine] = await run(engine, specimen);
      results.push(row);
      await appendFile(join(destination, 'functional.jsonl'), JSON.stringify(row) + '\n');
      if (index === 0 || (index + 1) % 28 === 0) {
        const progress = { completed: results.length, totals: Object.fromEntries(engines.map(engine => [engine, totals(engine)])) };
        console.log(JSON.stringify(progress)); await checkpoint(progress);
      }
    }
    await write('functional.json', results);
    const controlIds = ['command/cat/binary-stdin', 'command/echo/multiple', 'command/chmod/numeric', 'command/stat/fields', 'command/patch/apply', 'command/mktemp/file'];
    const controls = [...corpus.filter(specimen => controlIds.includes(specimen.id)), ...corpus.filter(specimen => ['tar', 'jq', 'join', 'sed'].includes(specimen.command)).filter((specimen, index, array) => array.findIndex(other => other.command === specimen.command) === index), ...corpus.filter(specimen => specimen.group === 'network').slice(0, 2)];
    for (const specimen of controls) for (const engine of engines) {
      const plain = await run(engine, specimen, false, true), traced = results.find(row => row.id === specimen.id)[engine];
      neutrality.push({ id: specimen.id, engine, plain, pass: !!plain.observation && !!traced.observation && compare(plain.observation, traced.observation).pass });
    }
    await write('instrumentation-controls.json', neutrality);
    const hits = engine => [...new Set(results.flatMap(row => row[engine].observation?.registryEvents.map(event => event.name) ?? []))].sort();
    const reached = Object.fromEntries(engines.map(engine => [engine, hits(engine)]));
    const dispatch = { reached, requiredUnshadowed: names.virtual.unshadowedRegistry, missingUnshadowed: names.virtual.unshadowedRegistry.filter(name => !reached['virtual-bash'].includes(name)), curlCases: results.filter(row => row.group === 'network').map(row => ({ id: row.id, events: row['virtual-bash'].observation?.registryEvents ?? [] })), defaultCurlRegistered: names.virtual.registered.includes('curl') };
    await write('dispatch.json', dispatch);
    const report = { phase, finishedAt: new Date().toISOString(), denominator: results.length, totals: Object.fromEntries(engines.map(engine => [engine, totals(engine)])), instrumentation: { total: neutrality.length, pass: neutrality.filter(row => row.pass).length }, dispatch,
      bothPass: results.filter(row => engines.every(engine => row[engine].status === 'pass')).length,
      bothNonPass: results.filter(row => engines.every(engine => row[engine].status !== 'pass')).map(row => row.id),
      performance: 'Not run; functional elapsed/memory fields retained as raw historical observation shape only, not performance evidence.', lifecycle: 'Pending outer supervisor gate; scores do not imply lifecycle pass.' };
    await write('report.json', report); await checkpoint(report); console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const worker of sessions.values()) await worker.close();
    await server.close();
    await write('network-requests.json', server.requests);
    await write('phase-cleanup.json', { at: new Date().toISOString(), sessionsClosed: true, serverClosed: true, independentSupervisorRequired: true });
  }
}
