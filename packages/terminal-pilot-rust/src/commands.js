import {native} from './native.js';
import {TerminalPilot} from './session-host.js';
export const SESSION_ENV_VAR='TERMINAL_PILOT_SESSION';
function admission(result){
 if(result!==null&&result.fault!==undefined){const fault=new Error(result.fault);fault.name=result.code===-32603?'ToolcraftBugError':'UserError';if(result.code!==undefined)fault.rpcCode=result.code;throw fault;}
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
let sharedRuntime;
export function getTerminalPilotRuntime(runtime){return runtime??(sharedRuntime??=createTerminalPilotRuntime());}
export async function closeSharedTerminalPilotRuntime(){if(sharedRuntime!==undefined){await sharedRuntime.close();sharedRuntime=undefined;}}
async function executeCommand(name,{params,env,terminalPilotRuntime}){
 const source=params??{},input=Object.create(Object.getPrototypeOf(source));
 for(const[key,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(source))){
  if(!descriptor.enumerable||(Object.hasOwn(descriptor,'value')&&descriptor.value===undefined))continue;
  Object.defineProperty(input,key,descriptor);
 }
 const plan=admission(native.terminalCommandPrepare(name,input));
 const runtime=getTerminalPilotRuntime(terminalPilotRuntime);
 let payload;
 if(plan.route==='create'){
  const named=await runtime.createSession(plan.args[0],env);payload={name:named.name,pid:named.session.pid};
 }else if(plan.route==='list'){
  payload={result:(await runtime.listSessions()).map(named=>({name:named.name,command:named.session.command,pid:named.session.pid}))};
 }else if(plan.route==='close'){
  payload={result:(await runtime.closeSession(plan.session??undefined,env)).exitCode};
 }else{
  const named=await runtime.resolveSession(plan.session??undefined,env),session=named.session;
  payload={name:named.name,pid:session.pid,command:session.command,exitCode:session.exitCode};
  if(plan.route==='session'){
   const args=plan.args.map(value=>value===null?undefined:value);
   if(plan.regexp===true)args[0]=new RegExp(args[0]);
   const result=await session[plan.method](...args);
   payload.exitCode=session.exitCode;
   if(plan.method==='screen')payload.result={lines:[...result.lines],cursor:{...result.cursor},size:{...result.size}};
   else if(result!==undefined)payload.result=result;
  }
 }
 const result=admission(native.terminalCommandFinish(name,payload,false));
 return native.terminalCommandReturnsValue(name)?result:undefined;
}
export function createTerminalPilotGroup(){
 const children=native.terminalCommandDefinitions().map(metadata=>{
  delete metadata.mcpResultSchema;
  return{...metadata,handler:context=>executeCommand(metadata.name,context)};
 });
 return{kind:'group',name:'terminal-pilot',aliases:[],scope:['cli','mcp','sdk'],secrets:{},children};
}
export const terminalPilotGroup=Object.freeze(createTerminalPilotGroup());
const commands=Object.fromEntries(terminalPilotGroup.children.map(command=>[command.name,command]));
export const createSession=commands['create-session'],fill=commands.fill,type=commands.type,pressKey=commands['press-key'],sendSignal=commands['send-signal'],waitFor=commands['wait-for'],waitForExit=commands['wait-for-exit'],readScreen=commands['read-screen'],readHistory=commands['read-history'],resize=commands.resize,closeSession=commands['close-session'],getSession=commands['get-session'],listSessions=commands['list-sessions'];
