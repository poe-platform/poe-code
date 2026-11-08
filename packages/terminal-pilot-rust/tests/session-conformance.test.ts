import {expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({processes:[] as Array<{data:(chunk:string)=>void;exit:(event:{exitCode:number})=>void}>}));
function processMock(){
 const listeners={data:(_chunk:string)=>{},exit:(_event:{exitCode:number})=>{}};
 state.processes.push(listeners);
 return{pid:123,write(){},resize(){},kill(){listeners.exit({exitCode:0});},onData(fn:(chunk:string)=>void){listeners.data=fn;return{dispose(){}};},onExit(fn:(event:{exitCode:number})=>void){listeners.exit=fn;return{dispose(){}};}};
}
vi.mock('../dist/pty-host.js',()=>({createPty:()=>processMock()}));
vi.mock('node-pty',()=>({spawn:()=>processMock()}));
vi.mock('node:fs',async()=>({...await vi.importActual('node:fs'),accessSync(){}}));
import {TerminalSession as NativeSession} from '../dist/index.js';
import {TerminalSession as SDKSession} from '../../terminal-pilot/src/terminal-session.js';
it('matches the original session history and screen across generated streaming rewrites',async()=>{
 vi.useFakeTimers();
 try{
  let seed=0x471ba;
  const pieces=['abc','\rXY','\b!','\r\n','\x1b[31mred\x1b[0m','🦀','é','\x1b[2J\x1b[H','\x1b[?1049hother\x1b[?1049l','\x1b]0;title\x07','\x1b[2C'];
  for(let n=0;n<256;n++){
   state.processes=[];
   const options={id:'case-'+n,command:'test',cols:24,rows:6};
   const a=new NativeSession(options),b=new SDKSession(options);
   for(let i=0;i<16;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const text=pieces[seed%pieces.length]!;
    // Include splits inside CSI, OSC, surrogate pairs and combining sequences.
    const cut=seed%(text.length+1);
    for(const chunk of [text.slice(0,cut),text.slice(cut)])for(const pty of state.processes)pty.data(chunk);
   }
   for(const pty of state.processes)pty.data('\r\ntail');
   expect(await a.history()).toEqual(await b.history());
   for(const last of [0,1,3,100])expect(await a.history({last})).toEqual(await b.history({last}));
   const screenA=await a.screen(),screenB=await b.screen();
   expect(screenA.lines).toEqual(screenB.lines);expect(screenA.rawLines).toEqual(screenB.rawLines);expect(screenA.cursor).toEqual(screenB.cursor);
   for(const pattern of ['tail',/tail/g,/tail/y])expect(await a.waitFor(pattern,{timeout:0})).toEqual(await b.waitFor(pattern,{timeout:0}));
   await a.resize(16,4);await b.resize(16,4);expect((await a.screen()).lines).toEqual((await b.screen()).lines);
   for(const pty of state.processes)pty.exit({exitCode:7});
   expect(await a.close()).toBe(await b.close());
  }
 }finally{vi.useRealTimers();}
});
