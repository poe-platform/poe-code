import {compileCodeLocalLayout} from "./code-local-layout.js";
import type {CompiledFunction} from "./function-compilation.js";
import type {CompiledModule} from "./program-compilation.js";
import type {CompiledClassBody} from "./class-compilation.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

const members=["co_name","co_qualname","co_filename","co_flags","co_firstlineno","co_argcount","co_posonlyargcount","co_kwonlyargcount","co_nlocals"] as const;
const tuples=["co_varnames","co_cellvars","co_freevars"] as const;

export type RuntimeCompiledCode=CompiledFunction<RuntimeValue>|CompiledModule<RuntimeValue>|CompiledClassBody<RuntimeValue>;

/** Compiler identity and immutable reflected metadata, not a host function. */
export interface RuntimeCodeState {
  readonly kind:"code";
  readonly code:RuntimeCompiledCode;
  readonly fields:ReadonlyMap<string,RuntimeValue>;
}

export function createRuntimeCodeState(code:RuntimeCompiledCode,values:RuntimeValues,meter:ExecutionMeter):RuntimeCodeState {
  const layout=("localLayout" in code?code.localLayout:undefined)??compileCodeLocalLayout(code.scope,meter);
  const node=code.scope.scope.node;
  const name="name" in code?code.name:values.string(node.kind==="class"?node.name.name:"<module>");
  const qualifiedName="qualifiedName" in code?code.qualifiedName:name;
  const firstLine="firstLine" in code?code.firstLine:values.integer(1);
  meter.checkpoint(0,448);
  const fields=new Map<string,RuntimeValue>([
    ["co_name",name],["co_qualname",qualifiedName],["co_firstlineno",firstLine],
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
