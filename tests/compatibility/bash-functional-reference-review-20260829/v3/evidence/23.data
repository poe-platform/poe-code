import assert from 'node:assert/strict';
import {Storage} from './storage.mjs';
import {creditObservation} from './state.mjs';
const eligible=()=>({id:'DATA',exit:true,close:true,group:{state:'absent'},signal:null,stop:null,errors:[],capture:[{flush:true,size:true,hash:true,close:true},{flush:true,size:true,hash:true,close:true}],filesVerified:true,receiptPublished:true});
function fixture(now,changes={}){
 const clock={now},calls=[],primary=Error('FSYNC_SENTINEL'),secondary=Error('CLOSE_SENTINEL');
 let closeCount=0;
 const operations={
  openSync(filename,flags,mode){calls.push({op:'open',filename,flags,mode});if(changes.openLate)clock.now=101;return 7;},
  writeFileSync(descriptor,bytes){calls.push({op:'write',descriptor,base64:bytes.toString('base64')});},
  fsyncSync(descriptor){calls.push({op:'fsync',descriptor});if(changes.fsyncFailure)throw primary;},
  closeSync(descriptor){calls.push({op:'close',descriptor});closeCount++;if(changes.closeFailure&&closeCount===1)throw secondary;if(changes.closeLate)clock.now=101;}
 };
 const storage=new Storage('/DATA_ONLY',{deadline:100},{now:()=>clock.now,terminalOperations:operations});
 return {clock,calls,storage,primary,secondary};
}
const reason=callback=>{try{callback();return null;}catch(error){return error;}};
const stateView=storage=>storage.terminalState===null?null:{...storage.terminalState,primary:storage.terminalState.primary&&{phase:storage.terminalState.primary.phase,message:storage.terminalState.primary.error.message},secondary:storage.terminalState.secondary.map(item=>({phase:item.phase,message:item.error.message}))};
export function runDataControls(){
 const results=[];
 {
  const test=fixture(100),events=[];test.storage.record=value=>events.push(value);
  assert.equal(test.storage.terminal({event:'DATA'}),true);
  assert.equal(creditObservation(eligible(),test.storage,0),1);
  assert.deepEqual(test.calls.map(item=>item.op),['open','write','fsync','close']);
  assert.equal(test.storage.terminalState.qualified,true);assert.equal(test.storage.terminal({event:'SECOND'}),false);
  results.push({id:'D01',matched:true,calls:test.calls,events,completed:1,state:stateView(test.storage)});
 }
 {
  const test=fixture(101),events=[];test.storage.record=value=>events.push(value);let completed=0;
  assert.equal(reason(()=>test.storage.terminal({event:'DATA'})).message,'FINALIZATION_DEADLINE');
  assert.equal(reason(()=>{completed=creditObservation(eligible(),test.storage,completed);}).message,'FINALIZATION_DEADLINE');
  assert.deepEqual(test.calls,[]);assert.deepEqual(events,[]);assert.equal(completed,0);
  results.push({id:'D02',matched:true,calls:test.calls,events,completed,state:stateView(test.storage)});
 }
 {
  const test=fixture(100,{openLate:true});
  assert.equal(reason(()=>test.storage.terminal({event:'DATA'})).message,'FINALIZATION_DEADLINE');
  assert.deepEqual(test.calls.map(item=>item.op),['open','close']);assert.equal(test.storage.terminalState.qualified,false);assert.equal(test.storage.terminalState.closed,true);
  results.push({id:'D03',matched:true,calls:test.calls,state:stateView(test.storage)});
 }
 {
  const test=fixture(99,{fsyncFailure:true,closeFailure:true});
  assert.equal(reason(()=>test.storage.terminal({event:'DATA'})),test.primary);
  assert.equal(test.storage.terminalState.secondary[0].error,test.secondary);
  assert.equal(test.storage.terminalState.closed,true);assert.equal(test.storage.terminalState.qualified,false);
  assert.deepEqual(test.calls.map(item=>item.op),['open','write','fsync','close','close']);
  const row=eligible();row.errors.push(test.primary);let completed=0;test.storage.record=()=>assert.fail('NO_CREDIT_WRITE');
  assert.equal(reason(()=>{completed=creditObservation(row,test.storage,completed);}).message,'OBSERVATION_INELIGIBLE');assert.equal(completed,0);
  results.push({id:'D04',matched:true,calls:test.calls,state:stateView(test.storage),primaryIdentity:true,secondaryIdentity:true,completed});
 }
 {
  const test=fixture(99,{closeLate:true});
  assert.equal(reason(()=>test.storage.terminal({event:'DATA'})).message,'FINALIZATION_DEADLINE');
  assert.equal(test.storage.terminalState.qualified,false);assert.equal(test.storage.terminalState.closed,true);assert.equal(test.storage.terminalState.late,true);
  let completed=0;test.storage.record=()=>assert.fail('NO_LATE_CREDIT_WRITE');
  assert.equal(reason(()=>{completed=creditObservation(eligible(),test.storage,completed);}).message,'FINALIZATION_DEADLINE');assert.equal(completed,0);
  results.push({id:'D05',matched:true,calls:test.calls,state:stateView(test.storage),completed});
 }
 {
  const test=fixture(99),events=[];test.storage.record=value=>{events.push(value);test.clock.now=101;};let completed=0;
  assert.equal(reason(()=>{completed=creditObservation(eligible(),test.storage,completed);}).message,'FINALIZATION_DEADLINE');
  assert.equal(completed,0);assert.deepEqual(events,[{event:'OBSERVATION_READY_FOR_CREDIT',id:'DATA'}]);
  assert.equal(reason(()=>test.storage.terminal({event:'DATA'})).message,'FINALIZATION_DEADLINE');assert.deepEqual(test.calls,[]);
  results.push({id:'D06',matched:true,events,completed,calls:test.calls});
 }
 return {schema:'functional-reference-v3-data-results',identities:results,matched:results.length,actualChildStarts:0,entryImported:false,qualification:'SYNTHETIC_CLOCK_AND_IO_NOT_NATIVE_OR_LIFECYCLE_ACCEPTANCE'};
}
