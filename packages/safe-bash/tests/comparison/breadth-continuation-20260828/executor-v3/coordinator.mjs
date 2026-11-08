import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authority, authenticatePacket } from './authorization.mjs';
import { boundFile, inspectTree, stage, authenticateView, parseStage } from './projection.mjs';
import { supervise } from './supervisor.mjs';
import { controls, defectControls } from './controls.mjs';
import { qualify } from './predicates.mjs';
import { hash, requireThat, errorRecord, serial, settled } from './safety.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(root, '../../../..');
const readJson = filename => JSON.parse(fs.readFileSync(filename));
const projection = readJson(path.join(root, 'PROJECTION.json'));
const node = projection.tools.find(tool => tool.role === 'node').path;
const workflows = readJson(path.join(root, '../WORKFLOWS.json')).rows;
const legacy = readJson(path.join(root, '../LEGACY-RECIPES.json')).rows.map(row => row.recipe);
const schedule = readJson(path.join(root, '../executor-preparation-v1/SCHEDULE.json'));
const mode = process.argv[2];
requireThat(['verify', 'synthetic', 'synthetic-repair', 'synthetic-load', 'admission', 'cohort'].includes(mode), 'MODE', mode);
const syntheticMode = mode.startsWith('synthetic');
const recipe = authenticatePacket(root);
for (const tool of projection.tools) boundFile(tool.path, tool);
if (mode === 'verify') {
  process.stdout.write(`${JSON.stringify({ recipe, verified: true, productImports: 0, modes: ['synthetic', 'admission', 'cohort'], realModesHeldWithoutDifferentFreezeAndRootGrant: true })}\n`);
} else {
  const runId = process.argv[3];
  requireThat(/^[a-z0-9-]{1,64}$/.test(runId ?? ''), 'RUN_ID', runId);
  const runRoot = path.join(root, 'runs', runId);
  let authorization;
  if (!syntheticMode) {
    const external = readJson(process.argv[4]);
    authorization = { repository, phase: mode, review: external.review, grant: external.grant };
    authority({ ...authorization, root, projection });
  }
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
  if (!syntheticMode) fs.writeFileSync(path.join(root, 'runs', `authority-${authorization.grant.sha256}.lock`), `${JSON.stringify({ runId, mode, recipe, grant: authorization.grant })}\n`, { flag: 'wx', mode: 0o444 });
  fs.mkdirSync(runRoot);
  const output = { recipe, mode, runId, started: new Date().toISOString(), productCohortCalls: 0, setupCalls: 0, children: [], rows: [], unsafe: false, historicalScoresUnchanged: true };
  const outerStart = Date.now();
  let written = 0;
  const save = (name, value) => {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    written += bytes.length;
    requireThat(written <= 268435456, 'EVIDENCE_CAP', written);
    fs.writeFileSync(path.join(runRoot, name), bytes, { flag: 'wx', mode: 0o644 });
    return hash(bytes);
  };
  save('AUTHORIZATION.json', { mode, authorization: authorization ?? null, recipe, actualRootGrant: !syntheticMode });
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
    const ordinal = output.children.length + 1;
    const filename = `child-${String(ordinal).padStart(3, '0')}.json`;
    const configSha = save(filename, config);
    const receipt = await supervise(node, ['--max-old-space-size=256', path.join(root, synthetic ? 'synthetic-worker.mjs' : 'worker.mjs'), path.join(runRoot, filename), configSha], runRoot, { legacy: config.kind === 'case' && !config.specimen.id.startsWith('W') });
    const receiptSha = save(`child-${String(ordinal).padStart(3, '0')}.receipt.json`, receipt);
    output.children.push({ ordinal, pid: receipt.pid, configSha, receiptSha, reaped: receipt.reaped, natural: receipt.natural, kind: config.kind ?? config.mode });
    await integrity();
    requireThat(receipt.reaped && receipt.exit && receipt.close, 'CHILD_UNREAPED', receipt);
    if (synthetic && config.mode === 'leak') requireThat(receipt.failures.every(error => error.code === 'NATURAL_DEADLINE') && receipt.exit.code === 0 && receipt.close.code === 0 && receipt.records.at(-1)?.report?.timerRetired === true, 'UNSAFE_NEGATIVE_CHILD', receipt);
    else if (synthetic && config.mode === 'nonzero') requireThat(receipt.failures.length === 0 && receipt.signals.length === 0 && receipt.exit.code === 7 && receipt.close.code === 7, 'UNSAFE_NEGATIVE_CHILD', receipt);
    else requireThat(settled(receipt), 'CHILD_UNSAFE', receipt);
    return receipt;
  }
  try {
    if (syntheticMode) {
      output.defectControls = mode === 'synthetic' ? await defectControls() : { status: 'RETAINED_NOT_RERUN', originalCommit: '446206f6', count: 20 };
      output.controls = await controls({ root, work: runRoot, workflows, child: config => launch(config, true), integrity, only: mode === 'synthetic-repair' ? ['C03', 'C04', 'C05'] : mode === 'synthetic-load' ? ['C03', 'C04'] : null });
      output.unsafe = output.controls.unsafe;
      output.productImports = 0;
      output.actualC11 = 'HELD_NOT_A_MODEL_PASS';
    } else if (mode === 'admission') {
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
      output.admissionQualified = !output.unsafe && output.probes.rows.every(row => row.pass) && output.controls.rows.every(row => row.pass);
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
  const expected = mode === 'cohort' ? schedule.rows.map(row => `${row.ordinal}:${row.layout}:${row.id}`) : mode === 'synthetic-repair' ? ['C03', 'C04', 'C05'] : mode === 'synthetic-load' ? ['C03', 'C04'] : Array.from({ length: 12 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`);
  const observedRows = mode === 'cohort' ? output.cohort?.rows ?? [] : output.controls?.rows ?? [];
  output.tail = expected.map((id, index) => ({ id, status: observedRows[index]?.status ?? 'UNRUN_PREPARATION_OR_UNSAFE_STOP' }));
  output.allChildrenReaped = output.children.every(child => child.reaped);
  output.evidenceBytesBeforeFinal = written;
  save('RESULT.json', output);
  process.stdout.write(`${JSON.stringify({ mode, runId, unsafe: output.unsafe, children: output.children.length, reaped: output.children.filter(child => child.reaped).length, controls: output.controls?.rows.map(row => ({ id: row.id, status: row.status })), fatal: output.fatal, report: path.join(runRoot, 'RESULT.json') })}\n`);
  if (output.unsafe || output.controls?.rows.some(row => row.pass === false) || output.cohort?.rows.some(row => row.pass === false)) process.exitCode = 1;
}
