import {StringDecoder} from 'node:string_decoder';
import {constants} from 'node:os';
import {native} from './native.js';

// Only byte decoding, scheduling and effect subscriptions live in this adapter.
export function createPty({command,args,cwd,env,cols,rows}) {
 if(!native.NativeTerminalPty)throw new Error('Native PTY sessions currently support macOS and Linux.');
 const environment=Object.fromEntries(Object.entries(env).filter(([,value])=>value!==undefined));
 const pty=new native.NativeTerminalPty(command,args,cwd,JSON.stringify(environment),cols,rows);
 const decoder=new StringDecoder('utf8');
 const listeners={data:new Set(),exit:new Set(),error:new Set()};
 let timer,stopped=false;
 const emit=(kind,value)=>{for(const listener of [...listeners[kind]])listener(value);};
 const poll=()=>{
  if(stopped)return;
  try{
   let reads=0;
   for(;reads<64;reads++){
    const bytes=pty.read();if(bytes.length===0)break;
    const text=decoder.write(bytes);if(text!=='')emit('data',text);
   }
   // Drain all available output before publishing an already-reaped exit.
   if(reads<64){
    const exitCode=pty.exitCode;
    if(exitCode!=null){
     const tail=decoder.end();if(tail!=='')emit('data',tail);
     stopped=true;emit('exit',{exitCode});return;
    }
   }
  }catch(error){
   stopped=true;
   pty.dispose();
   emit('error',error);return;
  }
  timer=setTimeout(poll,2);
 };
 timer=setTimeout(poll,0);
 const subscribe=(kind,listener)=>{listeners[kind].add(listener);return{dispose(){listeners[kind].delete(listener);}};};
 return {
  pid:pty.pid,
  write(text){pty.write(Buffer.from(text,'utf8'));},
  resize(cols,rows){pty.resize(cols,rows);},
  kill(signal='SIGTERM'){
   const value=constants.signals[signal];
   if(value===undefined)throw new Error(`Unknown signal: ${signal}`);
   pty.signal(value);
  },
  onData(listener){return subscribe('data',listener);},
  onExit(listener){return subscribe('exit',listener);},
  onError(listener){return subscribe('error',listener);},
  dispose(){stopped=true;clearTimeout(timer);pty.dispose();for(const set of Object.values(listeners))set.clear();}
 };
}
