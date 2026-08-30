import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const own='/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/preexec-v1/actual-v2';
const output=own+'/inspection-v1';
let totalBytes=0;
const pins=[];
function read(filename,expected){
  const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)throw Error('INSPECTION_TYPE_SIZE '+filename);
  if(expected&&(expected.bytes!==stat.size||expected.mode!==(stat.mode&4095)))throw Error('BOUND_METADATA');
  totalBytes+=stat.size;if(totalBytes>8388608)throw Error('TOTAL_READ_BOUND');
  const bytes=fs.readFileSync(filename),sha256=createHash('sha256').update(bytes).digest('hex');
  if(bytes.length!==stat.size||expected&&expected.sha256!==sha256)throw Error('BOUND_BYTES');
  pins.push({path:filename,bytes:bytes.length,mode:stat.mode&4095,sha256});return bytes;
}
const publicationBytes=read('/private/tmp/safe-bash-pipestatus-actual-v2-publication.stdout');
const resultBytes=read(own+'/RESULT.json');
const result=JSON.parse(resultBytes),publication=publicationBytes.toString('utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
const summary=publication.find(row=>row.receiptSha256),commit=publication.find(row=>row.role==='git-commit'),terminal=publication.at(-1);
if(!summary||summary.receiptSha256!==pins[1].sha256||!commit||commit.status!==0||commit.signal!==null)throw Error('PUBLICATION_RESULT_BINDING');
const matched=commit.stdout.match(/^\[[^ \n]+ ([a-f0-9]{40})\]/m);if(!matched)throw Error('COMMIT_IDENTITY');
const layouts={};
for(const [name,row] of Object.entries(result.layouts)){const passed=row.ids.filter(item=>item.pass===true).length,failed=row.ids.filter(item=>item.pass===false).length;if(passed!==row.pass||failed!==row.fail||passed+failed!==row.ids.length)throw Error('LAYOUT_COUNTS');layouts[name]={PASS:passed,FAIL:failed,UNRUN:26-row.ids.length,failures:row.ids.filter(item=>!item.pass).map(item=>item.id)};}
const cells=[];
for(const failure of result.failures.slice(0,6)){
  const filename='/private/tmp/safe-bash-pipestatus-actual-78-v1/capture/'+failure.layout+'-'+failure.id+'.json';
  const bound=result.rawInventory.find(row=>row.path===filename);if(!bound)throw Error('UNBOUND_CELL');
  const cell=JSON.parse(read(filename,bound));if(cell.receipt.id!==failure.id||cell.receipt.layout!==failure.layout||cell.receipt.pass!==false)throw Error('CELL_IDENTITY');
  cells.push({id:failure.id,layout:failure.layout,receipt:cell.receipt,lifecycle:{pid:cell.lifecycle.pid,status:cell.lifecycle.status,qualified:cell.lifecycle.qualified,knownOutstanding:cell.lifecycle.knownOutstanding,exit:cell.lifecycle.exit,close:cell.lifecycle.close,stdoutEOF:cell.lifecycle.stdoutEOF,stderrEOF:cell.lifecycle.stderrEOF},trace:cell.trace});
}
const inspected={kind:'READ_ONLY_DATA_INSPECTION_NO_RERUN',actualCommit:matched[1],actualReceiptSha256:pins[1].sha256,actualStatus:result.status,layouts,failures:result.failures,directlyBoundCells:cells,totalCells:result.actualCells,retirement:{retired:result.retired,outerQualified:result.outerQualified,innerChildren:result.childQualifications.length,qualifiedInner:result.childQualifications.filter(row=>row.qualified).length,closedInner:result.childQualifications.filter(row=>row.exit&&row.close&&row.stdoutEOF&&row.stderrEOF&&row.knownOutstanding===0).length,forced:result.childQualifications.filter(row=>row.forced).length,publicationTerminal:terminal},calls:{plannedExec:result.plannedPublicExecCalls,plannedInvoke:result.plannedContextInvokes,qualification:result.callCensusQualification},grant:result.grant,sourceOnly:result.sourceOnly,pins,totalBytes,classification:'Assertion reasons and directly bound cell captures are observations. No new production/fixture source was read, so this DATA audit does not independently assign root cause to product versus fixture.',newRuntimeExecutions:0};
fs.writeFileSync(output+'/INSPECTION.json',JSON.stringify(inspected,null,2)+'\n',{flag:'wx'});
const digest=createHash('sha256').update(fs.readFileSync(output+'/INSPECTION.json')).digest('hex');
console.log(JSON.stringify({actualCommit:inspected.actualCommit,actualReceiptSha256:inspected.actualReceiptSha256,inspectionSha256:digest,status:result.status,layouts,failures:result.failures,retirement:inspected.retirement,calls:inspected.calls,totalBytes,directCells:cells.length,grantTimes:{started:result.grant.started,deadline:result.grant.deadline}}));
