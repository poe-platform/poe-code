import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {processes} from './supervise.mjs';

export function attachProcessObserver(child,token){
  assert.ok(child.pid&&child.connected);assert.match(token,/^[a-f0-9-]{36}$/u);
  const root=processes().find(row=>row.pid===child.pid);assert.ok(root,'observer must bind its actual owned target before requests');
  const groups=new Map(),events=[];let requests=0;
  function members(record){
    const rows=processes(),current=rows.find(row=>row.pid===record.pid);
    if(current)assert.equal(current.born,record.born,'owned process identity changed');
    return rows.filter(row=>row.group===record.group);
  }
  const onMessage=message=>{
    if(message?.kind!=='unified76-process-observer')return;
    let result;
    try{
      assert.ok(++requests<=4096,'observer request bound');assert.equal(message.token,token);
      const current=processes().find(row=>row.pid===root.pid);assert.ok(current&&current.born===root.born,'owned requester identity changed');
      if(message.action==='register'){
        assert.ok(Number.isSafeInteger(message.pid)&&message.pid>0);
        const row=processes().find(row=>row.pid===message.pid);assert.ok(row,'process must remain alive until observer admission');
        assert.equal(row.parent,child.pid,'observer accepts only actual direct children of its owned requester');
        assert.equal(row.group,row.pid,'transport child must own its detached group');
        const handle=randomUUID();groups.set(handle,row);result={handle,identity:row};
      }else{
        assert.equal(message.action,'members');const record=groups.get(message.handle);assert.ok(record,'unknown observation capability');
        result={identity:record,members:members(record)};
      }
      events.push({id:message.id,action:message.action,result});
      child.send({kind:'unified76-process-observer-reply',id:message.id,result},error=>{if(error)events.push({replyError:error.message});});
    }catch(error){events.push({id:message.id,action:message.action,error:error.message});if(child.connected)child.send({kind:'unified76-process-observer-reply',id:message.id,error:error.message},()=>{});}
  };
  child.on('message',onMessage);
  return{root,events,finish(){child.off('message',onMessage);const survivors=[...groups.values()].flatMap(members);return{root,groups:[...groups.values()],events,survivors,qualification:'Trusted outer read-only ps observer; exact requester PID/birth and admitted child PID/group/birth. No signals or target sandbox policy changes.'};}};
}

export function createObserverClient(token){
  assert.ok(process.connected&&typeof process.send==='function','explicit inherited observer channel required');
  const request=(action,fields)=>new Promise((resolve,reject)=>{
    const id=randomUUID();
    const timer=setTimeout(()=>finish(new Error('outer process observer deadline')),5000);
    const receive=message=>{if(message?.kind==='unified76-process-observer-reply'&&message.id===id)finish(message.error?new Error(message.error):undefined,message.result);};
    const disconnect=()=>finish(new Error('outer process observer disconnected'));
    function finish(error,value){clearTimeout(timer);process.off('message',receive);process.off('disconnect',disconnect);error?reject(error):resolve(value);}
    process.on('message',receive);process.once('disconnect',disconnect);
    process.send({kind:'unified76-process-observer',token,id,action,...fields},error=>{if(error)finish(error);});
  });
  return{register:pid=>request('register',{pid}),members:receipt=>request('members',{handle:receipt.handle}).then(result=>result.members)};
}
