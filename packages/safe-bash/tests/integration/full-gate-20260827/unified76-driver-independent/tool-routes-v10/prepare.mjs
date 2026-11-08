import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream,readFileSync,writeFileSync,mkdirSync,mkdtempSync,realpathSync,lstatSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
const repository='/Users/kjopek/Workspace/safe-bash';
const owned=join(repository,'tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10');
const prefix='tests/integration/full-gate-20260827/unified76-driver/launcher-v3';
const source='fe15f1e406fa1039accddec25c696ae7187f6135',evidence='cdf2803ee6d7956556819be484e5b632dc407a0d';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function hashFile(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path,{highWaterMark:65536}))hash.update(chunk);return hash.digest('hex');}
assert.equal(await hashFile('/Applications/Xcode.app/Contents/Developer/usr/bin/git'),'10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9');
const environment={PATH:'/usr/bin:/bin',HOME:repository,LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'};
const git=args=>execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git',args,{cwd:repository,env:environment,timeout:30000,maxBuffer:16*1024*1024});
const blob=(commit,path)=>git(['show',`${commit}:${path}`]);
const seal=JSON.parse(blob(source,prefix+'/DRIVER.json'));
assert.equal(sha(JSON.stringify(seal)),'25ee4ded79df9c4fe0a9c8031721887dd7c8e22cb56f10d42b3d415eb30c0527');
const temporary=realpathSync(mkdtempSync('/tmp/unified76-independent-tool-v10-'));
const driver=join(temporary,'repository',prefix);mkdirSync(driver,{recursive:true});
const files={};
for(const name of ['DRIVER.json',...Object.keys(seal.files)]){
  assert.ok(!name.includes('/')&&!/agents\.md/iu.test(name));
  const bytes=blob(source,prefix+'/'+name);if(name!=='DRIVER.json')assert.equal(sha(bytes),seal.files[name]);
  writeFileSync(join(driver,name),bytes,{flag:'wx'});files[name]={sha256:sha(bytes),gitBlob:git(['rev-parse',`${source}:${prefix}/${name}`]).toString().trim(),bytes:bytes.length};
}
const prior={};
for(const path of git(['ls-files','-z','--','tests/integration/full-gate-20260827/unified76-driver-independent']).toString().split('\0').filter(path=>path&&!path.includes('/tool-routes-v10/')))prior[path]=await hashFile(join(repository,path));
const profile=JSON.parse(gunzipSync(Buffer.from(readFileSync(join(driver,'PROFILE.json.gz.base64'),'utf8').trim(),'base64')));
const external=JSON.parse(gunzipSync(Buffer.from(readFileSync(join(driver,'EXTERNAL.json.gz.base64'),'utf8').trim(),'base64')));
const routes=JSON.parse(readFileSync(join(driver,'TOOL-ROUTES.json')));
const checkedTools=[];for(const expected of [...external.tools,routes.inspector]){const stat=lstatSync(expected.physical);assert.equal(realpathSync(expected.origin),expected.physical);assert.ok(stat.isFile());assert.equal(stat.size,expected.bytes);assert.equal(stat.mode&0o777,expected.mode);assert.equal(await hashFile(expected.physical),expected.sha256);checkedTools.push(expected);}
const tools={};
for(const path of ['/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node','/usr/bin/sandbox-exec','/bin/sh','/usr/bin/tar','/Applications/Xcode.app/Contents/Developer/usr/bin/git','/bin/ps','/usr/bin/sw_vers',routes.inspector.origin]){
  const stat=lstatSync(path);tools[path]={realpath:realpathSync(path),sha256:await hashFile(path),bytes:stat.size,mode:stat.mode&0o777};
}
const packet=prefix+'/tool-routes-v1/HANDOFF-v2.md';
const result={recordedAt:new Date().toISOString(),source,evidence,candidate:seal.candidate,temporary,driver,normalizedDriverSha256:sha(JSON.stringify(seal)),files,packet:{path:packet,sha256:sha(blob(evidence,packet))},profileSha256:sha(JSON.stringify(profile)),projectionSha256:sha(JSON.stringify(JSON.parse(readFileSync(join(driver,'INSTRUCTION-PROJECTION.json'))))),externalReceipt:JSON.parse(readFileSync(join(driver,'EXTERNAL-RECEIPT.json'))),toolRoutes:routes,toolRoutesSha256:sha(JSON.stringify(routes)),preImportToolFiles:checkedTools,externalKeys:Object.keys(external),externalTools:external.tools,externalLinkage:external.linkage,tools,prior};
writeFileSync(join(owned,'BINDINGS.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({temporary,driver,normalizedDriverSha256:result.normalizedDriverSha256,profileSha256:result.profileSha256,projectionSha256:result.projectionSha256,externalKeys:result.externalKeys,priorFiles:Object.keys(prior).length,driverFiles:Object.keys(files).length}));
