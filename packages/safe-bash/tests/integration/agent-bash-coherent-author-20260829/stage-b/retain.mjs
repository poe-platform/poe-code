import{fs,path,assert,scope,sha,read,put,metadataOwner}from'./io.mjs';
const reads=JSON.parse(read(path.join(scope,'SOURCE-READS.json'),1048576)),rows=JSON.parse(reads['RETAINED-FIXTURES.json'].text),owner=metadataOwner('retain');
const requests=rows.map(row=>{const split=row.reference.indexOf(':');assert.ok(split>0);return{commit:row.reference.slice(0,split),path:row.reference.slice(split+1)};});const loaded=owner.fetch(requests);
loaded.forEach((row,index)=>{assert.equal(row.blob,rows[index].blob);assert.equal(row.bytes,rows[index].bytes);assert.equal(row.sha256,rows[index].sha256);});
put('RETAINED-SOURCES.json',loaded.map(({body,...row})=>({...row,text:body.toString()})));
console.log('RETAINED_FILES',JSON.stringify(loaded.map(row=>({path:row.path,bytes:row.bytes,sha256:row.sha256}))));
for(const row of loaded){const lines=row.body.toString().split('\n');console.log('EXTRACT',row.path);console.log(lines.filter(line=>/^(import|export)|\b179\b|\bexport|\.mjs|\.json|\.js|case|retain|regex/i.test(line)).slice(0,95).join('\n'));}
const engine=JSON.parse(read(path.join(scope,'inherited/PUBLIC95-BINDINGS.json'),1048576));console.log('ADAPTERS',JSON.stringify(engine.adapterAndGuardFiles));console.log('EDGES',JSON.stringify(engine.externalEdges));
const handoff=read(path.join(scope,'inherited/HANDOFF.md'),65536).toString().split('\n');console.log('ENGINE_HANDOFF_REMAINDER',handoff.slice(72,165).join('\n'));
put('RETAIN-RESULT.json',{metadataChildren:owner.count(),files:loaded.length,productImports:0,fixtureExecutions:0});
