import type {FunctionLocalLayout} from "./function-local-layout.js";
import type {CellStorage} from "./lexical-frame.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";

/** Execution-owned reflective access to optimized slots. Names are literal,
 * never normalized or privately mangled here. A native mapping adapter owns
 * arbitrary extra keys, key protocols and fresh guest proxy identities; false
 * or undefined results here allow it to consult that shared extra dictionary. */
export class FrameLocals<Value> {
  readonly #names=new Set<string>();
  constructor(layout:FunctionLocalLayout,private readonly locals:Map<string,Value>,private readonly cells:ReadonlyMap<string,CellStorage<Value>>,private readonly meter:ExecutionMeter){
    meter.checkpoint(1,128);
    for(const names of [layout.variableNames,layout.cellNames,layout.freeNames])for(const name of names){
      meter.checkpoint();if(this.#names.has(name))continue;
      meter.checkpoint(0,40);this.#names.add(name);
    }
    Object.freeze(this);
  }
  lookup(name:string):{readonly value:Value}|undefined {
    this.meter.checkpoint();
    if(!this.#names.has(name))return undefined;
    const cell=this.cells.get(name);
    if(cell!==undefined)return cell.content;
    if(!this.locals.has(name))return undefined;
    this.meter.checkpoint(0,24);return {value:this.locals.get(name)!};
  }
  store(name:string,value:Value):boolean {
    this.meter.checkpoint();
    if(!this.#names.has(name))return false;
    const cell=this.cells.get(name);
    if(cell!==undefined){this.meter.checkpoint(0,24);cell.content={value};}
    else {if(!this.locals.has(name))this.meter.checkpoint(0,48);this.locals.set(name,value);}
    return true;
  }
  delete(name:string):false {
    this.meter.checkpoint();
    if(this.#names.has(name))throw new PythonRuntimeError("ValueError","cannot remove local variables from FrameLocalsProxy");
    return false;
  }
  snapshot():Map<string,Value> {
    this.meter.checkpoint(1,64);const result=new Map<string,Value>();
    for(const name of this.#names){
      const item=this.lookup(name);
      if(item===undefined)continue;
      this.meter.checkpoint(0,48);result.set(name,item.value);
    }
    return result;
  }
}
