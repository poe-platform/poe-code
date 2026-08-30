import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const home=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(home,'../../..');
const [label,mode,...argumentsList]=process.argv.slice(2);
if(!/^m\d{2}$/u.test(label)||!['batch','tree'].includes(mode))throw Error('metadata arguments');
const capture=path.join(home,label+'-RAW.json.gz.base64');
const descriptor=fs.openSync(capture,'wx',0o600);
const state={label,role:'immutable-git-metadata',before:new Date().toISOString(),args:null,closed:false,code:null,signal:null,stdout:null,stderr:null,error:null};
try{
 const values=argumentsList.length===1&&/^@m\d{2}-SPECS\.json$/u.test(argumentsList[0])?JSON.parse(fs.readFileSync(path.join(home,argumentsList[0].slice(1)),'utf8')):argumentsList;
 const args=mode==='tree'?['ls-tree','-rz','--full-tree',values[0],'--',values[1]]:['cat-file','--batch'];
 if(mode==='batch'&&values.some(value=>!/^([0-9a-f]{40})(?::[^\n\r\0]+)?$/u.test(value)))throw Error('immutable spec');
 if(mode==='tree'&&(!/^[0-9a-f]{40}$/u.test(values[0])||values.length!==2))throw Error('tree identity');
 state.args=args;const result=spawnSync('git',args,{cwd:root,input:mode==='batch'?values.join('\n')+'\n':undefined,maxBuffer:16777216,timeout:30000,encoding:null});
 state.code=result.status;state.signal=result.signal;state.closed=result.status!==null;state.stdout=result.stdout?.toString('base64')??null;state.stderr=result.stderr?.toString('base64')??null;state.error=result.error?{code:result.error.code,message:result.error.message}:null;
 if(result.error||result.signal||result.status!==0)throw Error('metadata child/capture/retirement STOP');
 const bytes=result.stdout;const sha=value=>createHash('sha256').update(value).digest('hex');
 if(mode==='tree'){
 const rows=bytes.toString('utf8').split('\0').filter(Boolean).map(line=>{const match=/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/u.exec(line);if(!match)throw Error('tree record');return{mode:match[1],kind:match[2],oid:match[3],path:match[4]};});fs.writeFileSync(path.join(home,label+'-INVENTORY.json'),JSON.stringify(rows,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({label,rows:rows.length,bytes:bytes.length}));
 }else{
 let offset=0;const rows=[];for(const spec of values){const end=bytes.indexOf(10,offset);const header=bytes.subarray(offset,end).toString('ascii');const match=/^([a-f0-9]{40}) blob (\d+)$/u.exec(header);if(!match)throw Error('batch blob '+header);const size=Number(match[2]);const body=bytes.subarray(end+1,end+1+size);if(body.length!==size||bytes[end+1+size]!==10)throw Error('batch framing');rows.push({spec,oid:match[1],bytes:size,sha256:sha(body),body:body.toString('base64')});offset=end+2+size;}if(offset!==bytes.length)throw Error('batch trailing');const data=gzipSync(Buffer.from(JSON.stringify(rows)));fs.writeFileSync(path.join(home,label+'-INPUTS.json.gz.base64'),data.toString('base64')+'\n',{flag:'wx'});console.log(JSON.stringify({label,rows:rows.length,bodyBytes:rows.reduce((sum,row)=>sum+row.bytes,0),archiveSha256:sha(data)}));
 }
}catch(error){state.failure={message:error.message};process.exitCode=1;}
finally{state.after=new Date().toISOString();fs.writeFileSync(descriptor,gzipSync(Buffer.from(JSON.stringify(state))).toString('base64')+'\n');fs.closeSync(descriptor);}
