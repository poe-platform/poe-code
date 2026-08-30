import assert from 'node:assert/strict';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sha, node24} from '../full-gate-20260827/unified76-driver/launcher-v3/common.mjs';
import {capture, compare} from '../full-gate-20260827/unified76-driver/launcher-v3/inventory.mjs';
import {supervise} from '../full-gate-20260827/unified76-driver/launcher-v3/supervise.mjs';
import {accountFile} from '../full-gate-20260827/unified76-driver/launcher-v3/tap.mjs';

const reportPath=resolve(process.argv[2]);
const author=JSON.parse(readFileSync(reportPath));
assert.equal(author.status,'AUTHOR_TIMEOUT78_PACKAGE_FOLLOWUP_PASS');
assert.equal(author.candidate,'67eab12e315054907ef4ef435c6bbca2f59e0c36');
assert.equal(sha(readFileSync(author.package.origin)),author.package.sha256);
const packageRoot=join(author.root,'moved consumer/node_modules/virtual-bash');
const before=await capture(packageRoot);
assert.deepEqual(compare(author.packageFiles,before),[]);
const root=realpathSync(mkdtempSync(join(tmpdir(),'timeout78-assertion-controls-')));
const environment={PATH:dirname(node24)+':/usr/bin:/bin',HOME:root,TMPDIR:root,LANG:'C',LC_ALL:'C',TZ:'UTC',NO_COLOR:'1'};
const result={createdAt:new Date().toISOString(),candidate:author.candidate,packageSha256:author.package.sha256,authorReportSha256:sha(readFileSync(reportPath)),root,commands:[],sourceMutants:false};
async function run(label,args,cwd,expected){
  const stdout=join(root,label+'.stdout'),stderr=join(root,label+'.stderr');
  const command=await supervise(node24,args,{cwd,env:environment,stdout,stderr,timeoutMs:30000,maxOutputBytes:1024*1024,observeSockets:true});
  const row={label,...command,expected,stdout,stderr,stdoutSha256:sha(readFileSync(stdout)),stderrSha256:sha(readFileSync(stderr))};
  if(args.includes('--test-reporter=tap'))row.accounting=await accountFile(stdout);
  result.commands.push(row);
  assert.equal(command.status,expected);assert.equal(command.signal,null);assert.equal(command.clean,true);assert.equal(command.closed,true);assert.deepEqual(command.survivors,[]);
  return row;
}
try{
  const script=`import assert from 'node:assert/strict';import test from 'node:test';import {CommandRegistry,agentCommands} from ${JSON.stringify(pathToFileURL(join(packageRoot,'dist/index.js')).href)};
const original={name:'timeout',execute:()=>({exitCode:7})},other={name:'other',execute:()=>({exitCode:8})};
const commands=new CommandRegistry([original,other]),before=commands.list();
const originalTimeout=before.find(row=>row.name==='timeout'),originalOther=before.find(row=>row.name==='other');
const host={commands,use(){throw Error('unexpected middleware');},registerFileSystem(){throw Error('unexpected filesystem');}};
agentCommands({replace:true}).setup(host);const after=new Map(commands.list().map(row=>[row.name,row]));
const check=entries=>{assert.notEqual(entries.get('timeout'),originalTimeout);assert.equal(entries.get('other'),originalOther);};
test('actual registered-entry replacement and preservation pass',()=>check(after));
test('no-op timeout replacement assertion mutant is rejected',()=>{const changed=new Map(after);changed.set('timeout',originalTimeout);assert.throws(()=>check(changed),{code:'ERR_ASSERTION'});});
test('unrelated-entry replacement assertion mutant is rejected',()=>{const changed=new Map(after);changed.set('other',Object.freeze({...originalOther}));assert.throws(()=>check(changed),{code:'ERR_ASSERTION'});});
test('old input-definition identity is not registry identity',()=>{assert.notEqual(originalOther,other);assert.equal(originalOther.execute,other.execute);assert.throws(()=>assert.equal(commands.get('other'),other),{code:'ERR_ASSERTION'});});
`;
  const scriptPath=join(root,'assertions.mjs');writeFileSync(scriptPath,script,{flag:'wx'});result.assertionScriptSha256=sha(script);
  const assertion=await run('assertions',['--permission',`--allow-fs-read=${root}`,`--allow-fs-read=${packageRoot}`,'--allow-worker','--unhandled-rejections=strict','--test-reporter=tap',scriptPath],root,0);
  assert.equal(assertion.accounting.reconciled,true);assert.deepEqual(assertion.accounting.counts,{pass:4,fail:0,skipped:0,todo:0,cancelled:0});
  for(const [label,key,specifier]of [['root','.', 'virtual-bash'],['timeout','./commands/timeout','virtual-bash/commands/timeout']]){
    const consumer=join(root,'denied-'+label),target=join(consumer,'node_modules/virtual-bash');mkdirSync(dirname(target),{recursive:true});cpSync(packageRoot,target,{recursive:true});
    writeFileSync(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}),{flag:'wx'});
    const path=join(target,'package.json'),manifest=JSON.parse(readFileSync(path));manifest.exports[key]=null;writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
    const denied=await run('denied-'+label,['--permission',`--allow-fs-read=${consumer}`,'--unhandled-rejections=strict','--input-type=module','-e',`await import(${JSON.stringify(specifier)})`],consumer,1);
    assert.match(readFileSync(denied.stderr,'utf8'),/ERR_PACKAGE_PATH_NOT_EXPORTED/u);
  }
  assert.deepEqual(compare(before,await capture(packageRoot)),[]);assert.equal(sha(readFileSync(author.package.origin)),author.package.sha256);
  result.status='PASS';
}catch(error){result.status='FAIL';result.error=error.stack;process.exitCode=1;}
finally{result.finishedAt=new Date().toISOString();writeFileSync(join(root,'REPORT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({root,status:result.status,commands:result.commands.map(row=>({label:row.label,status:row.status,clean:row.clean,counts:row.accounting?.counts})),error:result.error}));}
