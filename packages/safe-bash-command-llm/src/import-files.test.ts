import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {withFileEmbeddingEntries} from './import-files.js';

test('file import uses the last successful decoding and Python universal newlines',async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/text',new TextEncoder().encode('café\r\nline\r'));
 for(const [encodings,expected]of [[undefined,'cafÃ©\nline\n'],[['utf-8'],'café\nline\n'],[['cp65001'],'café\nline\n'],[['ISO 8859-1'],'cafÃ©\nline\n'],[['latin-1','utf-8'],'café\nline\n'],[['utf-8','ascii'],'café\nline\n']] as const){
  const rows:unknown[]=[];
  await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,...(encodings?{encodings}:{})},{async *[Symbol.asyncIterator](){yield {path:'/text',id:'a.txt'};}},async entries=>{
   for await(const entry of entries){let text='';for await(const bytes of entry.input.bytes)text+=new TextDecoder().decode(bytes);rows.push({id:entry.id,binary:entry.binary,text});await entry.input.dispose();}
  });
  assert.deepEqual(rows,[{id:'a.txt',binary:false,text:expected}]);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['text']);
 }
});
test('file import preserves empty text in binary mode and skips undecodable text',async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/empty',new Uint8Array());await fs.writeFile('/raw',Uint8Array.of(255,0));
 const files={async *[Symbol.asyncIterator](){yield {path:'/empty',id:'empty'};yield {path:'/raw',id:'raw'};}};
 for(const binary of [true,false]){
  const rows:unknown[]=[],warnings:string[]=[];
  await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,binary,...(binary?{}:{encodings:['utf-8']}),prefix:'p:',prepend:'T:',undecodable:path=>{warnings.push(path);}},files,async entries=>{
   for await(const entry of entries){const bytes:number[]=[];for await(const chunk of entry.input.bytes)bytes.push(...chunk);rows.push([entry.id,entry.binary,bytes]);}
  });
  assert.deepEqual(rows,binary?[['p:empty',false,[84,58]],['p:raw',true,[255,0]]]:[['p:empty',false,[84,58]]]);
  assert.deepEqual(warnings,binary?[]:['/raw']);
 }
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name).sort(),['empty','raw']);
});

test('file preparation uses bounded reads and output chunks and retires escaped leases before prepend',async()=>{
 const backing=new MemoryFileSystem();await backing.writeFile('/large',new Uint8Array(1024*1024).fill(233));let peak=0,open=0;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='readFile')return ()=>{throw Error('whole file read');};
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{
   const handle=await target.openReadFile(...args);open++;let closed=false;
   return {...handle,async read(position:number,maxBytes:number,options:Parameters<typeof handle.read>[2]){peak=Math.max(peak,maxBytes);assert.ok(maxBytes<=16384);return handle.read(position,maxBytes,options);},async close(){if(!closed){closed=true;open--;}await handle.close();}};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 let saved:import('./collections-batch.js').LlmCollectionBatchEntry|undefined;
 await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings:['latin-1'],prepend:'before:'},{async *[Symbol.asyncIterator](){yield {path:'/large',id:'large'};}},async entries=>{
  for await(const entry of entries){saved=entry;let count=0;for await(const bytes of entry.input.bytes){assert.ok(bytes.length<=16384);count+=bytes.length;}assert.equal(count,2*1024*1024+7);}
 });
 assert.ok(peak>0);assert.equal(open,0);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['large']);
 await assert.rejects(saved!.input.bytes[Symbol.asyncIterator]().next(),/closed/);
});
test('early return, unknown codec, quotas and cancellation leave only original files',async()=>{
 for(const scenario of ['return','codec','quota','cancel']){
  const fs=new MemoryFileSystem();await fs.writeFile('/file',new TextEncoder().encode('hello'));
  const controller=new AbortController(),reason=new Error('cancel import');let retired=false;
  const files={async *[Symbol.asyncIterator](){try{yield {path:'/file',id:'file'};yield {path:'/file',id:'again'};}finally{retired=true;}}};
  const run=()=>withFileEmbeddingEntries({fs,directory:'/',signal:controller.signal,encodings:scenario==='codec'?['utf-8','unknown']:['utf-8'],maxInputBytes:scenario==='quota'?1:Infinity,admit(){if(scenario==='cancel')controller.abort(reason);}},files,async entries=>{await entries[Symbol.asyncIterator]().next();});
  if(scenario==='return')await run();else await assert.rejects(run(),scenario==='codec'?/unknown encoding/:scenario==='quota'?/byte limit/:error=>error===reason);
  assert.equal(retired,true);assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['file']);
 }
});

