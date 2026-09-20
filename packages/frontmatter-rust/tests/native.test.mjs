import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as own from '../dist/index.js';
import * as sdk from '../../frontmatter/dist/index.js';
import {Worker} from 'node:worker_threads';
test('fences match the SDK for BOM, line endings, fence whitespace and UTF-16 bodies',()=>{
 for(const ending of ['\n','\r\n','\r'])for(const bom of ['','\uFEFF'])for(const opening of ['---','--- \t','----','---#comment'])for(const closing of ['---','--- \t','----']){
  const source=bom+opening+ending+'title: example'+ending+closing+ending+'😀\uD800'+ending+'Body';
  let expected;
  try{expected=sdk.splitFrontmatterBlock(source);}catch(error){assert.throws(()=>own.splitFrontmatterBlock(source),{message:error.message});continue;}
  assert.deepEqual(own.splitFrontmatterBlock(source),expected);
 }
});
test('default duplicate, YAML 1.2 scalar and timestamp semantics match SDK',()=>{
 for(const yaml of ['title: first\ntitle: second','yes: yes\noctal: 0o17\nleading: 001\ndate: 2026-01-01','first: &date !!timestamp 2026-01-01\nsecond: *date','__proto__: {owner: attacker}']){
  const source='---\n'+yaml+'\n---\nBody';assert.deepEqual(own.parseFrontmatter(source),sdk.parseFrontmatter(source));
 }
 const parsed=own.parseFrontmatter('---\nfirst: &date !!timestamp 2026-01-01\nsecond: *date\n---');assert.equal(parsed.frontmatter.first,parsed.frontmatter.second);
});
test('kind error predicate is structurally compatible and retains expected/found kinds',()=>{
 const error=new own.FrontmatterKindError('Wrong',{expected:'task',found:'skill'});
 assert.ok(error instanceof own.FrontmatterParseError);assert.ok(own.isFrontmatterKindError(error));assert.ok(sdk.isFrontmatterKindError(error));
 assert.equal(error.expectedKind,'task');assert.equal(error.foundKind,'skill');assert.equal(own.isFrontmatterKindError({name:error.name,expectedKind:'task',foundKind:'skill'}),false);
});
test('stringifier repeats shared objects without YAML aliases',()=>{
 const shared={nested:'example'},value={a:shared,b:shared};assert.equal(own.stringifyFrontmatter(value,'Body'),sdk.stringifyFrontmatter(value,'Body'));
 const cyclic={};cyclic.self=cyclic;assert.throws(()=>own.stringifyFrontmatter(cyclic,''),{name:'FrontmatterParseError',message:'Cannot stringify cyclic frontmatter.'});
});
test('source line counters match SDK offsets and retain lexical method receivers',()=>{
 for(const source of ['Body','\uFEFF---\r\ntitle: 😀\r\n---\r\nBody\nText','---\ra: b\r---\rBody']){
  const left=own.parseFrontmatterDocument(source).lineCounter,right=sdk.parseFrontmatterDocument(source).lineCounter;
  assert.deepEqual(left.lineStarts,right.lineStarts);
  for(let offset=-2;offset<=source.length+2;offset+=0.5)assert.deepEqual(left.linePos(offset),right.linePos(offset));
  const method=left.linePos;assert.deepEqual(method.call({lineStarts:[]},0),left.linePos(0));
  assert.equal(left.addNewLine(source.length+5),right.addNewLine(source.length+5));
  assert.deepEqual(left.linePos(source.length+7),right.linePos(source.length+7));
 }
});
test('options are never read for absent or incomplete fences and getter failures retain identity',()=>{
 const failure=new Error('unique keys'),options={get uniqueKeys(){throw failure;}};
 assert.deepEqual(own.parseFrontmatter('Body',options),{frontmatter:{},body:'Body'});
 assert.equal(own.parseFrontmatterDocument('Body',options).body,'Body');
 assert.throws(()=>own.parseFrontmatter('---\ntitle: hello',options),/Missing YAML/);
 assert.equal(own.parseFrontmatterDocument('---\ntitle: hello',options).errors.length,1);
 for(const fn of [own.parseFrontmatter,own.parseFrontmatterDocument])assert.throws(()=>fn('---\ntitle: hello\n---',options),error=>error===failure);
});
test('acyclic traversal preserves getter ordering and closes custom iterators on cycle failures',()=>{
 const invoke=fn=>{const log=[],inner={get value(){log.push('inner');return 'example';}},root={get first(){log.push('first');return inner;},get second(){log.push('second');return inner;}};
  return {output:fn(root,'Body'),log};};
 assert.deepEqual(invoke(own.stringifyFrontmatter),invoke(sdk.stringifyFrontmatter));
 const array=[],cyclic={array};let closed=0;array[Symbol.iterator]=function*(){try{yield cyclic;}finally{closed++;}};
 assert.throws(()=>own.stringifyFrontmatter(cyclic,''),/cyclic frontmatter/);assert.equal(closed,1);
});
test('parallel small-stack workers parse and stringify bounded deep documents',async()=>{
 const entry=new URL('../dist/index.js',import.meta.url).href;
 const source=`const {parentPort,workerData}=require('node:worker_threads');(async()=>{
 const api=await import(workerData.entry);
 const value={};let node=value;for(let i=0;i<400;i++){node.next={};node=node.next;}node.value='deep';
 const rendered=api.stringifyFrontmatter(value,'Body');const parsed=api.parseFrontmatter(rendered);let result=parsed.frontmatter;for(let i=0;i<400;i++)result=result.next;if(result.value!=='deep')throw Error('Deep mismatch');
 for(let i=0;i<1024;i++){const document=api.stringifyFrontmatter({title:'example',items:['a','b'],prompt:'Line one\\nLine two\\n'},'Body');if(api.parseFrontmatter(document).body!=='Body')throw Error('Body mismatch');}
 try{api.parseFrontmatter('---\\nvalue: '+ '{a:'.repeat(513)+'null'+'}'.repeat(513)+'\\n---');throw Error('Expected depth failure');}catch(error){if(!(error instanceof api.FrontmatterParseError))throw error;}
 parentPort.postMessage('done');})().catch(error=>{throw error;});`;
 await Promise.all([0,1].map(()=>new Promise((resolve,reject)=>{const worker=new Worker(source,{eval:true,workerData:{entry},resourceLimits:{stackSizeMb:4}});let done=false;worker.on('message',message=>{assert.equal(message,'done');done=true;});worker.on('error',reject);worker.on('exit',code=>code===0&&done?resolve():reject(new Error('Worker failed '+code)));})));
});
