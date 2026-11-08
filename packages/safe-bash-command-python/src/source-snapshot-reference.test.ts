import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {createPythonSourceSnapshot} from './source-snapshot.js';

const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('source-copy exclusions and symlink policy match pinned pip',{
 skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false
},async()=>{
 const fs=new MemoryFileSystem();
 for(const path of ['/source/.tox','/source/.nox','/source/nested/.tox','/source/builds'])await fs.mkdir(path,{recursive:true});
 await fs.symlink('missing','/source/link');
 const snapshot=await createPythonSourceSnapshot('/source','/source/builds',{fs,cwd:'/',env:{},signal:new AbortController().signal,command:'python',args:[],stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}});
 try{
  const result=spawnSync(python,['-B','-c',String.raw`
import json, sys
from unittest.mock import patch
import pip
assert pip.__version__ == '21.2.4'
from pip._internal.operations.prepare import _copy_source_tree
target=json.load(sys.stdin)
with patch('shutil.copytree') as copy:
 _copy_source_tree('/source',target)
 options=copy.call_args.kwargs
 assert options['symlinks'] is True
 ignore=options['ignore']
 rows=[('.',['.tox','.nox','nested','builds','link']),('nested',['.tox']),('builds',[target.rsplit('/',1)[1]])]
 print(json.dumps({relative:sorted(set(names)-set(ignore('/source' if relative=='.' else '/source/'+relative,names))) for relative,names in rows}))
`],{input:JSON.stringify(snapshot.path),encoding:'utf8',timeout:5000});
  assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
  const actual:Record<string,string[]>={};
  for(const path of ['.','nested','builds'])actual[path]=(await fs.readdir(snapshot.path+'/'+path)).map(entry=>entry.name).sort();
  assert.deepEqual(actual,JSON.parse(result.stdout));
  assert.equal(await fs.readlink(snapshot.path+'/link'),'missing');
 }finally{await snapshot.dispose();}
});
