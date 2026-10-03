import { MemoryFileSystem } from "@poe-platform/safe-fs/core";
import { withLlmCollections, createLlmCollectionCommands, withCsvEmbeddingEntries, withJsonEmbeddingEntries, withJsonLinesEmbeddingEntries, withFileEmbeddingEntries, withEmbeddingFileGlob } from "@poe-platform/safe-bash/commands/llm/collections";
import { createLlmService, llmCommands } from "@poe-platform/safe-bash/commands/llm";
import { legacyCollectionDatabases, jsonImportEncodingInputs, jsonImportRejectedInputs } from "./safe-packages-llm-collections-reference.mjs";
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
  }catch(error){if(!(error instanceof Error)||!error.message.includes('surrogates not allowed'))throw error;invalidRejected=true;}
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
  }catch(error){if(!(error instanceof Error)||!error.message.includes('surrogates not allowed'))throw error;invalidRejected=true;}
  if(!invalidRejected||invalidCalls!==1||(await invalidFs.readdir('/')).length)throw new Error('Raw surrogate ID timing or rollback changed');
  const globFs=new MemoryFileSystem();
  await globFs.writeFile('/signature',Uint8Array.of(0xef,0xbb));
  let signatureRows=0;
  await withFileEmbeddingEntries({fs:globFs,directory:'/',signal:new AbortController().signal,encodings:['UTF 8 SIG'],undecodable(){throw new Error('Incomplete UTF8 signature was skipped');}},{async *[Symbol.asyncIterator](){yield {path:'/signature',id:'signature'};}},async entries=>{
    for await(const entry of entries){signatureRows++;for await(const bytes of entry.input.bytes)if(bytes.length)throw new Error('Incomplete signature produced content');}
  });
  if(signatureRows!==1)throw new Error('Incomplete signature did not yield an empty row');
  await globFs.unlink('/signature');
  for(const [encoding,byte,expected]of [['windows-1252',0x80,'€'],['mac-roman',0x80,'Ä'],['cp437',0x80,'Ç'],['cp1251',0xc0,'А']]){
    await globFs.writeFile('/legacy',Uint8Array.of(byte));let count=0;
    await withFileEmbeddingEntries({fs:globFs,directory:'/',signal:new AbortController().signal,encodings:[encoding]},{async *[Symbol.asyncIterator](){yield {path:'/legacy',id:'legacy'};}},async entries=>{
      for await(const entry of entries){count++;let text='';for await(const bytes of entry.input.bytes)text+=new TextDecoder().decode(bytes);if(text!==expected)throw new Error('Legacy codec changed: '+encoding);}
    });
    if(count!==1)throw new Error('Legacy codec row missing: '+encoding);
  }
  await globFs.unlink('/legacy');
  for(const [encoding,bytes,expected]of [['utf-16',[255,254,0,216,0,220],'𐀀'],['utf-16-be',[254,255,0,65],'\ufeffA'],['utf-16-le',[255,254,65,0],'\ufeffA']]){
    await globFs.writeFile('/utf16',Uint8Array.from(bytes));let count=0;
    await withFileEmbeddingEntries({fs:globFs,directory:'/',signal:new AbortController().signal,encodings:[encoding]},{async *[Symbol.asyncIterator](){yield {path:'/utf16',id:'utf16'};}},async entries=>{
      for await(const entry of entries){count++;let text='';const decoder=new TextDecoder('utf-8',{ignoreBOM:true});for await(const chunk of entry.input.bytes)text+=decoder.decode(chunk,{stream:true});text+=decoder.decode();if(text!==expected)throw new Error('UTF16 codec changed: '+encoding);}
    });
    if(count!==1)throw new Error('UTF16 codec row missing: '+encoding);
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
  await withJsonEmbeddingEntries({...options,directory:'/'},{async *[Symbol.asyncIterator](){
    yield new TextEncoder().encode('[{"id":1e0,"body":"');
    const chunk=new Uint8Array(4096).fill(120);for(let index=0;index<1024;index++)yield chunk;
    yield new TextEncoder().encode('"}]');
  }},async entries=>{for await(const entry of entries){
    if(entry.id!=='1.0')throw new Error('JSON numeric ID lost its type');
    for await(const bytes of entry.input.bytes){if(bytes.length>24576)throw new Error('Unbounded JSON field chunk');jsonBytes+=bytes.length;}
    await entry.input.dispose();
  }});
  if(jsonBytes!==4194304)throw new Error('Large JSON field was truncated');
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
