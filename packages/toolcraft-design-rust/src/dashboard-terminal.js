import readline from "node:readline";
import {PassThrough} from "node:stream";
import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {createInputParser} from "./terminal-input.js";
import {cellToAnsi} from "./dashboard-buffer.js";
import {graphemeWidth} from "./terminal.js";

const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const primitives={
  undefined:()=>undefined,true:()=>true,false:()=>false,
  same:(a,b)=>a===b,ge:(a,b)=>a>=b,le:(a,b)=>a<=b,gt:(a,b)=>a>b,
  add:(a,b)=>a+b,max:(a,b)=>Math.max(a,b),floor:value=>Math.floor(value),
  truthy:value=>!!value,finite:value=>Number.isFinite(value),nullish:value=>value==null,
  optionalGet:(value,key)=>value?.[key],at:(value,key)=>value[key],
  set:(value,key,item)=>{value[key]=item;},
  arrayLength:value=>Array.from(value).length,point:value=>value.codePointAt(0),
  code:value=>value.charCodeAt(0),character:value=>String.fromCharCode(value),tail:value=>value.slice(1),
  key:(ch,ctrl,meta,shift)=>({ch,ctrl,meta,shift}),named:(name,ctrl,meta,shift)=>({name,ctrl,meta,shift}),
  paste:(name,ch,ctrl,meta,shift)=>({name,ch,ctrl,meta,shift}),
  position:(row,col)=>`\u001b[${row};${col}H`,size:(cols,rows)=>({cols,rows}),
  cellToAnsi,graphemeWidth,emit:(handler,event)=>handler(event),noop:()=>()=>{},
  invalidOperation(){throw new TypeError("Invalid dashboard terminal operation");}
};
const parsePolicy=createComponentPolicy(native.designDashboardTerminalPolicy,{
  ...primitives,
  readline(data){
    const stream=new PassThrough();let event;
    readline.emitKeypressEvents(stream);
    stream.on("keypress",(str,key)=>{event=parsePolicy("toEvent",[str,key]);});
    stream.emit("data",data);stream.destroy();return event;
  }
});
export function parseKeypress(data){return parsePolicy("parse",[data]);}

export function createTerminalDriver(opts){
  const stdin=opts?.stdin??process.stdin,stdout=opts?.stdout??process.stdout;
  const resizeListeners=new Set(),keypressListeners=new Map();
  const state={rawMode:false,altScreen:false,lineWrapEnabled:true,cursorHidden:false,destroyed:false};
  const policy=createComponentPolicy(native.designDashboardTerminalPolicy,{
    ...primitives,state:()=>state,output:()=>stdout,
    raw:enabled=>stdin.setRawMode?.(enabled),resume:()=>stdin.resume(),pause:()=>stdin.pause(),
    write:text=>stdout.write(text),
    flush(changes){
      const frame={output:"",cursorX:undefined,cursorY:undefined};
      for(const change of changes)policy("flushCell",[frame,change]);
      return frame.output;
    },
    registerResize(handler){
      const listener=()=>{handler();};
      resizeListeners.add(listener);stdout.on("resize",listener);
      return ()=>{policy("offResize",[listener]);};
    },
    deleteResize:listener=>resizeListeners.delete(listener),offResize:listener=>stdout.off("resize",listener),
    registerKeypress(handler){
      const dispatch=event=>{policy("dispatch",[handler,event]);};
      const parser=createInputParser({onEvent:dispatch});
      const listener=chunk=>{for(const event of parser.feed(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)))dispatch(event);};
      keypressListeners.set(listener,parser.destroy);stdin.on("data",listener);
      return ()=>{policy("offKeypress",[listener,parser]);};
    },
    deleteKeypress:listener=>keypressListeners.delete(listener),
    destroyParser:parser=>parser.destroy(),offKeypress:listener=>stdin.off("data",listener),
    clearKeypress(){for(const [listener,cleanup] of keypressListeners){cleanup();stdin.off("data",listener);}keypressListeners.clear();},
    clearResize(){for(const listener of resizeListeners)stdout.off("resize",listener);resizeListeners.clear();}
  });
  function enterRawMode(){policy("enterRawMode",[]);}
  function exitRawMode(){policy("exitRawMode",[]);}
  function enterAltScreen(){policy("enterAltScreen",[]);}
  function exitAltScreen(){policy("exitAltScreen",[]);}
  function disableLineWrap(){policy("disableLineWrap",[]);}
  function enableLineWrap(){policy("enableLineWrap",[]);}
  function hideCursor(){policy("hideCursor",[]);}
  function showCursor(){policy("showCursor",[]);}
  function moveTo(x,y){policy("moveTo",[x,y]);}
  function write(text){policy("write",[text]);}
  function flush(changes){policy("flush",[changes]);}
  function getSize(){return policy("getSize",[]);}
  function onResize(handler){return policy("onResize",[handler]);}
  function onKeypress(handler){return policy("onKeypress",[handler]);}
  function destroy(){policy("destroy",[]);}
  return {enterRawMode,exitRawMode,enterAltScreen,exitAltScreen,disableLineWrap,enableLineWrap,hideCursor,showCursor,moveTo,write,flush,getSize,onResize,onKeypress,destroy};
}
