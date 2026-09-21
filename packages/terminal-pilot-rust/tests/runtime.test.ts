import {expect,it,vi} from 'vitest';
import {createTerminalPilotRuntime} from '../dist/commands.js';
import {createTerminalPilotRuntime as createSDKRuntime} from '../../terminal-pilot/src/commands/runtime.js';
import {isUserError} from '../../toolcraft/src/user-error.js';
function session(id:string){const s={id,command:'test',pid:123,exitCode:null as number|null,fill:vi.fn(),type:vi.fn(),press:vi.fn(),signal:vi.fn(),waitFor:vi.fn(),waitForExit:vi.fn(),screen:vi.fn(),history:vi.fn(),resize:vi.fn(),close:vi.fn()};s.close.mockImplementation(async()=>{s.exitCode=0;return 0;});return s;}
function pilot(){
 const sessions:any[]=[];let nextId=0;
 const p={newSession:vi.fn(async()=>{const s=session('id-'+(++nextId));sessions.push(s);return s;}),sessions:()=>sessions.filter(s=>s.exitCode===null),getSession:(id:string)=>{const s=sessions.find(s=>s.id===id);if(!s)throw new Error('missing');return s;},deleteSession:(id:string)=>{const i=sessions.findIndex(s=>s.id===id);if(i>=0)sessions.splice(i,1);},close:vi.fn(async()=>{for(const s of sessions)await s.close();sessions.length=0;})};
 return p;
}
it('reserves names during concurrent creation and releases failed reservations',async()=>{
 const p=pilot();let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const base=p.newSession.getMockImplementation()!;p.newSession.mockImplementationOnce(async()=>{await gate;return base();});
 const r=createTerminalPilotRuntime({launchPilot:async()=>p});
 const pending=r.createSession({command:'test',session:'named'});
 await expect(r.createSession({command:'test',session:'named'})).rejects.toThrow('already exists');
 release();expect((await pending).name).toBe('named');
 p.newSession.mockRejectedValueOnce(new Error('spawn failed'));
 await expect(r.createSession({command:'test',session:'retry'})).rejects.toThrow('spawn failed');
 expect((await r.createSession({command:'test',session:'retry'})).name).toBe('retry');await r.close();
});
it('retains completed sessions for reads and safely replaces their public name',async()=>{
 const p=pilot(),r=createTerminalPilotRuntime({launchPilot:async()=>p});
 const first=await r.createSession({command:'test'});expect(first.name).toBe('s1');
 first.session.exitCode=7;
 expect(await r.listSessions()).toEqual([]);expect(await r.resolveSession('s1')).toEqual(first);expect(await r.hasRetainedSessions()).toBe(true);
 const replaced=await r.createSession({command:'test',session:'s1'});expect(replaced.session).not.toBe(first.session);
 expect(await r.resolveSession(undefined)).toEqual(replaced);await r.close();expect(await r.hasRetainedSessions()).toBe(false);
});
it('waits for in-flight creation during shutdown and rejects new admission',async()=>{
 const p=pilot();let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});const base=p.newSession.getMockImplementation()!;
 p.newSession.mockImplementationOnce(async()=>{await gate;return base();});
 const r=createTerminalPilotRuntime({launchPilot:async()=>p});
 const creating=r.createSession({command:'test'});let finished=false;
 const closing=r.close().then(()=>{finished=true;});
 await expect(r.createSession({command:'test'})).rejects.toThrow('closing');expect(finished).toBe(false);
 release();const created=await creating;await closing;expect(created.session.exitCode).toBe(0);expect(await r.hasRetainedSessions()).toBe(false);
 expect((await r.createSession({command:'test'})).name).toBe('s1');await r.close();
});
it('failed shutdown preserves lookup and can be retried',async()=>{
 const p=pilot(),r=createTerminalPilotRuntime({launchPilot:async()=>p});const created=await r.createSession({command:'test',session:'kept'});
 p.close.mockRejectedValueOnce(new Error('close failed'));
 await expect(r.close()).rejects.toThrow('close failed');expect(await r.resolveSession('kept')).toEqual(created);
 await r.close();expect(await r.hasRetainedSessions()).toBe(false);
});
it('matches original naming, env selection, retention, errors and public error detection',async()=>{
 const run=async(factory:typeof createTerminalPilotRuntime)=>{
  const p=pilot(),r=factory({launchPilot:async()=>p}),events:any[]=[];
  const env={get:(key:string)=>key==='TERMINAL_PILOT_SESSION'?'env-name':undefined};
  const first=await r.createSession({command:'test'},env);events.push(first.name);
  events.push((await r.resolveSession(undefined,env)).name);
  events.push((await r.createSession({command:'other'})).name);
  for(const name of [undefined,'missing']){
   try{await r.resolveSession(name);}catch(error){events.push([(error as Error).message,isUserError(error)]);}
  }
  first.session.exitCode=7;events.push((await r.listSessions()).map(s=>s.name));
  events.push((await r.resolveSession('env-name')).session.exitCode);
  events.push((await r.createSession({command:'test',session:'env-name'})).name);
  const closed=await r.closeSession('env-name');events.push(closed);
  events.push((await r.listSessions()).map(s=>s.name));await r.close();events.push(await r.hasRetainedSessions());
  return events;
 };
 expect(await run(createTerminalPilotRuntime)).toEqual(await run(createSDKRuntime));
});
it('invalid admission does not launch a pilot and failed launch can be retried',async()=>{
 const p=pilot(),launch=vi.fn(async()=>p),r=createTerminalPilotRuntime({launchPilot:launch});
 for(const options of [{command:' \ufeff'}, {command:'test',session:'\ufeff'}])await expect(r.createSession(options)).rejects.toThrow('must not be empty');
 expect(launch).not.toHaveBeenCalled();
 launch.mockRejectedValueOnce(new Error('launch failed'));
 await expect(r.createSession({command:'test',session:'retry'})).rejects.toThrow('launch failed');
 expect((await r.createSession({command:'test',session:'retry'})).name).toBe('retry');await r.close();
});
