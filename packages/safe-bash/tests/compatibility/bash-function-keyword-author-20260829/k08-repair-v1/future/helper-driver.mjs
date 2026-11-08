import {pathToFileURL} from 'node:url';
export async function runHelperControls(role,data){
 const {prepareArithmetic}=await import(pathToFileURL(role.arithmeticEntry));
 const {evaluatePositionalArithmetic}=await import(pathToFileURL(role.helperEntry));
 const {ArrayLedger,ArrayOwner}=await import(pathToFileURL(role.ledgerEntry));
 const results=[];let ownedClosed=true;
 for(const row of data.helperControls.filter(item=>item.id!=='H09')){
  const variants=row.injectedCheckpointReasons??row.injectedReadReasons??[null];
  for(const variant of variants){
   const supplied=variant==='undefined'?undefined:variant==='null'?null:variant==='false'?false:variant==='Error'?Error('literal-helper-reason'):variant;
   const injecting=row.injectedCheckpointReasons!==undefined||row.injectedReadReasons!==undefined;
   const ledger=row.injectedReadReasons?new ArrayLedger(1048576,16384):undefined;
   const owner=ledger?ArrayOwner.create(ledger):undefined;const baseline=ledger?.snapshot();
   const reads=[];let prepared,bodyCalls=0,hasPrimary=false,primary,closed=false;
   const limitReason=Error('literal-maxExpansionBytes');
   const program=prepareArithmetic(row.source);
   try{
    evaluatePositionalArithmetic(program,{positional:row.positional??['3'],arg0:row.arg0??'0',maximumBytes:row.maximumBytes??1048576,owner,
     checkpoint(){if(row.injectedCheckpointReasons)throw supplied;},
     requireParameter(name){reads.push(name);if(row.injectedReadReasons)throw supplied;},limit(){throw limitReason;}
    },value=>{prepared=value;bodyCalls++;return 0n;});
   }catch(reason){hasPrimary=true;primary=reason;}
   const snapshot=ledger?.snapshot();
   const liveReleased=!baseline||baseline.used.slice(0,4).every((value,index)=>snapshot.used[index]===value);
   try{await owner?.close();closed=true;}catch{ownedClosed=false;}
   const failures=[];
   if(injecting){if(!hasPrimary||primary!==supplied||bodyCalls!==0)failures.push('raw-reason-or-body');}
   else if(row.expectedLimit){if(!hasPrimary||primary!==limitReason||bodyCalls!==0)failures.push('limit');}
   else if(row.expectedPrepared!==undefined){if(hasPrimary||prepared?.source!==row.expectedPrepared||bodyCalls!==1)failures.push('prepared-text');}
   else if(hasPrimary||prepared!==program||reads.length!==0||bodyCalls!==1)failures.push('unchanged-program');
   if(row.parameterReadNames&&JSON.stringify(reads)!==JSON.stringify(row.parameterReadNames))failures.push('read-count');
   if(!liveReleased||!closed)failures.push('owned-cleanup');
   results.push({id:row.id,variant,pass:failures.length===0,failures,hasPrimary,primaryKind:primary===null?'null':typeof primary,reasonIdentity:injecting?hasPrimary&&primary===supplied:undefined,bodyCalls,reads,preparedSource:prepared?.source,originalProgram:prepared===program,liveReleased,closed});
  }
 }
 return {pass:results.every(row=>row.pass),results,helperSettlement:{completed:true,ownedClosed,qualification:'private helper/data controls; not a public Shell invocation or private-job census'}};
}
