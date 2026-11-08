import {pathToFileURL} from 'node:url';
export function selectChild(child,publishReceipt){
 const selected={present:child.primary.present,reason:child.primary.reason,secondary:[]};
 const fail=reason=>{if(!selected.present){selected.present=true;selected.reason=reason;}else selected.secondary.push({present:true,reason});};
 if(!child.row.qualified&&!selected.present)fail(Error('TARGET_LIFECYCLE'));
 try{publishReceipt(child.row);}catch(reason){fail(reason);}
 return selected;
}
function epoch(value){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error('OUTER_TIME_TYPE');return value;}
export function inheritWindow(started,deadline,grant,limits,now){
 epoch(started);epoch(deadline);epoch(now);epoch(grant.expiresEpochMs);
 const expected=Math.min(started+limits.durationMs,grant.expiresEpochMs);
 if(!Number.isSafeInteger(expected)||deadline!==expected||now<started||now>=deadline)throw Error('OUTER_TIME_BINDING');
 return Object.freeze({started,finalDeadline:deadline,bodyDeadline:deadline-limits.finalizationTailMs,ownerPublicationDeadline:deadline-15000,collectorRetirementDeadline:deadline-6000});
}
export function admitCase(window,now,timeout=30000){epoch(now);if(now+timeout+3000>=window.bodyDeadline)throw Error('CHILD_CLEANUP_RESERVATION');return {bodyDeadline:Math.min(window.bodyDeadline,now+timeout),finalDeadline:window.finalDeadline};}
export function requireRetired(ledger){if(ledger.active!==0||ledger.rows.some(row=>row.knownOutstanding!==0||!row.exit||!row.close))throw Error('KNOWN_WORK_OUTSTANDING');return true;}
export function loadedHelper(rows,role){const expected=role.files[role.helperEntry],url=pathToFileURL(role.helperEntry).href;const matches=rows.filter(row=>row.event==='module-loaded'&&row.url===url);if(matches.length!==1||matches[0].role!==role.id||matches[0].bytes!==expected.bytes||matches[0].sha256!==expected.sha256)throw Error('HELPER_LOADED_BINDING');return {url,bytes:expected.bytes,sha256:expected.sha256,trace:matches[0]};}
export function m01Detected(baseline,mutant,expected){const receipt=mutant.receipt,observation=receipt.observation;return baseline?.receipt.pass===true&&receipt.pass===false&&JSON.stringify(receipt.failures)===JSON.stringify(['status','stdout','stderr'])&&observation?.kind==='resolved'&&observation.status===1&&observation.stdout?.base64===''&&observation.stderr?.base64===expected.stderrBase64&&observation.hasPrimary===false&&observation.hasCleanupError===false&&JSON.stringify(observation.filesBefore)===JSON.stringify(observation.filesAfter)&&receipt.publicSettlement?.execObserved===true&&receipt.publicSettlement?.disposeSettled===true&&mutant.helperLoad?.sha256===expected.mutantSha256&&baseline.helperLoad?.sha256===expected.baselineSha256;}
export function ownerOutcome(result,summary,expected){
 if(!Number.isSafeInteger(result.finished)||result.finished<expected.started||summary.publicationSucceeded!==true||summary.primaryPresent!==false||result.primaryPresent!==false||result.secondary.length||result.finished>=expected.finalDeadline||result.started!==expected.started)throw Error('OWNER_RESULT_QUALIFICATION');
 requireRetired(result.ledger);
 const ids=result.observations.map(row=>row.id),helpers=result.helpers.map(row=>row.id),mutants=result.mutants.map(row=>row.mutation.id),refusals=result.refusals.map(row=>row.id);
 for(const [actual,wanted]of [[ids,expected.observations],[helpers,expected.helpers],[mutants,['M01','M02','M03']],[refusals,['N01','N02']]])if(JSON.stringify(actual)!==JSON.stringify(wanted))throw Error('OWNER_RESULT_MEMBERSHIP');
 const allIds=[...ids,...helpers,...mutants,...refusals];if(result.ledger.starts!==78||result.ledger.rows.length!==77||new Set(allIds).size!==77||result.ledger.rows.some(row=>!row.qualified)||JSON.stringify([...result.ledger.rows.map(row=>row.id)].sort())!==JSON.stringify([...allIds].sort()))throw Error('OWNER_ROLE_MEMBERSHIP');
 const failures=result.observations.filter(row=>!row.receipt.pass).length+result.helpers.filter(row=>!row.receipt.pass).length+result.mutants.filter(row=>!row.detected).length+result.refusals.filter(row=>!row.observed).length;
 const status=failures?'COMPLETED_WITH_ASSERTION_FAILURES':'COMPLETED';if(result.status!==status||summary.resultStatus!==status||result.semanticFailures+result.controlFailures!==failures)throw Error('OWNER_RESULT_STATUS');return {status,failures,accepted:failures===0,knownOwnedRetired:true};
}
