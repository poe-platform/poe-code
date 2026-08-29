import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireValue=value=>{if(!value)throw Error('DATA_REJECT');};
export function validate(original,audit,requests,protocol){
 requireValue(audit.cases.length===40&&requests.length===37&&original.cases.length===40);
 requireValue(JSON.stringify(audit.cases.map(row=>row.id))===JSON.stringify(original.cases.map(row=>row.id)));
 for(const row of audit.cases){const source=original.cases.find(item=>item.id===row.id);requireValue(source&&row.program===source.program&&row.programBase64===Buffer.from(source.program).toString('base64')&&row.programSha256===hash(Buffer.from(source.program))&&row.stdinBase64===Buffer.from(source.stdin??original.defaultStdin).toString('base64'));}
 requireValue(audit.fixtures.length===4);
 for(const fixture of audit.fixtures){requireValue(Object.hasOwn(original.fixtures,fixture.path)&&fixture.base64===Buffer.from(original.fixtures[fixture.path]).toString('base64')&&fixture.mode===384);}
 requireValue(JSON.stringify(requests.map(row=>row.id))===JSON.stringify(original.cases.filter(row=>!['B26','B27','B28'].includes(row.id)).map(row=>row.id)));
 for(const request of requests){const row=original.cases.find(item=>item.id===request.id),caseRoot=protocol.root+'/'+request.id;requireValue(JSON.stringify(request.argv)===JSON.stringify(['--noprofile','--norc','-c',row.program,'surface-case'])&&request.stdinBase64===Buffer.from(row.stdin??original.defaultStdin).toString('base64')&&request.executable==='/bin/bash'&&request.cwd===caseRoot+'/work'&&JSON.stringify(request.environment)===JSON.stringify({LC_ALL:'C',LANG:'C',TZ:'UTC',HOME:caseRoot+'/home',TMPDIR:caseRoot+'/tmp',PATH:caseRoot+'/empty-path'}));}
 requireValue(protocol.comparison.stdoutNormalization==='NONE'&&protocol.comparison.stderrNormalization==='NONE'&&protocol.comparison.statusNormalization==='NONE'&&protocol.osFence===false);
 return true;
}
