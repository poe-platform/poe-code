import {compileFunctionLocalLayout} from "./function-local-layout.js";
import type {CompiledFunction} from "./function-compilation.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

const members=["co_name","co_qualname","co_filename","co_flags","co_firstlineno","co_argcount","co_posonlyargcount","co_kwonlyargcount","co_nlocals"] as const;
const tuples=["co_varnames","co_cellvars","co_freevars"] as const;

/** Compiler identity and immutable reflected metadata, not a host function. */
export interface RuntimeCodeState {
  readonly kind:"code";
  readonly code:CompiledFunction<RuntimeValue>;
  readonly fields:ReadonlyMap<string,RuntimeValue>;
}

export function createRuntimeCodeState(code:CompiledFunction<RuntimeValue>,values:RuntimeValues,meter:ExecutionMeter):RuntimeCodeState {
  const layout=code.localLayout??compileFunctionLocalLayout(code.scope,meter);
  meter.checkpoint(0,448);
  const fields=new Map<string,RuntimeValue>([
    ["co_name",code.name],["co_qualname",code.qualifiedName],["co_firstlineno",code.firstLine],
    ["co_argcount",values.integer(layout.positionalCount)],["co_posonlyargcount",values.integer(layout.positionalOnlyCount)],
    ["co_kwonlyargcount",values.integer(layout.keywordOnlyCount)],["co_nlocals",values.integer(layout.variableNames.length)]
  ]);
  if(code.source!==undefined){meter.checkpoint(0,32);fields.set("co_filename",code.source.filename);}
  if(code.flags!==undefined){meter.checkpoint(0,32);fields.set("co_flags",values.integer(code.flags));}
  for(const [name,names] of [["co_varnames",layout.variableNames],["co_cellvars",layout.cellNames],["co_freevars",layout.freeNames]] as const){
    fields.set(name,values.tuple(names.length,index=>values.string(names[index])));
  }
  return Object.freeze({kind:"code",code,fields});
}

export function installRuntimeCodeDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  for(const name of [...members,...tuples]){
    meter.checkpoint(0,96);
    const capability={owner,name,accepts:(value:RuntimeValue)=>value.kind==="instance"&&value.type===owner&&value.native?.kind==="code",
      get(receiver:RuntimeValue,meter:ExecutionMeter){
        meter.checkpoint();
        if(receiver.kind!=="instance"||receiver.native?.kind!=="code")throw Error("code descriptor requires native storage");
        const value=receiver.native.fields.get(name);
        if(value===undefined)throw Error("missing compiler code metadata");
        return value;
      }
    };
    owner.value.namespace.items.set(values.string(name),(tuples as readonly string[]).includes(name)?values.getsetDescriptor(capability):values.memberDescriptor(capability));
  }
}
