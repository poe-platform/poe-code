import { join, relative } from 'node:path';
import { canonical, captureIdentity, checkedMaterialization, directory, finish, guard, inside, ownProjection, readPlan, regularBytes, requireFact, sha256, validateApi } from './worker-support.mjs';

async function validateLoaded(api, loaded, environment, root, manifest, variant) {
  const request = api.request;
  requireFact(loaded && loaded.candidate === request.bindings.candidate && loaded.rootGoSha256 === request.rootGoSha256 && loaded.recipeSha256 === request.recipeSha256, 'Unbound actual load provenance');
  requireFact(loaded.environment === environment && loaded.root === root && loaded.variantId === (variant?.id ?? null), 'Loaded profile/root/variant mismatch');
  requireFact(loaded.factory === 'createYqCommand' && Array.isArray(loaded.supportedCommands) && loaded.supportedCommands.includes('yq') && loaded.invoked === true, 'Actual factory/command invocation absent');
  requireFact(loaded.moduleCacheKey === root && loaded.parentBindingsAuthenticated === true, 'Unbound cache or import parent closure');
  requireFact(loaded.entry?.path === join(root, 'dist/commands/yq/index.js') && loaded.entry.sha256 === manifest.files['dist/commands/yq/index.js'].sha256, 'Actual loaded entry mismatch');
  requireFact(Array.isArray(loaded.resolutions) && loaded.resolutions.length > 0 && loaded.resolutions.length <= 4096, 'Missing or excessive load records');
  const seen = new Set();
  for (const resolution of loaded.resolutions) {
    requireFact(typeof resolution.path === 'string' && inside(root, resolution.path) && typeof resolution.parentURL === 'string' && resolution.parentURL.startsWith('file:'), 'Candidate resolution escaped materialization or lacks parent');
    const key = relative(root, resolution.path).split('\\').join('/');
    requireFact(Object.hasOwn(manifest.files, key) && resolution.sha256 === manifest.files[key].sha256, 'Loaded dependency absent from exact full map');
    await regularBytes(resolution.path, 16777216, manifest.files[key]);
    seen.add(key);
  }
  requireFact(seen.has('dist/commands/yq/index.js'), 'Entry was not actually resolved');
  if (variant) requireFact(seen.has(variant.packageRelativePath) && manifest.files[variant.packageRelativePath].sha256 === variant.postimageSha256, 'Modified dependency was not actually loaded');
}

function normalFacts(capture) {
  const facts = capture.receipt?.normalizedFacts;
  if (capture.loaded?.normalCompletion !== true || facts?.completion !== 'command-result') return null;
  requireFact(Number.isInteger(facts.status) && facts.status >= 0 && facts.status <= 255, 'Invalid command status');
  requireFact(typeof facts.stdoutHex === 'string' && typeof facts.stderrHex === 'string' && /^(?:[a-f0-9]{2})*$/u.test(facts.stdoutHex) && /^(?:[a-f0-9]{2})*$/u.test(facts.stderrHex), 'Invalid raw command hex');
  requireFact(facts.stdoutHex.length + facts.stderrHex.length <= 4194304, 'Command capture overflow');
  requireFact(facts.diagnosticCode === null || typeof facts.diagnosticCode === 'string', 'Invalid normalized diagnostic');
  return facts;
}

