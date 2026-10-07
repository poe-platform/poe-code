import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';

test('requirement file continuations and comments match native pip preprocessing',async()=>{
 const sources=[
  'alpha\\\n==1\nbeta',
  'alpha \\\n >=1,\\\n <3 # constraint',
  '# ignored\\\nalpha==1',
  'alpha\\\n # comment\\\nbeta',
  'alpha # ignored\\\nbeta\ngamma',
  'alpha\\',
  'alpha\\\r\n==1\rbeta',
  'alpha\\\n\\==1\\\n\nbeta',
  'alpha @ https://example.test/a.whl#sha256=abc\\\n123 # comment',
  'alpha\\ \nbeta',
  'alpha\vbeta\fgamma\u0085delta\u2028epsilon\u2029zeta',
 ];
 const native=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c','import json,sys; from pip._internal.req.req_file import preprocess; print(json.dumps([[line for _,line in preprocess(source)] for source in json.load(sys.stdin)]))'],{input:JSON.stringify(sources),encoding:'utf8',timeout:5000});
 assert.ifError(native.error);assert.equal(native.status,0,native.stderr);
 const expected=JSON.parse(native.stdout) as string[][];
 for(const [index,source] of sources.entries()){
  const fs=new MemoryFileSystem();await fs.writeFile('/requirements.txt',new TextEncoder().encode(source));
  const environment=createPythonPackageEnvironment();
  try {
   const prepared=await environment.prepare({fs,cwd:'/',requirementFiles:['requirements.txt'],signal:new AbortController().signal});
   assert.deepEqual(prepared.requested,expected[index],JSON.stringify(source));
   await environment.finish(prepared);
  }finally{await environment.dispose();}
 }
});

test('requirements expand only caller environment values using native pip substitution order',async()=>{
 const env=Object.setPrototypeOf({VERSION:'1.2',NEXT:'${VERSION}',EMPTY:'',lower:'wrong',DOLLARS:'$&$$',_1:'allowed'},{INHERITED:'not-visible'});
 const sources=['alpha==${VERSION}','alpha==${MISSING}','alpha==${EMPTY}','alpha==${lower}','alpha==${_1}',
  'alpha==${NEXT}','alpha==${NEXT}-${VERSION}','alpha==${VERSION}-${NEXT}',
  'alpha==${DOLLARS}','alpha==${INHERITED}','alpha==${}','alpha==$VERSION','alpha==${BAD-NAME}','alpha==${VERSION','alpha==${VER\\\nSION} # ${NEXT}', 'alpha==${bad${VERSION}}'];
 const native=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c','import json,sys,os; from pip._internal.req.req_file import preprocess; sources,env=json.load(sys.stdin); os.environ.clear(); os.environ.update(env); print(json.dumps([[line for _,line in preprocess(source)] for source in sources]))'],{input:JSON.stringify([sources,env]),encoding:'utf8',timeout:5000});
 assert.ifError(native.error);assert.equal(native.status,0,native.stderr);
 const expected=JSON.parse(native.stdout) as string[][];
 for(const [index,source] of sources.entries()){
  const fs=new MemoryFileSystem();await fs.writeFile('/requirements.txt',new TextEncoder().encode(source));
  const environment=createPythonPackageEnvironment();
  try{
   const prepared=await environment.prepare({fs,cwd:'/',env,requirementFiles:['requirements.txt'],signal:new AbortController().signal});
   assert.deepEqual(prepared.requested,expected[index],source);await environment.finish(prepared);
   const isolated=await environment.prepare({fs,cwd:'/',requirementFiles:['requirements.txt'],signal:new AbortController().signal});
   if(source==='alpha==${VERSION}')assert.deepEqual(isolated.requested,[source]);
   await environment.finish(isolated);
  }finally{await environment.dispose();}
 }
});
