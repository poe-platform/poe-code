import {createHash} from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
const expectedIds = Array.from({length:40},(_,index)=>'B'+String(index+1).padStart(2,'0')).filter(id=>!['B26','B27','B28'].includes(id));
const demand = (condition,code) => { if(!condition) throw Error(code); };
export function validateMatrix(matrix) {
 demand(matrix.candidate==='bf079ada185a79aec864b068f3738ddc5520822e','CANDIDATE');
 demand(JSON.stringify(matrix.cases.map(row=>row.id))===JSON.stringify(expectedIds),'MEMBERSHIP');
 demand(matrix.cases.length===37 && matrix.totalVirtualInvocations===111 && matrix.actualVirtualInvocations===0,'COUNT');
 demand(matrix.fixtures.length===4,'FIXTURES');
 const fixtureNames=['a.txt','b.txt','.hidden','source-fixture'];
 let fixtureBytes=0,programBytes=0;
 for(const [index,fixture] of matrix.fixtures.entries()) {
  demand(fixture.path===fixtureNames[index] && fixture.mode===384,'FIXTURE_PATH_MODE');
  const bytes=Buffer.from(fixture.base64,'base64');
  demand(bytes.toString('base64')===fixture.base64 && bytes.length===fixture.bytes && hash(bytes)===fixture.sha256,'FIXTURE_BYTES'); fixtureBytes+=bytes.length;
 }
 for(const row of matrix.cases) {
  const bytes=Buffer.from(row.program,'utf8'); programBytes+=bytes.length;
  demand(bytes.length===row.programBytes && bytes.toString('base64')===row.programBase64 && hash(bytes)===row.programSha256,'PROGRAM');
  demand(JSON.stringify(row.nativeInvocation.argv)===JSON.stringify(['--noprofile','--norc','-c',row.program,'surface-case']),'ARGV');
  const cwd='/private/tmp/safe-bash-surface-functional-v3-20260829-01/cases/'+row.id+'/work';
  demand(row.nativeInvocation.cwd===cwd && row.virtualInvocation.cwd===cwd,'CWD');
  demand(JSON.stringify(row.nativeInvocation.environment)===JSON.stringify(row.virtualInvocation.environment),'ENV');
  for(const name of ['stdout','stderr']) {
   const capture=row.nativeObservation[name],bytes=Buffer.from(capture.base64,'base64');
   demand(bytes.toString('base64')===capture.base64 && bytes.length===capture.bytes && hash(bytes)===capture.sha256,'NATIVE_BYTES');
  }
  demand(Number.isInteger(row.nativeObservation.status),'STATUS');
 }
 demand(fixtureBytes===43 && programBytes===2301,'TOTAL_BYTES');
 return {cases:37,fixtures:4,programBytes,fixtureBytes,virtualCalls:0};
}
export function compareRaw(expected,actual) {
 const bytesEqual=(name)=>Buffer.from(expected[name].base64,'base64').equals(Buffer.from(actual[name].base64,'base64'));
 const canonical=rows=>rows.map(row=>({path:row.path,type:row.type,mode:row.mode,...(row.base64!==undefined?{base64:row.base64}:{}),...(row.target!==undefined?{target:row.target}:{})})).sort((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path)));
 return {stdout:bytesEqual('stdout'),stderr:bytesEqual('stderr'),status:actual.kind==='resolved' && expected.status===actual.status,filesBefore:JSON.stringify(canonical(expected.filesBefore))===JSON.stringify(canonical(actual.filesBefore)),filesAfter:JSON.stringify(canonical(expected.filesAfter))===JSON.stringify(canonical(actual.filesAfter)),comparableSettlement:actual.kind==='resolved',normalization:'NONE'};
}
