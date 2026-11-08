import {createRequire} from "node:module";
import {createInputParser} from "./terminal-input.js";
import {createFrameWriter} from "./frame-writer.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
export function createTerminalDriver(options={}) {
  const input=options.input??process.stdin;
  const output=options.output??process.stdout;
  const eventListeners=new Set(),resizeListeners=new Set();
  const emit=event=>{for(const listener of eventListeners)listener(event);};
  const parser=createInputParser({escTimeoutMs:options.escTimeoutMs,onEvent:emit});
  const writer=createFrameWriter(output,{mouse:options.mouse});
  const state=new native.NativeTerminalDriver();
  const onData=chunk=>{for(const event of parser.feed(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)))emit(event);};
  const getSize=()=>({cols:native.designTerminalDimension(output.columns),rows:native.designTerminalDimension(output.rows)});
  const onTerminalResize=()=>{const size=getSize();for(const listener of resizeListeners)listener(size);};
  return {
    start(){
      if(!state.start())return;
      input.setRawMode?.(true);
      input.resume();
      input.on("data",onData);
      output.on("resize",onTerminalResize);
      writer.open();
    },
    stop(){
      if(!state.stop())return;
      input.off("data",onData);
      output.off("resize",onTerminalResize);
      parser.destroy();
      writer.close();
      input.setRawMode?.(false);
      input.pause();
    },
    onEvent(fn){eventListeners.add(fn);return ()=>{eventListeners.delete(fn);};},
    onResize(fn){resizeListeners.add(fn);return ()=>{resizeListeners.delete(fn);};},
    getSize,
    writeFrame:writer.writeFrame
  };
}
