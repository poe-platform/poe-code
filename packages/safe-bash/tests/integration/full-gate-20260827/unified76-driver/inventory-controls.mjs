import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {capture,compare,createTreeGuard,requireBuildDelta,verifyArchive} from './inventory.mjs';
import {createHash} from 'node:crypto';
import {save,sha,candidate} from './common.mjs';
const temporary=mkdtempSync(join(tmpdir(),'unified76-stream-inventory-')),rows=[];
const test=async(name,callback)=>{try{await callback();rows.push({name,status:'PASS'});}catch(error){rows.push({name,status:'FAIL',error:error.stack});}};
const root=join(temporary,'source');mkdirSync(root);writeFileSync(join(root,'input'),'input');
const initial=await capture(root),guard=await createTreeGuard(root);
const expected=[{path:'input',mode:'100644',bytes:5,blob:createHash('sha1').update('blob 5\0input').digest('hex')}];
await test('streamed committed archive authentication',async()=>assert.equal((await verifyArchive(root,expected)).count,1));
await test('streamed exact small-tree digest',async()=>{assert.equal(initial.entries.find(entry=>entry.path==='input').sha256,sha('input'));assert.deepEqual((await guard.check()).changes,[]);});
for(const kind of ['add-file','add-directory','remove','modify','symlink','mode'])await test('streamed '+kind+' rejection',async()=>{
 const file=join(root,'input');
 if(kind==='add-file')writeFileSync(join(root,'extra'),'extra');
 if(kind==='add-directory')mkdirSync(join(root,'extra'));
 if(kind==='remove')rmSync(file);
 if(kind==='modify')writeFileSync(file,'changed');
 if(kind==='symlink'){rmSync(file);symlinkSync('../other',file);}
 if(kind==='mode')chmodSync(file,0o755);
 try{assert.equal((await guard.check()).changes.length,1);await assert.rejects(()=>verifyArchive(root,expected));}finally{if(kind.startsWith('add-'))rmSync(join(root,'extra'),{recursive:true});else{rmSync(file,{force:true});writeFileSync(file,'input',{mode:0o644});}}
});
mkdirSync(join(root,'dist'));writeFileSync(join(root,'dist/index.js'),'built');
await test('only authorized new dist accepted at setup transition',async()=>requireBuildDelta(initial,await capture(root)));
await test('unauthorized new top-level file cannot be blessed by post-build freeze',async()=>{writeFileSync(join(root,'foreign.mjs'),'foreign');try{assert.throws(()=>requireBuildDelta(initial,{...initial,entries:[...initial.entries,{path:'dist',kind:'directory',mode:0o755},{path:'foreign.mjs',kind:'file',mode:0o644,bytes:7,sha256:sha('foreign')}]}));}finally{rmSync(join(root,'foreign.mjs'));}});
const post=await createTreeGuard(root);await test('post-build new output rejected',async()=>{writeFileSync(join(root,'dist/new.js'),'new');try{assert.equal((await post.check()).changes[0].kind,'added');}finally{rmSync(join(root,'dist/new.js'));}});
await test('duplicate entries cannot bypass inventory',async()=>assert.throws(()=>compare(initial,{...initial,entries:[...initial.entries,initial.entries[0]]})));
await test('multi-chunk file digest equals independent whole-byte digest',async()=>{const bytes=Buffer.alloc(1024*1024+17,71);writeFileSync(join(root,'large'),bytes);const found=(await capture(root)).entries.find(entry=>entry.path==='large');assert.equal(found.bytes,bytes.length);assert.equal(found.sha256,sha(bytes));});
const report={candidate:candidate.candidate,temporary,rows,scope:'bounded author streamed inventory and setup transition controls; no full archive inventory execution'};save(join(temporary,'REPORT.json'),report);console.log(JSON.stringify({temporary,pass:rows.filter(row=>row.status==='PASS').length,fail:rows.filter(row=>row.status==='FAIL')}));if(rows.some(row=>row.status==='FAIL'))process.exitCode=1;