test('prepared file payloads match genuine LLM 0.27.1 capture values',async()=>{
 const {readFileSync}=await import('node:fs');
 const fixtures=JSON.parse(readFileSync(new URL('./fixtures/files-0.27.1.json',import.meta.url),'utf8')) as {args:string[];files:Record<string,string>;code:number;calls:(string|{hex:string})[][];rows:{id:string;content:string|null;blob:string}[]}[];
 for(const fixture of fixtures.filter(row=>row.code===0)){
  const fs=new MemoryFileSystem();
  for(const [path,hex]of Object.entries(fixture.files)){await fs.mkdir('/'+path.slice(0,path.lastIndexOf('/')),{recursive:true});await fs.writeFile('/'+path,Uint8Array.from(Buffer.from(hex,'hex')));}
  const pattern=fixture.args[fixture.args.indexOf('--files')+2];
  // This fixture qualifies payload preparation; traversal is a separate API.
  const paths=pattern==='*.txt'?['docs/a.txt','docs/.hidden.txt']:pattern==='**/*.txt'?['docs/a.txt','docs/.hidden.txt','docs/nested/c.txt']:pattern==='*.bin'?['docs/empty.bin','docs/raw.bin']:[];
  const encodings=fixture.args.flatMap((value,index)=>value==='--encoding'?[fixture.args[index+1]!]:[]);
  const prefix=fixture.args.includes('--prefix')?'p:':'',prepend=fixture.args.includes('--prepend')?'T:':'';
  const actual:(string|{hex:string})[]=[],rows:{id:string;content:string|null;blob:string}[]=[];
  await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings,binary:fixture.args.includes('--binary'),prefix,prepend},{async *[Symbol.asyncIterator](){for(const path of paths)yield {path:'/'+path,id:path.slice(5)};}},async entries=>{
   for await(const entry of entries){const chunks=[];for await(const bytes of entry.input.bytes)chunks.push(bytes);const payload=Buffer.concat(chunks),text=payload.toString('utf8');actual.push(entry.binary?{hex:payload.toString('hex')}:text);rows.push({id:entry.id,content:entry.binary?null:text,blob:entry.binary?payload.toString('hex').toUpperCase():''});}
  });
  assert.deepEqual(actual,fixture.calls.flat());assert.deepEqual(rows.sort((a,b)=>a.id<b.id?-1:1),fixture.rows);
 }
});

test('filesystem failures are never classified as undecodable text',async()=>{
 const backing=new MemoryFileSystem();await backing.writeFile('/file',new TextEncoder().encode('hello'));
 const reason=new Error('retained read failed');let warned=false;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{const reader=await target.openReadFile(...args);return {...reader,async read(){throw reason;}};};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 await assert.rejects(withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,undecodable(){warned=true;}},{async *[Symbol.asyncIterator](){yield {path:'/file',id:'file'};}},async entries=>{for await(const ignored of entries)assert.fail('unexpected entry');}),error=>error===reason);
 assert.equal(warned,false);assert.deepEqual((await backing.readdir('/')).map(entry=>entry.name),['file']);
});
test('UTF8-sig incomplete signatures import as empty text instead of being skipped',async()=>{
 const fs=new MemoryFileSystem();
 for(const bytes of [Uint8Array.of(0xef),Uint8Array.of(0xef,0xbb)]){
  await fs.writeFile('/prefix',bytes);let count=0;
  await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings:['utf-8-sig'],undecodable(){assert.fail('Python accepts an incomplete initial signature');}},{async *[Symbol.asyncIterator](){yield {path:'/prefix',id:'prefix'};}},async entries=>{
   for await(const entry of entries){count++;let text='';for await(const chunk of entry.input.bytes)text+=new TextDecoder().decode(chunk);assert.equal(text,'');}
  });
  assert.equal(count,1);assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['prefix']);
 }
});

test('single-byte file codecs preserve Python characters, strict errors and staging cleanup',async()=>{
 const fs=new MemoryFileSystem();
 for(const [encoding,byte,expected]of [['windows-1252',0x80,'€'],['mac-roman',0x80,'Ä'],['cp437',0x80,'Ç'],['cp1251',0xc0,'А'],['cp1252',0x81,null]] as const){
  await fs.writeFile('/legacy',Uint8Array.of(byte));const values:string[]=[],warnings:string[]=[];
  await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings:[encoding],undecodable(path){warnings.push(path);}},{async *[Symbol.asyncIterator](){yield {path:'/legacy',id:'legacy'};}},async entries=>{
   for await(const entry of entries){let text='';for await(const bytes of entry.input.bytes)text+=new TextDecoder().decode(bytes);values.push(text);}
  });
  assert.deepEqual(values,expected===null?[]:[expected]);assert.deepEqual(warnings,expected===null?['/legacy']:[]);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['legacy']);
 }
});

