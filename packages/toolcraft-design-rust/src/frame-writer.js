import {createRequire} from "node:module";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const controls=native.designFrameControls();
export function createFrameWriter(stream,options={}) {
  const state=new native.NativeFrameWriter();
  const interrupt=()=>terminateWith("SIGINT");
  const terminate=()=>terminateWith("SIGTERM");
  const fatal=error=>{close();throw error;};
  function terminateWith(signal){close();process.kill(process.pid,signal);}
  function open(){
    if(!state.open())return;
    stream.write(controls[options.mouse===false?1:0]);
    process.once("SIGINT",interrupt);
    process.once("SIGTERM",terminate);
    process.once("uncaughtException",fatal);
  }
  function close(){
    if(!state.close())return;
    process.removeListener("SIGINT",interrupt);
    process.removeListener("SIGTERM",terminate);
    process.removeListener("uncaughtException",fatal);
    stream.write(controls[options.mouse===false?3:2]);
  }
  return {open,close,writeFrame(ansi){
    if(!state.isOpen()||ansi.length===0)return;
    stream.write(`${controls[4]}${ansi}${controls[5]}`);
  }};
}