function baselineMatches(facts, witness) {
  if (facts === null || facts.status !== witness.job.expected.status) return false;
  const expected = witness.job.expected;
  if (Object.hasOwn(expected, 'stdoutUtf8') && facts.stdoutHex !== Buffer.from(expected.stdoutUtf8).toString('hex')) return false;
  if (expected.diagnosticCode && facts.diagnosticCode !== expected.diagnosticCode) return false;
  if (!expected.diagnosticCode && (facts.stderrHex !== '' || facts.diagnosticCode !== null)) return false;
  if (expected.documents) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(facts.stdoutHex, 'hex'));
      if (!text.endsWith('\n')) return false;
      const documents = text.slice(0, -1).split('\n').map(line => JSON.parse(line));
      if (canonical(documents) !== canonical(expected.documents)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function changedPrimitive(facts, witness, variant) {
  const expected = witness.job.expected;
  if (variant.id === 'retained-view') return facts.status !== expected.status || facts.stdoutHex !== Buffer.from(expected.stdoutUtf8).toString('hex');
  if (variant.id === 'quoted-del') return facts.status !== expected.status;
  if (variant.id === 'pending-shadow') return facts.status !== expected.status || facts.diagnosticCode !== expected.diagnosticCode;
  requireFact(false, 'Unknown kill predicate');
}

async function pristinePrerequisite(api, captured, slot, plan, witness, mutantRoot, artifacts) {
  const prior = captured.loaded.pristineWitness;
  const request = api.request;
  requireFact(prior && prior.runtimeJobId === slot.runtimeJobId && prior.environment === slot.environment && prior.rootGoSha256 === request.rootGoSha256 && prior.recipeSha256 === request.recipeSha256, 'Missing same-environment b8 prerequisite');
  requireFact(prior.loaded?.root !== mutantRoot && !prior.loaded?.pristineWitness, 'Reused mutant root or recursive prerequisite');
  await directory(prior.loaded.root);
  const manifest = JSON.parse((await ownProjection(plan.pristineMap)).toString('utf8'));
  await validateLoaded(api, prior.loaded, slot.environment, prior.loaded.root, manifest, null);
  const identity = await captureIdentity(api, prior.capturePath);
  artifacts.push(identity);
  artifacts.push(await api.writeJson('loaded/pristine-prerequisite.json', { runtimeJobId: prior.runtimeJobId, environment: prior.environment, capture: identity, receipt: prior.receipt, loaded: prior.loaded }));
  const projection = await api.assertProjection({ receipt: prior.receipt, runtimeJobId: slot.runtimeJobId });
  const facts = normalFacts(prior);
  return { valid: projection.status === 'BOUND_PROJECTION_ONLY' && baselineMatches(facts, witness), projection, facts, capture: identity };
}

export async function runWorker(api) {
  const request = validateApi(api);
  await api.phase('setup', { component: 'LOADED' });
  await api.phase('admission');
  await guard(api);
  const plan = await readPlan(api, 'mutantPlan', 'MUTANT-PLAN.json');
  const slot = plan.slots.find(item => item.id === request.job.id);
  requireFact(slot && request.job.environment === slot.environment, 'Unknown LOADED slot/profile');
  if (request.job.runtimeJobId != null) requireFact(request.job.runtimeJobId === slot.runtimeJobId, 'Wrong frozen witness selection');
  const witness = plan.witnesses.find(item => item.witnessId === slot.runtimeJobId);
  requireFact(witness && sha256(JSON.stringify(witness.job)) === witness.frozenWitness.jobSha256, 'Frozen witness mismatch');
  const runtimeJobs = await api.readBoundJson('runtimeJobs');
  requireFact(Array.isArray(runtimeJobs?.jobs), 'Missing core runtime fixture projection');
  const coreWitnesses = runtimeJobs.jobs.filter(item => item.id === slot.runtimeJobId);
  requireFact(coreWitnesses.length === 1 && canonical(coreWitnesses[0]) === canonical(witness.job), 'Core runtime witness differs from frozen input');
  const variant = slot.variantId === null ? null : plan.variants.find(item => item.id === slot.variantId);
  requireFact(slot.variantId === null || variant, 'Unknown variant');
  const materialization = await checkedMaterialization(api, slot, variant);
  requireFact(sha256(canonical(materialization.manifest)) === (variant?.mapSha256 ?? plan.pristineMapSha256), 'Control/pristine complete map digest mismatch');
  await api.note('loaded-admission', { root: materialization.root, entry: materialization.entry, mapSha256: variant?.mapSha256 ?? plan.pristineMapSha256, variantId: slot.variantId, runtimeJobId: slot.runtimeJobId, actualQuoteStyle: slot.actualQuoteStyle ?? null });
  await api.phase('operation', { runtimeJobId: slot.runtimeJobId });
  const captured = await api.captureSemantic({ materialization, runtimeJobId: slot.runtimeJobId });
  await api.phase('capture');
  const artifacts = [await captureIdentity(api, captured.capturePath)];
  artifacts.push(await api.writeJson('loaded/raw-return.json', { runtimeJobId: slot.runtimeJobId, capture: artifacts[0], receipt: captured.receipt, loaded: captured.loaded }));
  await guard(api);
  await validateLoaded(api, captured.loaded, slot.environment, materialization.root, materialization.manifest, variant);
  const facts = normalFacts(captured);
  let classification;
  let status = 'FAIL';
  let baseline = null;
  if (facts === null) {
    classification = 'NON_COMMAND_FAILURE_NOT_A_KILL';
  } else if (variant === null) {
    const projection = await api.assertProjection({ receipt: captured.receipt, runtimeJobId: slot.runtimeJobId });
    status = projection.status === 'BOUND_PROJECTION_ONLY' && baselineMatches(facts, witness) ? 'PASS' : 'FAIL';
    classification = status === 'PASS' ? 'ACTUAL_PRISTINE_LOAD_AND_WITNESS' : 'PRISTINE_WITNESS_FAILURE';
    baseline = { projection };
  } else {
    baseline = await pristinePrerequisite(api, captured, slot, plan, witness, materialization.root, artifacts);
    if (!baseline.valid) classification = 'PRISTINE_PREREQUISITE_FAILURE';
    else if (changedPrimitive(facts, witness, variant)) {
      status = 'PASS';
      classification = 'LOADED_MUTANT_KILLED_BY_DECLARED_PRIMITIVE';
    } else classification = 'MUTANT_SURVIVED';
  }
  const details = { environment: slot.environment, runtimeJobId: slot.runtimeJobId, variantId: slot.variantId, actualQuoteStyle: slot.actualQuoteStyle ?? null, classification, baseline, facts, semanticPasses: 0, fullRecordAcceptance: false, publicExport: 'PUBLIC_EXPORT_GAP', parentExitAndReapStillRequired: true };
  artifacts.push(await api.writeJson('loaded/classification.json', { status, ...details }));
  return finish(api, { status, proofRole: 'LOADED_CONTROL_NOT_SEMANTIC', details, artifacts });
}
