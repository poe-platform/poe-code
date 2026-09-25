import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { admitObjectIoArtifacts, runHostedObjectIoQualification } from '../../../safe-fs/tests/integration/object-io-hosted.mjs';
import { createCloudflareQualificationApi } from '../../../safe-fs/tests/integration/object-io-cloudflare-api.mjs';

const {values} = parseArgs({options:{artifacts:{type:'string'},receipt:{type:'string'},'source-revision':{type:'string'},'run-id':{type:'string'}},strict:true});
assert.ok(values.artifacts && values.receipt && values['source-revision'] && values['run-id']);
const directory = resolve(values.artifacts);
const manifest = JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));
assert.equal(manifest.consumerQualification,true,'Actual consumer runtime qualification required');
assert.deepEqual(manifest.unhandledWorkerErrors,[]);
const artifact = await admitObjectIoArtifacts({manifest:{compatibilityDate:manifest.compatibilityDate,artifacts:manifest.assets},async readArtifact(name) {
 const path = resolve(directory,name);
 const stat = await lstat(path);
 assert.ok(stat.isFile() && !stat.isSymbolicLink());
 return readFile(path);
}});
const requestFor = ({url,token}) => async path => {
 const response = await fetch(url+path,{method:'POST',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(120000)});
 assert.equal(response.status,200,'Hosted Python endpoint failed');
 return response.json();
};
let receipt;
try {
 receipt = await runHostedObjectIoQualification({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
  nonce:randomBytes(16).toString('hex'),token:randomBytes(32).toString('hex'),runId:values['run-id'],sourceRevision:values['source-revision'],artifact,
  api:createCloudflareQualificationApi({token:process.env.CLOUDFLARE_API_TOKEN}),
  async qualify(endpoint) {
   const request = requestFor(endpoint);
   const consumer = await request('/consumer');
   assert.equal(consumer.passed,true);assert.deepEqual(consumer.failures,[]);assert.deepEqual(consumer.callbacks,[]);
   for (const key of ['modelOptions','bashPythonEquivalent','authorization','billing']) assert.equal(consumer[key],true);
   assert.equal(consumer.privateStorage,false);assert.equal(consumer.guestCredentials,false);
   const shell = await request('/python-shell');
   assert.equal(shell.exitCode,0);assert.equal(shell.stdout,'shell-ok\n');assert.equal(shell.stderr,'');assert.deepEqual(shell.failures,[]);
   assert.deepEqual(await request('/unhandled-errors'),[]);
   const unauthorized = await fetch(endpoint.url+'/consumer',{method:'POST',redirect:'error'});
   assert.equal(unauthorized.status,403);
   return {consumer,shell:true,unauthorizedRejected:true,unhandledWorkerErrors:[]};
  },
  clean:async endpoint => requestFor(endpoint)('/cleanup'),
 });
 await writeFile(values.receipt,JSON.stringify({...receipt,passed:true,consumerRevision:manifest.consumerRevision},null,2)+'\n');
} catch (error) {
 await writeFile(values.receipt,JSON.stringify({passed:false,sourceRevision:values['source-revision'],consumerRevision:manifest.consumerRevision,error:String(error)},null,2)+'\n');
 throw error;
}