test('UTF16 files preserve split surrogate pairs and distinguish missing BOM from malformed input',async()=>{
 const fs=new MemoryFileSystem();const valid=new Uint8Array(4098);valid.set([255,254]);
 for(let offset=2;offset<4094;offset+=2)valid[offset]=65;
 valid.set([0,216,0,220],4094);
 for(const [bytes,expected,warned]of [[valid,'A'.repeat(2046)+'𐀀',false],[Uint8Array.of(255),null,true],[Uint8Array.of(65,0),null,false]] as const){
  await fs.writeFile('/utf16',bytes);const values:string[]=[],warnings:string[]=[];
  const run=()=>withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings:['utf-16'],undecodable(path){warnings.push(path);}},{async *[Symbol.asyncIterator](){yield {path:'/utf16',id:'utf16'};}},async entries=>{
   for await(const entry of entries){let text='';for await(const chunk of entry.input.bytes)text+=new TextDecoder().decode(chunk);values.push(text);}
  });
  if(expected===null&&!warned)await assert.rejects(run(),/UTF-16 stream does not start with BOM/);else await run();
  assert.deepEqual(values,expected===null?[]:[expected]);assert.deepEqual(warnings,warned?['/utf16']:[]);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['utf16']);
 }
});

test('UTF32 file imports preserve universal newlines, strict errors and caller storage cleanup',async()=>{
 const fs=new MemoryFileSystem(),valid=new Uint8Array(4104),view=new DataView(valid.buffer);view.setUint32(0,0xfeff,true);
 for(let offset=4;offset<4092;offset+=4)view.setUint32(offset,65,true);
 view.setUint32(4092,13,true);view.setUint32(4096,10,true);view.setUint32(4100,0x10000,true);
 for(const [encoding,bytes,expected,warned]of [['utf32',valid,'A'.repeat(1022)+'\n𐀀',false],['utf-32',Uint8Array.of(255),null,true],['utf-32',Uint8Array.of(65,0,0,0),null,false],['utf-32-be',Uint8Array.of(0,0,254,255,0,0,0,65),'\ufeffA',false]] as const){
  await fs.writeFile('/utf32',bytes);const values:string[]=[],warnings:string[]=[];
  const run=()=>withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings:[encoding],undecodable(path){warnings.push(path);}},{async *[Symbol.asyncIterator](){yield {path:'/utf32',id:'utf32'};}},async entries=>{
   for await(const entry of entries){let text='';const decoder=new TextDecoder('utf-8',{ignoreBOM:true});for await(const chunk of entry.input.bytes)text+=decoder.decode(chunk,{stream:true});text+=decoder.decode();values.push(text);}
  });
  if(expected===null&&!warned)await assert.rejects(run(),/UTF-32 stream does not start with BOM/);else await run();
  assert.deepEqual(values,expected===null?[]:[expected]);assert.deepEqual(warnings,warned?['/utf32']:[]);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['utf32']);
 }
});

test('EBCDIC file decoding translates low-byte controls before universal newline handling',async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/ebcdic',Uint8Array.of(0xc1,0x0d,0x25,0xc2,0x15));
 const values:string[]=[];
 await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings:['ibm037']},{async *[Symbol.asyncIterator](){yield {path:'/ebcdic',id:'one'};}},async entries=>{
  for await(const entry of entries){let text='';for await(const bytes of entry.input.bytes)text+=new TextDecoder().decode(bytes);values.push(text);}
 });
 assert.deepEqual(values,['A\nB\u0085']);assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['ebcdic']);
});

test('multibyte file imports cross read boundaries and clean up rejected input',async()=>{
 const fs=new MemoryFileSystem();
 for(const suffix of [[0xa4,0xd4,0xa4,0xa1,0xa4,0xbf,0xa4,0xa1,13,10],[0xa4,0xd4,0]]){
  const bytes=new Uint8Array(4095+suffix.length);bytes.fill(65,0,4095);bytes.set(suffix,4095);
  await fs.writeFile('/korean',bytes);const values:string[]=[],warnings:string[]=[];
  await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings:['euc_kr'],undecodable(path){warnings.push(path);}},{async *[Symbol.asyncIterator](){yield {path:'/korean',id:'one'};}},async entries=>{
   for await(const entry of entries){let text='';const decoder=new TextDecoder();for await(const bytes of entry.input.bytes)text+=decoder.decode(bytes,{stream:true});values.push(text+decoder.decode());}
  });
  assert.deepEqual(values,suffix.length===10?['A'.repeat(4095)+'각\n']:[]);
  assert.deepEqual(warnings,suffix.length===10?[]:['/korean']);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['korean']);
 }
});

