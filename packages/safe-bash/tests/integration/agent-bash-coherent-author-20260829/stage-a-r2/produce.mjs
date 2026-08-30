import {fs,path,assert,repo,scope,sha,oid,read,streamed,json,safe,inventory,supervisor} from './common.mjs';
import { gunzipSync } from 'node:zlib';
const started=new Date().toISOString();
let manager,work,productionBuilds=0;
try{
 const sealBytes=read(path.join(scope,'PRESEAL.json'),1048576);
 const receipt=JSON.parse(read(path.join(scope,'ACTIVATION.json'),65536));assert.equal(sha(sealBytes),receipt.presealSha256);assert.equal(sealBytes.length,receipt.presealBytes);assert.equal(receipt.scope,'STAGE_A_PRODUCER_ONLY');
 const seal=JSON.parse(sealBytes);
 for(const row of seal.inputs)read(path.join(scope,safe(row.path)),1048576,row);
 const source=JSON.parse(read(seal.source.path,1048576,seal.source));const tools=JSON.parse(read(seal.tools.path,1048576,seal.tools));
 await streamed(tools.node.path,tools.node);await streamed(tools.git.path,tools.git);assert.equal(process.execPath,tools.node.path);
 work=seal.workRoot;assert.ok(!fs.existsSync(work));assert.equal(fs.realpathSync(path.dirname(work)),path.dirname(work));fs.mkdirSync(work,{mode:448});assert.equal(fs.realpathSync(seal.aliasRoot),work);const physicalRootStat=fs.lstatSync(work),aliasRootStat=fs.statSync(seal.aliasRoot);assert.ok(physicalRootStat.isDirectory()&&!physicalRootStat.isSymbolicLink());assert.equal(aliasRootStat.dev,physicalRootStat.dev);assert.equal(aliasRootStat.ino,physicalRootStat.ino);json(path.join(work,'ROOT-IDENTITY.json'),{physical:work,alias:seal.aliasRoot,device:String(physicalRootStat.dev),inode:String(physicalRootStat.ino)});
 for(const name of ['source','tools','pack','capture','home','tmp','cache','empty-bin'])fs.mkdirSync(path.join(work,name),{mode:448});
 manager=supervisor(path.join(work,'capture'),seal.bounds.seconds);
 const plainEnv={PATH:path.join(work,'empty-bin'),HOME:path.join(work,'home'),TMPDIR:path.join(work,'tmp'),LANG:'C',LC_ALL:'C',TZ:'UTC',GIT_OPTIONAL_LOCKS:'0'};
 const git=async(args,input)=>{const result=await manager.run('git-metadata',tools.git.path,args,{cwd:repo,env:plainEnv,input,seconds:30});return read(result.stdout,16777216);};
 const metadata=(await git(['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],source.inputs.map(row=>row.blob).join('\n')+'\n')).toString().trimEnd().split('\n');
 assert.equal(metadata.length,source.inputs.length);
 metadata.forEach((line,index)=>assert.equal(line,`${source.inputs[index].blob} blob ${source.inputs[index].bytes}`));
 const totalSource=source.inputs.reduce((sum,row)=>sum+row.bytes+128,0);assert.ok(totalSource<16777216);
 let batch=await git(['cat-file','--batch'],source.inputs.map(row=>row.blob).join('\n')+'\n');assert.ok(batch.length<=totalSource);
 let cursor=0;
 for(const row of source.inputs){manager.remaining();safe(row.path);assert.equal(row.mode,'100644');const end=batch.indexOf(10,cursor);assert.equal(batch.subarray(cursor,end).toString(),`${row.blob} blob ${row.bytes}`);const body=batch.subarray(end+1,end+1+row.bytes);assert.equal(body.length,row.bytes);assert.equal(sha(body),row.sha256);assert.equal(oid(body),row.blob);assert.equal(batch[end+1+row.bytes],10);cursor=end+row.bytes+2;const destination=path.join(work,'source',row.path);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,body,{flag:'wx',mode:420});}
 assert.equal(cursor,batch.length);batch=undefined;
 const sourceInventory=inventory(path.join(work,'source'));assert.equal(sourceInventory.length,309);json(path.join(work,'SOURCE-BEFORE.json'),sourceInventory);
 const toolLinks={};
 for(const [name,pack]of Object.entries(tools.packages)){
  const destination=path.join(work,'tools',safe(name));fs.mkdirSync(destination,{recursive:true});
  for(const row of pack.rows){manager.remaining();safe(row.path);const target=path.join(destination,row.path);fs.mkdirSync(path.dirname(target),{recursive:true});if(row.type==='symlink'){safe(row.resolvedRelative);assert.equal(fs.readlinkSync(path.join(pack.resolvedRoot,row.path)),row.target);assert.equal(path.resolve(path.dirname(target),row.target),path.join(destination,row.resolvedRelative));fs.symlinkSync(row.target,target);toolLinks[name+'/'+row.path]=row.target;}else{assert.equal(row.type,'file');const bytes=read(path.join(pack.resolvedRoot,row.path),16777216,row);fs.writeFileSync(target,bytes,{flag:'wx',mode:row.mode});}}
 }
 const compilerModules=path.join(work,'source','node_modules');fs.mkdirSync(compilerModules);fs.mkdirSync(path.join(compilerModules,'@types'));
 for(const [name,pack]of Object.entries(tools.packages)){
  if(name==='npm')continue;const destination=path.join(compilerModules,name);fs.mkdirSync(destination,{recursive:true});
  for(const row of pack.rows){const bytes=read(path.join(work,'tools',name,row.path),16777216,row),target=path.join(destination,row.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx',mode:row.mode});}
 }
 const toolInventory=inventory(path.join(work,'tools'),toolLinks);json(path.join(work,'TOOLS-BEFORE.json'),toolInventory);
 const packageFile=path.join(work,'source','package.json');const packageRow=source.inputs.find(row=>row.path==='package.json');const packageBytes=read(packageFile,1048576,packageRow),manifest=JSON.parse(packageBytes);
 for(const hook of ['prepublish','prepare','prepublishOnly','prepack','postpack','publish','postpublish','preinstall','install','postinstall'])assert.ok(!Object.hasOwn(manifest.scripts??{},hook));assert.equal(Object.keys(manifest.dependencies??{}).length,0);assert.deepEqual(manifest.files,['dist']);
 const configs=['user.npmrc','global.npmrc'];for(const name of configs)fs.writeFileSync(path.join(work,name),'',{flag:'wx'});
 const env={...plainEnv,npm_config_userconfig:path.join(work,'user.npmrc'),npm_config_globalconfig:path.join(work,'global.npmrc'),npm_config_cache:path.join(work,'cache'),npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false',npm_config_update_notifier:'false',npm_config_ignore_scripts:'true',HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',NO_PROXY:'*'};
 const permissions=['--experimental-permission',`--allow-fs-read=${work}`,`--allow-fs-read=${tools.node.path}`,`--allow-fs-write=${work}`];
 assert.equal(productionBuilds++,0);
 await manager.run('strict-build',tools.node.path,[...permissions,path.join(work,'tools','typescript','lib','tsc.js'),'-p','tsconfig.build.json'],{cwd:path.join(work,'source'),env,seconds:120});
 const dist=inventory(path.join(work,'source','dist'));assert.equal(dist.length,1012);json(path.join(work,'EMITTED.json'),dist);
 const packResult=await manager.run('offline-pack',tools.node.path,[...permissions,path.join(work,'tools','npm','bin','npm-cli.js'),'pack','--json','--offline','--ignore-scripts','--pack-destination',path.join(work,'pack'),'--cache',path.join(work,'cache')],{cwd:path.join(work,'source'),env,seconds:120});
 const packFiles=fs.readdirSync(path.join(work,'pack'));assert.equal(packFiles.length,1);const packName=safe(packFiles[0]);assert.ok(packName.endsWith('.tgz')&&!packName.includes('/'));
 const packagePath=path.join(work,'pack',packName);const rawStat=fs.lstatSync(packagePath);assert.ok(rawStat.isFile()&&!rawStat.isSymbolicLink()&&rawStat.size<=seal.bounds.encodedPackageBytes);
 const packageIdentity=await streamed(packagePath);
 const outputReceipt={role:'NEW_TRUSTED_PRODUCER_OUTPUT_BEFORE_INFLATION',path:packagePath,...packageIdentity,sourceTree:seal.sourceTree,presealSha256:sha(sealBytes),productionBuilds,producerClosed:true,created:new Date().toISOString()};
 json(path.join(work,'PACKAGE-OUTPUT-RECEIPT.json'),outputReceipt);
 const raw=read(packagePath,seal.bounds.encodedPackageBytes,outputReceipt);
 manager.note({packageAdmittedBeforeInflate:true,bytes:raw.length,sha256:sha(raw)});
 const inflated=gunzipSync(raw,{maxOutputLength:seal.bounds.decodedPackageBytes,info:true});assert.equal(inflated.engine.bytesWritten,raw.length);const tar=inflated.buffer;
 assert.ok(raw.length+tar.length+16777216<=seal.bounds.simultaneousAccountedDataBuffers);
 const expected=new Map(dist.map(row=>['dist/'+row.path,row]));for(const name of ['README.md','package.json'])expected.set(name,source.inputs.find(row=>row.path===name));
 const members=[];let offset=0,pax={},ended=false;
 const text=(bytes)=>{const nul=bytes.indexOf(0);return bytes.subarray(0,nul===-1?bytes.length:nul).toString('utf8');};
 const octal=bytes=>{const value=text(bytes).trim();assert.ok(/^[0-7]*$/.test(value));const number=parseInt(value||'0',8);assert.ok(Number.isSafeInteger(number)&&number>=0);return number;};
 while(offset+512<=tar.length){manager.remaining();const header=tar.subarray(offset,offset+512);if(header.every(value=>value===0)){assert.ok(tar.subarray(offset).every(value=>value===0));ended=true;break;}const checksum=octal(header.subarray(148,156));let sum=0;for(let index=0;index<512;index++)sum+=index>=148&&index<156?32:header[index];assert.equal(sum,checksum);const size=octal(header.subarray(124,136));assert.ok(size<=16777216);const start=offset+512,end=start+size;assert.ok(end<=tar.length);const body=tar.subarray(start,end);const type=header[156];const prefix=text(header.subarray(345,500));let name=(prefix?prefix+'/':'')+text(header.subarray(0,100));offset=start+Math.ceil(size/512)*512;
  if(type===120){let position=0;pax={};while(position<body.length){const space=body.indexOf(32,position);assert.ok(space>position);const length=Number(body.subarray(position,space).toString());assert.ok(Number.isSafeInteger(length)&&length>0&&position+length<=body.length);const entry=body.subarray(space+1,position+length-1).toString();assert.equal(body[position+length-1],10);const equal=entry.indexOf('=');assert.ok(equal>0);pax[entry.slice(0,equal)]=entry.slice(equal+1);position+=length;}continue;}
  assert.ok(type===0||type===48,'nonregular package entry');assert.equal(text(header.subarray(157,257)),'');if(pax.path)name=pax.path;assert.ok(Object.keys(pax).every(key=>['path','mtime','atime','ctime','size','uid','gid','uname','gname'].includes(key)));if(pax.size)assert.equal(Number(pax.size),size);pax={};assert.ok(name.startsWith('package/'));const relative=safe(name.slice(8));assert.ok(!members.some(row=>row.path===relative));const target=expected.get(relative);assert.ok(target,'unexpected package member '+relative);assert.equal(size,target.bytes);assert.equal(sha(body),target.sha256);assert.equal(octal(header.subarray(100,108))&511,420);members.push({path:relative,bytes:size,sha256:sha(body),mode:420});
 }
 assert.ok(ended);assert.deepEqual(members.map(row=>row.path).sort(),seal.expectedMembers);
 json(path.join(work,'PACKAGE-MEMBERS.json'),members);
 const packReport=JSON.parse(read(packResult.stdout,1048576));assert.equal(packReport.length,1);assert.equal(packReport[0].filename,packName);assert.equal(packReport[0].entryCount,members.length);
 const after=inventory(path.join(work,'source'));for(const row of sourceInventory){const match=after.find(entry=>entry.path===row.path);assert.deepEqual(match,row);}assert.ok(after.every(row=>sourceInventory.some(item=>item.path===row.path)||row.path.startsWith('dist/')||row.path.startsWith('node_modules/')));
 assert.deepEqual(inventory(path.join(work,'tools'),toolLinks),toolInventory);
 const all=inventory(work,Object.fromEntries(Object.entries(toolLinks).map(([name,target])=>['tools/'+name,target])));const workingBytes=all.reduce((sum,row)=>sum+row.bytes,0);assert.ok(workingBytes<=seal.bounds.workingBytes);await streamed(packagePath,outputReceipt);
 const retirement=manager.finish();manager=undefined;
 const result={role:'STAGE_A_ONLY_NO_PRODUCT_ACCEPTANCE',started,finished:new Date().toISOString(),sourceTree:seal.sourceTree,sourceInputs:309,productionBuilds,emittedFiles:dist.length,package:outputReceipt,actualMembers:members.length,predictedMembers:1014,workingBytes,retirement,packageOutputBeforeInflation:true,sameBufferInflation:true,sourceAndToolPostguards:true,productImports:0,semanticCalls:0,consumerExecution:0,workers:0,stageB:'UNRUN_FRESH_GO_REQUIRED'};
 json(path.join(work,'RESULT.json'),result);json(path.join(scope,'RESULT.json'),result);console.log(JSON.stringify(result));
}catch(error){const failure={started,finished:new Date().toISOString(),work,productionBuilds,error:String(error?.stack??error),stageB:'UNRUN',automaticRetry:false};try{json(path.join(scope,'STOP.json'),failure);}catch{}console.error(JSON.stringify(failure));process.exitCode=78;}
