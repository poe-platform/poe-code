import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authority, authenticatePacket } from './authorization.mjs';
import { boundFile, inspectTree, stage, authenticateView, parseStage } from '../executor-v3/projection.mjs';
import { supervise } from './supervisor.mjs';
import { controls, defectControls } from './controls.mjs';
import { qualify } from './predicates.mjs';
import { hash, requireThat, errorRecord, serial, settled } from './safety.mjs';
import { createLedger, launchTracked } from './launch-ledger.mjs';
import { selectOperation } from './operations.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(root, '../../../..');
const readJson = filename => JSON.parse(fs.readFileSync(filename));
const projection = readJson(path.join(root, '../executor-v3/PROJECTION.json'));
const node = projection.tools.find(tool => tool.role === 'node').path;
const workflows = readJson(path.join(root, '../WORKFLOWS.json')).rows;
const legacy = readJson(path.join(root, '../LEGACY-RECIPES.json')).rows.map(row => row.recipe);
const schedule = readJson(path.join(root, '../executor-preparation-v1/SCHEDULE.json'));
const mode = process.argv[2];
requireThat(['verify', 'admission', 'cohort'].includes(mode), 'MODE', mode);
const plan = readJson(path.join(root, 'OPERATION-PLAN.json'));
const ledger = createLedger(mode === 'cohort' ? 99 : 27);
const recipe = authenticatePacket(root);
for (const tool of projection.tools) boundFile(tool.path, tool);
if (mode === 'verify') {
  process.stdout.write(`${JSON.stringify({ recipe, verified: true, productImports: 0, modes: ['admission', 'cohort'], realModesHeldWithoutDifferentFreezeAndRootGrant: true })}\n`);
} else {
  const runId = process.argv[3];
  requireThat(/^[a-z0-9-]{1,64}$/.test(runId ?? ''), 'RUN_ID', runId);
  const runRoot = path.join(root, 'runs', runId);
  let authorization;
  let permission;
  {
    const external = readJson(process.argv[4]);
    authorization = { repository, phase: mode, runId, outputRoot: runRoot, review: external.review, grant: external.grant };
    permission = authority({ ...authorization, root, projection });
    requireThat(process.execArgv.includes('--unhandled-rejections=strict'), 'STRICT_UNHANDLED_POLICY', process.execArgv);
  }
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runs', `authority-${authorization.grant.sha256}.lock`), `${JSON.stringify({ runId, mode, recipe, grant: authorization.grant })}\n`, { flag: 'wx', mode: 0o444 });
  fs.mkdirSync(runRoot);
  const output = { recipe, mode, runId, started: new Date().toISOString(), productCohortCalls: 0, setupCalls: 0, children: ledger.entries, rows: [], unsafe: false, historicalScoresUnchanged: true, status: mode === 'admission' ? 'ADMISSION_PENDING' : 'COHORT_PENDING' };
  const outerStart = Date.now();
  let written = 0;
  const save = (name, value) => {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    written += bytes.length;
    requireThat(written <= 268435456, 'EVIDENCE_CAP', written);
    fs.writeFileSync(path.join(runRoot, name), bytes, { flag: 'wx', mode: 0o644 });
    return hash(bytes);
  };
  save('AUTHORIZATION.json', { mode, authorization: authorization ?? null, recipe, actualRootGrant: true });
  let staged;
  const integrity = async () => {
    try {
    requireThat(Date.now() - outerStart < 4500000, 'OUTER_DEADLINE', mode);
    requireThat(authenticatePacket(root) === recipe, 'RECIPE_CHANGED', recipe);
    for (const tool of projection.tools) boundFile(tool.path, tool);
    if (staged) for (const view of Object.values(staged.views)) {
      authenticateView(projection, view);
      inspectTree(view.root, view.files);
      if (view.oldOrigin) requireThat(!fs.existsSync(view.oldOrigin), 'OLD_LAYOUT_PRESENT', view.oldOrigin);
    }
    } catch (cause) { throw Object.assign(new Error('UNSAFE_INTEGRITY', { cause }), { code: 'UNSAFE_INTEGRITY', original: errorRecord(cause) }); }
  };
  async function launch(config, synthetic = false) {
    await integrity();
    requireThat(output.children.length < (mode === 'cohort' ? 99 : 27), 'CHILD_BUDGET', output.children.length);
    const preparedConfig = { ...config, authorization, kind: synthetic ? 'control' : config.kind };
    const operation = selectOperation(permission.approved, preparedConfig, plan, permission.context, synthetic ? 'control' : 'engine');
    const previous = ledger.entries.at(-1);
    requireThat(!previous || previous.operationOrdinal < operation.ordinal, 'OPERATION_ORDER', operation.id);
    const receipt = await launchTracked({
      ledger, kind: preparedConfig.kind,
      prepare: async entry => {
        entry.operationId = operation.id; entry.operationOrdinal = operation.ordinal;
        const boundConfig = { ...preparedConfig, operationId: operation.id, operationOrdinal: operation.ordinal, launchOrdinal: entry.ordinal };
        const filename = `child-${String(entry.ordinal).padStart(3, '0')}.json`;
        const configSha = save(filename, boundConfig);
        return { configSha, filename, boundConfig };
      },
      supervise: (prepared, onSpawn) => supervise(node, ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(root, synthetic ? 'synthetic-worker.mjs' : 'worker.mjs'), path.join(runRoot, prepared.filename), prepared.configSha], runRoot, { legacy: config.kind === 'case' && !config.specimen.id.startsWith('W'), onSpawn }),
      persist: (entry, child) => save(`child-${String(entry.ordinal).padStart(3, '0')}.receipt.json`, child),
    });
    await integrity();
    requireThat(receipt.reaped && receipt.exit && receipt.close, 'CHILD_UNREAPED', receipt);
    if (synthetic && config.mode === 'leak') requireThat(receipt.failures.every(error => error.code === 'NATURAL_DEADLINE') && receipt.exit.code === 0 && receipt.close.code === 0 && receipt.records.at(-1)?.report?.timerRetired === true, 'UNSAFE_NEGATIVE_CHILD', receipt);
    else if (synthetic && config.mode === 'nonzero') requireThat(receipt.failures.length === 0 && receipt.signals.length === 0 && receipt.exit.code === 7 && receipt.close.code === 7, 'UNSAFE_NEGATIVE_CHILD', receipt);
    else requireThat(settled(receipt), 'CHILD_UNSAFE', receipt);
    return receipt;
  }
  try {
    if (mode === 'admission') {
      staged = stage(path.join(runRoot, 'views'), projection);
      output.stagedSha256 = save('STAGED.json', staged);
      output.projection = { proof: staged.proof, before: staged.before, after: staged.after };
      output.probes = await serial(Object.values(staged.views).map(view => ({ id: view.name, view })), async item => {
        const receipt = await launch({ authorization, kind: 'probe', view: item.view });
        const report = receipt.records.at(-1).report;
        return { safe: report.postGuard === true && report.resources.pending === 0 && report.resources.violations.length === 0 && report.loads.count > 0, pass: report.exportEvaluation === true, report };
      }, integrity);
      requireThat(!output.probes.unsafe, 'ADMISSION_PROBE_STOP', output.probes);
      output.defectControls = await defectControls();
      output.controls = await controls({ root, work: runRoot, workflows, child: config => launch(config, true), integrity, actualC11: negative => launch({ authorization, kind: 'C11', negative, view: staged.views['target-installed'] }) });
      output.setupCalls = output.children.filter(child => child.kind === 'C11').length;
      output.unsafe = output.controls.unsafe;
      output.admissionQualified = !output.unsafe && output.probes.rows.every(row => row.pass) && output.controls.rows.every(row => row.pass) && ledger.entries.length === 14 && output.setupCalls === 2 && output.productCohortCalls === 0;
      output.observerQualifications = { W07: { comparatorNonExecution: 'UNQUALIFIED', comparatorDispatch: 'UNOBSERVABLE', semanticCredit: false } };
      output.separateCohortGoRequired = true;
    } else {
      const approved = authority({ ...authorization, root, projection }).approved;
      const admissionFile = path.resolve(repository, approved.acceptedAdmission.path);
      requireThat(admissionFile.startsWith(`${root}/runs/`), 'ADMISSION_PATH', admissionFile);
      const bytes = fs.readFileSync(admissionFile);
      requireThat(hash(bytes) === approved.acceptedAdmission.sha256, 'ADMISSION_HASH', admissionFile);
      const admission = JSON.parse(bytes);
      requireThat(admission.mode === 'admission' && admission.recipe === recipe && admission.admissionQualified === true && !admission.unsafe, 'ADMISSION_NOT_ACCEPTED', admission);
      staged = parseStage(fs.readFileSync(path.join(path.dirname(admissionFile), 'STAGED.json')), admission.stagedSha256);
      await integrity();
      const executions = schedule.rows ?? schedule.executions;
      requireThat(Array.isArray(executions) && executions.length === 99, 'SCHEDULE', executions?.length);
      const cases = new Map([...legacy, ...workflows].map(specimen => [specimen.id, specimen]));
      output.cohort = await serial(executions, async item => {
        const specimen = cases.get(item.id);
        requireThat(specimen && hash(JSON.stringify(specimen)) === item.recipeSha256, 'SPECIMEN_BINDING', item.id);
        const view = staged.views[item.layout];
        const receipt = await launch({ authorization, kind: 'case', specimen, view });
        output.productCohortCalls++;
        const report = receipt.records.at(-1).report;
        output.setupCalls += report.setup?.execCalls ?? 0;
        if (report.result) report.result = { ...report.result, stdoutBase64: receipt.stdout, stderrBase64: receipt.stderr, stdout: Buffer.from(receipt.stdout, 'base64').toString('utf8'), stderr: Buffer.from(receipt.stderr, 'base64').toString('utf8') };
        return qualify(specimen, report, receipt, true, view.engine);
      }, integrity);
      output.unsafe = output.cohort.unsafe;
      output.actualUniqueSemanticSpecs = 33;
      output.comparisonIsAdditiveNotHistoricalRescore = true;
    }
    await integrity();
  } catch (error) { output.unsafe = true; output.fatal = errorRecord(error); }
  output.finished = new Date().toISOString();
  const expected = mode === 'cohort' ? schedule.rows.map(row => `${row.ordinal}:${row.layout}:${row.id}`) : Array.from({ length: 12 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`);
  const observedRows = mode === 'cohort' ? output.cohort?.rows ?? [] : output.controls?.rows ?? [];
  output.tail = expected.map((id, index) => ({ id, status: observedRows[index]?.status ?? 'UNRUN_PREPARATION_OR_UNSAFE_STOP' }));
  output.launchAccounting = ledger.summary();
  output.allChildrenReaped = output.launchAccounting.allChildrenReaped;
  output.plannedOperations = plan[mode].map(operation => ({ id: operation.id, launch: ledger.entries.find(entry => entry.operationId === operation.id)?.ordinal ?? null }));
  output.status = output.unsafe || output.launchAccounting.unsafe ? 'UNSAFE_STOP' : mode === 'admission' ? output.admissionQualified ? 'ADMISSION_ACCEPTED' : 'ADMISSION_FAILED' : 'COHORT_COMPLETED';
  output.evidenceBytesBeforeFinal = written;
  try { save('RESULT.json', output); } catch (error) { output.unsafe = true; output.status = 'UNSAFE_STOP'; output.finalPersistenceError = errorRecord(error); process.stderr.write(`${JSON.stringify({ emergencyLaunchAccounting: output.launchAccounting, children: output.children, error: output.finalPersistenceError })}\n`); }
  process.stdout.write(`${JSON.stringify({ mode, runId, unsafe: output.unsafe, children: output.children.length, reaped: output.children.filter(child => child.reaped).length, controls: output.controls?.rows.map(row => ({ id: row.id, status: row.status })), fatal: output.fatal, report: path.join(runRoot, 'RESULT.json') })}\n`);
  if (output.unsafe || output.controls?.rows.some(row => row.pass === false) || output.cohort?.rows.some(row => row.pass === false)) process.exitCode = 1;
}
