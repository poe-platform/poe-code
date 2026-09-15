import type {CodeLocalLayout} from "./code-local-layout.js";
import type {CellStorage} from "./lexical-frame.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";

/** Execution-owned reflective access to optimized slots. Names are literal,
 * never normalized or privately mangled here.
 * Optional indices select physical slots for that adapter; name-only reads
 * prefer the first bound slot; name-only writes target the first slot.
 * The adapter owns arbitrary extra keys, key protocols and fresh guest proxy identities; false
 * or undefined results here allow it to consult that shared extra dictionary. */
export class FrameLocals<Value> {
  readonly #names=new Map<string,number>();
  readonly #freeStart:number;
  readonly #inline:FrameLocals<Value>[];
  readonly #hidden:ReadonlySet<string>;
  readonly #free:ReadonlySet<string>;
  readonly #cellNames:ReadonlySet<string>;
  readonly names:readonly string[];
  constructor(layout:CodeLocalLayout,private readonly locals:Map<string,Value>,private readonly cells:ReadonlyMap<string,CellStorage<Value>>,private readonly meter:ExecutionMeter,hiddenLocals=false,inline:FrameLocals<Value>[]=[],private readonly freeCells:ReadonlyMap<string,CellStorage<Value>>=cells){
    meter.checkpoint(1,352+(layout.freeNames.length+layout.cellNames.length)*40+(hiddenLocals?layout.variableNames.length*40:0));
    this.#inline=inline;
    this.#hidden=new Set(hiddenLocals?layout.variableNames:[]);
    this.#free=new Set(layout.freeNames);
    this.#cellNames=new Set(layout.cellNames);
    const physical:string[]=[];
    for(const names of [layout.variableNames,layout.cellNames])for(const name of names){
      meter.checkpoint();if(this.#names.has(name))continue;
      meter.checkpoint(0,48);this.#names.set(name,physical.length);physical.push(name);
    }
    this.#freeStart=physical.length;
    // Fast/cell parameters share a physical slot; free cells never do, even
    // when a class construction cell has the same name as an enclosing cell.
    for(const name of layout.freeNames){
      meter.checkpoint(1,8);
      if(!this.#names.has(name)){meter.checkpoint(0,40);this.#names.set(name,physical.length);}
      physical.push(name);
    }
    meter.checkpoint(0,32);this.names=Object.freeze(physical);
    Object.freeze(this);
  }
  lookup(name:string,index?:number):{readonly value:Value}|undefined {
    this.meter.checkpoint();
    const slot=index??this.#names.get(name);
    if(slot===undefined||this.names[slot]!==name)return undefined;
    if(slot>=this.#freeStart)return this.freeCells.get(name)?.content;
    for(let index=this.#inline.length-1;index>=0;index--){
      this.meter.checkpoint();const inner=this.#inline[index];
      if(inner.#names.has(name)){
        const value=inner.lookup(name);
        if(value!==undefined||!this.#hidden.has(name)&&!this.#free.has(name))return value;
        break;
      }
    }
    const cell=this.#free.has(name)&&!this.#cellNames.has(name)?undefined:this.cells.get(name);
    if(cell!==undefined&&cell.content!==undefined)return cell.content;
    if(cell!==undefined||!this.locals.has(name))return index===undefined&&this.#free.has(name)?this.freeCells.get(name)?.content:undefined;
    this.meter.checkpoint(0,24);return {value:this.locals.get(name)!};
  }
  store(name:string,value:Value,index?:number):boolean {
    this.meter.checkpoint();
    const slot=index??this.#names.get(name);
    if(slot===undefined||this.names[slot]!==name)return false;
    if(slot>=this.#freeStart){
      const cell=this.freeCells.get(name);if(cell===undefined)return false;
      this.meter.checkpoint(0,24);cell.content={value};return true;
    }
    if(this.#hidden.has(name)){
      const cell=this.#free.has(name)&&!this.#cellNames.has(name)?undefined:this.cells.get(name);if(cell===undefined)return false;
      this.meter.checkpoint(0,24);cell.content={value};return true;
    }
    for(let index=this.#inline.length-1;index>=0;index--){
      this.meter.checkpoint();const inner=this.#inline[index];if(inner.#names.has(name))return inner.store(name,value);
    }
    const cell=this.#free.has(name)&&!this.#cellNames.has(name)?undefined:this.cells.get(name);
    if(cell!==undefined){this.meter.checkpoint(0,24);cell.content={value};}
    else {if(!this.locals.has(name))this.meter.checkpoint(0,48);this.locals.set(name,value);}
    return true;
  }
  writable(name:string,index?:number):boolean {
    this.meter.checkpoint();const slot=index??this.#names.get(name);
    return slot!==undefined&&this.names[slot]===name&&(slot>=this.#freeStart||!this.#hidden.has(name)||(!this.#free.has(name)||this.#cellNames.has(name))&&this.cells.has(name));
  }
  delete(name:string,index?:number):false {
    this.meter.checkpoint();
    if(this.writable(name,index))throw new PythonRuntimeError("ValueError","cannot remove local variables from FrameLocalsProxy");
    return false;
  }
  snapshot():Map<string,Value> {
    this.meter.checkpoint(1,64);const result=new Map<string,Value>();
    for(const name of this.#names.keys()){
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
