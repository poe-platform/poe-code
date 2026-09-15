import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {suggestName} from "./name-suggestion.js";
import type {BuiltinFunctionValue,BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";

export interface DynamicExecutionRequest {
  readonly mode:"eval"|"exec";
  readonly source:RuntimeValue;
  readonly globals:RuntimeValue;
  readonly locals:RuntimeValue;
  /** Always None for eval; exec preserves the supplied object for validation. */
  readonly closure:RuntimeValue;
}
export interface DynamicExecutionContext {
  /** Own namespace/default-local policy, source/code admission, compilation and
   * execution. No host eval, filesystem, or ambient namespace is discovered. */
  execute(request:DynamicExecutionRequest,invocation:BuiltinInvocationContext|undefined,meter:ExecutionMeter):RuntimeValue;
}

/** Python eval/exec call binding only. The backend validates namespaces, code
 * and closures after binding; exec discards any backend expression result. */
export function createDynamicExecutionBuiltin(name:"eval"|"exec",values:RuntimeValues,meter:ExecutionMeter,context:DynamicExecutionContext):BuiltinFunctionValue {
  meter.checkpoint(1,160);
  const parameters=name==="exec"?["globals","locals","closure"]:["globals","locals"];
  const maximum=parameters.length+1;
  return values.builtinFunction({name,keywordValidation:"callee",invoke(positional,keywords,meter,invocation){
    let fatal=false;
    try {
      meter.checkpoint(1,512);
      const count=positional.length+keywords.items.size;
      if(count>maximum)throw new PythonRuntimeError("TypeError",`${name}() takes at most ${maximum} ${positional.length===0?"keyword ":""}arguments (${count} given)`);
      if(positional.length>3)throw new PythonRuntimeError("TypeError",`${name}() takes at most 3 positional arguments (${positional.length} given)`);
      if(positional.length===0)throw new PythonRuntimeError("TypeError",`${name}() takes at least 1 positional argument (0 given)`);
      const args=[positional[0],positional[1]??values.none,positional[2]??values.none,values.none];
      let unexpected:string|undefined,duplicate:number|undefined;
      for(const [key,value] of keywords.items.snapshot()){
        if(key.kind!=="str")throw new PythonRuntimeError("TypeError","keywords must be strings");
        meter.checkpoint(1,32+68*key.value.length);
        let keyword="";for(const point of key.value){meter.checkpoint();keyword+=String.fromCodePoint(point);}
        const index=parameters.indexOf(keyword)+1;
        if(index===0){unexpected??=keyword;continue;}
        if(index<positional.length){duplicate??=index;continue;}
        args[index]=value;
      }
      if(duplicate!==undefined)throw new PythonRuntimeError("TypeError",`argument for ${name}() given by name ('${parameters[duplicate-1]}') and position (${duplicate+1})`);
      if(unexpected!==undefined){
        const suggestion=suggestName(unexpected,parameters,meter);
        meter.checkpoint(1,192+2*unexpected.length);
        throw new PythonRuntimeError("TypeError",`${name}() got an unexpected keyword argument '${unexpected}'${suggestion===undefined?"":`. Did you mean '${suggestion}'?`}`);
      }
      meter.checkpoint(1,80);
      const result=context.execute({mode:name,source:args[0],globals:args[1],locals:args[2],closure:args[3]},invocation,meter);
      return name==="eval"?result:values.none;
    } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }});
}
