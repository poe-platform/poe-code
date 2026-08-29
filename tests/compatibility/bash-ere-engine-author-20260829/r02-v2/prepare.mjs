import {open,lstat,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const own=dirname(fileURLToPath(import.meta.url)),author=dirname(own),repo=resolve(own,'../../../..');
const outer=await open(join(own,'PREPARE.outer.jsonl'),'wx');
await outer.write(JSON.stringify({start:new Date().toISOString(),pid:process.pid,productExecution:false})+'\n');
try {
  const bindings=[];
  async function text(path) {
    const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)throw new Error('text admission');
    const bytes=await readFile(path);bindings.push({path,size:bytes.length,mode:stat.mode&511,sha256:createHash('sha256').update(bytes).digest('hex')});return bytes.toString('utf8');
  }
  const oldSeal=JSON.parse(await text(join(author,'r02-v1/SEAL.json')));
  let runner=await text(join(author,'r02-v1/runner.mjs'));
  if(createHash('sha256').update(runner).digest('hex')!==oldSeal.harness.find(entry=>entry.path.endsWith('/runner.mjs')).sha256)throw new Error('template binding');
  const transforms=[];
  function replace(before,after,count=1){const actual=runner.split(before).length-1;if(actual!==count)throw new Error(`exact transform count ${actual}/${count}: ${before}`);runner=runner.split(before).join(after);transforms.push({before,after,count});}
  replace('(mode === \'seal\' ? 10 : 35)', '(mode === \'seal\' ? 10 : 25)');
  replace('128 * 1024 * 1024) { failure', '96 * 1024 * 1024) { failure');
  replace("join(author, 'SEAL-v3.json')", "join(author, 'r02-v1/SEAL.json')");
  replace("join(author, 'ACTUAL-03/work/source'", "join(author, 'r02-v1/ACTUAL-01/work/source'");
  replace("['matcher.ts','syntax.ts'].includes", "['syntax.ts'].includes");
  replace('previous.inputs.find', 'previous.fixtures.find');
  replace("join(author, 'ACTUAL-03/RESULT.json')", "join(author, 'r02-v1/ACTUAL-01/RESULT.json')");
  replace("['runner.mjs','checkpoints.mjs','RECIPE.md']", "['runner.mjs','checkpoints.mjs','empty.mjs','RECIPE.md']");
  replace("engineBaseline: 'f97fd06024cb63edfd01873d81d84576a22189db'", "engineBaseline: '0e97500f41be479e4a266037b03230ab5118d300'");
  replace("expectedChildren: 19, caseGroups: { author: 66, targeted: 8, layouts: 3 }, deadlineMs: 2100000", "expectedChildren: 18, caseGroups: { author: 66, priorCheckpoints: 8, empty: 4, layouts: 3 }, deadlineMs: 1500000");
  replace("const script = target ? join(own, 'checkpoints.mjs') : join(author, 'suite.mjs');", "const script = target === 'empty' ? join(own, 'empty.mjs') : target ? join(own, 'checkpoints.mjs') : join(author, 'suite.mjs');");
  replace("await runCases(`${layout}-checkpoints8`,directory,true);", "await runCases(`${layout}-checkpoints8`,directory,true); await runCases(`${layout}-empty4`,directory,'empty');");
  const mutationStart=runner.indexOf('    const mutations = [');const mutationEnd=runner.indexOf('    const mutants = [];',mutationStart);
  if(mutationStart<0||mutationEnd<0)throw new Error('mutation recipe boundaries');
  const prior=runner.slice(mutationStart,mutationEnd);
  replace(prior,"    const mutations = [\n      {id:'M01-empty',name:'syntax',start:'async function flatten(',oldStart:'async function flatten(',end:'\\nclass Parser',selection:'N01-empty-fragment-first-pass'},\n    ];\n");
  replace('runCases(spec.id,emitted,true,spec.selection,spec.name)',"runCases(spec.id,emitted,'empty',spec.selection,spec.name)");
  replace('runCases(`${spec.id}-restore`,emitted,true,spec.selection)',"runCases(`${spec.id}-restore`,emitted,'empty',spec.selection)");
  const novelPath=join(repo,'tests/compatibility/bash-ere-checkpoint-independent-20260829/novel.mjs');
  const novel=await text(novelPath);const inspections=JSON.parse(await text(join(own,'INSPECTION.json')));
  if(bindings.find(entry=>entry.path===novelPath).sha256!==inspections.find(entry=>entry.path===novelPath).sha256)throw new Error('N01 source drift');
  const boundary=novel.indexOf("await check('N02-bulk-work-checkpoint'");if(boundary<0)throw new Error('N01 boundary');
  let empty=novel.slice(0,boundary).replace('async function check(id, body) {',"async function check(id, body) {\n  if (process.argv[3] !== 'all' && process.argv[3] !== id) return;");
  empty+=await text(join(own,'extra-cases.mjs.txt'));
  empty+="console.log(JSON.stringify({ event: 'results', rows, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length }));\nif (rows.length === 0 || rows.some(row => !row.pass)) process.exitCode = 1;\n";
  const checkpoints=await text(join(author,'r02-v1/checkpoints.mjs'));
  if(createHash('sha256').update(checkpoints).digest('hex')!==oldSeal.harness.find(entry=>entry.path.endsWith('/checkpoints.mjs')).sha256)throw new Error('checkpoint fixture binding');
  let patch='*** Begin Patch\n';
  for(const [name,content] of [['runner.mjs',runner],['empty.mjs',empty],['checkpoints.mjs',checkpoints]]){
    if(!content.endsWith('\n'))throw new Error('fixture terminal LF');
    patch+=`*** Add File: ${join(own,name)}\n`+content.slice(0,-1).split('\n').map(line=>'+'+line).join('\n')+'\n';
  }
  patch+='*** End Patch\n';
  const applied=spawnSync('apply_patch',[],{input:patch,encoding:'utf8',timeout:30000,maxBuffer:1048576});
  await writeFile(join(own,'apply.stdout'),applied.stdout??'',{flag:'wx'});await writeFile(join(own,'apply.stderr'),applied.stderr??'',{flag:'wx'});
  await outer.write(JSON.stringify({role:'apply_patch',pid:applied.pid,status:applied.status,signal:applied.signal,error:applied.error?.message})+'\n');
  if(applied.status!==0||applied.signal||applied.error)throw new Error('preparation patch failed');
  await writeFile(join(own,'TRANSFORMS.json'),JSON.stringify({bindings,transforms,N01bodyUnchanged:true,previousCheckpointBytesUnchanged:true},null,2)+'\n',{flag:'wx'});
}catch(error){await outer.write(JSON.stringify({failure:String(error?.stack??error)})+'\n');process.exitCode=1;}finally{await outer.close();}
