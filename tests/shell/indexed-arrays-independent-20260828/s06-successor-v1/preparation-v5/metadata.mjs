import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate, census, digest } from '../../candidate-v1/boundary-app.mjs';
import { put } from '../preparation-v3/staging.mjs';
import { controller } from '../preparation-v4/controller.mjs';
import { deadline } from '../preparation-v4/deadline.mjs';
import { admitSelectedSource } from './composition.mjs';

const clock = deadline(180000), here = path.dirname(fileURLToPath(import.meta.url)), own = path.resolve(here,'../..'), repository = path.resolve(own,'../../..');
const [sealHash,label] = process.argv.slice(2); assert.match(label ?? '', /^[A-Z0-9-]{1,30}$/u);
const seal = JSON.parse(authenticate(path.join(here,'SEAL.json'),sealHash));
const verify = () => {
  clock.check('metadata-integrity'); authenticate(path.join(here,'SEAL.json'),sealHash);
  for (const role of seal.roles) { const file = path.join(own,role.path); assert.equal(authenticate(file,role.sha256).length,role.bytes); assert.equal(fs.lstatSync(file).mode & 0o777,role.mode); }
  authenticate(seal.node.path,seal.node.sha256); authenticate(seal.git.path,seal.git.sha256);
};
verify(); assert.equal(process.execPath,seal.node.path); assert.equal(process.version,seal.node.version);
const root = path.join(here,`METADATA-${label}`); assert.equal(fs.existsSync(root),false); fs.mkdirSync(root);
const policy = { ...JSON.parse(authenticate(path.join(here,'POLICY.json'),seal.policySha256)), reservedCleanupMs: 5000, maxWorkingBytes: 67108864, maxPersistedEvidenceBytes: 67108864 };
const budget = controller(root,policy,{node:seal.node,git:seal.git},verify,clock);
budget.registerStorage('metadata',root,67108864);
let evidence, failure;
try {
  const scope = authenticate(path.join(own,'s06-successor-v1/SCOPE-BINDING-v2.json'),seal.scopeSha256);
  const result = await admitSelectedSource(scope, async args => {
    const run = await budget.child('git',seal.git.path,args,{cwd:repository,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'},timeoutMs:10000,maxBytes:16777216});
    assert.equal(run.code,0,'metadata tool command failed'); assert.equal(run.stderr,''); return Buffer.from(run.stdout);
  }, () => clock.check('metadata-composition',5000));
  evidence = result.evidence; assert.equal(result.files.size,269); assert.equal(budget.children.length,282);
} catch (reason) { failure = String(reason?.stack ?? reason); }
try {
  const terminal = await budget.finalize({kind:'composition-metadata-only',complete:!failure,unsafeStop:Boolean(failure),failure,sealHash,evidence,actualProductImports:0,actualBuilds:0,actualNativeOracleCalls:0},()=>({finalCensus:census(root)}),value=>new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):resolve())));
  clock.check('metadata-exit'); process.exitCode = terminal.accepted ? 0 : 78;
} catch (reason) { console.error(String(reason?.stack ?? reason)); process.exitCode = 78; }
