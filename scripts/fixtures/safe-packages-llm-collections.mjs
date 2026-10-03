import { MemoryFileSystem } from "@poe-platform/safe-fs/core";
import { withLlmCollections } from "@poe-platform/safe-bash/commands/llm/collections";
import { createLlmService } from "@poe-platform/safe-bash/commands/llm";
import { legacyCollectionDatabases } from "./safe-packages-llm-collections-reference.mjs";
import { Shell } from "@poe-platform/safe-bash/shell";
import { sqlite3Commands } from "@poe-platform/safe-bash/commands/sqlite3";

export async function verifyLlmCollections() {
  const fs = new MemoryFileSystem();
  const options = { fs, path: "/embeddings.db", signal: new AbortController().signal,
    maxFileBytes: 1048576, maxIndexBytes: 1048576, maxOpenFiles: 8,
    now: () => new Date("2026-10-02T00:00:00Z") };
  const created = await withLlmCollections(options, async catalog => catalog.collection("documents", { model: "embed" }));
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
  let calls=0;
  const service=createLlmService({providers:[{name:'fixture',models:[{id:'embed',capabilities:['embed']}],async *complete(){},async embedSources(request){
    calls++;for await(const chunk of request.inputs[0].bytes)if(chunk.length>16384)throw new Error('Unbounded embedding chunk');
    return {model:'embed',vectors:[[1,0.5,-2]]};
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
