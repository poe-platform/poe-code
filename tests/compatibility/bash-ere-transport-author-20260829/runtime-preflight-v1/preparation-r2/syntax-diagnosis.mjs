import {lstatSync,readFileSync,createReadStream,writeSync,openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
const own=fileURLToPath(new URL('.',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function read(path,max){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw Error('bounded regular input');const bytes=readFileSync(path);if(bytes.length!==stat.size)throw Error('input drift');return bytes;}
function write(fd,bytes){let offset=0;while(offset<bytes.length){const count=writeSync(fd,bytes,offset,bytes.length-offset);if(!Number.isSafeInteger(count)||count<=0||count>bytes.length-offset)throw Error('capture write');offset+=count;}}
let primary={present:false};const secondary=[];let output;
try{
 output=openSync(join(own,'capture','syntax-diagnostics.json'),'wx',0o600);
 const sealBytes=read(join(own,'SYNTAX-PRESEAL.json'),65536);if(sha(sealBytes)!==process.argv[2])throw Error('syntax preseal');const seal=JSON.parse(sealBytes);
 const tool=seal.typescript;const stat=lstatSync(tool.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==tool.size)throw Error('tool size/type');let size=0;const hash=createHash('sha256');for await(const chunk of createReadStream(tool.path,{highWaterMark:65536})){size+=chunk.length;if(size>tool.size)throw Error('tool overread');hash.update(chunk);}if(size!==tool.size||hash.digest('hex')!==tool.sha256)throw Error('tool hash');
 const scripts=[];for(const row of seal.inputs){const bytes=read(join(own,'..',row.name),131072);if(bytes.length!==row.size||sha(bytes)!==row.sha256)throw Error('input hash');if(row.name.endsWith('.mjs.data'))scripts.push({name:row.name,text:bytes.toString('utf8')});if(row.name==='FAULT-ASSETS.json'){for(const asset of JSON.parse(bytes).assets){if(Buffer.byteLength(asset.source)!==asset.bytes||sha(Buffer.from(asset.source))!==asset.sha256)throw Error('fault hash');scripts.push({name:asset.id+'.mjs',text:asset.source});}}}
 if(scripts.length!==28)throw Error('script cardinality');const ts=await import(pathToFileURL(tool.path).href);const results=[];for(const script of scripts){const parsed=ts.createSourceFile(script.name,script.text,ts.ScriptTarget.ES2023,true,ts.ScriptKind.JS);results.push({name:script.name,diagnostics:parsed.parseDiagnostics.map(item=>({code:item.code,start:item.start??null,length:item.length??null,message:ts.flattenDiagnosticMessageText(item.messageText,' ')}))});}
 const bytes=Buffer.from(JSON.stringify({schema:1,role:'TEXT syntax only; no fixture/product execution',scripts:results},null,2)+'\n');if(bytes.length>65536)throw Error('diagnostic cap');write(output,bytes);write(1,bytes);if(results.some(row=>row.diagnostics.length))process.exitCode=1;
}catch(reason){primary={present:true,value:reason};process.exitCode=2;try{write(2,Buffer.from(JSON.stringify({failure:true,primaryPresent:true,message:reason instanceof Error?reason.message:'non-Error'})+'\n'));}catch(fault){secondary.push(fault);}}
finally{if(output!==undefined){try{closeSync(output);}catch(reason){secondary.push(reason);process.exitCode=2;}}}
