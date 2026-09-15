import type {DynamicExecutionRequest} from "./builtin-dynamic-execution.js";
import {compileCodeLocalLayout} from "./code-local-layout.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeCompiledCode} from "./runtime-code.js";
import type {RuntimeValue} from "./runtime-values.js";

/** Validate after namespace selection, before source conversion or execution.
 * Exact tuples/cells only: no iteration, subclass slots or cell-content reads.
 * The retained tuple keeps aliasing and empty cells intact for the executor. */
export function prepareDynamicCodeClosure(request:Pick<DynamicExecutionRequest,"mode"|"closure">,code:RuntimeCompiledCode|undefined,meter:ExecutionMeter):Extract<RuntimeValue,{kind:"tuple"}>|undefined {
  meter.checkpoint(1,320);
  try {
    const {mode,closure}=request;
    if(code===undefined){
      if(mode==="exec"&&closure.kind!=="none")throw new PythonRuntimeError("TypeError","closure can only be used when source is a code object");
      return undefined;
    }
    const layout=("localLayout" in code?code.localLayout:undefined)??compileCodeLocalLayout(code.scope,meter);
    const count=layout.freeNames.length;
    if(mode==="eval"){
      if(count!==0)throw new PythonRuntimeError("TypeError","code object passed to eval() may not contain free variables");
      return undefined;
    }
    if(count===0){
      if(closure.kind!=="none")throw new PythonRuntimeError("TypeError","cannot use a closure with this code object");
      return undefined;
    }
    let valid=closure.kind==="tuple"&&closure.items.length===count;
    if(valid&&closure.kind==="tuple")for(const cell of closure.items){meter.checkpoint();if(cell.kind!=="cell"){valid=false;break;}}
    if(!valid)throw new PythonRuntimeError("TypeError",`code object requires a closure of exactly length ${count}`);
    return closure as Extract<RuntimeValue,{kind:"tuple"}>;
  } finally {meter.checkpoint();}
}
