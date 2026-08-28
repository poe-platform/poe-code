import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authenticatePacket } from './authorization.mjs';
import { viewProjection, boundFile, writeView, inspectTree } from './projection.mjs';
import { viewProjection as previousProjection } from '../executor-v5/projection.mjs';
import { supervise } from '../executor-v4/supervisor.mjs';
import { createLedger, launchTracked } from '../executor-v4/launch-ledger.mjs';
import { hash, requireThat, errorRecord, settled, serial } from '../executor-v4/safety.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const run = path.join(root, 'runs/entry-01');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'ENTRY-CASES.json')));
const recipe = authenticatePacket(root);
const ledger = createLedger(fixtures.limits.children);
const result = { kind: 'V6_STUB_WORKER_ENTRY_EDGE', coordinatorPid: process.pid, started: new Date().toISOString(), recipeSha256: recipe, data: [], children: ledger.entries, unsafe: false, realEngineImports: 0, actualC11: 0, newAdmissionAttempts: 0, semanticCalls: 0 };
fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
fs.mkdirSync(run);
let written = 0;
const save = (name, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  written += bytes.length;
  requireThat(written <= fixtures.limits.evidenceBytes, 'STUB_EVIDENCE_CAP', written);
  fs.writeFileSync(path.join(run, name), bytes, { flag: 'wx' });
  return hash(bytes);
};
const integrity = async () => {
  requireThat(authenticatePacket(root) === recipe, 'STUB_RECIPE_CHANGED', recipe);
  for (const tool of fixtures.tools) boundFile(tool.path, tool);
};
try {
  await integrity();
  const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
  for (const name of ['target-installed', 'target-moved', 'baseline-installed']) {
    const current = viewProjection(projection, name);
    requireThat(JSON.stringify(current) === JSON.stringify(previousProjection(projection, name)), 'PROJECTION_CHANGED', name);
    result.data.push({ id: `DATA-${name}`, pass: true, indexOnly: true, files: current.files.length });
  }
  requireThat(fs.readFileSync(path.join(root, 'OPERATION-PLAN.json')).equals(fs.readFileSync(path.join(root, '../executor-v5/OPERATION-PLAN.json'))), 'PLAN_CHANGED', null);
  result.data.push({ id: 'DATA-plan', pass: true, admissionWorkers: 14, cohortWorkers: 99, grantIssued: false });
  const node = fixtures.tools.find(tool => tool.role === 'node').path;
  result.controls = await serial(fixtures.cases, async specimen => {
    const parent = path.join(run, 'cases', specimen.id);
    const capsule = path.join(parent, 'capsule');
    const origin = path.join(parent, 'capsule-origin');
    writeView(specimen.moved ? origin : capsule, specimen.physicalFiles.map(({ text, ...file }) => file), file => Buffer.from(specimen.physicalFiles.find(entry => entry.path === file.path).text));
    if (specimen.moved) fs.renameSync(origin, capsule);
    const receipt = await launchTracked({
      ledger, kind: 'stub-entry-edge',
      prepare: async entry => {
        requireThat(entry.ordinal === specimen.ordinal, 'STUB_ORDER', specimen.id);
        entry.caseId = specimen.id;
        const filename = `child-${String(entry.ordinal).padStart(3, '0')}.json`;
        const configSha = save(filename, { id: specimen.id, caseSha256: hash(JSON.stringify(specimen)) });
        return { filename, configSha };
      },
      supervise: (prepared, onSpawn) => supervise(node, ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(root, 'entry-worker.mjs'), path.join(run, prepared.filename), prepared.configSha], path.join(capsule, 'cwd-decoy'), { onSpawn }),
      persist: (entry, child) => save(`child-${String(entry.ordinal).padStart(3, '0')}.receipt.json`, child),
    });
    requireThat(settled(receipt), 'UNSAFE_STUB_CHILD', receipt);
    const report = receipt.records.at(-1).report;
    requireThat(report.postGuard && report.oldOriginAbsent && !report.late.length && report.attempts.every(attempt => attempt.hooksClosed && !attempt.cleanupErrors.length && (!attempt.resources || attempt.resources.pending === 0 && attempt.resources.descriptors === 0 && !attempt.resources.violations.length)), 'UNSAFE_STUB_REPORT', report);
    inspectTree(capsule, specimen.physicalFiles.map(({ text, ...file }) => file));
    const expectedWorker = pathToFileURL(path.join(root, 'entry-worker.mjs')).href;
    const expectedConsumer = pathToFileURL(path.join(capsule, 'view', specimen.consumerPath)).href;
    const observations = { workerIdentity: report.workerURL === expectedWorker, attempts: report.attempts.length === specimen.steps.length };
    for (const [index, step] of specimen.steps.entries()) {
      const actual = report.attempts[index];
      const acceptedEntries = actual.entries.filter(entry => entry.accepted);
      const expected = step.expected;
      observations[`${index}:exactCode`] = (actual.caught?.code ?? null) === expected.code;
      observations[`${index}:evaluation`] = actual.evaluated === expected.evaluated;
      observations[`${index}:sourceCount`] = actual.sources.length === expected.sourceCount;
      observations[`${index}:consumerSources`] = actual.sources.filter(source => source.path === specimen.consumerPath).length === expected.consumerSources;
      observations[`${index}:entryAccepted`] = acceptedEntries.length === expected.acceptedEntries;
      observations[`${index}:noTrap`] = actual.effects.trap === null && actual.effects.decoy === null;
      observations[`${index}:effect`] = actual.effects.entry === (expected.evaluated ? specimen.marker : null);
      if (expected.evaluated) {
        observations[`${index}:marker`] = actual.marker === specimen.marker;
        observations[`${index}:exactEdge`] = acceptedEntries.length === 1 && acceptedEntries[0].parentURL === expectedWorker && acceptedEntries[0].url === expectedConsumer && acceptedEntries[0].specifier === expectedConsumer;
        observations[`${index}:bareEdge`] = actual.bareResolutions.length === 1 && actual.bareResolutions[0].accepted && actual.bareResolutions[0].parentURL === expectedConsumer;
      }
      if (step.action === 'intermediate') observations[`${index}:intermediateObserved`] = actual.entries.length === 1 && actual.entries[0].parentURL === pathToFileURL(path.join(capsule, 'view/unauthorized-parent.mjs')).href && actual.entries[0].url === expectedConsumer && actual.entries[0].accepted === false;
      if (['missing-parent', 'wrong-parent', 'parent-query'].includes(step.action)) {
        const attemptEvent = receipt.records.find(event => event.kind === 'consumer-entry-attempt' && event.attempt === index);
        const wanted = step.action === 'missing-parent' ? null : step.action === 'parent-query' ? `${expectedWorker}?parent-alias` : pathToFileURL(path.join(capsule, 'view/unauthorized-parent.mjs')).href;
        observations[`${index}:actualForwardedParent`] = actual.metadataOverrides.length === 1 && attemptEvent?.parentURL === wanted;
      }
    }
    return { safe: true, pass: Object.values(observations).every(value => value === true), observations, report };
  }, integrity);
  result.unsafe = result.controls.unsafe;
  await integrity();
} catch (error) { result.unsafe = true; result.fatal = errorRecord(error); }
result.finished = new Date().toISOString();
result.launchAccounting = ledger.summary();
result.unsafe ||= result.launchAccounting.unsafe;
const rows = [...result.data, ...(result.controls?.rows ?? [])];
result.counts = { data: result.data.length, synthetic: result.controls?.rows.filter(row => row.safe).length ?? 0, passed: rows.filter(row => row.pass === true).length, failed: rows.filter(row => row.pass === false).length, unrun: fixtures.cases.filter(specimen => !result.controls?.rows.some(row => row.id === specimen.id && row.safe)).length, stepsObserved: result.controls?.rows.reduce((total, row) => total + (row.report?.attempts.length ?? 0), 0) ?? 0 };
result.status = result.unsafe ? 'UNSAFE_STOP' : result.counts.failed || result.counts.unrun ? 'STUB_REJECT' : 'STUB_PREPARATION_QUALIFIED';
save('RESULT.json', result);
process.stdout.write(`${JSON.stringify({ status: result.status, counts: result.counts, launchAccounting: result.launchAccounting, report: path.join(run, 'RESULT.json') })}\n`);
if (result.status !== 'STUB_PREPARATION_QUALIFIED') process.exitCode = 1;
