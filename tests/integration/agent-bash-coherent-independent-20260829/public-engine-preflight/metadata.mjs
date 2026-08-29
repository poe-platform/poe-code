import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const home=path.dirname(fileURLToPath(import.meta.url)),root='/Users/kjopek/Workspace/safe-bash';
const [label,mode,...values]=process.argv.slice(2);
if(!/^m\d{2}$/u.test(label))throw Error('label');
const fd=fs.openSync(home+'/'+label+'-RAW.json.gz.base64','wx',0o600),state={label,mode,started:new Date().toISOString(),closed:false};
const hash=(algorithm,body)=>createHash(algorithm).update(body).digest('hex');
try{
 let specs=values;
 if(values.length===1&&/^@m\d{2}-SPECS.json$/u.test(values[0])){const file=home+'/'+values[0].slice(1),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('spec admission');specs=JSON.parse(fs.readFileSync(file));}
 if(!Array.isArray(specs)||specs.length>256||specs.some(value=>typeof value!=='string'||/[\0\r\n]/u.test(value)||value.endsWith('AGENTS.md')))throw Error('specs');
 let args;
 if(mode==='resolve'){if(specs.some(value=>!/^\w{8,40}$/u.test(value)))throw Error('revision');args=['rev-parse','--verify',...specs.map(value=>value+'^{commit}')];}
 else if(mode==='tree'){if(specs.length!==2||!/^\w{8,40}$/u.test(specs[0]))throw Error('tree');args=['ls-tree','-rlz','--full-tree',specs[0],'--',specs[1]];}
 else if(mode==='blobs'){if(specs.some(value=>!/^([a-f0-9]{8,40})(?::[^\0\r\n]+)?$/u.test(value)))throw Error('blob');args=['cat-file','--batch'];}
 else throw Error('mode');
 state.args=args;
 const result=spawnSync('/usr/bin/git',args,{cwd:root,env:{PATH:'/usr/bin:/bin',HOME:home,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_OPTIONAL_LOCKS:'0'},input:mode==='blobs'?specs.join('\n')+'\n':undefined,maxBuffer:16777216,timeout:30000});
 Object.assign(state,{pid:result.pid,code:result.status,signal:result.signal,closed:result.status!==null,stdout:result.stdout?.toString('base64'),stderr:result.stderr?.toString('base64'),captureBytes:(result.stdout?.length??0)+(result.stderr?.length??0)});
 if(result.error||result.status!==0||result.signal)throw Error('metadata failure/retirement STOP');
 if(mode==='tree'){const inventory=result.stdout.toString().split('\0').filter(Boolean).map(record=>{const match=/^(\d+) (\w+) ([a-f0-9]{40})\s+(\d+|-)\t([\s\S]+)$/u.exec(record);if(!match)throw Error('tree framing');return{mode:match[1],kind:match[2],oid:match[3],bytes:Number(match[4]),path:match[5]};});fs.writeFileSync(home+'/'+label+'-INVENTORY.json',JSON.stringify(inventory,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({label,entries:inventory.length,bytes:result.stdout.length}));}
 else if(mode==='blobs'){const bytes=result.stdout,rows=[];let offset=0;for(const spec of specs){const end=bytes.indexOf(10,offset),match=/^([a-f0-9]{40}) blob (\d+)$/u.exec(bytes.subarray(offset,end).toString());if(!match)throw Error('blob header '+spec);const size=Number(match[2]);if(size>12582912)throw Error('blob cap');const body=bytes.subarray(end+1,end+1+size);if(body.length!==size||bytes[end+1+size]!==10||hash('sha1',Buffer.concat([Buffer.from('blob '+size+'\0'),body]))!==match[1])throw Error('blob integrity');rows.push({spec,oid:match[1],bytes:size,sha256:hash('sha256',body),body:body.toString('base64')});offset=end+2+size;}if(offset!==bytes.length)throw Error('trailing');fs.writeFileSync(home+'/'+label+'-INPUTS.json.gz.base64',gzipSync(Buffer.from(JSON.stringify(rows))).toString('base64')+'\n',{flag:'wx'});console.log(JSON.stringify({label,rows:rows.length,bytes:rows.reduce((sum,row)=>sum+row.bytes,0)}));}
 else console.log(result.stdout.toString());
}catch(error){state.failure={message:error.message};process.exitCode=1;}
finally{state.finished=new Date().toISOString();fs.writeFileSync(fd,gzipSync(Buffer.from(JSON.stringify(state))).toString('base64')+'\n');fs.closeSync(fd);}
