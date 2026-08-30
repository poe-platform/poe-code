import {fs,path,scope,read,put,sha} from './io.mjs';
const retained=JSON.parse(read(path.join(scope,'RETAINED-SOURCES.json'),2097152));
const source=JSON.parse(read(path.join(scope,'SOURCE-READS.json'),1048576));
console.log(JSON.stringify({retainedShape:Object.keys(retained),sourceShape:Object.keys(source)}));
function scan(value,prefix){if(Array.isArray(value)){for(const [index,row] of value.entries())scan(row,prefix+'/'+index);return;}if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(typeof item==='string'&&(key==='text'||key==='body'||key==='sourceText')){const lines=item.split('\n');console.log(JSON.stringify({location:prefix,path:value.path,bytes:Buffer.byteLength(item),sha256:sha(Buffer.from(item)),selected:lines.flatMap((line,index)=>/import |expectedNames|Object.keys|exports|\.length|^test\(|^await test|^add\(|^await check|^await run|^const tests|engine\.createProvider|createProvider\(|case "C1|case 'C1|context\.engine|snapshot/.test(line)?[{line:index+1,text:line}]:[])}));}else if(item&&typeof item==='object')scan(item,prefix+'/'+key);}}
scan(retained,'retained');scan(source,'source');
const base=path.dirname(scope);
for(const name of ['v4/workflows.mjs','v2/workflow-entry.mjs','v2/RETAINED-FIXTURES.json','v4/PRESEAL.json']){const body=read(path.join(base,name),1048576);const text=body.toString();console.log(JSON.stringify({file:name,bytes:body.length,sha256:sha(body),text:name.endsWith('.mjs')?text:undefined,keys:name.endsWith('.json')?Object.keys(JSON.parse(text)):undefined}));}
put('AUDIT-RESULT.json',{role:'SOURCE_ONLY',productImports:0,retainedCasesExecuted:0});
