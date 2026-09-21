import {native} from './native.js';
import {TerminalPilot} from './session-host.js';
export const SESSION_ENV_VAR='TERMINAL_PILOT_SESSION';
function admission(result){
 if(result!==null&&result.fault!==undefined){const fault=new Error(result.fault);fault.name='UserError';throw fault;}
 return result;
}
export function createTerminalPilotRuntime({launchPilot=TerminalPilot.launch}={}){
 const state=new native.NativeTerminalNames(),pending=new Set();
 let pilotPromise,closePromise;
 const getPilot=()=>pilotPromise??=(Promise.resolve().then(launchPilot).catch(error=>{pilotPromise=undefined;throw error;}));
 const requested=(name,env)=>admission(state.requestedName(name??env?.get(SESSION_ENV_VAR))).name??undefined;
 const runtime={
  async createSession(params,env){
   admission(state.validateCommand(params.command));
   const name=requested(params.session,env);
   const existing=name===undefined?undefined:state.idFor(name);
   if(existing!=null){
    const pilot=await getPilot();
    try{state.setActive(existing,pilot.getSession(existing).exitCode===null);}catch{state.setActive(existing,false);}
   }
   const reservation=admission(state.reserve(params.command,name));
   const task=(async()=>{
    const pilot=await getPilot();
    if(reservation.replaced!==null){try{pilot.deleteSession(reservation.replaced);}catch{}}
    const session=await pilot.newSession({command:params.command,args:params.args,cwd:params.cwd,cols:params.cols,rows:params.rows,observe:params.observe});
    admission(state.commit(reservation.name,session.id,session.exitCode===null));
    return{name:reservation.name,session};
   })();
   pending.add(task);
   try{return await task;}finally{pending.delete(task);state.release(reservation.name);}
  },
  async resolveSession(name,env){
   const requestedName=requested(name,env),pilot=await getPilot();
   state.synchronize(pilot.sessions().map(session=>session.id));
   const target=admission(state.resolve(requestedName));
   try{return{name:target.name,session:pilot.getSession(target.id)};}
   catch{state.forget(target.name,target.id);state.synchronize(pilot.sessions().map(session=>session.id));return admission(state.notFound(target.name));}
  },
  async closeSession(name,env){
   const named=await runtime.resolveSession(name,env),exitCode=await named.session.close(),pilot=await getPilot();
   pilot.deleteSession(named.session.id);state.forget(named.name,named.session.id);
   return{exitCode,name:named.name};
  },
  async listSessions(){
   const live=(await getPilot()).sessions(),ids=live.map(session=>session.id);
   state.synchronize(ids);const names=state.namesFor(ids);
   return live.flatMap((session,index)=>names[index]===null?[]:[{name:names[index],session}]);
  },
  async hasRetainedSessions(){return state.retained;},
  async close(){
   if(closePromise!==undefined)return closePromise;
   state.beginShutdown();
   closePromise=(async()=>{
    try{
     await Promise.allSettled([...pending]);
     if(pilotPromise!==undefined)await(await pilotPromise).close();
     pilotPromise=undefined;state.endShutdown(true);
    }catch(error){state.endShutdown(false);throw error;}
   })().finally(()=>{closePromise=undefined;});
   return closePromise;
  }
 };
 return runtime;
}
