import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.dirname(new URL(import.meta.url).pathname);
const log=fs.openSync(path.join(root,'FINALIZE.capture.data'),'wx',0o600);
const emit=value=>fs.writeSync(log,JSON.stringify(value)+'\n');
const hash=location=>{
  const stat=fs.lstatSync(location);assert.ok(stat.isFile());assert.ok(stat.size<=128*1024*1024);
  const digest=crypto.createHash('sha256');const descriptor=fs.openSync(location,'r');const buffer=Buffer.alloc(65536);let size=0;
  try{let count;while((count=fs.readSync(descriptor,buffer,0,buffer.length,null))>0){digest.update(buffer.subarray(0,count));size+=count;}}finally{fs.closeSync(descriptor);}
  assert.equal(size,stat.size);return{path:location,size,mode:stat.mode&0o777,sha256:digest.digest('hex')};
};
try{
  emit({event:'start',at:new Date().toISOString(),role:'DATA-only'});
  const result=JSON.parse(fs.readFileSync(path.join(root,'ACTUAL-01/RESULT.json')));
  assert.ok(Date.now()<result.started+3600000);
  const seal=JSON.parse(fs.readFileSync(path.join(root,'SEAL.json')));
  for(const row of [seal.node,...seal.sources,...seal.tools,...seal.inputs])assert.deepEqual(hash(row.path),{path:row.path,size:row.size,mode:row.mode,sha256:row.sha256});
  assert.equal(result.source,'f97fd06024cb63edfd01873d81d84576a22189db');
  assert.equal(result.children,27);assert.equal(result.receipts.length,27);
  let rawBytes=0;
  const captures=new Map();
  for(const receipt of result.receipts){
    assert.equal(receipt.retired,true);assert.equal(receipt.signal,null);assert.equal(receipt.stop,null);assert.ok([0,1,2].includes(receipt.code));
    for(const row of [receipt.stdout,receipt.stderr]){assert.deepEqual(hash(row.path),row);rawBytes+=row.size;}
    captures.set(receipt.id,fs.readFileSync(receipt.stdout.path,'utf8').split('\n').filter(Boolean));
  }
  assert.equal(rawBytes,result.captureBytes);
  const expectedFailures=['I01-parent-optional-reset','I02-parent-alternative-reset','I03-nested-parent-reset','I04-manual-example','I05-finite-parent-reset','I06-parent-zero-iteration','I23-finite-reset-property'];
  const layouts=[];
  for(const layout of ['source','installed','moved']){
    const author=result.results.find(row=>row.id===layout+'-author');
    const independent=result.results.find(row=>row.id===layout+'-independent');
    assert.equal(author.pass,true);assert.equal(author.results.pass,66);assert.equal(author.results.fail,0);
    assert.equal(independent.pass,false);assert.equal(independent.results.pass,17);assert.equal(independent.results.fail,7);
    assert.deepEqual(independent.results.rows.filter(row=>!row.pass).map(row=>row.id),expectedFailures);
    const parsed=captures.get(layout+'-independent').map(line=>JSON.parse(line));
    const property=parsed.find(row=>row.event==='property');assert.equal(property.checked,62);assert.equal(property.failures.length,52);
    for(const suffix of ['author','independent']){
      const admitted=captures.get(layout+'-'+suffix).map(line=>JSON.parse(line)).find(row=>row.event==='admitted');
      assert.equal(admitted.manifest.files.length,11);
      if(suffix==='author'){
        const loaded=captures.get(layout+'-'+suffix).map(line=>JSON.parse(line)).find(row=>row.event==='loaded');
        assert.deepEqual(Object.keys(loaded.files),['types','errors','limits','syntax','matcher']);
        for(const [name,record] of Object.entries(loaded.files)){
          assert.equal(new URL(record.url).pathname,path.join(admitted.manifest.directory,name+'.js'));
          assert.equal(record.sha256,admitted.manifest.files.find(row=>row.name===name+'.js').sha256);
        }
      }
    }
    layouts.push({layout,author:{pass:66,fail:0},independent:{pass:17,fail:7},failures:expectedFailures,property:{checks:62,contradictions:52},observations:parsed.filter(row=>row.event==='observation')});
  }
  const types=result.results.filter(row=>row.id.includes('-types-'));assert.equal(types.length,6);assert.ok(types.every(row=>row.pass));
  const mutations=result.results.filter(row=>/^M\d\d-.+-control$/.test(row.id));assert.equal(mutations.length,6);assert.ok(mutations.every(row=>row.pass&&row.restored));
  const denials=result.results.filter(row=>row.id==='wrong-hash'||row.id==='wrong-path');assert.equal(denials.length,2);assert.ok(denials.every(row=>row.pass));
  const original=JSON.parse(fs.readFileSync(path.join(root,'ACTUAL-01/original.manifest.json')));
  for(const row of original.files){const current=hash(path.join(original.directory,row.name));assert.equal(current.sha256,row.sha256);assert.equal(current.mode,row.mode);assert.equal(current.size,row.size);}
  assert.equal(fs.existsSync(path.join(root,'ACTUAL-01/work/installed-consumer')),false);
  const chargeTrace={historyEntries:255,outerCharges:255,leftLinkCharges:255*254/2,rightLinkCharges:255*254/2,total:255**2,checkpointPredicatesTrue:0,classification:'SOURCE arithmetic only, not executed cancellation/timing proof'};
  const summary={source:result.source,seal:result.seal,disposition:'REJECT pending capture-reset correction/profile decision',layouts,types,mutations,denials,stockGroupOutcomes:{pass:249,fail:21,total:270,uniqueGroupIds:90,inputOverlap:true},runtime:{children:27,retired:27,elapsedMs:result.elapsedMs,captureBytes:rawBytes,work:result.working,peakOwnerAndChild:2},sourceOnlyChargeTrace:chargeTrace,publicationElapsedMs:Date.now()-result.started,native:'UNRUN',shellIntegration:'UNRUN'};
  fs.writeFileSync(path.join(root,'SUMMARY.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600,flag:'wx'});
  const entries=[];
  const visit=directory=>{for(const name of fs.readdirSync(directory)){if(directory===path.join(root,'ACTUAL-01')&&name==='work')continue;if(name.startsWith('FINALIZE')||name==='EVIDENCE.json')continue;const location=path.join(directory,name);const stat=fs.lstatSync(location);if(stat.isDirectory())visit(location);else if(stat.isFile())entries.push({...hash(location),path:path.relative(root,location)});else throw Error('unexpected evidence role');}};
  visit(root);entries.sort((left,right)=>left.path<right.path?-1:1);
  const evidence={files:entries,bytes:entries.reduce((sum,row)=>sum+row.size,0),canonicalEntriesSha256:crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
  fs.writeFileSync(path.join(root,'EVIDENCE.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});
  emit({event:'complete',summary:hash(path.join(root,'SUMMARY.json')),evidence:hash(path.join(root,'EVIDENCE.json')),runtime:summary.runtime});
  console.log(JSON.stringify({summary:hash(path.join(root,'SUMMARY.json')),evidence:hash(path.join(root,'EVIDENCE.json')),runtime:summary.runtime,types:types.map(row=>({id:row.id,diagnostics:row.diagnostics})),mutants:mutations.map(row=>({id:row.id,killed:row.killed})),sourceOnlyChargeTrace:chargeTrace}));
}catch(error){emit({event:'failure',message:String(error?.stack??error)});process.exitCode=1;}
finally{fs.fsyncSync(log);fs.closeSync(log);}
