import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
const base='44f00bf84278e3361b52106478d59c707ab7b2bc';
const git=(...args)=>execFileSync('git',['--no-replace-objects',...args]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const replacements=[
  ['tests/commands/split/integration.test.ts', [['contains 73 including','contains 76 including'],['createAgentCommands().length, 73','createAgentCommands().length, 76'],['shell.commands.list().length, 73','shell.commands.list().length, 76']]],
  ['tests/commands/stream-format-author-stress/contracts.test.ts',[['contains73 and standalone','contains76 and standalone'],['createAgentCommands().length, 73','createAgentCommands().length, 76'],['instance.commands.list().length, 73','instance.commands.list().length, 76']]],
  ['tests/integration/stream-inspection-public-author/public.test.ts',[['target.commands.list().length, 74','target.commands.list().length, 77',2]]],
  ['tests/plugins/stream-five-public/consumer.mjs',[['names.length, 70','names.length, 76'],['new Set(names).size, 70','new Set(names).size, 76'],['commands.list().length, 70','commands.list().length, 76']]],
];
const files=replacements.map(([path,changes])=>{const before=git('show',`${base}:${path}`);assert.deepEqual(readFileSync(path),before,'fixture changed before freeze');let after=before.toString();for(const[from,to,count=1]of changes){assert.equal(after.split(from).length-1,count,path+': '+from);after=after.replaceAll(from,to);}return{path,beforeSha256:sha(before),afterSha256:sha(after),beforeBlob:git('rev-parse',`${base}:${path}`).toString().trim(),replacements:changes};});
const controls=[
  'exact four-path delta accepted','missing fixture change rejected','extra fixture/product path rejected','wrong default/custom count rejected','removed assertion rejected','changed diagnostic/input rejected','dynamic self-derived expected rejected',
  'candidate absent reconstructed from reachable base plus four blobs','wrong raw commit rejected','wrong parent rejected','missing reachable fixture blob rejected','tree mismatch rejected',
  'unmodified admission accepted without suite','pending release cannot execute','unknown/duplicate flags rejected','wrong candidate or source rejected','missing input rejected','unexpected file rejected','unexpected directory rejected','modified input rejected','symlink/type substitution rejected','mode change rejected','missing native rejected','changed native rejected','wrong runtime rejected','wrong cleanup membership rejected','stale cleanup revision rejected','wrong package input rejected','unknown mts rejected','canonical omission rejected','source fallback rejected','TAP/concurrency before paths required','permission positive and exact denial required','phase order enforced','post-setup addition rejected','guard removal mutant detected','cleanup removal mutant detected','phase order mutant detected',
];
writeFileSync(new URL('./FREEZE.json',import.meta.url),JSON.stringify({schema:1,createdAt:new Date().toISOString(),base,preImplementationHead:git('rev-parse','HEAD').toString().trim(),scope:'author pre-implementation expectation/control freeze, not independent acceptance',files,controls,productExecutions:0,wholeGateLaunched:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({base,files:files.length,controls:controls.length}));
