import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const home=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(home,'../../..');
const [label,mode,...values]=process.argv.slice(2);
if(!/^m\d{2}$/u.test(label))throw Error('capture label');
const raw=fs.openSync(path.join(home,label+'-RAW.json.gz.base64'),'wx',0o600);
const state={label,mode,start:new Date().toISOString(),args:null,closed:false,stdout:null,stderr:null,error:null};
const hash=(algorithm,body)=>createHash(algorithm).update(body).digest('hex');
try{
 let specs=values;
 if(values.length===1&&/^@m\d{2}-SPECS.json$/u.test(values[0])){const filename=path.join(home,values[0].slice(1)),stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('spec admission');specs=JSON.parse(fs.readFileSync(filename,'utf8'));}
 if(!Array.isArray(specs)||specs.length>512||specs.some(value=>typeof value!=='string'||value.includes('\0')||value.includes('\n')||value.includes('\r')))throw Error('finite specs');
 let args;
 if(mode==='batch'){if(specs.some(value=>!/^([0-9a-f]{40})(?::[^\0\n\r]+)?$/u.test(value)||value.endsWith('AGENTS.md')))throw Error('immutable blob admission');args=['cat-file','--batch'];}
 else if(mode==='tree'){if(specs.length!==2||!/^[0-9a-f]{40}$/u.test(specs[0]))throw Error('tree admission');args=['ls-tree','-rz','--full-tree',specs[0],'--',specs[1]];}
 else if(mode==='resolve'){if(specs.length!==1||!/^[0-9a-f]{8,40}$/u.test(specs[0]))throw Error('stored revision admission');args=['rev-parse','--verify',specs[0]+'^{commit}'];}
 else if(mode==='status'){if(specs.length!==0)throw Error('status admission');args=['status','--porcelain=v1','-z','--',path.relative(root,home)];}
 else throw Error('mode admission');
 state.args=args;const result=spawnSync('/usr/bin/git',args,{cwd:root,env:{PATH:'/usr/bin:/bin',HOME:home,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'},input:mode==='batch'?specs.join('\n')+'\n':undefined,encoding:null,timeout:30000,maxBuffer:12582912});
 state.pid=result.pid;state.code=result.status;state.signal=result.signal;state.closed=result.status!==null;state.stdout=result.stdout?.toString('base64')??null;state.stderr=result.stderr?.toString('base64')??null;
 if(result.error){state.error={code:result.error.code,message:result.error.message};throw Error('metadata capture/retirement STOP');}if(result.status!==0||result.signal)throw Error('metadata exit STOP');
 const bytes=result.stdout;state.captureBytes=bytes.length+(result.stderr?.length??0);
 if(mode==='batch'){let offset=0;const rows=[];for(const spec of specs){const end=bytes.indexOf(10,offset);if(end<0)throw Error('batch header');const header=bytes.subarray(offset,end).toString('ascii'),match=/^([a-f0-9]{40}) blob (\d+)$/u.exec(header);if(!match)throw Error('blob lookup '+header);const size=Number(match[2]);if(!Number.isSafeInteger(size)||size>10485760)throw Error('blob size');const body=bytes.subarray(end+1,end+1+size);if(body.length!==size||bytes[end+1+size]!==10)throw Error('blob framing');if(hash('sha1',Buffer.concat([Buffer.from('blob '+size+'\0'),body]))!==match[1])throw Error('blob integrity STOP');rows.push({spec,oid:match[1],bytes:size,sha256:hash('sha256',body),body:body.toString('base64')});offset=end+2+size;}if(offset!==bytes.length)throw Error('trailing metadata');const compressed=gzipSync(Buffer.from(JSON.stringify(rows)));fs.writeFileSync(path.join(home,label+'-INPUTS.json.gz.base64'),compressed.toString('base64')+'\n',{flag:'wx'});console.log(JSON.stringify({label,rows:rows.length,bytes:rows.reduce((sum,row)=>sum+row.bytes,0),sha256:hash('sha256',compressed)}));}
 else if(mode==='tree'){const rows=bytes.toString('utf8').split('\0').filter(Boolean).map(record=>{const match=/^(\d+) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/u.exec(record);if(!match)throw Error('tree framing');return{mode:match[1],kind:match[2],oid:match[3],path:match[4]};});fs.writeFileSync(path.join(home,label+'-INVENTORY.json'),JSON.stringify(rows,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({label,rows:rows.length,bytes:bytes.length}));}
 else console.log(JSON.stringify({label,text:bytes.toString('utf8')}));
}catch(error){state.failure={message:error.message};process.exitCode=1;}
finally{state.end=new Date().toISOString();fs.writeFileSync(raw,gzipSync(Buffer.from(JSON.stringify(state))).toString('base64')+'\n');fs.closeSync(raw);}
