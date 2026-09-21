import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {native} from './native.js';
import {createPty} from './pty-host.js';
import {TerminalScreen,keyToSequence} from './index.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class TerminalSession {
 #state;#pty;#events=new EventEmitter({captureRejections:false});#close=null;#failure=null;
 constructor({id,command,args=[],cwd=process.cwd(),env=process.env,cols=120,rows=40,observe=false}){
  this.#state=new native.NativeTerminalSession(id,cols,rows,Date.now());
  this.id=id;this.command=command;
  this.#pty=createPty({command,args,cwd,env,cols,rows});this.pid=this.#pty.pid;
  const data=this.#pty.onData(chunk=>{this.#state.data(chunk,Date.now());if(observe)process.stderr.write(chunk);});
  let exit,error;
  exit=this.#pty.onExit(({exitCode})=>{
    if(!this.#state.markExit(exitCode))return;
    data.dispose();exit?.dispose();error?.dispose();this.#pty.dispose?.();
    this.#events.emit('exit',exitCode);
  });
  error=this.#pty.onError?.(fault=>{this.#failure=fault;this.#events.emit('transport-failure');});
 }
 get exitCode(){return this.#state.exitCode??null;}
 // The writable SDK property is retained for structural compatibility.
 set exitCode(code){if(code!==null)this.#state.markExit(code);}
 async type(text){for(const character of text){await this.send(character);await sleep(15);}}
 async fill(text){this.#checkFailure();this.#pty.write(this.#state.fill(text));}
 async press(key){await this.send(keyToSequence(key));}
 async send(raw){this.#checkFailure();this.#pty.write(this.#state.input(raw));}
 async signal(sig){if(this.exitCode===null){this.#checkFailure();this.#pty.kill(sig);}}
 async waitFor(pattern,opts){
  const timeout=opts?.timeout??10000,scope=opts?.scope??'history';
  this.#state.validateWait(timeout,scope);
  const started=Date.now(),label=String(pattern);
  const expression=typeof pattern==='string'?null:new RegExp(pattern.source,[...pattern.flags].filter(c=>c!=='g').join(''));
  while(true){
   this.#checkFailure();
   const elapsed=Date.now()-started;
   if(elapsed<=timeout){
    const match=expression===null?this.#state.matchString(pattern,scope==='screen'):this.#state.matchLines(scope==='screen').find(line=>expression.test(line));
    if(match!==null&&match!==undefined)return match;
   }
   const fault=this.#state.waitError(elapsed,timeout,label);if(fault!=null)throw new Error(fault);
   await sleep(10);
  }
 }
 async waitForQuiet(ms){
  while(true){this.#checkFailure();const remaining=this.#state.quietRemaining(ms,Date.now());if(remaining===0)return;await sleep(remaining);}
 }
 async screen(){const rawLines=this.#state.screenLines();return new TerminalScreen({lines:rawLines,rawLines,cursor:this.#state.cursor,size:this.#state.size});}
 async history(opts){return this.#state.history(opts?.last);}
 async resize(cols,rows){
  this.#state.validateGeometry(cols,rows);
  if(this.exitCode===null){this.#checkFailure();this.#pty.resize(cols,rows);}
  this.#state.resize(cols,rows);
 }
 async waitForExit(opts){
  if(opts?.timeout!==undefined)this.#state.validateTimeout(opts.timeout);
  this.#checkFailure();if(this.exitCode!==null)return this.exitCode;
  const code=await this.#awaitExit(opts?.timeout);
  if(code===null)throw new Error(`Timed out waiting for process to exit after ${opts.timeout}ms`);
  return code;
 }
 async close(){
  if(this.exitCode!==null)return this.exitCode;
  this.#close??=this.#runClose().catch(error=>{this.#close=null;this.#state.abortClose();throw error;});
  return this.#close;
 }
 async #runClose(){
  this.#state.beginClose(Date.now());
  while(true){
   this.#checkFailure();const action=this.#state.closeStep(Date.now());
   if(action.done!==undefined)return action.done;
   if(action.signal!==undefined){this.#pty.kill(action.signal===15?'SIGTERM':'SIGKILL');this.#state.signalSent(Date.now());}
   else await this.#awaitExit(action.wait);
  }
 }
 #awaitExit(ms){
  return new Promise((resolve,reject)=>{
   let timer,settled=false;
   const settle=(fault,code)=>{if(settled)return;settled=true;clearTimeout(timer);this.#events.off('exit',exited);this.#events.off('transport-failure',failed);fault?reject(fault):resolve(code);};
   const exited=code=>settle(null,code),failed=()=>settle(this.#failure,null);
   this.#events.on('exit',exited);this.#events.on('transport-failure',failed);
   if(this.exitCode!==null){exited(this.exitCode);return;}
   if(this.#failure!==null){failed();return;}
   if(ms!==undefined)timer=setTimeout(()=>settle(null,null),ms);
  });
 }
 #checkFailure(){if(this.#failure!==null)throw this.#failure;}
 on(event,cb){this.#events.on(event,cb);}
}
export class TerminalPilot {
 #state=new native.NativeTerminalPilot();#sessions=new Map();
 static async launch(){return new TerminalPilot();}
 async newSession(options){
  const session=new TerminalSession({...options,id:randomUUID()});
  this.#state.register(session.id);this.#sessions.set(session.id,session);
  session.on('exit',()=>this.#state.exited(session.id));
  return session;
 }
 getSession(id){if(!this.#state.contains(id))throw new Error(`Session not found: ${id}`);return this.#sessions.get(id);}
 deleteSession(id){this.#state.remove(id);this.#sessions.delete(id);}
 sessions(){return this.#state.ids(true).map(id=>this.#sessions.get(id));}
 async close(){await Promise.all(this.#state.ids(false).map(async id=>{await this.#sessions.get(id).close();this.deleteSession(id);}));}
}
