import * as readline from "node:readline";
import {StringDecoder} from "node:string_decoder";
import {CANCEL} from "./cancel-symbol.js";
export const pendingCarriageReturns=new WeakMap();

export function ttyPrompt(p){
  return new Promise(resolve=>{
    const onSubmit=value=>resolve(value),onCancel=()=>resolve(CANCEL);
    p.once("submit",onSubmit);p.once("cancel",onCancel);
    p.signal?.addEventListener("abort",p.onCancel,{once:true});
    p.readlineInterface=readline.createInterface({input:p.input,output:undefined,tabSize:2,prompt:"",escapeCodeTimeout:50,terminal:true});
    p.readlineInterface.once("close",p.onCancel);p.input.once("close",p.onCancel);
    readline.emitKeypressEvents(p.input,p.readlineInterface);p.readlineInterface.prompt();
    p.input.on("keypress",p.onKeypress);if(p.input.setRawMode)p.input.setRawMode(true);
    p.output.on("resize",p.render);p.render();
  });
}

export function readStream(p,input,invoke){
  return new Promise((resolve,reject)=>{
    const decoder=new StringDecoder("utf8"),state={line:"",settled:false,input,decoder,p};
    const settle=(value,remainder)=>{
      if(state.settled)return;state.settled=true;
      input.removeListener("data",onData);input.removeListener("end",onEnd);
      input.removeListener("close",onCancel);input.removeListener("error",settle);
      p.signal?.removeEventListener("abort",onCancel);input.pause();
      if(remainder?.length)input.unshift(remainder,input.readableEncoding??undefined);
      if(value instanceof Error)reject(value);else resolve(value);
    };
    state.settle=settle;
    const onCancel=()=>{p.state="cancel";settle(CANCEL);};
    const onEnd=()=>settle(state.line+decoder.end());
    const onData=chunk=>{invoke("lineChunk",[state,chunk]);};
    input.once("end",onEnd);input.once("close",onCancel);input.once("error",settle);
    p.signal?.addEventListener("abort",onCancel,{once:true});
    if(p.signal?.aborted)onCancel();else if(input.readableEnded)onEnd();else if(input.destroyed)onCancel();
    else if(!state.settled){input.on("data",onData);if(!state.settled)input.resume();if(state.settled)input.pause();}
  });
}

export function readGenericStream(p){
  return new Promise((resolve,reject)=>{
    let rl=null,settled=false;
    const settle=value=>{
      if(settled)return;settled=true;
      p.input.removeListener("close",onCancel);p.signal?.removeEventListener("abort",onCancel);
      rl?.removeListener("error",settle);rl?.removeListener("line",settle);rl?.removeListener("close",onClose);rl?.close();
      if(value instanceof Error)reject(value);else resolve(value);
    };
    const onCancel=()=>{p.state="cancel";settle(CANCEL);};
    const onClose=()=>settle(rl?.line??"");
    p.input.once("close",onCancel);rl=readline.createInterface({input:p.input,terminal:false});
    if(settled){rl.close();return;}
    rl.once("error",settle);rl.once("line",settle);rl.once("close",onClose);
    p.signal?.addEventListener("abort",onCancel,{once:true});
    if(p.signal?.aborted)onCancel();else if(p.input.readableEnded)settle(rl.line);else if(p.input.destroyed)onCancel();
  });
}
