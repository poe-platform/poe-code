import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {types} from 'node:util';
const home='/Users/kjopek/Workspace/safe-bash/tests/commands/node-author-20260829';
const root=home+'/validation-v2/preflight';const state=root+'/state';const rows=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(id,value)=>{rows.push({id,pass:value===true});if(value!==true)throw Error('preflight '+id);};
const read=file=>{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('preflight size');return fs.readFileSync(file);};
fs.mkdirSync(root);let primary;
try{
 fs.mkdirSync(state);fs.writeFileSync(state+'/data.txt','owned-v2\n',{flag:'wx',mode:0o600});check('P01',fs.existsSync(state+'/data.txt'));
 check('P02',read(state+'/data.txt').toString('utf8')==='owned-v2\n'&&fs.realpathSync(state)===state);
 const archive=gzipSync(Buffer.from(JSON.stringify({value:'owned-v2'})));fs.writeFileSync(state+'/archive.gz',archive,{flag:'wx',mode:0o600});const actual=read(state+'/archive.gz');check('P03',hash(actual)===hash(archive)&&gunzipSync(actual,{maxOutputLength:65536}).toString('utf8')==='{"value":"owned-v2"}');
 let denied=false;try{fs.readFileSync(home+'/ROOT-GRANT-v1.json');}catch(value){if(value!==null&&typeof value==='object'&&!types.isProxy(value)){const field=Object.getOwnPropertyDescriptor(value,'code');denied=!!field&&Object.hasOwn(field,'value')&&field.value==='ERR_ACCESS_DENIED';}}check('P04',denied);
 check('P05',process.permission.has('fs.write',home+'/validation-v1/forbidden-v2.txt')===false&&process.permission.has('fs.read',home+'/ROOT-GRANT-v1.json')===false);
 let reason;try{throw undefined;}catch(value){reason={present:true,value};}fs.writeFileSync(state+'/failure.json',JSON.stringify({present:reason.present,isUndefined:reason.value===undefined}),{flag:'wx',mode:0o600});const observed=JSON.parse(read(state+'/failure.json'));fs.rmSync(state,{recursive:true});check('P06',observed.present===true&&observed.isUndefined===true&&!fs.existsSync(state));
}catch(value){primary={present:true,isUndefined:value===undefined};}
const receipt={role:'node-author-permission-preflight-v2',rows,pass:rows.length===6&&rows.every(row=>row.pass)&&!primary,primary:primary??null,stateAbsent:!fs.existsSync(state)};fs.writeFileSync(root+'/RECEIPT.json',JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify(receipt)+'\n');process.exitCode=receipt.pass?0:1;
