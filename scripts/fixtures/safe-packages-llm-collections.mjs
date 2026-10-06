import { S3FileSystem, MockS3Client } from "@poe-platform/safe-fs/fs/s3";
import { MemoryFileSystem, createMountFileSystem, createOverlayFileSystem } from "@poe-platform/safe-fs/core";
import { withLlmCollections, createLlmCollectionCommands, withCsvEmbeddingEntries, withJsonEmbeddingEntries, withJsonLinesEmbeddingEntries, withFileEmbeddingEntries, withEmbeddingFileGlob } from "@poe-platform/safe-bash/commands/llm/collections";
import { createLlmService, llmCommands } from "@poe-platform/safe-bash/commands/llm";
import { legacyCollectionDatabases, jsonImportEncodingInputs, jsonImportRejectedInputs, singleByteFileInputs, multibyteFileInputs, iso2022FileInputs } from "./safe-packages-llm-collections-reference.mjs";
import { Shell } from "@poe-platform/safe-bash/shell";
import { sqlite3Commands } from "@poe-platform/safe-bash/commands/sqlite3";

export async function verifyLlmCollections() {
  const invalidFs=new MemoryFileSystem();let invalidCalls=0,invalidRejected=false;
  const invalidService=createLlmService({providers:[{name:'test',models:[{id:'embed',capabilities:['embed']}],async *complete(){},async embedSources(request){invalidCalls++;return {model:'embed',vectors:request.inputs.map(()=>[1])};}}]});
  try{
    await withLlmCollections({fs:invalidFs,path:'/invalid.db',signal:new AbortController().signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)},async catalog=>{
      await catalog.collection('docs',{model:'embed'});
      await catalog.embedMany('docs',{service:invalidService,directory:'/',maxInputBytes:1024,entries:{async *[Symbol.asyncIterator](){yield {id:'\ud800',input:{bytes:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('hello');}},async dispose(){}}};}}});
    });
  }catch(error){if(!(error instanceof TypeError)||!error.message.includes('surrogates not allowed'))throw error;invalidRejected=true;}
  if(!invalidRejected||invalidCalls!==1||(await invalidFs.readdir('/')).length)throw new Error('Invalid Unicode ID timing or rollback changed');
  const rawPair=Uint8Array.of(0xed,0xa0,0x80,0xed,0xb0,0x80);
  const rawInput=Uint8Array.from([...new TextEncoder().encode('{"id":"'),...rawPair,...new TextEncoder().encode('","body":"hello"}')]);
  invalidRejected=false;invalidCalls=0;
  try{
    const settings={fs:invalidFs,directory:'/',path:'/invalid.db',signal:new AbortController().signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)};
    await withJsonEmbeddingEntries(settings,{async *[Symbol.asyncIterator](){for(const byte of rawInput)yield Uint8Array.of(byte);}},entries=>withLlmCollections(settings,async catalog=>{
      await catalog.collection('docs',{model:'embed'});
      await catalog.embedMany('docs',{service:invalidService,directory:'/',maxInputBytes:1024,entries});
    }));
  }catch(error){if(!(error instanceof TypeError)||!error.message.includes('surrogates not allowed'))throw error;invalidRejected=true;}
  if(!invalidRejected||invalidCalls!==1||(await invalidFs.readdir('/')).length)throw new Error('Raw surrogate ID timing or rollback changed');
  const mountRoot=new MemoryFileSystem(),mountLeaf=new MemoryFileSystem();
  await mountRoot.mkdir('/scratch');await mountRoot.writeFile('/visible.txt',new TextEncoder().encode('root'));
  await mountLeaf.writeFile('/leaf.txt',new TextEncoder().encode('mounted'));
  const mounted=createMountFileSystem({root:mountRoot,mounts:{'/synthetic/deep':mountLeaf}});
  mountRoot.readdir=mountLeaf.readdir=async()=>{throw new Error('Mounted glob used eager listing');};
  const mountOptions={fs:mounted,directory:'/scratch',signal:new AbortController().signal,maxFileBytes:1048576,maxOpenFiles:8};
  const mountRows=[];
  await withEmbeddingFileGlob(mountOptions,{directory:'/',pattern:'**/*.txt'},files=>withFileEmbeddingEntries({...mountOptions,encodings:['utf8']},files,async entries=>{
    for await(const entry of entries){let text='';for await(const chunk of entry.input.bytes)text+=new TextDecoder().decode(chunk);mountRows.push([entry.id,text]);}
  }));
  mountRows.sort((a,b)=>a[0].localeCompare(b[0]));
  if(JSON.stringify(mountRows)!==JSON.stringify([['synthetic/deep/leaf.txt','mounted'],['visible.txt','root']]))throw new Error('Installed mounted file traversal changed');
  for await(const entry of mountRoot.iterateDirectory('/scratch'))throw new Error('Mounted traversal leaked scratch storage: '+entry.name);
  const overlayUpper=new MemoryFileSystem(),overlayLower=new MemoryFileSystem(),overlayRoot=new MemoryFileSystem();
  for(const [backing,path,text]of [[overlayUpper,'/shared.txt','upper'],[overlayLower,'/shared.txt','hidden'],[overlayLower,'/lower.txt','lower'],[overlayLower,'/removed.txt','removed']])await backing.writeFile(path,new TextEncoder().encode(text));
  const overlay=createOverlayFileSystem({upper:overlayUpper,lower:overlayLower});
  await overlay.rm('/removed.txt');await overlayRoot.mkdir('/scratch');
  overlayUpper.readdir=overlayLower.readdir=async()=>{throw new Error('Overlay glob used eager listing');};
  const overlayFs=createMountFileSystem({root:overlayRoot,mounts:{'/union':overlay}});
  const overlayOptions={fs:overlayFs,directory:'/scratch',signal:new AbortController().signal,maxFileBytes:1048576,maxOpenFiles:8};
  const overlayRows=[];
  await withEmbeddingFileGlob(overlayOptions,{directory:'/union',pattern:'*.txt'},files=>withFileEmbeddingEntries({...overlayOptions,encodings:['utf8']},files,async entries=>{
    for await(const entry of entries){let text='';for await(const chunk of entry.input.bytes)text+=new TextDecoder().decode(chunk);overlayRows.push([entry.id,text]);}
  }));
  overlayRows.sort((a,b)=>a[0].localeCompare(b[0]));
  if(JSON.stringify(overlayRows)!==JSON.stringify([['lower.txt','lower'],['shared.txt','upper']]))throw new Error('Installed overlay file traversal changed');
  for await(const entry of overlayRoot.iterateDirectory('/scratch'))throw new Error('Overlay traversal leaked scratch storage: '+entry.name);
  const s3Root=new MemoryFileSystem(),s3Transport=new MockS3Client({buckets:['files'],pageSize:1});
  await s3Root.mkdir('/scratch');
  for(const key of ['first.txt','nested/second.txt'])await s3Transport.putObject({Bucket:'files',Key:key,Body:new TextEncoder().encode(key)});
  const s3Source=new S3FileSystem({transport:s3Transport,bucket:'files',pageSize:1});
  s3Source.readdir=async()=>{throw new Error('S3 glob used eager listing');};
  const s3Mount=createMountFileSystem({root:s3Root,mounts:{'/remote':s3Source}}),s3Names=[];
  await withEmbeddingFileGlob({fs:s3Mount,directory:'/scratch',signal:new AbortController().signal,maxFileBytes:1048576,maxOpenFiles:8},{directory:'/remote',pattern:'**/*.txt'},async files=>{for await(const file of files)s3Names.push(file.id);});
  s3Names.sort();if(JSON.stringify(s3Names)!==JSON.stringify(['first.txt','nested/second.txt']))throw new Error('Installed S3 glob enumeration failed');
  for await(const entry of s3Root.iterateDirectory('/scratch'))throw new Error('S3 glob leaked caller scratch: '+entry.name);
  const globFs=new MemoryFileSystem();
  await globFs.writeFile('/signature',Uint8Array.of(0xef,0xbb));
  let signatureRows=0;
  await withFileEmbeddingEntries({fs:globFs,directory:'/',signal:new AbortController().signal,encodings:['UTF 8 SIG'],undecodable(){throw new Error('Incomplete UTF8 signature was skipped');}},{async *[Symbol.asyncIterator](){yield {path:'/signature',id:'signature'};}},async entries=>{
    for await(const entry of entries){signatureRows++;for await(const bytes of entry.input.bytes)if(bytes.length)throw new Error('Incomplete signature produced content');}
  });
  if(signatureRows!==1)throw new Error('Incomplete signature did not yield an empty row');
  await globFs.unlink('/signature');
  for(const fixture of [...singleByteFileInputs,...multibyteFileInputs,...iso2022FileInputs]){
    await globFs.writeFile('/legacy',Uint8Array.from(atob(fixture.base64),char=>char.charCodeAt(0)));let count=0;
    const options={fs:globFs,directory:'/',signal:new AbortController().signal,encodings:[fixture.encoding]};
    const files={async *[Symbol.asyncIterator](){yield {path:'/legacy',id:'legacy'};}};
    await withFileEmbeddingEntries(options,files,async entries=>{
      for await(const entry of entries){count++;let text='';const decoder=new TextDecoder('utf-8',{ignoreBOM:true});for await(const bytes of entry.input.bytes)text+=decoder.decode(bytes,{stream:true});text+=decoder.decode();if(text!==fixture.text)throw new Error('Pinned file decoding changed: '+fixture.encoding);await entry.input.dispose();}
    });
    if(count!==1)throw new Error('Codepage row missing: '+fixture.encoding);
    if(fixture.undefinedByte!==null){
      await globFs.writeFile('/legacy',Uint8Array.of(fixture.undefinedByte));let warnings=0;
      await withFileEmbeddingEntries({...options,undecodable(){warnings++;}},files,async entries=>{for await(const entry of entries)throw new Error('Undefined codepage byte accepted: '+fixture.encoding,{cause:entry});});
      if(warnings!==1)throw new Error('Undefined codepage byte was not skipped: '+fixture.encoding);
    }
    if((await globFs.readdir('/')).length!==1)throw new Error('Codepage staging leaked: '+fixture.encoding);
  }
  await globFs.writeFile('/legacy',new TextEncoder().encode('A'.repeat(4087)+'\x1b$'+' '.repeat(7)+'B'));
  let invalidEscapeWarnings=0;
  await withFileEmbeddingEntries({fs:globFs,directory:'/',signal:new AbortController().signal,encodings:['iso2022_jp'],undecodable(){invalidEscapeWarnings++;}},{async *[Symbol.asyncIterator](){yield {path:'/legacy',id:'legacy'};}},async entries=>{
    for await(const entry of entries)throw new Error('Invalid ISO-2022 escape accepted',{cause:entry});
  });
  if(invalidEscapeWarnings!==1||(await globFs.readdir('/')).length!==1)throw new Error('Invalid ISO-2022 escape timing or cleanup changed');
  await globFs.unlink('/legacy');
  for(const [encoding,bytes,expected]of [['utf-16',[255,254,0,216,0,220],'𐀀'],['utf-16-be',[254,255,0,65],'\ufeffA'],['utf-16-le',[255,254,65,0],'\ufeffA'],['utf32',[255,254,0,0,0,0,1,0],'𐀀'],['utf-32-be',[0,0,254,255,0,0,0,65],'\ufeffA'],['utf_32_le',[255,254,0,0,65,0,0,0],'\ufeffA']]){
    await globFs.writeFile('/utf16',Uint8Array.from(bytes));let count=0;
    await withFileEmbeddingEntries({fs:globFs,directory:'/',signal:new AbortController().signal,encodings:[encoding]},{async *[Symbol.asyncIterator](){yield {path:'/utf16',id:'utf16'};}},async entries=>{
      for await(const entry of entries){count++;let text='';const decoder=new TextDecoder('utf-8',{ignoreBOM:true});for await(const chunk of entry.input.bytes)text+=decoder.decode(chunk,{stream:true});text+=decoder.decode();if(text!==expected)throw new Error('Unicode codec changed: '+encoding);}
    });
    if(count!==1)throw new Error('Unicode codec row missing: '+encoding);
  }
  await globFs.unlink('/utf16');
  await globFs.mkdir('/nested');
  await globFs.writeFile('/first.txt',new TextEncoder().encode('first'));
  await globFs.writeFile('/nested/second.txt',new TextEncoder().encode('second'));
  await globFs.symlink('nested','/alias');
  const globOptions={fs:globFs,directory:'/',signal:new AbortController().signal,maxFileBytes:1048576,maxOpenFiles:8};
  const globIds=[];
  await withEmbeddingFileGlob(globOptions,{directory:'/',pattern:'**/**/*.txt'},files=>withFileEmbeddingEntries(globOptions,files,async entries=>{
    for await(const entry of entries){let text='';for await(const chunk of entry.input.bytes)text+=new TextDecoder().decode(chunk);globIds.push([entry.id,text]);}
  }));
  if(JSON.stringify(globIds)!==JSON.stringify([['first.txt','first'],['nested/second.txt','second']]))throw new Error('Installed Python glob traversal changed');
  if((await globFs.readdir('/')).length!==3)throw new Error('Installed glob storage leaked');
  const fs = new MemoryFileSystem();
  const options = { fs, path: "/embeddings.db", signal: new AbortController().signal,
    maxFileBytes: 1048576, maxIndexBytes: 1048576, maxOpenFiles: 8,
    now: () => new Date("2026-10-02T00:00:00Z") };
  const created = await withLlmCollections(options, async catalog => catalog.collection("documents", { model: "embed" }));
  let importedBytes=0;
  await withCsvEmbeddingEntries({...options,directory:'/'},{async *[Symbol.asyncIterator](){
    yield new TextEncoder().encode('id,body\nlarge,"');
    const chunk=new Uint8Array(4096).fill(120);for(let index=0;index<1024;index++)yield chunk;
    yield new TextEncoder().encode('"\n');
  }},async entries=>{
    for await(const entry of entries){
      if(entry.id!=='large')throw new Error('Large CSV ID mismatch');
      for await(const bytes of entry.input.bytes){if(bytes.length>16384)throw new Error('Unbounded CSV field chunk');importedBytes+=bytes.length;}
      await entry.input.dispose();
    }
  });
  if(importedBytes!==4194304)throw new Error('Large CSV field was truncated');
  let jsonBytes=0;
  // The 4 MiB payload is separate from the 1 MiB index limit.
  await withJsonEmbeddingEntries({...options,directory:'/'},{async *[Symbol.asyncIterator](){
    yield new TextEncoder().encode('[{"id":1e0,"body":"');
    const chunk=new Uint8Array(4096).fill(120);for(let index=0;index<1024;index++)yield chunk;
    yield new TextEncoder().encode('"}]');
  }},async entries=>{for await(const entry of entries){
    if(entry.id!=='1.0')throw new Error('JSON numeric ID lost its type');
    for await(const bytes of entry.input.bytes){if(bytes.length>24576)throw new Error('Unbounded JSON field chunk');if(bytes.some(byte=>byte!==120))throw new Error('Large JSON field bytes changed');jsonBytes+=bytes.length;}
    await entry.input.dispose();
  }});
  if(jsonBytes!==4194304)throw new Error('Large JSON field was truncated');
  if(JSON.stringify(await fs.readdir('/'))!==JSON.stringify([{name:'embeddings.db',type:'file'}]))throw new Error('JSON staging files leaked');
  for(const fixture of jsonImportEncodingInputs){
    let count=0;
    await withJsonEmbeddingEntries({...options,directory:'/'},{async *[Symbol.asyncIterator](){for(const byte of Uint8Array.from(atob(fixture.base64),c=>c.charCodeAt(0)))yield Uint8Array.of(byte);}},async entries=>{
      for await(const entry of entries){let text='';for await(const bytes of entry.input.bytes)text+=new TextDecoder().decode(bytes);if(entry.id!=='one'||text!=='hello')throw new Error('JSON encoding changed: '+fixture.label);count++;await entry.input.dispose();}
    });
    if(count!==1)throw new Error('JSON encoding row count changed: '+fixture.label);
  }
  for(const fixture of jsonImportRejectedInputs){
    let rejected=false;
    try{await withJsonEmbeddingEntries({...options,directory:'/'},{async *[Symbol.asyncIterator](){yield Uint8Array.from(atob(fixture.base64),c=>c.charCodeAt(0));}},async()=>{});}
    catch(error){if(!String(error).includes('parse error'))throw error;rejected=true;}
    if(!rejected)throw new Error('Double BOM accepted: '+fixture.label);
  }
  let jsonLineCount=0;
  await withJsonLinesEmbeddingEntries({...options,directory:'/'},{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('\ufeff{"id":1,"body":"first"}\n\x0b\x0c\r\n\ufeff{"id":2,"body":"second"}\n');}},async entries=>{for await(const entry of entries){jsonLineCount++;for await(const bytes of entry.input.bytes)if(!bytes.length)throw new Error('Empty JSONL payload chunk');await entry.input.dispose();}});
  if(jsonLineCount!==2)throw new Error('JSONL row count changed');
  if (!created.committed || created.cleanupErrors.length || created.value.model !== "embed") throw new Error("Collection creation failed");
  await withLlmCollections(options, async catalog => {
    const existing = await catalog.collection("documents", { create: false });
    if (existing.id !== created.value.id) throw new Error("Collection identity changed");
    let count = 0;
    await catalog.list(row => {
      if (row.name !== "documents" || row.count !== 0n) throw new Error("Unexpected collection row");
      count++;
    });
    if (count !== 1) throw new Error("Missing collection");
    await catalog.delete("documents");
  });
  await withLlmCollections(options, async catalog => {
    await catalog.list(() => { throw new Error("Deleted collection survived"); });
  });
  if ((await fs.readdir("/")).length !== 1) throw new Error("Collection scratch files leaked");
  await fs.writeFile('/file-input',new TextEncoder().encode('café\r\nline\r'));
  await withFileEmbeddingEntries({...options,directory:'/'},{async *[Symbol.asyncIterator](){yield {path:'/file-input',id:'text'};}},async entries=>{
    for await(const entry of entries){let value='';for await(const bytes of entry.input.bytes)value+=new TextDecoder().decode(bytes);if(value!=='cafÃ©\nline\n'||entry.binary)throw new Error('File decoding differs from reference');}
  });
  await fs.writeFile('/file-input',new Uint8Array(4194304).fill(233));let fileBytes=0;
  await withFileEmbeddingEntries({...options,directory:'/',encodings:['latin-1']},{async *[Symbol.asyncIterator](){yield {path:'/file-input',id:'large'};}},async entries=>{
    for await(const entry of entries)for await(const bytes of entry.input.bytes){if(bytes.length>16384)throw new Error('Unbounded file decoding');fileBytes+=bytes.length;}
  });
  if(fileBytes!==8388608)throw new Error('File decoding truncated');await fs.unlink('/file-input');
  await fs.writeFile('/empty-file',new Uint8Array());await fs.writeFile('/binary-file',Uint8Array.of(255,0));
  let mixedCalls=0;
  const mixedService=createLlmService({providers:[{name:'mixed',models:[{id:'mixed',capabilities:['embed','embed-binary','embed-mixed']}],async *complete(){},async embedSources(request){
    mixedCalls++;if(JSON.stringify(request.inputTypes)!=='["text","binary"]'||request.binary!==undefined)throw new Error('Mixed input kinds lost');
    const values=[];for(const input of request.inputs){const bytes=[];for await(const chunk of input.bytes)bytes.push(...chunk);values.push(bytes);}
    if(JSON.stringify(values)!=='[[],[255,0]]')throw new Error('Mixed payload changed');
    return {model:'mixed',vectors:[[1],[2]]};
  }}]});
  await withLlmCollections(options,async catalog=>{
    await catalog.collection('mixed',{model:'mixed'});
    await withFileEmbeddingEntries({...options,directory:'/',binary:true},{async *[Symbol.asyncIterator](){yield {path:'/empty-file',id:'text'};yield {path:'/binary-file',id:'binary'};}},entries=>catalog.embedMany('mixed',{service:mixedService,directory:'/',maxInputBytes:100,store:true,binary:true,entries}));
  });
  await fs.unlink('/empty-file');await fs.unlink('/binary-file');
  if(mixedCalls!==1)throw new Error('Mixed batch split across calls');
  const mixedShell=new Shell({fs}).use(sqlite3Commands());
  try{
  const mixedRows=await mixedShell.exec(`sqlite3 /embeddings.db "SELECT id,typeof(content),typeof(content_blob),hex(content_blob) FROM embeddings ORDER BY id"`);
  if(mixedRows.exitCode!==0||mixedRows.stdout!=='binary|null|blob|FF00\ntext|text|null|\n')throw new Error('Mixed SQLite types changed: '+JSON.stringify(mixedRows));
  }finally{await mixedShell.dispose();}
  await withLlmCollections(options,catalog=>catalog.delete('mixed'));
  let calls=0;
  const service=createLlmService({providers:[{name:'fixture',models:[{id:'embed',capabilities:['embed']}],async *complete(){},async embedSources(request){
    calls++;for(const input of request.inputs)for await(const chunk of input.bytes)if(chunk.length>16384)throw new Error('Unbounded embedding chunk');
    return {model:'embed',vectors:request.inputs.map(()=>[1,0.5,-2])};
  }}]});
  const input=()=>({bytes:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('stored content');}},async dispose(){}});
  await withLlmCollections(options,async catalog=>{
    await catalog.collection('documents',{model:'embed'});
    await catalog.embed('documents','one',{service,input:input(),directory:'/',maxInputBytes:1048576,store:true,metadata:{name:'fixture'}});
    await catalog.embed('documents','duplicate',{service,input:input(),directory:'/',maxInputBytes:1048576});
    await catalog.list(row=>{if(row.count!==1n)throw new Error('Embedding dedup failed');});
  });
  if(calls!==1)throw new Error('Duplicate invoked provider');
  await withLlmCollections(options,async catalog=>{
    await catalog.collection('batch',{model:'embed'});
    await catalog.embedMany('batch',{service,directory:'/',maxInputBytes:1048576,batchSize:2,store:true,entries:{async *[Symbol.asyncIterator](){yield {id:'a',input:input()};yield {id:'b',input:input()};}}});
    let count=0;await catalog.similarByVector('batch',[1,0.5,-2],{},()=>{count++;});
    if(count!==2)throw new Error('Batch duplicate content lost');
    await catalog.delete('batch');
  });
  await withLlmCollections(options,async catalog=>{
    let count=0;
    await catalog.similarByVector('documents',[1,0.5,-2],{number:1},async row=>{
      count++;if(row.id!=='one'||Math.abs(row.score-1)>1e-15)throw new Error('Similarity score mismatch');
      let text='';for await(const bytes of row.content.bytes)text+=new TextDecoder().decode(bytes);
      if(text!=='stored content')throw new Error('Similarity content mismatch');
    });
    if(count!==1)throw new Error('Similarity result missing');
    await catalog.similarById('documents','one',{},()=>{throw new Error('Similarity included own ID');});
    await catalog.similar('documents',{service,input:input(),maxInputBytes:1048576},row=>{if(row.id!=='one')throw new Error('Query embedding mismatch');});
  });
  const embeddingShell=new Shell({fs}).use(sqlite3Commands());
  try{
    const result=await embeddingShell.exec('sqlite3 -readonly /embeddings.db "SELECT id,hex(embedding),content,metadata FROM embeddings;"');
    if(result.exitCode!==0||result.stdout!=='one|0000803F0000003F000000C0|stored content|{"name":"fixture"}\n')throw new Error(`Embedding readback failed: ${result.stderr||result.stdout}`);
  }finally{await embeddingShell.dispose();}
  const cliShell=new Shell({fs}).use(llmCommands({service,collections:createLlmCollectionCommands({maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8})}));
  try{
    const stored=await cliShell.exec('llm embed cli one -m embed -c hello --store -d /cli.db');
    if(stored.exitCode!==0||stored.stdout)throw new Error(`Stored CLI embedding failed: ${stored.stderr}`);
    const listed=await cliShell.exec('llm collections --json -d /cli.db');
    if(listed.exitCode!==0||JSON.stringify(JSON.parse(listed.stdout))!==JSON.stringify([{name:'cli',model:'embed',num_embeddings:1}]))throw new Error('Collection CLI list failed');
    const similar=await cliShell.exec('llm similar cli -c query -d /cli.db');
    if(similar.exitCode!==0||JSON.parse(similar.stdout).id!=='one'||JSON.parse(similar.stdout).content!=='hello')throw new Error(`Similarity CLI failed: ${similar.stderr}`);
    await fs.writeFile('/input.csv',new TextEncoder().encode('key,title,key,body\nold,Hello,new,World\nfirst,Only\n'));
    const imported=await cliShell.exec('llm embed-multi imported /input.csv --format csv -m embed --store -d /cli.db --batch-size 1');
    if(imported.exitCode!==0||imported.stdout!=='Embedding\n')throw new Error(`CSV import failed: ${imported.stderr}`);
    const neighbors=await cliShell.exec('llm similar imported -c query -d /cli.db');
    const records=neighbors.stdout.trim().split('\n').map(JSON.parse).sort((a,b)=>a.id.localeCompare(b.id));
    if(neighbors.exitCode!==0||JSON.stringify(records.map(row=>[row.id,row.content]))!==JSON.stringify([['new','Hello World'],['None','Only ']].sort((a,b)=>a[0].localeCompare(b[0]))))throw new Error(`CSV import readback failed: ${neighbors.stderr}`);
    await fs.unlink('/input.csv');
    await fs.writeFile('/auto.tsv',new TextEncoder().encode('id\ttext\none\tvalue\n'));
    const automatic=await cliShell.exec('llm embed-multi automatic /auto.tsv -m embed --store -d /cli.db');
    if(automatic.exitCode!==0||automatic.stdout!=='Embedding\n')throw new Error(`Dialect detection failed: ${automatic.stderr}`);
    const automaticRows=await cliShell.exec('llm similar automatic -c query -d /cli.db');
    if(automaticRows.exitCode!==0||JSON.parse(automaticRows.stdout).content!=='value')throw new Error('Detected TSV content changed');
    await fs.unlink('/auto.tsv');
    await fs.writeFile('/auto.json',new TextEncoder().encode('[{"id":[1,true],"body":"json content"}]'));
    const jsonImport=await cliShell.exec('llm embed-multi json /auto.json -m embed --store -d /cli.db');
    if(jsonImport.exitCode!==0||jsonImport.stdout!=='Embedding\n')throw new Error(`JSON import failed: ${jsonImport.stderr}`);
    const jsonRows=await cliShell.exec('llm similar json -c query -d /cli.db');
    const jsonRow=JSON.parse(jsonRows.stdout);
    if(jsonRows.exitCode!==0||jsonRow.id!=='[1, True]'||jsonRow.content!=='json content')throw new Error('JSON import readback changed');
    await fs.unlink('/auto.json');
    await fs.mkdir('/file-inputs');
    await fs.writeFile('/file-inputs/a.txt',new TextEncoder().encode('café'));
    const fileImport=await cliShell.exec("llm embed-multi files --files /file-inputs '*.txt' --encoding cp65001 --store -m embed -d /cli.db");
    if(fileImport.exitCode!==0||fileImport.stdout!=='Embedding\n')throw new Error('File CLI import failed: '+fileImport.stderr);
    const fileRows=await cliShell.exec('llm similar files -c query -d /cli.db');
    if(fileRows.exitCode!==0||JSON.parse(fileRows.stdout).content!=='café'||JSON.parse(fileRows.stdout).id!=='a.txt')throw new Error('File CLI stored content changed');
    await fs.writeFile('/file-inputs/u32.txt',Uint8Array.of(255,254,0,0,0,0,1,0));
    const unicodeImport=await cliShell.exec('llm embed-multi utf32 --files /file-inputs u32.txt --encoding utf32 --store -m embed -d /cli.db');
    if(unicodeImport.exitCode!==0||unicodeImport.stdout!=='Embedding\n')throw new Error('UTF32 CLI import failed: '+unicodeImport.stderr);
    const unicodeRows=await cliShell.exec('llm similar utf32 -c query -d /cli.db');
    if(unicodeRows.exitCode!==0||JSON.parse(unicodeRows.stdout).content!=='𐀀')throw new Error('UTF32 CLI stored content changed');
    await fs.unlink('/file-inputs/u32.txt');
    await fs.writeFile('/file-inputs/korean.txt',Uint8Array.of(0xa4,0xd4,0xa4,0xa1,0xa4,0xbf,0xa4,0xa1,13,10));
    const koreanImport=await cliShell.exec('llm embed-multi korean --files /file-inputs korean.txt --encoding euc_kr --store -m embed -d /cli.db');
    if(koreanImport.exitCode!==0||koreanImport.stdout!=='Embedding\n')throw new Error('EUC-KR CLI import failed: '+koreanImport.stderr);
    const koreanRows=await cliShell.exec('llm similar korean -c query -d /cli.db');
    if(koreanRows.exitCode!==0||JSON.parse(koreanRows.stdout).content!=='각\n')throw new Error('EUC-KR CLI stored content changed');
    await fs.unlink('/file-inputs/korean.txt');
    await fs.writeFile('/file-inputs/chinese.txt',Uint8Array.of(0x90,0x30,0x81,0x30,0xa8,0xbc,13,10));
    const chineseImport=await cliShell.exec('llm embed-multi chinese --files /file-inputs chinese.txt --encoding gb18030 --store -m embed -d /cli.db');
    if(chineseImport.exitCode!==0||chineseImport.stdout!=='Embedding\n')throw new Error('GB18030 CLI import failed: '+chineseImport.stderr);
    const chineseRows=await cliShell.exec('llm similar chinese -c query -d /cli.db');
    if(chineseRows.exitCode!==0||JSON.parse(chineseRows.stdout).content!=='\u{10000}\ue7c7\n')throw new Error('GB18030 CLI stored content changed');
    await fs.unlink('/file-inputs/chinese.txt');
    await fs.writeFile('/file-inputs/hz.txt',new TextEncoder().encode('A'.repeat(4095)+'~{VP~}\r\n'));
    const hzImport=await cliShell.exec('llm embed-multi hz --files /file-inputs hz.txt --encoding hz-gb-2312 --store -m embed -d /cli.db');
    if(hzImport.exitCode!==0||hzImport.stdout!=='Embedding\n')throw new Error('HZ CLI import failed: '+hzImport.stderr);
    const hzRows=await cliShell.exec('llm similar hz -c query -d /cli.db');
    if(hzRows.exitCode!==0||JSON.parse(hzRows.stdout).content!=='A'.repeat(4095)+'中\n')throw new Error('HZ CLI stored content changed');
    await fs.unlink('/file-inputs/hz.txt');
    await fs.writeFile('/file-inputs/ebcdic.txt',Uint8Array.of(0xc1,0x0d,0x25));
    const ebcdicImport=await cliShell.exec('llm embed-multi ebcdic --files /file-inputs ebcdic.txt --encoding ibm037 --store -m embed -d /cli.db');
    if(ebcdicImport.exitCode!==0||ebcdicImport.stdout!=='Embedding\n')throw new Error('EBCDIC CLI import failed: '+ebcdicImport.stderr);
    const ebcdicRows=await cliShell.exec('llm similar ebcdic -c query -d /cli.db');
    if(ebcdicRows.exitCode!==0||JSON.parse(ebcdicRows.stdout).content!=='A\n')throw new Error('EBCDIC CLI stored content changed');
    await fs.unlink('/file-inputs/ebcdic.txt');
    await fs.unlink('/file-inputs/a.txt');await fs.rmdir('/file-inputs');
    for(const [format,input]of [['json','[1]'],['nl','1\n']]){
      await fs.writeFile('/count-input',new TextEncoder().encode(input));
      const counted=await cliShell.exec('llm embed-multi count-'+format+' /count-input --format '+format+' -m embed -d /cli.db');
      if(counted.exitCode!==1||counted.stdout!=='Embedding\n'||!counted.stderr.includes("'int' object has no attribute 'values'"))throw new Error('JSON count prepass timing changed: '+format);
    }
    await fs.unlink('/count-input');
    await fs.writeFile('/raw.json',Uint8Array.from([...new TextEncoder().encode('{"id":["'),...rawPair,...new TextEncoder().encode('"],"body":"raw unicode"}')]));
    const rawImport=await cliShell.exec('llm embed-multi raw /raw.json --format json -m embed --store -d /cli.db');
    if(rawImport.exitCode!==0||rawImport.stdout!=='Embedding\n')throw new Error('Raw JSON import failed: '+rawImport.stderr);
    const rawRows=await cliShell.exec('llm similar raw -c query -d /cli.db');
    if(rawRows.exitCode!==0||JSON.parse(rawRows.stdout).id!=="['\\ud800\\udc00']")throw new Error('Raw JSON repr changed');
    await fs.unlink('/raw.json');

    const deleted=await cliShell.exec('llm collections delete cli -d /cli.db');
    if(deleted.exitCode!==0)throw new Error('Collection CLI delete failed');
  }finally{await cliShell.dispose();}
  await fs.unlink('/cli.db');
  const mountShell=new Shell({fs:mounted}).use(llmCommands({service,collections:createLlmCollectionCommands({maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8})}));
  try{
    const imported=await mountShell.exec('llm embed-multi mounted --files /synthetic "**/*.txt" --encoding utf8 --store -m embed -d /mounted.db');
    if(imported.exitCode!==0)throw new Error('Mounted CLI import failed: '+imported.stderr);
    const rows=await mountShell.exec('llm similar mounted -c query -d /mounted.db');
    if(rows.exitCode!==0||JSON.parse(rows.stdout).content!=='mounted')throw new Error('Mounted CLI readback changed');
  }finally{await mountShell.dispose();}
  await mounted.unlink('/mounted.db');
  const overlayShell=new Shell({fs:overlayFs}).use(llmCommands({service,collections:createLlmCollectionCommands({maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8})}));
  try{
    const imported=await overlayShell.exec('llm embed-multi union --files /union "*.txt" --encoding utf8 --store -m embed -d /union.db');
    if(imported.exitCode!==0)throw new Error('Overlay CLI import failed: '+imported.stderr);
    const rows=await overlayShell.exec('llm similar union -c query -d /union.db');
    const contents=rows.stdout.trim().split('\n').map(line=>JSON.parse(line).content).sort();
    if(rows.exitCode!==0||JSON.stringify(contents)!==JSON.stringify(['lower','upper']))throw new Error('Overlay CLI readback changed');
  }finally{await overlayShell.dispose();}
  await overlayFs.unlink('/union.db');


  for (const {version, zlibBase64} of legacyCollectionDatabases) {
    const bytes = Uint8Array.from(atob(zlibBase64), character => character.charCodeAt(0));
    const database = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
    await fs.writeFile(options.path, database);
    await withLlmCollections(options, async catalog => {
      const collection = await catalog.collection("documents", {create: false});
      if (collection.id !== 7n || collection.model !== "embed") throw new Error(`Legacy collection ${version} changed`);
      let count = 0;
      await catalog.list(row => { count++; if (row.count !== 1n) throw new Error("Legacy embedding disappeared"); });
      if (count !== 1) throw new Error("Legacy catalog changed");
    });
    const shell = new Shell({fs}).use(sqlite3Commands());
    try {
      const result = await shell.exec('sqlite3 -readonly /embeddings.db "SELECT hex(content_hash),updated,length(content),hex(embedding),metadata FROM embeddings;"');
      const expected = `${version >= 4 ? "0102" : "1A03E1E9316B7EB389448E2EEDE26210"}|${version >= 3 ? 123 : 1790899200}|40000|0000803F|{}\n`;
      if (result.exitCode !== 0 || result.stdout !== expected) throw new Error(`Legacy values changed: ${result.stderr || result.stdout}`);
    } finally { await shell.dispose(); }
    // A second open exercises the persisted final layout, independently of the
    // in-transaction handles that performed migration.
    await withLlmCollections(options, async catalog => catalog.delete("documents"));
    if ((await fs.readdir("/")).length !== 1) throw new Error("Migration scratch files leaked");
  }
}
