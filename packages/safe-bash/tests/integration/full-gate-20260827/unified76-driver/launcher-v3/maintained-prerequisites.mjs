import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,chownSync,copyFileSync,lstatSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readHistoricalEligibility} from './historical-eligibility.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const privateRoot='/Users/kjopek/Workspace/poe-code';
export const SETUP_STAGES=Object.freeze(['authorities','metadata','stageMetadata','archive','group','bytes','privateBefore','privateCopy','privateAfter']);
export const AUTHORITY_FILES=Object.freeze(['tests/commands/metadata-stress/canonical-env/runner.mjs','tests/plugins/qualified-current-release/prerequisites.mjs']);
export function createPrerequisiteReceipt(){return{capturedAt:new Date().toISOString(),native:{},assets:[],safejs:{},completedStages:[]};}

export async function runPrerequisiteStages(input,stages,receipt=createPrerequisiteReceipt()){
  assert.deepEqual(Object.keys(stages).sort(),[...SETUP_STAGES].sort(),'exact mandatory stage set');
  assert.deepEqual(input.historicalEligibility,readHistoricalEligibility(),'historical admission must authenticate before setup');
  assert.deepEqual(receipt.completedStages,[]);assert.deepEqual(receipt.native,{});assert.deepEqual(receipt.assets,[]);assert.deepEqual(receipt.safejs,{});
  receipt.historicalEligibility=input.historicalEligibility;
  const complete=name=>receipt.completedStages.push(name);
  receipt.authorities=await stages.authorities();complete('authorities');
  receipt.native.metadata=await stages.metadata();assert.deepEqual(receipt.native.metadata.issues,[],'mandatory metadata/table native profile unavailable');complete('metadata');
  receipt.assets=await stages.stageMetadata(receipt.native.metadata);complete('stageMetadata');
  receipt.native.archive=await stages.archive();assert.deepEqual(receipt.native.archive.issues,[],'mandatory archive native profile unavailable');complete('archive');
  receipt.native.group=await stages.group();validateFreshGroup(receipt.native.group,input.temporary);complete('group');
  receipt.native.bytes=await stages.bytes();complete('bytes');
  receipt.safejs.before=await stages.privateBefore();complete('privateBefore');
  Object.assign(receipt.safejs,await stages.privateCopy(receipt.safejs));complete('privateCopy');
  receipt.safejs.after=await stages.privateAfter();assert.deepEqual(receipt.safejs.after,receipt.safejs.before,'private state changed during read-only copy');complete('privateAfter');
  input.environment.SAFEJS_LOCAL_ROOT=receipt.safejs.copiedRoot;
  return receipt;
}

export function validateFreshGroup(profile,directory){
  assert.deepEqual(profile.issues,[],'fresh native group setup unavailable');
  assert.equal(profile.profile,'owned-group-only-v1');assert.equal(profile.probesExecuted,0);
  assert.ok(Number.isInteger(profile.uid)&&profile.uid>=0&&Number.isInteger(profile.gid)&&profile.gid>=0);
  assert.ok(Array.isArray(profile.groups)&&profile.groups.includes(profile.gid));
  for(const identity of [profile.parent,profile.before,profile.after]){
    assert.equal(identity.directory,true);assert.equal(identity.symlink,false);assert.equal(identity.uid,profile.uid);
  }
  assert.equal(profile.parent.path,directory);assert.equal(profile.before.path,join(directory,'native-tmp'));
  assert.equal(profile.after.path,profile.before.path);assert.equal(profile.before.mode,'700');assert.equal(profile.after.mode,'700');
  assert.ok(profile.groups.includes(profile.after.gid));
  assert.equal(profile.normalized,!profile.groups.includes(profile.before.gid));
  assert.equal(profile.after.gid,profile.normalized?profile.gid:profile.before.gid);
  assert.deepEqual(profile.acl.command,['/bin/ls','-lde',directory,join(directory,'native-tmp')]);
  assert.equal(profile.acl.status,0);assert.equal(profile.acl.signal,null);assert.equal(profile.acl.error,undefined);
  assert.equal(typeof profile.acl.stdout,'string');assert.equal(profile.acl.stderr,'');
  assert.equal(profile.TMPDIR,join(directory,'native-tmp'));
  return profile;
}

const filesystem={mkdirSync,lstatSync,chownSync};
export function prepareOwnedGroup({directory,root},operations={fs:filesystem,uid:()=>process.getuid(),gid:()=>process.getgid(),groups:()=>process.getgroups(),umask:()=>process.umask(),run:(command,args,cwd)=>{
  const result=spawnSync(command,args,{cwd,env:{PATH:`${dirname(process.execPath)}:/usr/bin:/bin`,LC_ALL:'C',LANG:'C',TZ:'UTC'},encoding:'utf8',timeout:5000,maxBuffer:65536});
  return{command:[command,...args],cwd,status:result.status,signal:result.signal,error:result.error?.message,stdout:result.stdout,stderr:result.stderr};
}}){
  const identity=path=>{const stat=operations.fs.lstatSync(path);return{path,uid:stat.uid,gid:stat.gid,mode:(stat.mode&0o7777).toString(8),directory:stat.isDirectory(),symlink:stat.isSymbolicLink()};};
  const temporary=join(directory,'native-tmp');
  operations.fs.mkdirSync(temporary,{mode:0o700});
  const profile={profile:'owned-group-only-v1',uid:operations.uid(),gid:operations.gid(),groups:operations.groups(),umask:operations.umask().toString(8),parent:identity(directory),before:identity(temporary),normalized:false,issues:[],probesExecuted:0};
  assert.equal(profile.before.uid,profile.uid,'only newly owned native temporary directory may normalize');
  assert.equal(profile.before.directory,true);assert.equal(profile.before.symlink,false);
  assert.equal(profile.parent.uid,profile.uid);assert.equal(profile.parent.directory,true);assert.equal(profile.parent.symlink,false);
  assert.ok(profile.groups.includes(profile.gid),'primary GID must be a member group');
  if(!profile.groups.includes(profile.before.gid)){operations.fs.chownSync(temporary,profile.uid,profile.gid);profile.normalized=true;}
  profile.after=identity(temporary);profile.acl=operations.run('/bin/ls',['-lde',directory,temporary],root);profile.TMPDIR=temporary;
  return validateFreshGroup(profile,directory);
}

