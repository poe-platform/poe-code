import fs from 'node:fs';
import path from 'node:path';
import { createLedger, launchTracked } from '../../launch-ledger.mjs';
import { createEvidenceBudget, claimBytes, writeReserved } from '../../evidence.mjs';
import { createStore, readDocument, encode, saveInput } from '../../records.mjs';
import { publish, reason } from './report.mjs';
import { hash, requireThat, serial, settled } from '../../../executor-v4/safety.mjs';

export async function runCoordinator({ root, repository, mode, runId, authorizationPath, authorizationSha256 }, drivers) {
  const output = { mode, runId, productCohortCalls: 0, setupCalls: 0, rows: [], unsafe: false, historicalScoresUnchanged: true, status: 'PREPARATION_PENDING', cleanupErrors: [] };
  const ledger = createLedger(mode === 'cohort' ? 99 : 27);
  let store;
  let budget;
  let runRoot;
  let permission;
  let configuration;
  let staged;
  let phase = 'arguments';
  const start = Date.now();
  const selectFailure = error => { if (!Object.hasOwn(output, 'fatal')) { output.fatal = error; output.fatalPhase = phase; } else output.cleanupErrors.push({ phase, reason: reason(error) }); output.unsafe = true; };
  const checkpoint = async name => { phase = name; await drivers.checkpoint(name, { output, ledger, budget, store, runRoot }); };
  const integrity = async () => {
    requireThat(Date.now() - start < 4500000, 'OUTER_DEADLINE', mode);
    await drivers.integrity(configuration, staged);
    if (budget) budget.audit();
  };
  try {
    requireThat(mode === 'cohort' && /^[a-z0-9-]{1,64}$/.test(runId ?? ''), 'ARGUMENTS', { mode, runId });
    runRoot = path.join(root, 'runs', runId);
    fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
    fs.mkdirSync(runRoot, { mode: 0o755 });
    budget = createEvidenceBudget(runRoot, { limit: drivers.evidenceLimit ?? 260046848 });
    store = createStore(runRoot, { budget });
    await checkpoint('configuration');
    configuration = await drivers.configure();
    await checkpoint('authentication');
    output.authorizationMetadata = [];
    permission = await drivers.authorize({ root, repository, phase: mode, runId, outputRoot: runRoot, authorizationPath, authorizationSha256, configuration, metadataChildren: output.authorizationMetadata });
    output.recipe = permission.recipe;
    output.acceptedAdmission = permission.approved.acceptedAdmission;
    output.authorizationReferences = { review: permission.authorization.review, grant: permission.authorization.grant };
    output.authorityClass = permission.synthetic === true ? 'SYNTHETIC_ONLY' : 'COMMITTED_ROOT_REVIEW';
    output.authorizationMetadata = permission.metadataChildren ?? output.authorizationMetadata;
    await checkpoint('authority-lock');
    const lock = path.join(runRoot, 'AUTHORITY.lock');
    const lockBytes = encode({ runId, mode, recipe: permission.recipe, grant: permission.grant });
    const lockPermit = budget.external(lock, lockBytes, 0o444, 'authority-lock');
    writeReserved(lockPermit, lockBytes); budget.finish(lock);
    store.save('AUTHORIZATION.json', { mode, recipe: permission.recipe, authorization: permission.authorization, actualRootGrant: permission.synthetic !== true });
    const save = (name, value) => (name === 'STAGED.json' || /^child-\d{3}\.json$/.test(name) ? saveInput(store, name, value) : store.save(name, value)).sha256;
    async function launch(config, synthetic = false) {
      await integrity();
      const preparedConfig = { ...config, authorization: permission.authorization, kind: synthetic ? 'control' : config.kind };
      const operation = drivers.selectOperation(permission, preparedConfig, synthetic ? 'control' : 'engine');
      const previous = ledger.entries.at(-1);
      requireThat(!previous || previous.operationOrdinal < operation.ordinal, 'OPERATION_ORDER', operation.id);
      const receipt = await launchTracked({ ledger, kind: preparedConfig.kind,
        prepare: async entry => {
          entry.operationId = operation.id; entry.operationOrdinal = operation.ordinal;
          const claimPermit = budget.external(path.join(runRoot, `operation-${operation.id}.claim`), claimBytes(operation, permission.recipe));
          const configValue = { ...preparedConfig, operationId: operation.id, operationOrdinal: operation.ordinal, launchOrdinal: entry.ordinal, claimPermit };
          const filename = `child-${String(entry.ordinal).padStart(3, '0')}.json`;
          const configSha = save(filename, configValue);
          await checkpoint('child-prepared');
          return { filename, configSha, configValue };
        },
        supervise: (prepared, attach) => drivers.supervise(prepared, synthetic, runRoot, (child, state) => { attach(child, state); drivers.spawnObserved(child, state); }),
        persist: async (entry, receipt) => { await checkpoint('receipt-persistence'); return save(`child-${String(entry.ordinal).padStart(3, '0')}.receipt.json`, receipt); },
      });
      requireThat(receipt.reaped && receipt.exit && receipt.close, 'CHILD_UNREAPED', { pid: receipt.pid });
      if (synthetic && config.mode === 'leak') requireThat(receipt.failures.every(error => error.code === 'NATURAL_DEADLINE') && receipt.exit.code === 0 && receipt.close.code === 0 && receipt.records.at(-1)?.report?.timerRetired === true, 'UNSAFE_NEGATIVE_CHILD', receipt);
      else if (synthetic && config.mode === 'nonzero') requireThat(receipt.failures.length === 0 && receipt.signals.length === 0 && receipt.exit.code === 7 && receipt.close.code === 7, 'UNSAFE_NEGATIVE_CHILD', receipt);
      else requireThat(settled(receipt), 'CHILD_UNSAFE', { pid: receipt.pid, exit: receipt.exit, failures: receipt.failures, signals: receipt.signals });
      budget.finish(path.join(runRoot, `operation-${operation.id}.claim`));
      await integrity();
      return receipt;
    }
    await checkpoint('stage-intent');
    const declaration = drivers.stageDeclaration(runRoot, configuration);
    for (const item of declaration.views) budget.declareStage(item.root, item.files);
    for (const item of declaration.aliases ?? []) budget.stageAlias(item.root, item.files);
    for (const entry of declaration.evidenceFiles ?? []) budget.reserve(entry.path, entry.bytes, entry.mode, entry.sha256, 'control-fixture');
    await checkpoint('stage');
    if (mode === 'admission') {
      staged = await drivers.stage(path.join(runRoot, 'views'), configuration);
      output.stagedSha256 = save('STAGED.json', staged);
      output.projection = staged.proof;
      output.probes = await serial(Object.values(staged.views).map(view => ({ id: view.name, view })), async item => {
        const receipt = await launch({ kind: 'probe', view: item.view });
        const report = receipt.records.at(-1).report;
        return { safe: true, pass: report.exportEvaluation === true, report };
      }, integrity);
      requireThat(!output.probes.unsafe && output.probes.rows.every(row => row.pass), 'ADMISSION_PROBE_STOP', { rows: output.probes.rows.map(row => ({ id: row.id, pass: row.pass, safe: row.safe })) });
      await checkpoint('controls');
      output.defectControls = await drivers.defectControls();
      output.controls = await drivers.controls({ root, work: runRoot, workflows: configuration.workflows, child: config => launch(config, true), integrity, actualC11: negative => launch({ kind: 'C11', negative, view: staged.views['target-installed'] }) });
      for (const entry of declaration.evidenceFiles ?? []) budget.finish(entry.path);
      output.setupCalls = ledger.entries.filter(entry => entry.kind === 'C11').length;
      output.unsafe = output.controls.unsafe;
      output.admissionQualified = !output.unsafe && output.probes.rows.every(row => row.pass) && output.controls.rows.length === 12 && output.controls.rows.every(row => row.pass) && ledger.entries.length === permission.plan.admission.length && output.setupCalls === permission.plan.limits.admissionSetup && output.productCohortCalls === 0;
      output.observerQualifications = { W07: { comparatorNonExecution: 'UNQUALIFIED', comparatorDispatch: 'UNOBSERVABLE', semanticCredit: false } };
      output.separateCohortGoRequired = true;
    } else {
      const accepted = permission.approved.acceptedAdmission;
      const filename = path.resolve(repository, accepted.path);
      requireThat(filename.startsWith(`${root}/runs/`), 'ADMISSION_PATH', filename);
      const admission = readDocument(path.dirname(filename), path.basename(filename), accepted.sha256);
      requireThat(admission.recipe === 'bd4690d595751b99b3a2bf020f0063f86c03b23ae2600ecaa637be7dc6096b1c' && admission.admissionQualified === true && !admission.unsafe, 'ADMISSION_NOT_ACCEPTED', null);
      output.stagedSha256 = admission.stagedSha256;
      staged = readDocument(path.dirname(filename), 'STAGED.json', admission.stagedSha256, 2 * 1024 * 1024);
      const schedule = configuration.schedule.rows ?? configuration.schedule.executions;
      requireThat(Array.isArray(schedule) && schedule.length === 99, 'SCHEDULE', schedule?.length);
      const cases = new Map([...configuration.legacy, ...configuration.workflows].map(row => [row.id, row]));
      output.cohort = await serial(schedule, async item => {
        const specimen = cases.get(item.id);
        requireThat(specimen && hash(JSON.stringify(specimen)) === item.recipeSha256, 'SPECIMEN_BINDING', item.id);
        const view = staged.views[item.layout];
        const receipt = await launch({ kind: 'case', specimen, view });
        output.productCohortCalls++;
        const report = receipt.records.at(-1).report;
        output.setupCalls += report.setup?.execCalls ?? 0;
        if (report.result) report.result = { ...report.result, stdoutBase64: receipt.stdout, stderrBase64: receipt.stderr, stdout: Buffer.from(receipt.stdout, 'base64').toString(), stderr: Buffer.from(receipt.stderr, 'base64').toString() };
        return drivers.qualify(specimen, report, receipt, true, view.engine);
      }, integrity);
      output.unsafe = output.cohort.unsafe;
      output.actualUniqueSemanticSpecs = 33;
      output.comparisonIsAdditiveNotHistoricalRescore = true;
    }
    await integrity();
  } catch (error) { selectFailure(error); }
  finally {
    phase = 'child-cleanup';
    try { await ledger.closeAll(); } catch (error) { selectFailure(error); }
    try { await drivers.cleanup({ output, ledger }); } catch (error) { selectFailure(error); }
    try {
      await checkpoint('tail');
      const schedule = configuration?.schedule?.rows ?? configuration?.schedule?.executions ?? [];
      const expected = mode === 'cohort' ? schedule.map(row => `${row.ordinal}:${row.layout}:${row.id}`) : Array.from({ length: 12 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`);
      const observed = mode === 'cohort' ? output.cohort?.rows ?? [] : output.controls?.rows ?? [];
      output.tail = expected.map((id, index) => ({ id, status: observed[index]?.status ?? 'UNRUN_PREPARATION_OR_UNSAFE_STOP' }));
      output.launchAccounting = ledger.summary();
      output.allChildrenReaped = output.launchAccounting.allChildrenReaped;
      output.plannedOperations = (permission?.plan[mode] ?? []).map(operation => ({ id: operation.id, launch: ledger.entries.find(entry => entry.operationId === operation.id)?.ordinal ?? null }));
      output.status = output.unsafe || output.launchAccounting.unsafe ? 'UNSAFE_STOP' : mode === 'admission' ? output.admissionQualified ? 'ADMISSION_ACCEPTED' : 'ADMISSION_FAILED' : 'COHORT_COMPLETED';
      if (budget) output.evidence = budget.audit({ partial: output.unsafe });
    } catch (error) { selectFailure(error); output.status = 'UNSAFE_STOP'; }
  }
  let inheritedExitCode = 0;
  try { inheritedExitCode = drivers.inheritedExitCode(); } catch (error) { phase = 'publication-preparation'; selectFailure(error); }
  let publication;
  try { publication = publish({ output, ledger, store, inheritedExitCode, audit: () => { if (budget) budget.audit({ partial: output.unsafe }); }, writeStream: drivers.writeStream }); }
  catch (error) {
    phase = 'publication-emergency'; selectFailure(error);
    publication = { status: 'UNSAFE_STOP', unsafe: true, exitCode: inheritedExitCode || 1, reference: null, selectedPrimary: { present: true, undefinedValue: output.fatal === undefined }, failures: [{ phase }], children: ledger.entries.map(entry => ({ ordinal: entry.ordinal, pid: entry.pid, group: entry.group, reaped: entry.reaped })) };
    try { fs.writeSync(2, encode({ schema: 'PUBLICATION_EMERGENCY', ...publication }, 8192)); } catch {}
  }
  return { output, publication, ledger: ledger.entries, evidence: budget?.snapshot() ?? null };
}
