import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveData, rawRoot, regular, digest } from './archive-data.mjs';
import { census, admit, authenticate, tarInventory, verifyTree } from '../../candidate-v1/boundary-app.mjs';
import { controller } from '../preparation-v4/controller.mjs';
import { deadline } from '../preparation-v4/deadline.mjs';
import { assess } from '../preparation-v3/assess.mjs';
import { put, copyRegularTree, unpack, variantTar } from '../preparation-v3/staging.mjs';
import { prepareCompiledMutation } from '../preparation-v3/compiled-mutation.mjs';
import { admissionControls } from '../preparation-v3/admission-controls.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), own = path.resolve(here, '../..');
const clock = deadline(1200000);
let budget, report;
try {
  const [grantPath, grantHash, sealHash, label] = process.argv.slice(2);
  assert.equal(process.argv.length, 6); assert.match(label, /^ARRAY-TAIL-[A-Z0-9-]{1,40}$/u);
  const seal = JSON.parse(authenticate(path.join(here, 'SEAL.json'), sealHash));
  const grant = JSON.parse(authenticate(grantPath, grantHash));
  assert.deepEqual(Object.keys(grant), ['action','sealSha256','candidate','packageSha256','rootReceipt']);
  assert.equal(grant.action, 'execute-array-affected-tail-v1'); assert.equal(grant.sealSha256, sealHash);
  assert.match(grant.rootReceipt, /^[a-f0-9]{40}$/u);
  const scope = JSON.parse(authenticate(path.resolve(here, '../SCOPE-BINDING-v2.json'), seal.scopeSha256));
  assert.equal(grant.candidate, scope.product); assert.equal(grant.packageSha256, scope.package.sha256);
  const policy = JSON.parse(authenticate(path.join(here, 'POLICY.json'), seal.policySha256));
  assert.equal(policy.totalElapsedMsIncludingCleanup, clock.totalMs);
  const verifyRoles = () => {
    clock.check('sealed-role-integrity');
    for (const role of seal.roles) { const filename = path.join(own, role.path); assert.equal(authenticate(filename, role.sha256).length, role.bytes); assert.equal(fs.lstatSync(filename).mode & 0o777, role.mode); }
    authenticate(scope.tools.node.path, scope.tools.node.sha256);
    authenticate(path.join(here, 'SEAL.json'), sealHash); authenticate(grantPath, grantHash);
  };
  verifyRoles(); assert.equal(process.execPath, scope.tools.node.path); assert.equal(process.version, scope.tools.node.version);
  const archive = await archiveData(['FINAL.json','types-source-build.json','types-installed.json','types-moved.json'], false, () => clock.check('archive-admission', policy.reservedCleanupMs));
  const historical = JSON.parse(archive.values.get('FINAL.json'));
  assert.equal(historical.candidate, scope.product); assert.equal(historical.composition, scope.selectedComposition);
  assert.ok(historical.accounting.children.every(child => child.retired && child.groupAbsent));
  assert.deepEqual(fs.readdirSync(path.join(rawRoot, 'records')), []);
  const verifyRetained = () => { for (const tree of historical.finalCensuses) { clock.check('retained-inputs', policy.reservedCleanupMs); verifyTree(tree); } };
  verifyRetained();
  const work = path.join(here, `RUN-${label}`); assert.ok(!fs.existsSync(work)); fs.mkdirSync(work);
  const immutable = [];
  report = { kind: 'array-affected-tail-v1', candidate: scope.product, composition: scope.selectedComposition, packageSha256: scope.package.sha256, sealHash, grantHash, rootReceipt: grant.rootReceipt, work, phases: [], complete: false, unsafeStop: false, qualification: 'No new build/install/compiler pass. Reused authenticated actual v5 package and prior three-layout type receipts. Old10/9/8 outcomes not rescored.' };
  budget = controller(work, policy, { node: scope.tools.node, git: seal.git }, () => { verifyRoles(); for (const tree of immutable) verifyTree(tree); }, clock);
  for (const role of seal.storage) { fs.mkdirSync(path.join(work, role.directory)); budget.registerStorage(role.name, path.join(work, role.directory), role.maxBytes); }
  const sourceRoot = path.join(work, 'source'), apps = path.join(work, 'apps'), artifacts = path.join(work, 'artifacts'), priorRoot = path.join(work, 'prior');
  for (const entry of scope.selectedSource) { const bytes = authenticate(path.join(rawRoot, 'source', entry.path), entry.sha256); assert.equal(bytes.length, entry.bytes); put(path.join(sourceRoot, entry.path), bytes, parseInt(entry.mode, 8) & 0o777); }
  immutable.push({ root: sourceRoot, entries: census(sourceRoot) });
  const typeReceipts = {};
  for (const layout of ['source-build','installed','moved']) {
    const name = `types-${layout}.json`, bytes = archive.values.get(name), parsed = JSON.parse(bytes);
    assert.equal(parsed.accepted, true); assert.equal(parsed.candidate, scope.product); assert.equal(parsed.packageSha256, scope.package.sha256);
    assert.deepEqual(parsed.unapprovedAstChanges, []); assert.equal(parsed.results.length, 10); assert.ok(parsed.results.every(row => row.accepted));
    const filename = path.join(priorRoot, name); put(filename, bytes); typeReceipts[layout] = { path: filename, sha256: digest(bytes) };
  }
  immutable.push({ root: priorRoot, entries: census(priorRoot) });
  const tarFile = path.join(artifacts, 'original.tgz'), originalTar = authenticate(path.join(rawRoot, 'artifacts/virtual-bash-0.0.0.tgz'), scope.package.sha256);
  assert.deepEqual(tarInventory(originalTar), scope.package.inventory); put(tarFile, originalTar);
  const originalMembers = unpack(originalTar), roles = new Map(seal.appRoles.map(role => [role.destination, authenticate(path.join(own, role.path), role.sha256)]));
  const stage = (template, name, kind = 'source') => { const app = path.join(apps, name); copyRegularTree(template, app); for (const [destination, bytes] of roles) { const filename = path.join(app, destination); fs.writeFileSync(filename, bytes); fs.chmodSync(filename, 0o644); } assert.deepEqual(census(app), seal.appTemplates[kind]); return app; };
  const sourceApp = stage(path.join(rawRoot, 'apps/source-app'), 'source-app');
  const installed = stage(path.join(rawRoot, 'apps/moved-app'), 'installed-reused-app', 'installed');
  const jobs = JSON.parse(authenticate(path.join(here, 'JOBS.json'), seal.jobsSha256)), positives = new Map();
  let bindingSerial = 0;
  const binding = async (app, layout, receipt = typeReceipts[layout], packageTar = tarFile, mutant) => {
    const packageRoot = path.join(app, 'node_modules/virtual-bash');
    const manifest = { kind: 'array-candidate-review-v1', candidate: scope.product, baseTree: '37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e', repository: scope.repository ?? path.resolve(own, '../../..'), node: scope.tools.node, trees: [{ root: app, entries: census(app) }, immutable[0], { root: artifacts, entries: census(artifacts) }], sourceRoot, sourceProjection: scope.selectedSource, sourceProjectionSha256: policy.projectionSha256, harnessRoot: app, packageRoot, packageTar, packageSha256: digest(regular(packageTar)), layout, defaultCount: 77, rootModule: path.join(packageRoot,'dist/index.js'), runtimeModule: path.join(packageRoot,'dist/shell/runtime.js'), rootDeclaration: path.join(packageRoot,'dist/index.d.ts'), workerModule: path.join(app,'worker.mjs'), vectorsFile: path.join(app,'VECTORS.json'), controlsFile: path.join(app,'CONTROLS.json'), holdoutsFile: path.join(app,'HOLDOUTS.json'), baselineFile: path.join(app,'BASELINE.json'), astCasesFile: path.join(app,'AST-COMPAT.json'), astBaselineFile: path.join(app,'AST-BASELINE.json'), adapter: { path: path.join(app,'complete-adapter.mjs') }, requiredFiles: [...roles.keys()].map(name => path.join(app,name)), astTypes: { accepted: true, candidate: scope.product, receiptPath: receipt.path, receiptSha256: receipt.sha256 }, continuation: 'affected-tail-v2; inherited prior type results only', ...(mutant ? { mutant } : {}) };
    const serial = ++bindingSerial;
    const manifestRecord = await budget.record(`manifest-${serial}`, manifest);
    const go = await budget.record(`go-${serial}`, { action: 'execute-array-candidate', rootReceipt: grant.rootReceipt, candidate: scope.product, manifestSha256: manifestRecord.sha256 });
    return { manifest, manifestPath: manifestRecord.path, manifestHash: manifestRecord.sha256, goPath: go.path, goHash: go.sha256 };
  };
  const run = async (app, job, receipt, tar = tarFile, mutant) => {
    const bound = await binding(app, job.layout ?? 'source-build', receipt, tar, mutant);
    admit(bound.manifestPath,bound.manifestHash,bound.goPath,bound.goHash);
    const manifest = bound.manifest;
    const roots = [...manifest.trees.map(tree => tree.root),bound.manifestPath,bound.goPath,manifest.astTypes.receiptPath,scope.tools.node.path];
    const result = await budget.child('product', scope.tools.node.path, ['--permission',...roots.map(root => `--allow-fs-read=${root}`),path.join(app,job.cohort==='guard'?'guard-worker.mjs':'worker.mjs'),bound.manifestPath,bound.manifestHash,bound.goPath,bound.goHash,job.cohort,JSON.stringify(job.ids)], { cwd: app, env: { LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: policy.maxRuntimeWorkerMs });
    for (const tree of manifest.trees) verifyTree(tree);
    const required = [manifest.rootModule,...(job.cohort==='guard'?[]:[manifest.runtimeModule])].map(filename=>({path:filename,sha256:digest(regular(filename))}));
    const verdict = assess(result,job.ids,required,mutant);
    if (mutant && ['U08','U11'].includes(mutant.id) && verdict.coherent) {
      const observation = verdict.observations.find(row => row.id === (mutant.id === 'U08' ? 'M22' : 'P11-U11'));
      const phases = observation?.pass ? observation.detail.detail : observation?.detail.phases;
      const expected = mutant.id === 'U08' ? ['readonly','caller','escaping'] : ['mixed-B','mixed-C'];
      if (!Array.isArray(phases) || JSON.stringify(phases.map(row => row.phase)) !== JSON.stringify(expected) || phases.some(row => typeof row.pass !== 'boolean')) { verdict.coherent=false; verdict.errors.push('missing versioned phase receipts'); verdict.mutantKilled=false; }
      else { verdict.phaseSpecificity = phases[0].pass === false && phases.slice(1).every(row => row.pass); verdict.mutantKilled &&= verdict.phaseSpecificity; }
    }
    const record = await budget.record(`body-${report.phases.length}`,{job,binding:bound,verdict});
    report.phases.push({job,receipt:record,accepted:mutant?verdict.mutantKilled:verdict.accepted});
    assert.equal(verdict.coherent,true,JSON.stringify(verdict.errors)); budget.ordinary(job.label,mutant?verdict.mutantKilled:verdict.accepted);
    if (!mutant && job.layout === 'source-build') for (const row of verdict.observations) positives.set(row.id,row.pass);
    return verdict;
  };
  for (const layout of ['source-build','installed','moved']) {
    let app = layout === 'source-build' ? sourceApp : installed;
    if (layout === 'moved') { const before = census(installed); app = path.join(apps,'moved-app'); fs.renameSync(installed,app); assert.deepEqual(census(app),before); assert.equal(fs.existsSync(installed),false); }
    const probe = await binding(app,layout);
    await budget.record(`admission-${layout}`,admissionControls(probe,()=>{}));
    for (const job of jobs.filter(row=>row.stage==='layout'&&row.layout===layout)) await run(app,job,typeReceipts[layout]);
  }
  for (const job of jobs.filter(row=>row.stage==='positive-before')) await run(sourceApp,job,typeReceipts['source-build']);
  for (const definition of JSON.parse(authenticate(path.join(here,'MUTANTS.json'),seal.mutantsSha256)).declarations) {
    if (![...definition.requiredFailed,...definition.requiredPassed].every(id=>positives.get(id)===true)) { report.phases.push({label:definition.id,blocked:'same-candidate positive prerequisite failed'}); budget.ordinary(definition.id,false); continue; }
    const keys=['id','member','originalSha256','originalBytes','mode','replacements','prefix','finalLF','changedSha256','changedBytes'];
    const spec=Object.fromEntries(keys.map(key=>[key,definition[key]]));
    const changed=prepareCompiledMutation(originalMembers.get(definition.member).bytes,spec), tar=variantTar(originalTar,definition.member,changed), variant=path.join(artifacts,`${definition.id}.tgz`); put(variant,tar);
    const app=stage(sourceApp,`mutant-${definition.id}`); fs.writeFileSync(path.join(app,'node_modules/virtual-bash',definition.member),changed);
    const inventory=tarInventory(tar); assert.equal(Object.keys(inventory).length,862);
    for(const [name,entry]of Object.entries(scope.package.inventory))if(name!==definition.member)assert.deepEqual(inventory[name],entry);
    const receipt=await budget.record(`inherited-types-${definition.id}`,{candidate:scope.product,packageSha256:digest(tar),sourceProjectionSha256:policy.projectionSha256,accepted:true,unapprovedAstChanges:[],qualification:'No new compiler pass; unchanged declaration/package metadata bytes inherit prior actual types',inheritedFrom:typeReceipts['source-build']});
    const mutant={id:definition.id,path:path.join(app,'node_modules/virtual-bash',definition.member),sha256:definition.changedSha256,requiredFailed:definition.requiredFailed,requiredPassed:definition.requiredPassed};
    await run(app,{label:definition.id,layout:'source-build',cohort:definition.cohort,ids:definition.ids},receipt,variant,mutant);
  }
  for (const job of jobs.filter(row=>row.stage==='positive-after')) await run(sourceApp,job,typeReceipts['source-build']);
  verifyRetained(); report.complete=true;
} catch(reason) {
  if(report){report.unsafeStop=true;report.error=String(reason?.stack??reason);}else{console.error(String(reason?.stack??reason));process.exitCode=78;}
} finally {
  if(report&&budget) {
    try { const terminal=await budget.finalize(report,()=>({finalCensuses:['source','apps','artifacts','prior'].map(name=>({root:path.join(report.work,name),entries:census(path.join(report.work,name))}))}),value=>new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):resolve())));clock.check('exit-selection');process.exitCode=terminal.unsafeStop?78:terminal.accepted?0:1; }
    catch(reason){console.error(`unsafe finalization: ${String(reason)}`);process.exitCode=78;}
  }
}
