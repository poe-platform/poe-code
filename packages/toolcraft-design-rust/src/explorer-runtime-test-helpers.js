import {harnessPolicy} from "./test-harness-host.js";

export class FakeTerminalDriver {
  cols;rows;writes=[];started=false;startCount=0;stopCount=0;
  eventHandlers=new Set();resizeHandlers=new Set();
  constructor(cols=120,rows=24){this.cols=cols;this.rows=rows;}
  get output(){return harnessPolicy("output",[this]);}
  get destroyed(){return harnessPolicy("destroyed",[this]);}
  get altScreen(){return this.started;}
  get enterAltScreenCount(){return this.startCount;}
  start(){harnessPolicy("start",[this]);}
  stop(){harnessPolicy("stop",[this]);}
  onEvent(handler){this.eventHandlers.add(handler);return ()=>{this.eventHandlers.delete(handler);};}
  onResize(handler){this.resizeHandlers.add(handler);return ()=>{this.resizeHandlers.delete(handler);};}
  getSize(){return {cols:this.cols,rows:this.rows};}
  writeFrame(ansi){harnessPolicy("write",[this,ansi]);}
  resize(cols,rows){this.cols=cols;this.rows=rows;for(const handler of this.resizeHandlers)handler(this.getSize());}
  press(key){harnessPolicy("press",[this,key]);}
}
