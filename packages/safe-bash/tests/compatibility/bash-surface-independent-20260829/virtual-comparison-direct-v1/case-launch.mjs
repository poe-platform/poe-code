import fs from 'node:fs';
import {readPinned,hash} from './auth.mjs';
import {PROFILE,caseArguments,validateArguments,completion} from './profile.mjs';
import {runDirect} from './direct-child.mjs';
export async function launchProductCase(spec,ledger) {
  const closure=JSON.parse(readPinned(spec.closurePath,spec.closurePin,2097152));
  if(closure.decision!=='ACCEPT'||closure.candidate!=='bf079ada185a79aec864b068f3738ddc5520822e'||closure.identityKind!=='DERIVED_COMPOSITION_NOT_GIT_OBJECT'||closure.profile!==PROFILE||!spec.rootGrant||spec.rootGrant.decision!=='GO'||spec.rootGrant.closureSha256!==spec.closurePin.sha256)throw Error('PRODUCT_CLOSURE_OR_GRANT_HOLD');
  if(spec.role.kind!=='product-case')throw Error('PRODUCT_ROLE');
  for(const [filename,pin]of Object.entries(spec.role.files))readPinned(filename,pin);
  const roleBytes=readPinned(spec.role.rolePath,spec.rolePin,2097152);
  if(JSON.stringify(JSON.parse(roleBytes))!==JSON.stringify(spec.role))throw Error('ROLE_OBJECT_BINDING');
  const env={HOME:spec.home,TMPDIR:spec.tmp,PATH:spec.emptyPath,LC_ALL:'C',LANG:'C',TZ:'UTC',SURFACE_ROLE:spec.role.rolePath,SURFACE_ROLE_BYTES:String(roleBytes.length),SURFACE_ROLE_SHA256:hash(roleBytes)};
  const args=caseArguments(spec.role);validateArguments(spec.role,args,env);
  const result=await runDirect({...spec,args,env,cwd:spec.role.app,id:spec.role.id,timeoutMs:8000},ledger);
  if(!result.row.qualified||result.row.status!==0)throw Error('PRODUCT_DIRECT_CHILD_UNQUALIFIED');
  const output=result.row.captures.find(capture=>capture.kind==='stdout');
  const receipt=JSON.parse(Buffer.from(output.base64,'base64'));
  if(!completion(receipt,result.row)||receipt.caseId!==spec.role.caseId||receipt.layout!==spec.role.layout)throw Error('PRODUCT_PUBLIC_SETTLEMENT_RECEIPT');
  const traceStat=fs.lstatSync(spec.role.trace);if(!traceStat.isFile()||traceStat.isSymbolicLink()||traceStat.size>524288)throw Error('PRODUCT_TRACE_TYPE_SIZE');
  const trace=fs.readFileSync(spec.role.trace);ledger.captureBytes+=trace.length;if(ledger.captureBytes>ledger.captureMaximum)throw Error('PRODUCT_TRACE_CAPTURE_LIMIT');
  const rows=trace.toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  if(rows.filter(row=>row.event==='permission-admitted').length!==1||rows.filter(row=>row.event==='synchronous-hooks-installed').length!==1||rows.some(row=>row.profile!==PROFILE||row.role!==spec.role.id))throw Error('PRODUCT_TRACE_AUTHORITY');
  return {receipt,lifecycle:result.row,loadTrace:{bytes:trace.length,sha256:hash(trace),base64:trace.toString('base64')},qualification:'Public exec/dispose settlement contract and direct-child observations, no private job census/group absence/OS containment'};
}
