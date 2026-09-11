import {compileCodeLocalLayout} from "./code-local-layout.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {FunctionValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Stable per-function tuple in co_freevars order, with execution-wide canonical
 * cells. Publishing the tuple never reads cell contents or copies their values. */
export function runtimeFunctionClosure(fn:FunctionValue,values:RuntimeValues,meter:ExecutionMeter):RuntimeValue {
  meter.checkpoint();
  try {
    const state=fn.value;
    if(state.closureObject!==undefined)return state.closureObject;
    const names=(state.code.localLayout??compileCodeLocalLayout(state.code.scope,meter)).freeNames;
    const result=names.length===0?values.none:values.tuple(names.length,index=>{
      const cell=state.closure.get(names[index]);
      if(cell===undefined)throw Error("function closure reflection requires captured cells");
      return values.cell(cell);
    });
    meter.checkpoint(1,48);state.closureObject=result;return result;
  } finally {meter.checkpoint();}
}
