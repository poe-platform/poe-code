import type {CodeLocalLayout} from "./code-local-layout.js";
import type {CellStorage} from "./lexical-frame.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";

/** Execution-owned reflective access to optimized slots. Names are literal,
 * never normalized or privately mangled here. A native mapping adapter owns
 * arbitrary extra keys, key protocols and fresh guest proxy identities; false
 * or undefined results here allow it to consult that shared extra dictionary. */
export class FrameLocals<Value> {
  readonly #names=new Set<string>();
  readonly #inline:FrameLocals<Value>[];
  readonly #hidden:ReadonlySet<string>;
  readonly #free:ReadonlySet<string>;
  readonly names:readonly string[];
  constructor(layout:CodeLocalLayout,private readonly locals:Map<string,Value>,private readonly cells:ReadonlyMap<string,CellStorage<Value>>,private readonly meter:ExecutionMeter,hiddenLocals=false,inline:FrameLocals<Value>[]=[]){
    meter.checkpoint(1,288+layout.freeNames.length*40+(hiddenLocals?layout.variableNames.length*40:0));
    this.#inline=inline;
    this.#hidden=new Set(hiddenLocals?layout.variableNames:[]);
    this.#free=new Set(layout.freeNames);
    for(const names of [layout.variableNames,layout.cellNames,layout.freeNames])for(const name of names){
      meter.checkpoint();if(this.#names.has(name))continue;
      meter.checkpoint(0,40);this.#names.add(name);
    }
    meter.checkpoint(0,32+this.#names.size*8);this.names=Object.freeze([...this.#names]);
    Object.freeze(this);
  }
  lookup(name:string):{readonly value:Value}|undefined {
    this.meter.checkpoint();
    if(!this.#names.has(name))return undefined;
    for(let index=this.#inline.length-1;index>=0;index--){
      this.meter.checkpoint();const inner=this.#inline[index];
      if(inner.#names.has(name)){
        const value=inner.lookup(name);
        if(value!==undefined||!this.#hidden.has(name)&&!this.#free.has(name))return value;
        break;
      }
    }
    const cell=this.cells.get(name);
    if(cell!==undefined)return cell.content;
    if(!this.locals.has(name))return undefined;
    this.meter.checkpoint(0,24);return {value:this.locals.get(name)!};
  }
  store(name:string,value:Value):boolean {
    this.meter.checkpoint();
    if(!this.#names.has(name))return false;
    if(this.#hidden.has(name)){
      const cell=this.cells.get(name);if(cell===undefined)return false;
      this.meter.checkpoint(0,24);cell.content={value};return true;
    }
    for(let index=this.#inline.length-1;index>=0;index--){
      this.meter.checkpoint();const inner=this.#inline[index];if(inner.#names.has(name))return inner.store(name,value);
    }
    const cell=this.cells.get(name);
    if(cell!==undefined){this.meter.checkpoint(0,24);cell.content={value};}
    else {if(!this.locals.has(name))this.meter.checkpoint(0,48);this.locals.set(name,value);}
    return true;
  }
  writable(name:string):boolean {
    this.meter.checkpoint();return this.#names.has(name)&&(!this.#hidden.has(name)||this.cells.has(name));
  }
  delete(name:string):false {
    this.meter.checkpoint();
    if(this.#names.has(name)&&(!this.#hidden.has(name)||this.cells.has(name)))throw new PythonRuntimeError("ValueError","cannot remove local variables from FrameLocalsProxy");
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
  get inlineActive():boolean {return this.#inline.length!==0;}
  get hasHiddenLocals():boolean {
    for(const name of this.#hidden){
      this.meter.checkpoint();
      for(let index=this.#inline.length-1;index>=0;index--){
        this.meter.checkpoint();const inner=this.#inline[index];
        if(inner.#names.has(name)){if(inner.lookup(name)!==undefined)return true;break;}
      }
      if(this.locals.has(name))return true;
    }
    return false;
  }
  /** Existing proxies follow active isolated storage. Restoration is unmetered
   * so cancellation cannot leave temporary locals installed on the owner. */
  enterInline(inner:FrameLocals<Value>):()=>void {
    this.meter.checkpoint(1,72);
    this.#inline.push(inner);let left=false;
    return ()=>{
      if(left)return;
      if(this.#inline.at(-1)!==inner)throw Error("inline locals must leave in reverse order");
      this.#inline.pop();left=true;
    };
  }
}
