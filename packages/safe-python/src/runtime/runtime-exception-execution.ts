import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { HandledExceptionState } from "./exception-state.js";
import { matchExceptionType } from "./exception-matching.js";
import { executeRaise } from "./raise-execution.js";
import { normalizeRaisedException } from "./raise-normalization.js";
import { representationObject } from "./representation-protocol.js";
import { PythonKeyError } from "./runtime-dictionary-access.js";
import { RuntimeExceptionState, runtimeExceptionPayload } from "./runtime-exception-state.js";
import { runtimeTuplePayload } from "./runtime-tuple-payload.js";
import type { RuntimeFrame } from "./runtime-program.js";
import type { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import type { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { standardExceptionCatalog, type StandardExceptionName } from "./standard-exception-catalog.js";
import type { StatementContext } from "./statement-execution.js";
import type { BuiltinInvocationContext, InstanceValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { createExceptionAddNoteDescriptor } from "./builtin-exception-add-note.js";

/** Propagation must never render guest values or expose a host stack to Python. */
export class RuntimeRaisedException {
  constructor(readonly value:InstanceValue,meter:ExecutionMeter) {
    meter.checkpoint(1,32);Object.freeze(this);
  }
}

/** One synchronous execution's exception state, shared across nested frames.
 * Unknown native exception families and arbitrary host failures remain fatal.
 * Tracebacks, suspension and exception groups require separate capabilities. */
export class RuntimeExceptionExecution {
  readonly #handled=new HandledExceptionState<InstanceValue>();
  constructor(private readonly registry:RuntimeTypeRegistry,private readonly values:RuntimeValues,private readonly meter:ExecutionMeter) {
    meter.checkpoint(1,96);Object.freeze(this);
  }
  get active():InstanceValue|null{return this.#handled.active;}

  private exceptionClass(value:RuntimeValue) {
    this.meter.checkpoint();
    if(value.kind!=="type")return undefined;
    for(let base:RuntimeTypeLayout|undefined=value.value;base!==undefined;base=base.layoutBase) {
      this.meter.checkpoint();if(base===this.registry.baseExceptionType().value)return value.value;
    }
    return undefined;
  }
  private chain(value:InstanceValue):RuntimeRaisedException {
    this.#handled.chain(value,{
      get:error=>runtimeExceptionPayload(error)!.context,
      set:(error,context)=>runtimeExceptionPayload(error)!.assignContext(context,this.meter)
    },this.meter);
    return new RuntimeRaisedException(value,this.meter);
  }
  private native(name:StandardExceptionName,args:readonly RuntimeValue[]):InstanceValue {
    const {values,meter}=this,type=this.registry.exceptionType(name);
    const storage=new RuntimeExceptionState(values.tuple(args.length,index=>args[index]),meter);
    if(name==="StopIteration"&&args.length)storage.assignMember("value",args[0],meter);
    meter.checkpoint(0,32);
    return values.instance(type,()=>values.dictionary(type.value.namespace.items.emptyCopy()),storage);
  }
  prepare(error:unknown):unknown {
    if(!(error instanceof PythonRuntimeError)||!Object.hasOwn(standardExceptionCatalog,error.name))return error;
    const args=error instanceof PythonKeyError?error.args:[this.values.string(error.message)];
    const value=this.native(error.name as StandardExceptionName,args);
    if(error.notes!==undefined) {
      const notes=this.values.list([]);
      for(const note of error.notes){this.meter.checkpoint();notes.items.append(this.values.string(note));}
      value.state.ensureDictionary(this.meter);
      value.state.dictionary!.items.set(this.values.string("__notes__"),notes);
    }
    return this.chain(value);
  }
  matches(error:unknown,name:string):boolean {
    if(name!=="BaseException"&&!Object.hasOwn(standardExceptionCatalog,name))return false;
    const type=error instanceof RuntimeRaisedException?error.value.type:
      error instanceof PythonRuntimeError&&Object.hasOwn(standardExceptionCatalog,error.name)?this.registry.exceptionType(error.name as StandardExceptionName):undefined;
    if(type===undefined)return false;
    const target=this.registry.exceptionType(name as StandardExceptionName|"BaseException").value;
    for(const base of type.value.mro){this.meter.checkpoint();if(base===target)return true;}
    return false;
  }
  arguments(error:unknown):readonly RuntimeValue[]|undefined {
    this.meter.checkpoint();
    if(error instanceof RuntimeRaisedException)return runtimeExceptionPayload(error.value)?.args.items;
    return error instanceof PythonKeyError?error.args:undefined;
  }
  addNote(error:unknown,build:()=>string,invocation:BuiltinInvocationContext):unknown {
    const prepared=this.prepare(error),{values,meter}=this;
    if(!(prepared instanceof RuntimeRaisedException)) {
      if(!(prepared instanceof PythonRuntimeError))throw Error("exception notes require a guest exception");
      prepared.addNote(build(),meter);return prepared;
    }
    meter.checkpoint(0,64);
    try {
      const note=build(),method=createExceptionAddNoteDescriptor(this.registry.baseExceptionType(),values,meter);
      invocation.call(method,[prepared.value,values.string(note)]);
      return prepared;
    } catch(failure) {
      // Native note diagnostics assign context directly, preserving even
      // self/cyclic links. Callbacks retain the outer handled exception.
      const replacement=this.prepare(failure);
      if(replacement instanceof RuntimeRaisedException)runtimeExceptionPayload(replacement.value)!.assignContext(prepared.value,meter);
      throw replacement;
    }
  }
  statements(frame:RuntimeFrame):NonNullable<StatementContext<RuntimeValue>["exceptions"]> {
    this.meter.checkpoint(0,160);
    return {
      prepare:error=>this.prepare(error),isGuest:error=>error instanceof RuntimeRaisedException,
      enter:error=>this.#handled.enter((error as RuntimeRaisedException).value),
      handlers:{
        match:(error,type)=>matchExceptionType((error as RuntimeRaisedException).value.type.value,type,{
          exceptionClass:value=>this.exceptionClass(value),tupleItems:value=>runtimeTuplePayload(value)?.items,mro:type=>type.mro
        },this.meter),
        bind:(name,error)=>frame.store(name,(error as RuntimeRaisedException).value),
        clear:name=>{frame.store(name,this.values.none);frame.delete(name);}
      }
    };
  }
  assertions():NonNullable<StatementContext<RuntimeValue>["assertions"]> {
    this.meter.checkpoint(0,64);
    return {enabled:true,fail:message=>{throw this.chain(this.native("AssertionError",message===null?[]:[message.value]));}};
  }
  raise(statement:Extract<Statement,{kind:"raise"}>,evaluate:(expression:Expression)=>RuntimeValue,invocation:BuiltinInvocationContext):never {
    const {meter,values}=this;
    const typeOf=(value:RuntimeValue)=>{
      if(!invocation.actualType)throw Error("exception execution requires an actual-type policy");
      return invocation.actualType(value);
    };
    const repr=(value:RuntimeValue)=>{
      if(!invocation.formatting)throw Error("exception execution requires a representation policy");
      const result=representationObject(value,"repr",invocation.formatting,meter);
      let text="";
      for(const point of invocation.formatting.string(result)!){meter.checkpoint(1,4);text+=String.fromCodePoint(point);}
      return text;
    };
    const isInstance=(value:RuntimeValue)=>runtimeExceptionPayload(value)!==undefined;
    return executeRaise(statement,{
      evaluate,isClass:value=>this.exceptionClass(value)!==undefined,isInstance,isNone:value=>value.kind==="none",typeOf,
      call:type=>invocation.call(type,[]),repr,
      setCause:(exception,cause)=>runtimeExceptionPayload(exception)!.assignCause(cause===null?null:cause.value as InstanceValue,meter),
      active:()=>this.active===null?undefined:{value:this.active},
      reraise:value=>{throw new RuntimeRaisedException(value as InstanceValue,meter);},
      raise:(type,value)=>{
        const normalized=normalizeRaisedException(type,value,{
          typeOf,isInstance,repr,typeName:type=>type.kind==="type"?type.value.name:type.kind,
          isSubclass:(actual,requested)=>{
            const method=invocation.lookupSpecial?.(requested,"__subclasscheck__");
            if(method!==undefined){if(!invocation.truth)throw Error("exception normalization requires a truth policy");return invocation.truth(invocation.call(method,[actual]));}
            if(actual.kind!=="type"||requested.kind!=="type")return false;
            for(const base of actual.value.mro){meter.checkpoint();if(base===requested.value)return true;}return false;
          },
          call:(type,value)=>invocation.call(type,[value]),
          isGuest:error=>error instanceof RuntimeRaisedException||(error instanceof PythonRuntimeError&&Object.hasOwn(standardExceptionCatalog,error.name)),
          addNote:(error,note)=>{
            if(error instanceof PythonRuntimeError){error.addNote(note,meter);return;}
            const method=createExceptionAddNoteDescriptor(this.registry.baseExceptionType(),values,meter);
            invocation.call(method,[(error as RuntimeRaisedException).value,values.string(note)]);
          }
        },meter);
        throw this.chain(normalized as InstanceValue);
      }
    },meter);
  }
}
