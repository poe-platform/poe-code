import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const home=path.dirname(fileURLToPath(import.meta.url));
const receipt=fs.openSync(path.join(home,'input-selection.json'),'wx');
const result={role:'DATA-only immutable artifact selection',start:new Date().toISOString(),nativeExecutions:0};
try{const filename=path.join(home,'m01-INVENTORY.json'),stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>131072)throw Error('inventory admission');const rows=JSON.parse(fs.readFileSync(filename,'utf8'));if(rows.length!==52||rows.some(row=>row.mode!=='100644'||row.kind!=='blob'||row.bytes>1048576||row.path.endsWith('AGENTS.md')||!/^([a-f0-9]{40})$/u.test(row.oid)))throw Error('artifact admission');fs.writeFileSync(path.join(home,'m02-SPECS.json'),JSON.stringify(rows.map(row=>row.oid),null,2)+'\n',{flag:'wx'});result.files=rows.length;result.bytes=rows.reduce((sum,row)=>sum+row.bytes,0);result.ok=true;}catch(error){result.error=error.message;process.exitCode=1;}finally{result.end=new Date().toISOString();fs.writeFileSync(receipt,JSON.stringify(result,null,2)+'\n');fs.closeSync(receipt);}