test('GB18030 file imports preserve split supplementary characters and reject incomplete files',async()=>{
 const fs=new MemoryFileSystem();
 for(const suffix of [[0x90,0x30,0x81,0x30,0xa8,0xbc,13,10],[0x90,0x30,0x81]]){
  const bytes=new Uint8Array(4095+suffix.length);bytes.fill(65,0,4095);bytes.set(suffix,4095);
  await fs.writeFile('/chinese',bytes);const values:string[]=[],warnings:string[]=[];
  await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings:['gb18030'],undecodable(path){warnings.push(path);}},{async *[Symbol.asyncIterator](){yield {path:'/chinese',id:'one'};}},async entries=>{
   for await(const entry of entries){let text='';const decoder=new TextDecoder();for await(const bytes of entry.input.bytes)text+=decoder.decode(bytes,{stream:true});values.push(text+decoder.decode());}
  });
  assert.deepEqual(values,suffix.length===8?['A'.repeat(4095)+'\u{10000}\ue7c7\n']:[]);
  assert.deepEqual(warnings,suffix.length===8?[]:['/chinese']);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['chinese']);
 }
});

test('HZ file imports retain shift state across reads and clean rejected staging',async()=>{
 const fs=new MemoryFileSystem();
 for(const encoding of ['hz','hz-gb','hz-gb-2312','hzgb'])for(const suffix of ['~{VP~}\r\n','~{VP~']){
  const input='A'.repeat(4095)+suffix;
  await fs.writeFile('/hz',new TextEncoder().encode(input));const values:string[]=[],warnings:string[]=[];
  await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings:[encoding],undecodable(path){warnings.push(path);}},{async *[Symbol.asyncIterator](){yield {path:'/hz',id:'one'};}},async entries=>{
   for await(const entry of entries){let text='';const decoder=new TextDecoder();for await(const bytes of entry.input.bytes)text+=decoder.decode(bytes,{stream:true});values.push(text+decoder.decode());}
  });
  const valid=suffix.endsWith('\n');
  assert.deepEqual(values,valid?['A'.repeat(4095)+'中\n']:[]);
  assert.deepEqual(warnings,valid?[]:['/hz']);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['hz']);
 }
});

test('ISO-2022 imports preserve native shift state across reads and retire invalid input',async()=>{
 const {default:fixtures}=await import('./fixtures/iso2022-files-python39.json',{with:{type:'json'}});
 const fs=new MemoryFileSystem();
 for(const fixture of fixtures)for(const invalid of [false,true]){
  const suffix=Uint8Array.from(Buffer.from(fixture.hex,'hex')),bytes=new Uint8Array(4095+suffix.length+Number(invalid));
  bytes.fill(65,0,4095);bytes.set(suffix,4095);if(invalid)bytes[bytes.length-1]=27;
  await fs.writeFile('/iso2022',bytes);const values:string[]=[],warnings:string[]=[];
  await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings:[fixture.encoding],undecodable(path){warnings.push(path);}},{async *[Symbol.asyncIterator](){yield {path:'/iso2022',id:'one'};}},async entries=>{
   for await(const entry of entries){let text='';const decoder=new TextDecoder();for await(const bytes of entry.input.bytes)text+=decoder.decode(bytes,{stream:true});values.push(text+decoder.decode());}
  });
  assert.deepEqual(values,invalid?[]:['A'.repeat(4095)+fixture.text]);
  assert.deepEqual(warnings,invalid?['/iso2022']:[]);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['iso2022']);
 }
});

test('ISO-2022 whole-file malformed escapes remain skippable at chunk boundaries',async()=>{
 const fs=new MemoryFileSystem();
 await fs.writeFile('/invalid',new TextEncoder().encode('A'.repeat(4087)+'\x1b$'+' '.repeat(7)+'B'));
 const warnings:string[]=[];
 await withFileEmbeddingEntries({fs,directory:'/',signal:new AbortController().signal,encodings:['iso2022_jp'],undecodable(path){warnings.push(path);}},{async *[Symbol.asyncIterator](){yield {path:'/invalid',id:'one'};}},async entries=>{
  for await(const _entry of entries)assert.fail('Native whole-file decoding rejects the escape');
 });
 assert.deepEqual(warnings,['/invalid']);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['invalid']);
});