export async function prerequisites(input){
  const {repository,source,temporary,environment,candidate,privateState,receipt}=input;
  let canonical,archives,primary;
  return runPrerequisiteStages(input,{
    async authorities(){
      const authorities=AUTHORITY_FILES.map(path=>{
        const expected=execFileSync('git',['--no-replace-objects','show',`${candidate}:${path}`],{cwd:repository});
        assert.equal(sha(readFileSync(join(source,path))),sha(expected),`native helper drift: ${path}`);
        return{path,sha256:sha(expected)};
      });
      canonical=await import(pathToFileURL(join(source,AUTHORITY_FILES[0])).href);
      archives=await import(pathToFileURL(join(source,AUTHORITY_FILES[1])).href);
      primary=join(repository,relative(source,canonical.oracleDirectory));return authorities;
    },
    metadata:()=>canonical.verifySetup({primary}),
    stageMetadata(metadata){
      return metadata.assets.filter(asset=>asset.path.startsWith(repository+'/')).map(asset=>{
        const target=join(source,relative(repository,asset.path));mkdirSync(dirname(target),{recursive:true});
        copyFileSync(asset.path,target);chmodSync(target,lstatSync(asset.path).mode&0o777);
        assert.equal(sha(readFileSync(target)),asset.sha256);return{source:asset.path,target,sha256:asset.sha256};
      });
    },
    archive:()=>archives.archiveSetup(join(repository,archives.tarRelative),repository),
    group(){
      const group=prepareOwnedGroup({directory:temporary,root:source});
      writeFileSync(join(temporary,'native-group-setup.json'),JSON.stringify(group,null,2)+'\n',{flag:'wx'});
      return group;
    },
    bytes(){
      const coreutils=dirname(canonical.benchmarkStat),byteRoot=join(temporary,'byte-oracles');mkdirSync(byteRoot);
      const identities=JSON.parse(readFileSync(join(source,'tests/commands/bytes-stress/gnu-evidence.json'))).identities;
      const results=Object.entries(identities).map(([name,identity])=>{
        const origin=name==='gzip'?join(dirname(dirname(coreutils)),'gzip-1.14/gzip'):join(coreutils,name);
        const target=join(byteRoot,name);assert.equal(sha(readFileSync(origin)),identity.sha256,`byte oracle identity: ${name}`);
        copyFileSync(origin,target);chmodSync(target,0o755);
        const version=spawnSync(target,['--version'],{env:environment,encoding:'utf8',timeout:5000,maxBuffer:65536});
        assert.equal(version.error,undefined);assert.equal(version.signal,null);assert.equal(version.status,0);assert.equal(version.stdout.split('\n')[0],identity.version);
        return{name,origin,target,sha256:identity.sha256,version:version.stdout.split('\n')[0]};
      });
      environment.BYTE_GNU_COREUTILS_DIR=byteRoot;environment.BYTE_GNU_GZIP=join(byteRoot,'gzip');return results;
    },
    privateBefore:()=>privateState(),
    privateCopy(progress){
      const engine=join(privateRoot,'packages/safejs'),copied=join(temporary,'safejs-engine'),files=[];
      progress.files=files;progress.copiedRoot=copied;
      function copy(directory,prefix=''){
        for(const name of readdirSync(directory).sort()){
          if(['node_modules','.git','dist','.cache','.turbo'].includes(name))continue;
          assert.doesNotMatch(name,/^agents\.md$/iu,'private instruction body copying forbidden');
          const origin=join(directory,name),path=join(prefix,name),stat=lstatSync(origin);
          assert.equal(stat.isSymbolicLink(),false,`private engine source link: ${path}`);
          if(stat.isDirectory())copy(origin,path);
          else{
            assert.ok(stat.isFile());const bytes=readFileSync(origin),target=join(copied,path);
            mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});chmodSync(target,stat.mode&0o777);
            assert.equal(sha(readFileSync(target)),sha(bytes));files.push({path,bytes:bytes.length,sha256:sha(bytes),mode:stat.mode&0o777});
          }
        }
      }
      copy(engine);return{files,treeSha256:sha(JSON.stringify(files)),copiedRoot:copied,package:JSON.parse(readFileSync(join(copied,'package.json'))),policy:'actual current engine regular-file copy; no private execution, writes, symlinks, build, install, proposal patch or mock runner; availability is not behavioral acceptance'};
    },
    privateAfter:()=>privateState(),
  },receipt);
}
