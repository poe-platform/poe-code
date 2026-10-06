import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {createPythonBuildBackend} from './build-backend.js';
import {createPythonBuildEnvironment} from './build-environment.js';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';

const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('download filenames match pinned pip header parsing, MIME preference and redirect fallback',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},async()=>{
 let pythonBuildBackendProgram='';
 const environment=createPythonBuildEnvironment();
 try{
  await createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){
   pythonBuildBackendProgram=start.invocation.args[1]!;
   const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
   await send({op:'text',text:'"download"'});await send({op:'done'});return 0;
  }})})({hook:'read_download_filename',source:'https://example.test/download',responseUrl:'https://example.test/download',headers:[]},{fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,maxBytes:4096,stdout:{async write(){}},stderr:{async write(){}}});
 }finally{await environment.dispose();}
 const result=spawnSync(python,['-B','-c',String.raw`
import json,sys,types,mimetypes
from pip._internal.models.link import Link
from pip._internal.network.download import _get_http_response_filename
from pip._vendor.requests import Response
from pip._vendor.requests.structures import CaseInsensitiveDict
program=json.load(sys.stdin)
headers=[[],[('Content-Disposition','attachment; filename="project.tar.gz"')],[('content-disposition','attachment; filename="../../project.zip"')],[('content-disposition','attachment; filename="a;b.zip"')],[('content-disposition','attachment; filename="界.zip"')],[('content-disposition','attachment; filename=""')],[('content-disposition','attachment; filename="a\\"b.zip"')],[('content-disposition','attachment; filename="first.zip"; FILENAME="last.tar.gz"')],[('content-disposition',"attachment; filename*=UTF-8''project.zip")],[('content-disposition','attachment; filename="folder/"')],[('content-type','application/zip')],[('content-type','application/gzip')],[('content-type','application/x-gzip')],[('content-type','application/x-tar')],[('content-type','application/octet-stream')],[('content-type','APPLICATION/ZIP')],[('content-type','application/zip; charset=utf-8')]]
for source in ['https://example.test/download','https://example.test/project.tar.gz','https://example.test/%E7%95%8C','https://example.test/folder/']:
 for values in headers:
  for redirected in [source,'https://cdn.example.test/project.tar.gz','https://cdn.example.test/project.zip?key=value']:
   response=Response();response.url=redirected;response.headers=CaseInsensitiveDict(values)
   expected=_get_http_response_filename(response,Link(source))
   request=dict(hook='read_download_filename',source=source,responseUrl=redirected,headers=values)
   messages=[]
   def call(capability,message):
    assert capability=='python_build'
    if message['op']=='request':return request
    messages.append(message)
   sys.modules['safe_host']=types.SimpleNamespace(call=call)
   namespace={}
   exec(program,namespace)
   assert messages and messages[-1]==dict(op='done'),(request,messages)
   actual=json.loads(''.join(message['text'] for message in messages[:-1]))
   assert actual==expected,(request,actual,expected)
mimetypes.init()
assert namespace['MIME_PREFERENCES']=={key:mimetypes.guess_extension(key) for key in set(mimetypes.types_map.values())}
`],{input:JSON.stringify(pythonBuildBackendProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
