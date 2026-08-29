import{fs,path,assert,repo,scope,sha,read,put,metadataOwner}from'./io.mjs';
const owner=metadataOwner('engine');
const records=owner.fetch([{commit:'3681c910f485673051f59a35c68fcde32c01dbe7',path:'tests/integration/agent-bash-coherent-independent-20260829/public-engine-preflight/PUBLIC95-BINDINGS.json'}]);
fs.writeFileSync(path.join(scope,'inherited/PUBLIC95-BINDINGS.json'),records[0].body,{flag:'wx'});put('ENGINE-AUTHORITIES.json',records.map(({body,...row})=>row));
const binding=JSON.parse(records[0].body);
console.log('BINDING_KEYS',JSON.stringify(Object.keys(binding)));
for(const [key,value]of Object.entries(binding)){if(Array.isArray(value))console.log(key,JSON.stringify({length:value.length,first:value.slice(0,2)}));else{const text=JSON.stringify(value);console.log(key,text.length<24000?text:text.slice(0,24000)+' [DISPLAY ONLY TRUNCATED]');}}
const reads=JSON.parse(read(path.join(scope,'SOURCE-READS.json'),1048576));
console.log('RETAINED',reads['RETAINED-FIXTURES.json'].text);
console.log('WORKFLOW_ADAPTER_LINES',reads['workflows.mjs'].text.split('\n').filter(line=>/engine|adapter|C1[0568]|createNode|provider/i.test(line)).join('\n'));
console.log('RECEIPT_SHORT',reads['RECEIPTS.json'].text);
put('ENGINE-INSPECT-RESULT.json',{metadataChildren:owner.count(),productImports:0,engineImports:0});
