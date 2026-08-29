import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const scope='/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/stage-a-loader';
const read=(file,maximum,expected)=>{const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);if(expected)assert.equal(stat.size,expected.bytes);const body=fs.readFileSync(file);if(expected)assert.equal(crypto.createHash('sha256').update(body).digest('hex'),expected.sha256);return body;};
const primary=JSON.parse(read(path.join(scope,'PRIMARY.json'),32768));const outputs=[];
for(const row of primary.primary){const lines=read(path.join(scope,row.filename),524288,row).toString().split('\n');const spans=[];
 if(row.filename==='primary/lib__fs.js.txt')spans.push([2770,2827]);
 if(row.filename==='primary/lib__internal__modules__helpers.js.txt')spans.push([55,66]);
 if(row.filename==='primary/lib__internal__modules__run_main.js.txt')spans.push([28,48]);
 if(row.filename==='primary/lib__internal__modules__cjs__loader.js.txt')spans.push([728,750]);
 if(row.filename==='primary/src__node_file.cc.txt'){const found=lines.findIndex(line=>/^static void Stat\(/.test(line));assert.ok(found>=0);spans.push([found+1,found+58]);}
 for(const [start,end]of spans)outputs.push({file:row.filename,sha256:row.sha256,start,end,lines:lines.slice(start-1,end)});
}
fs.writeFileSync(path.join(scope,'SOURCE-PROOF.json'),JSON.stringify(outputs,null,2)+'\n',{flag:'wx'});
for(const row of outputs){console.log(row.file+' '+row.start+'-'+row.end);row.lines.forEach((line,index)=>console.log((row.start+index)+': '+line));}
