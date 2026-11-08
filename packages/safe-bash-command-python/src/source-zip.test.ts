import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {makeZipEntry,writeZipArchive} from 'safe-bash-zip-engine';
import {DEFAULT_ARCHIVE_LIMITS} from 'safe-bash-io-engine/commands/archive/internal';
import {extractPythonSourceZip} from './source-zip.js';
import {extractPythonSourceArchive} from './source-archive.js';

const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
async function fixture(names:string[],size?:number){
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 await fs.mkdir('/build/source',{recursive:true});
 const entries=await Promise.all(names.map((name,i)=>makeZipEntry(name,size===undefined?new TextEncoder().encode(name.endsWith('/')?'':'payload-'+i):new Uint8Array(size),{modified:new Date(0),mode:i%2?0o755:0o644,directory:name.endsWith('/'),symlink:false},DEFAULT_ARCHIVE_LIMITS,signal)));
 const bytes=await writeZipArchive({entries,comment:new Uint8Array()},DEFAULT_ARCHIVE_LIMITS,signal);
 await fs.writeFile('/input.zip',bytes);
 const confined=await fs.confineExtraction(['/build']);
 const proxy=new Proxy(confined,{get(target,key){
  if(key==='readFile')return ()=>{throw new Error('Buffered read');};
  const owner=key==='openReadFile'||key==='confineExtraction'?fs:target,value=Reflect.get(owner,key);
  return typeof value==='function'?value.bind(owner):value;
 }});
 const context={fs:proxy,cwd:'/',env:{},signal,command:'python',args:[],stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}};
 return {fs,bytes,context};
}
for(const name of ['/download','/misleading.tar.gz'])for(const trailing of [0,65536,65537])test(`source archive detection matches pinned pip; name=${name}; trailing=${trailing}`,{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},async()=>{
 const {fs,bytes,context}=await fixture(['project/','project/setup.py']);
 const archive=new Uint8Array(bytes.length+trailing);archive.set(bytes);
 const native=spawnSync(python,['-B','-c',String.raw`
import base64,io,json,sys
from unittest.mock import patch
from pip._internal.utils.unpacking import unpack_file
archive=base64.b64decode(sys.stdin.read())+bytes(int(sys.argv[2]));selected=[]
with patch('builtins.open',side_effect=lambda *args,**kwargs:io.BytesIO(archive)),patch('pip._internal.utils.unpacking.unzip_file',side_effect=lambda *args,**kwargs:selected.append('zip')),patch('pip._internal.utils.unpacking.untar_file',side_effect=lambda *args,**kwargs:selected.append('tar')):
 try: unpack_file(sys.argv[1],'/target')
 except Exception: selected.append('error')
print(json.dumps(selected))
`,name,String(trailing)],{input:Buffer.from(bytes).toString('base64'),encoding:'utf8',timeout:5000});
 assert.ifError(native.error);assert.equal(native.status,0,native.stderr);
 const zip=JSON.parse(native.stdout)[0]==='zip';assert.equal(zip,trailing<=65536);
 await fs.writeFile(name,archive);
 let opened=0,closed=0;
 const retained=new Proxy(context.fs,{get(target,key){if(key==='openReadFile')return async(...args:Parameters<NonNullable<typeof target.openReadFile>>)=>{
  const file=await target.openReadFile!(...args);if(args[0]!==name)return file;opened++;
  return new Proxy(file,{get(handle,operation){if(operation==='read')return (offset:number,length:number,options:any)=>handle.read(offset,Math.min(length,4096),options);if(operation==='close')return async()=>{closed++;await handle.close();};const value=Reflect.get(handle,operation);return typeof value==='function'?value.bind(handle):value;}});
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const extraction=extractPythonSourceArchive(name,'/build/source',Infinity,{...context,fs:retained});
 if(zip){await extraction;assert.equal(new TextDecoder().decode(await fs.readFile('/build/source/setup.py')),'payload-1');}
 else await assert.rejects(extraction);
 assert.equal(opened,1);assert.equal(closed,1);
});
for(const names of [['project/','project/setup.py','project/mod.py'],['setup.py','module.py'],['a/input','b/input'],['project/duplicate','project/duplicate'],['project/duplicate','project/duplicate','project/duplicate']])test('source ZIP extraction matches pinned pip paths, bytes and executable modes '+names.join(','),{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},async()=>{
 const {fs,bytes,context}=await fixture(names);
 const reference=spawnSync(python,['-B','-c',String.raw`
import base64,io,json,sys
from unittest.mock import patch
from pip._internal.utils.unpacking import unzip_file
archive=base64.b64decode(sys.stdin.read())
files={}
class Output(io.BytesIO):
 def __init__(self,path):super().__init__();self.path=path
 def close(self):
  files[self.path]=[self.getvalue().decode(),files.get(self.path,[None,420])[1]]
  super().close()
def opened(path,mode):return io.BytesIO(archive) if path=='/input.zip' else Output(path)
with patch('builtins.open',side_effect=opened),patch('pip._internal.utils.unpacking.ensure_dir'),patch('pip._internal.utils.unpacking.set_extracted_file_to_default_mode_plus_executable',side_effect=lambda path:files[path].__setitem__(1,493)):
 unzip_file('/input.zip','/build/source')
print(json.dumps(files))
`],{input:Buffer.from(bytes).toString('base64'),encoding:'utf8',timeout:5000});
 assert.ifError(reference.error);assert.equal(reference.status,0,reference.stderr);
 await extractPythonSourceZip('/input.zip','/build/source',Infinity,context);
 const actual:Record<string,unknown>={};
 async function walk(path:string):Promise<void>{for await(const entry of fs.iterateDirectory(path)){const child=path+'/'+entry.name,stat=await fs.stat(child);if(stat.type==='directory')await walk(child);else actual[child]=[new TextDecoder().decode(await fs.readFile(child)),stat.mode&0o777];}}
 await walk('/build/source');
 assert.deepEqual(actual,JSON.parse(reference.stdout));
 assert.deepEqual((await fs.readdir('/build')).map(entry=>entry.name),['source']);
});

test('source ZIP rejects traversal and retires metadata without writing outside its build root',async()=>{
 const {fs,context}=await fixture(['project/setup.py','project/aa/bb/escape']);
 const bytes=await fs.readFile('/input.zip');
 const from=new TextEncoder().encode('project/aa/bb/escape'),to=new TextEncoder().encode('project/../../escape');
 for(let i=0;i<=bytes.length-from.length;i++)if(from.every((value,j)=>bytes[i+j]===value))bytes.set(to,i);
 await fs.writeFile('/input.zip',bytes);
 await assert.rejects(extractPythonSourceZip('/input.zip','/build/source',Infinity,context),/escapes|unsafe/);
 await assert.rejects(fs.stat('/escape'));
 assert.deepEqual((await fs.readdir('/build')).map(entry=>entry.name),['source']);
});


test('large ZIP source members stream into caller storage without buffered reads',async()=>{
 const {fs,context}=await fixture(['project/module.py'],200000);
 let chunks=0,largest=0;
 const observed=new Proxy(context.fs,{get(target,key){
  if(key==='writeStream')return async(path:string,source:AsyncIterable<Uint8Array>,options:any)=>target.writeStream!(path,(async function*(){for await(const bytes of source){chunks++;largest=Math.max(largest,bytes.length);yield bytes;}})(),options);
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 await extractPythonSourceZip('/input.zip','/build/source',Infinity,{...context,fs:observed});
 assert.equal((await fs.stat('/build/source/module.py')).size,200000);
 assert.ok(chunks>1);assert.ok(largest<=65536);
});

test('invalid ZIP input retains its original failure when closing the retained input also fails',async()=>{
 const {fs,context}=await fixture(['project/module.py']);await fs.writeFile('/input.zip',Uint8Array.of(1,2,3));
 const retirement=new Error('retained close failed');
 const observed=new Proxy(context.fs,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<NonNullable<typeof target.openReadFile>>)=>{
   const handle=await target.openReadFile!(...args);
   if(args[0]!=='/input.zip')return handle;
   return {...handle,async close(){await handle.close();throw retirement;}};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 await assert.rejects(extractPythonSourceZip('/input.zip','/build/source',Infinity,{...context,fs:observed}),error=>error instanceof AggregateError&&error.errors.length===2&&error.errors[1]===retirement);
});

for(const filename of ['payload.whl','payload.WHL','payload.zip'])test('download filename controls native ZIP flattening: '+filename,async()=>{
 const {fs,context}=await fixture(['project/','project/setup.py']);
 await extractPythonSourceArchive('/input.zip','/build/source',Infinity,context,{filename});
 assert.equal(new TextDecoder().decode(await fs.readFile('/build/source/'+(filename.endsWith('.whl')?'project/':'')+'setup.py')),'payload-1');
});
