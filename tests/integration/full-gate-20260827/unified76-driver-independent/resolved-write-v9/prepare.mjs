import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,realpathSync,lstatSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
const repository='/Users/kjopek/Workspace/safe-bash';
const owned=join(repository,'tests/integration/full-gate-20260827/unified76-driver-independent/resolved-write-v9');
const prefix='tests/integration/full-gate-20260827/unified76-driver/launcher-v3';
const source='86038b27d1bee03333f13560e374ad407db417b8',evidence='62593a89afb0ee9db82341cf073229c555d3e2bc';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const environment={PATH:'/usr/bin:/bin',HOME:repository,LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'};
const git=args=>execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git',args,{cwd:repository,env:environment,timeout:30000,maxBuffer:16*1024*1024});
const blob=(commit,path)=>git(['show',`${commit}:${path}`]);
const seal=JSON.parse(blob(source,prefix+'/DRIVER.json'));
assert.equal(sha(JSON.stringify(seal)),'a99c9f24b9edee16ef959139b48905e943ee108080c0aa39511965103f32f26a');
const temporary=realpathSync(mkdtempSync('/tmp/unified76-independent-write-v9-'));
const driver=join(temporary,'repository',prefix);mkdirSync(driver,{recursive:true});
const files={};
for(const name of ['DRIVER.json',...Object.keys(seal.files)]){
  assert.ok(!name.includes('/')&&!/agents\.md/iu.test(name));
  const bytes=blob(source,prefix+'/'+name);if(name!=='DRIVER.json')assert.equal(sha(bytes),seal.files[name]);
  writeFileSync(join(driver,name),bytes,{flag:'wx'});files[name]={sha256:sha(bytes),gitBlob:git(['rev-parse',`${source}:${prefix}/${name}`]).toString().trim(),bytes:bytes.length};
}
const prior={};
for(const path of git(['ls-files','-z','--','tests/integration/full-gate-20260827/unified76-driver-independent']).toString().split('\0').filter(path=>path&&!path.includes('/resolved-write-v9/')))prior[path]=sha(readFileSync(join(repository,path)));
const profile=JSON.parse(gunzipSync(Buffer.from(readFileSync(join(driver,'PROFILE.json.gz.base64'),'utf8').trim(),'base64')));
const external=JSON.parse(gunzipSync(Buffer.from(readFileSync(join(driver,'EXTERNAL.json.gz.base64'),'utf8').trim(),'base64')));
const tools={};
for(const path of ['/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node','/usr/bin/sandbox-exec','/bin/sh','/usr/bin/tar','/Applications/Xcode.app/Contents/Developer/usr/bin/git','/bin/ps','/usr/bin/sw_vers','/usr/bin/otool']){
  const stat=lstatSync(path);tools[path]={realpath:realpathSync(path),sha256:sha(readFileSync(path)),bytes:stat.size,mode:stat.mode&0o777};
}
const packet=prefix+'/instruction-os-fence-v1/HANDOFF.md';
const result={recordedAt:new Date().toISOString(),source,evidence,additionalControls:'65bb898d17af8e674842e060ddd7ea61f91ff5bc',candidate:seal.candidate,temporary,driver,normalizedDriverSha256:sha(JSON.stringify(seal)),files,packet:{path:packet,sha256:sha(blob(evidence,packet))},profileSha256:sha(JSON.stringify(profile)),projectionSha256:sha(JSON.stringify(JSON.parse(readFileSync(join(driver,'INSTRUCTION-PROJECTION.json'))))),externalReceipt:JSON.parse(readFileSync(join(driver,'EXTERNAL-RECEIPT.json'))),externalKeys:Object.keys(external),externalTools:external.tools,externalLinkage:external.linkage,tools,prior};
writeFileSync(join(owned,'BINDINGS.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({temporary,driver,normalizedDriverSha256:result.normalizedDriverSha256,profileSha256:result.profileSha256,projectionSha256:result.projectionSha256,externalKeys:result.externalKeys,priorFiles:Object.keys(prior).length,driverFiles:Object.keys(files).length}));
