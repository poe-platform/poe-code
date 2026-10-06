import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {collectBytes,toByteSource} from 'safe-bash-contracts';
import {encodeEntry,type Entry} from 'safe-bash-command-tar/format';
import {compressed} from 'safe-bash-command-tar/stream';
import {DEFAULT_ARCHIVE_LIMITS} from 'safe-bash-io-engine/commands/archive/internal';
import {extractPythonSourceArchive} from './source-archive.js';

const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
async function fixture(entries:Partial<Entry>[],format?:'gzip'|'bzip2'|'xz'){
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 await fs.mkdir('/build/source',{recursive:true});
 const chunks:Uint8Array[]=[];
 for(const [index,value] of entries.entries()){
  const bytes=new TextEncoder().encode('payload-'+index);
  const entry:Entry={name:'project/file',type:'0',linkname:'',size:bytes.length,mode:0o644,mtime:1000+index,uid:0,gid:0,...value};
  if(entry.type!=='0')entry.size=0;
  chunks.push(...encodeEntry(entry,DEFAULT_ARCHIVE_LIMITS));
  if(entry.size)chunks.push(bytes,new Uint8Array((512-entry.size%512)%512));
 }
 chunks.push(new Uint8Array(1024));
 const sourceBytes=(async function*(){yield* chunks;})();
 const bytes=await collectBytes(format?compressed(sourceBytes,false,signal,DEFAULT_ARCHIVE_LIMITS,format):sourceBytes,{signal});
 const source='/input.tar'+(format==='gzip'?'.gz':format==='bzip2'?'.bz2':format==='xz'?'.xz':'');await fs.writeFile(source,bytes);
 const confined=await fs.confineExtraction(['/build']);
 const proxy=new Proxy(confined,{get(target,key){
  if(key==='readFile')return ()=>{throw new Error('Buffered source read');};
  const owner=['openReadFile','confineExtraction'].includes(String(key))?fs:target,value=Reflect.get(owner,key);return typeof value==='function'?value.bind(owner):value;
 }});
 const context={fs:proxy,cwd:'/',env:{},signal,command:'python',args:[],stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}};
 return {fs,source,bytes,context};
}
for(const format of [undefined,'gzip','bzip2','xz'] as const)test('source tar layout, links, modes and timestamps match pinned pip; '+format,{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},async()=>{
 const {fs,source,bytes,context}=await fixture([{name:'project/',type:'5'},{name:'project/module.py',mode:0o755},{name:'project/copy.py',type:'1',linkname:'project/module.py'},{name:'project/link.py',type:'2',linkname:'module.py'}],format);
 const reference=spawnSync(python,['-B','-c',String.raw`
import base64,io,json,sys
from unittest.mock import patch
from pip._internal.utils.unpacking import untar_file
archive=base64.b64decode(sys.stdin.read());files={};links={}
class Output(io.BytesIO):
 def __init__(self,path):super().__init__();self.path=path
 def close(self):
  if not self.closed:files[self.path]=[self.getvalue().decode(),files.get(self.path,[None,420])[1],None]
  super().close()
def opened(path,mode='r',*args,**kwargs):return io.BytesIO(archive) if path==sys.argv[1] else Output(path)
with patch('builtins.open',side_effect=opened),patch('bz2._builtin_open',side_effect=opened),patch('tarfile.bltn_open',side_effect=opened),patch('pip._internal.utils.unpacking.ensure_dir'),patch('tarfile.TarFile.utime',side_effect=lambda info,path:files[path].__setitem__(2,info.mtime*1000)),patch('tarfile.TarFile._extract_member',side_effect=lambda info,path:links.__setitem__(path,info.linkname)),patch('pip._internal.utils.unpacking.set_extracted_file_to_default_mode_plus_executable',side_effect=lambda path:files[path].__setitem__(1,493)):
 untar_file(sys.argv[1],'/build/source')
print(json.dumps(dict(files=files,links=links)))
`,source],{input:Buffer.from(bytes).toString('base64'),encoding:'utf8',timeout:5000});
 assert.ifError(reference.error);assert.equal(reference.status,0,reference.stderr);
 await extractPythonSourceArchive(source,'/build/source',Infinity,context);
 const actual={files:{} as Record<string,unknown>,links:{} as Record<string,string>};
 for await(const entry of fs.iterateDirectory('/build/source')){
  const path='/build/source/'+entry.name,stat=await fs.lstat(path);
  if(stat.type==='symlink')actual.links[path]=await fs.readlink(path);
  else actual.files[path]=[new TextDecoder().decode(await fs.readFile(path)),stat.mode&0o777,stat.mtimeMs];
 }
 assert.deepEqual(actual,JSON.parse(reference.stdout));
 assert.notEqual((await fs.stat('/build/source/module.py')).ino,(await fs.stat('/build/source/copy.py')).ino);
});

test('source tar rejects links outside its confined extraction root',async()=>{
 const {fs,source,context}=await fixture([{name:'project/',type:'5'},{name:'project/link',type:'2',linkname:'../../outside'}]);
 await assert.rejects(extractPythonSourceArchive(source,'/build/source',Infinity,context),/escapes/);
 await assert.rejects(fs.lstat('/build/source/link'));assert.deepEqual((await fs.readdir('/build')).map(entry=>entry.name),['source']);
});

test('later tar symlink members replace earlier links',async()=>{
 const {fs,source,context}=await fixture([{name:'project/',type:'5'},{name:'project/link',type:'2',linkname:'first'},{name:'project/link',type:'2',linkname:'second'}]);
 await extractPythonSourceArchive(source,'/build/source',Infinity,context);
 assert.equal(await fs.readlink('/build/source/link'),'second');
});

test('tar hard links resolve archive symlinks without reading extraction paths',async()=>{
 const {fs,source,context}=await fixture([{name:'project/',type:'5'},{name:'project/module.py'},{name:'project/link',type:'2',linkname:'module.py'},{name:'project/copy',type:'1',linkname:'project/link'}]);
 await extractPythonSourceArchive(source,'/build/source',Infinity,context);
 assert.equal(new TextDecoder().decode(await fs.readFile('/build/source/copy')),'payload-1');
});
