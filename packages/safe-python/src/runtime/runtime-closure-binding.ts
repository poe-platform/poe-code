import {compileCodeLocalLayout} from "./code-local-layout.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {LexicalCell} from "./lexical-frame.js";
import type {RuntimeCompiledCode} from "./runtime-code.js";
import type {RuntimeValue} from "./runtime-values.js";

/** Attach compiler ownership to a view of validated guest cells. Never attach
 * owners to the original storage: one cell may bind several names or programs.
 * Clearing content uses the setter, just like replacing a bound value. */
export function bindRuntimeCodeClosure(code:RuntimeCompiledCode,closure:Extract<RuntimeValue,{kind:"tuple"}>|undefined,meter:ExecutionMeter):ReadonlyMap<string,LexicalCell<RuntimeValue>> {
  meter.checkpoint(1,64);
  try {
    const layout=("localLayout" in code?code.localLayout:undefined)??compileCodeLocalLayout(code.scope,meter);
    const names=layout.freeNames;
    if((closure?.items.length??0)!==names.length)throw Error("closure binding requires validated cells");
    const result=new Map<string,LexicalCell<RuntimeValue>>();
    for(let index=0;index<names.length;index++){
      meter.checkpoint(1,184);
      const name=names[index],cell=closure!.items[index],owner=code.scope.free.get(name);
      if(cell.kind!=="cell"||owner===undefined)throw Error("closure binding requires validated cells");
      const storage=cell.value;
      result.set(name,Object.freeze({owner,original:storage,get content(){return storage.content;},set content(value){storage.content=value;}}));
    }
    return result;
  } finally {meter.checkpoint();}
}
