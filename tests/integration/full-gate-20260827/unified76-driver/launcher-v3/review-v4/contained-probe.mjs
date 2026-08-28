import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readlinkSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createObserverClient} from '../process-observer.mjs';
import {extractCommitted} from '../transport.mjs';
import {verifyArchive} from '../inventory.mjs';

try{
  const config=JSON.parse(readFileSync(process.argv[2]));
  const refused=spawnSync('/bin/ps',['-axo','pid=,pgid='],{encoding:'utf8'});
  assert.equal(refused.error?.code,'EPERM','the original inner observer restriction must remain');
  assert.throws(()=>writeFileSync(config.forbidden,'forbidden'),error=>['EPERM','EACCES'].includes(error.code));
  assert.equal(existsSync(config.forbidden),false);
  const observer=createObserverClient(process.env.UNIFIED76_OBSERVER_TOKEN);
  await assert.rejects(observer.register(process.pid),/actual direct children/);
  await assert.rejects(observer.members({handle:'not-an-admitted-handle'}),/unknown observation capability/);
  const receipt=await extractCommitted({...config.input,observer});
  const verified=await verifyArchive(config.input.destination,config.input.entries);
  assert.equal(readlinkSync(join(config.input.destination,'fixture-link')),'payload');
  assert.equal(readFileSync(join(config.input.destination,'payload'),'utf8'),'contained frozen bytes\n');
  assert.equal(receipt.status,0);assert.equal(receipt.closed,true);assert.deepEqual(receipt.survivors,[]);
  console.log(JSON.stringify({receipt,verified,innerPs:'EPERM retained',outsideWrite:'refused',foreignPid:'refused',foreignHandle:'refused'}));
}finally{process.disconnect?.();}
