import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authenticatePacket } from './authorization.mjs';
import { viewProjection } from './projection.mjs';
import { viewProjection as originalProjection, boundFile, writeView, inspectTree } from '../executor-v3/projection.mjs';
import { wrapperEntries } from './consumer-scope.mjs';
import { bindGrantPlan, phasePlan } from '../executor-v4/operations.mjs';
import { supervise } from '../executor-v4/supervisor.mjs';
import { createLedger, launchTracked } from '../executor-v4/launch-ledger.mjs';
import { hash, requireThat, errorRecord, settled, serial } from '../executor-v4/safety.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const run = path.join(root, 'runs/resolution-01');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'RESOLUTION-CASES.json')));
const recipe = authenticatePacket(root);
const ledger = createLedger(fixtures.limits.children);
const result = { kind: 'V5_STUB_ONLY_PACKAGE_RESOLUTION', coordinatorPid: process.pid, started: new Date().toISOString(), recipeSha256: recipe, data: [], children: ledger.entries, realEngineImports: 0, C11: 0, admissionAttempts: 0, semanticCalls: 0, unsafe: false };
fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
fs.mkdirSync(run, { recursive: false });
let evidenceBytes = 0;
const save = (name, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  evidenceBytes += bytes.length;
  requireThat(evidenceBytes <= fixtures.limits.evidenceBytes, 'SYNTHETIC_EVIDENCE_CAP', evidenceBytes);
  fs.writeFileSync(path.join(run, name), bytes, { flag: 'wx' });
  return hash(bytes);
};
const integrity = async () => {
  requireThat(authenticatePacket(root) === recipe, 'SYNTHETIC_RECIPE_CHANGED', recipe);
  for (const tool of fixtures.tools) boundFile(tool.path, tool);
};
const node = fixtures.tools.find(tool => tool.role === 'node').path;
try {
  await integrity();
  const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
  for (const name of ['target-installed', 'target-moved', 'baseline-installed']) {
    const previous = originalProjection(projection, name);
    const current = viewProjection(projection, name);
    const wrapperPaths = new Set(wrapperEntries(current.engine).map(entry => entry.path));
    requireThat(JSON.stringify(previous.files.filter(file => file.path !== previous.consumerPath)) === JSON.stringify(current.files.filter(file => !wrapperPaths.has(file.path))), 'PRODUCT_INDEX_CHANGED', name);
    result.data.push({ id: `DATA-${name}`, pass: true, indexOnly: true, filesBefore: previous.files.length, filesAfter: current.files.length, unchangedPackageFiles: current.files.length - 2 });
  }
  const planBytes = fs.readFileSync(path.join(root, 'OPERATION-PLAN.json'));
  requireThat(planBytes.equals(fs.readFileSync(path.join(root, '../executor-v4/OPERATION-PLAN.json'))), 'OPERATION_PLAN_CHANGED', null);
  const plan = JSON.parse(planBytes);
  const context = { root, phase: 'admission', runId: 'unissued-v5-example', outputRoot: path.join(root, 'runs/unissued-v5-example') };
  const model = { phase: context.phase, runId: context.runId, outputRoot: context.outputRoot, planSha256: hash(JSON.stringify(phasePlan(plan, context.phase))), command: { entry: 'coordinator.mjs', phase: context.phase, runId: context.runId, nodeArgs: plan.command.nodeArgs } };
  bindGrantPlan(model, context, plan);
  let rejected = false;
  try { bindGrantPlan({ ...model, outputRoot: context.outputRoot.replace('/executor-v5/', '/executor-v4/') }, context, plan); }
  catch (error) { requireThat(error.code === 'GRANT_RUN_BINDING', 'WRONG_GRANT_REJECTION', errorRecord(error)); rejected = true; }
  requireThat(rejected, 'OLD_OUTPUT_ACCEPTED', null);
  result.data.push({ id: 'DATA-auth-plan', pass: true, admissionPlanned: plan.admission.length, cohortPlanned: plan.cohort.length, oldOutputRejected: true, usableGrantIssued: false });
  result.controls = await serial(fixtures.cases, async specimen => {
    const parent = path.join(run, 'cases', specimen.id);
    const capsule = path.join(parent, 'capsule');
    const origin = path.join(parent, 'capsule-origin');
    writeView(specimen.moved ? origin : capsule, specimen.physicalFiles.map(({ text, ...file }) => file), entry => Buffer.from(specimen.physicalFiles.find(file => file.path === entry.path).text));
    if (specimen.moved) fs.renameSync(origin, capsule);
    const receipt = await launchTracked({
      ledger, kind: 'synthetic-resolution',
      prepare: async entry => {
        requireThat(entry.ordinal === specimen.ordinal, 'SYNTHETIC_ORDER', specimen.id);
        entry.caseId = specimen.id;
        const filename = `child-${String(entry.ordinal).padStart(3, '0')}.json`;
        const configSha = save(filename, { id: specimen.id, caseSha256: hash(JSON.stringify(specimen)) });
        return { filename, configSha };
      },
      supervise: (prepared, onSpawn) => supervise(node, ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(root, 'resolution-worker.mjs'), path.join(run, prepared.filename), prepared.configSha], path.join(capsule, 'cwd-decoy'), { onSpawn }),
      persist: (entry, child) => save(`child-${String(entry.ordinal).padStart(3, '0')}.receipt.json`, child),
    });
    requireThat(settled(receipt), 'UNSAFE_SYNTHETIC_CHILD', { id: specimen.id, receipt });
    const report = receipt.records.at(-1).report;
    requireThat(report.postGuard && report.oldOriginAbsent && report.cleanupErrors.length === 0 && report.late.length === 0 && (!report.resources || report.resources.pending === 0 && report.resources.violations.length === 0), 'UNSAFE_SYNTHETIC_REPORT', report);
    inspectTree(capsule, specimen.physicalFiles.map(({ text, ...file }) => file));
    const expectedParentURL = pathToFileURL(path.join(capsule, 'view', specimen.importPath)).href;
    const expectedResolvedURL = specimen.expected.resolvedPath ? pathToFileURL(path.join(capsule, specimen.expected.resolvedPath)).href : null;
    const observations = {
      exactRejection: (report.caught?.code ?? null) === specimen.expected.code,
      evaluation: report.evaluated === specimen.expected.evaluated,
      marker: specimen.expected.evaluated ? report.marker === specimen.expected.marker && report.effects.entry === specimen.expected.marker : report.effects.entry === null,
      trapNotEvaluated: report.effects.trap === null && report.effects.decoy === null,
      loadedCount: report.sources.length === specimen.expected.sourceCount,
      correctCwd: report.cwd === path.join(capsule, 'cwd-decoy'),
    };
    if (specimen.profile === 'legacy-self-reference-diagnosis') {
      const detail = JSON.parse(report.caught.message.slice('UNBOUND_MODULE: '.length));
      observations.actualLegacyParent = detail.parent === expectedParentURL;
      observations.actualLegacyResolution = detail.url === expectedResolvedURL;
    } else if (expectedResolvedURL) {
      observations.actualParent = report.resolutions.length === 1 && report.resolutions[0].parentURL === expectedParentURL;
      observations.actualResolution = report.resolutions.length === 1 && report.resolutions[0].url === expectedResolvedURL;
      observations.resolutionAccepted = report.resolutions[0]?.accepted === specimen.expected.evaluated;
    } else observations.noResolutionBeforeScopeRejection = report.resolutions.length === 0;
    return { safe: true, pass: Object.values(observations).every(value => value === true), profile: specimen.profile, observations, report };
  }, integrity);
  result.unsafe = result.controls.unsafe;
  await integrity();
} catch (error) { result.unsafe = true; result.fatal = errorRecord(error); }
result.finished = new Date().toISOString();
result.launchAccounting = ledger.summary();
result.unsafe ||= result.launchAccounting.unsafe;
const rows = [...result.data, ...(result.controls?.rows ?? [])];
result.counts = { data: result.data.length, synthetic: result.controls?.rows.filter(row => row.safe).length ?? 0, passed: rows.filter(row => row.pass === true).length, failed: rows.filter(row => row.pass === false).length, unrun: fixtures.cases.filter(specimen => !result.controls?.rows.some(row => row.id === specimen.id && row.safe)).length };
result.status = result.unsafe ? 'UNSAFE_STOP' : result.counts.failed || result.counts.unrun ? 'SYNTHETIC_REJECT' : 'SYNTHETIC_PREPARATION_QUALIFIED';
save('RESULT.json', result);
process.stdout.write(`${JSON.stringify({ status: result.status, counts: result.counts, launchAccounting: result.launchAccounting, report: path.join(run, 'RESULT.json') })}\n`);
if (result.status !== 'SYNTHETIC_PREPARATION_QUALIFIED') process.exitCode = 1;
