import{fs,path,assert,repo,scope,sha,read,put,streamHash,metadataOwner}from'./io.mjs';
const started=new Date().toISOString();
try{
 await streamHash('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node',{bytes:112989184,sha256:'5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'});await streamHash('/usr/bin/git',{bytes:118928,sha256:'12bed4523661307059b879b9b54e77a73176e9d27d27a0e40363271d8f0668ba'});
 const owner=metadataOwner('inspect');const enginePrefix='tests/integration/agent-bash-coherent-independent-20260829/public-engine-preflight/';
 const inputs=owner.fetch([{commit:'3681c910f485673051f59a35c68fcde32c01dbe7',path:enginePrefix+'HANDOFF.md'},{commit:'955e7eb7d7f49feb4cf288fcb58a6ba6125073f0',path:'tests/integration/agent-bash-coherent-author-20260829/v4/PRESEAL.json'},{commit:'d8524695c472cdea1e506bc234f426b4e6829cce',path:'tests/integration/agent-bash-coherent-author-20260829/stage-a-r2/BINDINGS.json'}]);
 fs.mkdirSync(path.join(scope,'inherited'));for(const row of inputs){const name=path.basename(row.path);fs.writeFileSync(path.join(scope,'inherited',name),row.body,{flag:'wx'});}put('INITIAL-AUTHORITIES.json',inputs.map(({body,...row})=>row));
 const fixture=JSON.parse(inputs[1].body);assert.equal(sha(inputs[1].body),'4911f32f621e33adf8cacd0eabbc13b0644586fc3efd36ca42abf3c85765734c');const packageBindings=JSON.parse(inputs[2].body);assert.equal(packageBindings.package.bytes,930368);assert.equal(packageBindings.package.sha256,'2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca');
 const packagePath=path.join(scope,'../stage-a-r2/evidence/package/virtual-bash-0.0.0.tgz');await streamHash(packagePath,packageBindings.package);
 const snapshots={};for(const name of ['RETAINED-FIXTURES.json','RECEIPTS.json','INHERITED-TOOL-BINDINGS.json','workflow-entry.mjs','admission.mjs','workflows.mjs']){const row=fixture.fixtureFiles.find(item=>item.path.endsWith('/'+name));assert.ok(row,name);const body=read(path.join(repo,row.path),4194304,row);snapshots[name]={path:row.path,bytes:body.length,sha256:sha(body),text:body.toString()};}
 put('SOURCE-READS.json',snapshots);
 console.log('PUBLIC95 HANDOFF\n'+inputs[0].body.toString());
 for(const name of ['RETAINED-FIXTURES.json','RECEIPTS.json','INHERITED-TOOL-BINDINGS.json','workflow-entry.mjs']){console.log('\n'+name+'\n'+snapshots[name].text);}
 put('INSPECT-RESULT.json',{started,finished:new Date().toISOString(),metadataChildren:owner.count(),packageSha256:packageBindings.package.sha256,productImports:0,engineImports:0});
}catch(error){put('STOP-inspect.json',{started,error:String(error?.stack??error),productImports:0,engineImports:0});throw error;}
