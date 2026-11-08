import assert from 'node:assert/strict';
import {existsSync,writeFileSync,readFileSync,readlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url));
const mode=process.argv[2];
if(mode==='containment'){
  const denied=join(directory,'FORBIDDEN-WRITE');assert.equal(existsSync(denied),false);
  assert.throws(()=>writeFileSync(denied,'forbidden'),error=>['EPERM','EACCES'].includes(error.code));
  assert.equal(existsSync(denied),false);writeFileSync(join(process.env.REVIEW_WORK,'allowed-write'),'allowed');console.log('OWNED_WRITE_ALLOWED_PARENT_WRITE_DENIED');
}else if(mode==='HEAD'||mode==='pinned'){
  const {parseArgs}=await import('./policy.mjs');
  const input=['--candidate',mode==='HEAD'?'HEAD':'f5e9fc49b6abb38e180cc9de16c95fced102ff75','--inspect'];
  console.log(JSON.stringify({input,calling:'parseArgs only, not inspect/run'}));console.log(JSON.stringify(parseArgs(input)));
}else if(mode==='seal'){
  const {verifyDriverSeal}=await import('./admission.mjs');const seal=verifyDriverSeal();console.log(JSON.stringify({candidate:seal.candidate,files:Object.keys(seal.files).length}));
}else if(mode==='link-transport'){
  const input=JSON.parse(readFileSync(process.env.REVIEW_TRANSPORT));
  const {extractCommitted}=await import('./transport.mjs');const {verifyArchive}=await import('./inventory.mjs');
  const receipt=await extractCommitted(input);const verified=await verifyArchive(input.destination,input.entries);
  assert.equal(readlinkSync(join(input.destination,'fixture-link')),'payload');assert.equal(readFileSync(join(input.destination,'payload'),'utf8'),'contained frozen bytes\n');
  assert.deepEqual(receipt.survivors,[]);assert.equal(receipt.closed,true);assert.equal(receipt.status,0);assert.ok(receipt.transferBytes<1048576);
  console.log(JSON.stringify({receipt,verified,link:'payload',noOutsideEffect:true}));
}else throw new Error('Unknown bounded probe');
