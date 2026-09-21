import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({bytes:[] as Buffer[],writes:[] as Buffer[],environment:'',exit:null as number|null,disposed:0,fault:null as Error|null,resize:[] as number[][]}));
vi.mock('../dist/native.js',async()=>{
 const actual=await vi.importActual<typeof import('../dist/native.js')>('../dist/native.js');
 class Pty{
  pid=123;
  constructor(_command:string,_args:string[],_cwd:string,environment:string){mock.environment=environment;}
  read(){if(mock.fault)throw mock.fault;return mock.bytes.shift()??Buffer.alloc(0);}
  write(bytes:Buffer){mock.writes.push(bytes);}
  resize(cols:number,rows:number){mock.resize.push([cols,rows]);}
  signal(){mock.exit=0;}
  get exitCode(){return mock.exit;}
  dispose(){mock.disposed++;}
 }
 return{native:{...actual.native,NativeTerminalPty:Pty}};
});
import {TerminalSession} from '../dist/index.js';
beforeEach(()=>{vi.useFakeTimers();mock.bytes=[];mock.writes=[];mock.exit=null;mock.disposed=0;mock.fault=null;mock.resize=[];});
afterEach(()=>{vi.useRealTimers();});
it('decodes split UTF8, drains exit output and disposes subscriptions once',async()=>{
 const bytes=Buffer.from('ready 🦀\r\ntail');
 mock.bytes=[bytes.subarray(0,7),bytes.subarray(7,9),bytes.subarray(9)];mock.exit=7;
 const session=new TerminalSession({id:'split',command:'test',env:{VISIBLE:'yes',MISSING:undefined},cols:20,rows:3});
 const events:number[]=[];session.on('exit',code=>events.push(code));
 const done=session.waitForExit({timeout:100});
 await vi.advanceTimersByTimeAsync(0);
 expect(await done).toBe(7);expect(events).toEqual([7]);expect(mock.disposed).toBe(1);
 expect(JSON.parse(mock.environment)).toEqual({VISIBLE:'yes'});
 expect(await session.history()).toEqual(['ready 🦀','tail']);
 await session.close();await session.close();expect(mock.disposed).toBe(1);
 await vi.advanceTimersByTimeAsync(1000);expect(events).toEqual([7]);
});
it('types Unicode scalar inputs at the requested cadence and validates before effects',async()=>{
 const session=new TerminalSession({id:'typing',command:'test',cols:20,rows:3});
 const typed=session.type('A🦀');
 await vi.advanceTimersByTimeAsync(30);await typed;
 expect(mock.writes.map(bytes=>bytes.toString())).toEqual(['A','🦀']);
 await session.fill('a\r\nb\nc\r');await session.press('Control+C');
 expect(mock.writes.slice(2).map(bytes=>bytes.toString())).toEqual(['a\rb\rc\r','\x03']);
 await expect(session.resize(0,3)).rejects.toThrow('positive integers');expect(mock.resize).toEqual([]);
 await session.signal('SIGTERM');await vi.advanceTimersByTimeAsync(2);expect(await session.close()).toBe(0);
});
it('transport failure rejects pending waiters and releases the native transport',async()=>{
 const session=new TerminalSession({id:'fault',command:'test',cols:20,rows:3});
 const fault=new Error('read failed');
 const exited=expect(session.waitForExit({timeout:100})).rejects.toBe(fault);
 const matching=expect(session.waitFor('absent',{timeout:100})).rejects.toBe(fault);
 mock.fault=fault;await vi.advanceTimersByTimeAsync(10);
 await exited;await matching;expect(mock.disposed).toBe(1);
 await expect(session.send('late')).rejects.toBe(fault);
 await expect(session.close()).rejects.toBe(fault);
});
it('concurrent exit and close waiters share one escalation and remove timers',async()=>{
 const session=new TerminalSession({id:'many',command:'test',cols:20,rows:3});
 const closing=[session.close(),session.close(),session.waitForExit({timeout:1000})];
 await vi.advanceTimersByTimeAsync(252);
 expect(await Promise.all(closing)).toEqual([0,0,0]);expect(mock.disposed).toBe(1);expect(vi.getTimerCount()).toBe(0);
});
