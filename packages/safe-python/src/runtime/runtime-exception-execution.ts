import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import { PythonSyntaxError } from "../source.js";
import { PythonIndentationError, PythonTabError } from "../indentation.js";
import { PythonRuntimeError } from "./error.js";
import { PythonEncodeError } from "./encode-error.js";
import { PythonDecodeError } from "./decode-error.js";
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
import { GeneratorExecution,type GeneratorInput } from "./generator-execution.js";
import type { CallStack } from "./call-stack.js";
import { normalizeThrownException } from "./throw-normalization.js";

/** Propagation must never render guest values or expose a host stack to Python. */
export class RuntimeRaisedException {
  constructor(readonly value:InstanceValue,meter:ExecutionMeter) {
    meter.checkpoint(1,32);Object.freeze(this);
  }
}

/** One execution's exception state, shared across nested and suspended frames.
 * Unknown native exception families and arbitrary host failures remain fatal.
 * Tracebacks and exception groups require separate capabilities. */
export class RuntimeExceptionExecution {
  readonly #handled:HandledExceptionState<InstanceValue>;
  constructor(private readonly registry:RuntimeTypeRegistry,private readonly values:RuntimeValues,private readonly meter:ExecutionMeter) {
    meter.checkpoint(1,160);this.#handled=new HandledExceptionState<InstanceValue>();Object.freeze(this);
  }
  get active():InstanceValue|null{return this.#handled.active;}

  /** Native completion does not implicitly chain the caller's handled error. */
  completion(value:RuntimeValue):RuntimeRaisedException {
    this.meter.checkpoint(0,8);
    return new RuntimeRaisedException(this.native("StopIteration",value.kind==="none"?[]:[value]),this.meter);
  }

  /** Assemble an unstarted native generator around a trusted resumable body.
   * Only the running body owns a call-stack entry and saved exception activation. */
  generator(driver:(input:GeneratorInput<RuntimeValue>)=>IteratorResult<RuntimeValue,RuntimeValue>,frame:object,calls:Pick<CallStack<object>,"enter">):InstanceValue {
    const {values,meter}=this;
    meter.checkpoint(0,512);
    const handled=this.#handled.createFrame(meter);
    const execution=new GeneratorExecution<RuntimeValue>(input=>{
      try {
        if(input.kind==="throw"&&input.error instanceof RuntimeRaisedException) {
          meter.checkpoint(0,32);
          input={kind:"throw",error:this.chain(input.error.value,"local")};
        }
        return driver(input);
      }
      catch(error){throw this.prepare(error);}
    },{
      none:values.none,
      enter:()=>{
        meter.checkpoint(0,64);
        const leave=calls.enter(frame);
        let restore:()=>void;
        try {restore=this.#handled.activate(handled,meter);}
        catch(error){leave();throw error;}
        return ()=>{restore();leave();};
      },
      generatorExit:()=>new RuntimeRaisedException(this.native("GeneratorExit",[]),meter),
      isGeneratorExit:error=>this.matches(error,"GeneratorExit"),
      isStopIteration:error=>this.matches(error,"StopIteration"),
      wrapStopIteration:error=>{
        const original=this.prepare(error);
        if(!(original instanceof RuntimeRaisedException))throw Error("generator conversion requires native StopIteration");
        const replacement=this.native("RuntimeError",[values.string("generator raised StopIteration")]),storage=runtimeExceptionPayload(replacement)!;
        storage.assignCause(original.value,meter);storage.assignContext(original.value,meter);
        return new RuntimeRaisedException(replacement,meter);
      }
    },meter);
    return values.instance(this.registry.generatorType(),undefined,Object.freeze({kind:"generator",execution,exceptions:this}));
  }

  private exceptionClass(value:RuntimeValue) {
    this.meter.checkpoint();
    if(value.kind!=="type")return undefined;
    for(let base:RuntimeTypeLayout|undefined=value.value;base!==undefined;base=base.layoutBase) {
      this.meter.checkpoint();if(base===this.registry.baseExceptionType().value)return value.value;
    }
    return undefined;
  }
  private chain(value:InstanceValue,source:"active"|"local"="active"):RuntimeRaisedException {
    this.#handled.chain(value,{
      get:error=>runtimeExceptionPayload(error)!.context,
      set:(error,context)=>runtimeExceptionPayload(error)!.assignContext(context,this.meter)
    },this.meter,source);
    return new RuntimeRaisedException(value,this.meter);
  }
  private native(name:StandardExceptionName,args:readonly RuntimeValue[]):InstanceValue {
    const {values,meter}=this,type=this.registry.exceptionType(name);
    const storage=new RuntimeExceptionState(values.tuple(args.length,index=>args[index]),meter);
    if(name==="StopIteration"&&args.length)storage.assignMember("value",args[0],meter);
    meter.checkpoint(0,32);
    return values.instance(type,()=>values.dictionary(type.value.namespace.items.emptyCopy()),storage);
  }
  private parserType(error:PythonSyntaxError):"SyntaxError"|"IndentationError"|"TabError" {
    return error instanceof PythonTabError?"TabError":error instanceof PythonIndentationError?"IndentationError":"SyntaxError";
  }
  prepare(error:unknown):unknown {
    if(error instanceof PythonSyntaxError) {
      const {values,meter}=this;
      meter.checkpoint(0,64);
      const message=values.string(error.message),filename=values.string(error.filename),line=values.integer(error.position.line),offset=values.integer(error.position.column+1);
      const text=error.sourceLine===undefined?values.none:values.string(error.sourceLine);
      const endLine=error.endPosition===undefined?values.none:values.integer(error.endPosition.line),endOffset=error.endPosition===undefined?values.none:values.integer(error.endPosition.column+1);
      const details=values.tuple(error.endPosition===undefined?[filename,line,offset,text]:[filename,line,offset,text,endLine,endOffset]);
      const value=this.native(this.parserType(error),[message,details]),storage=runtimeExceptionPayload(value)!;
      storage.assignMember("msg",message,meter);storage.assignMember("filename",filename,meter);
      storage.assignMember("lineno",line,meter);storage.assignMember("offset",offset,meter);
      storage.assignMember("text",text,meter);storage.assignMember("end_lineno",endLine,meter);storage.assignMember("end_offset",endOffset,meter);
      return this.chain(value);
    }
    if(!(error instanceof PythonRuntimeError)||!Object.hasOwn(standardExceptionCatalog,error.name))return error;
    const codec=error instanceof PythonEncodeError||error instanceof PythonDecodeError;
    this.meter.checkpoint(0,codec?80:0);
    const args=codec?[this.values.string(error.encoding),error instanceof PythonEncodeError?this.values.stringPoints(error.object):this.values.bytes(error.object),this.values.integer(error.start),this.values.integer(error.end),this.values.string(error.reason)]:error instanceof PythonKeyError?error.args:[this.values.string(error.message)];
    const value=this.native(error.name as StandardExceptionName,args);
    if(codec) {
      const storage=runtimeExceptionPayload(value)!;
      const fields=["encoding","object","start","end","reason"];
      for(let index=0;index<fields.length;index++){this.meter.checkpoint();storage.assignMember(fields[index],args[index],this.meter);}
    }
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
    const type=error instanceof RuntimeRaisedException?error.value.type:error instanceof PythonSyntaxError?this.registry.exceptionType(this.parserType(error)):
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
  private normalization(invocation:BuiltinInvocationContext) {
    const {meter}=this;
    meter.checkpoint(0,384);
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
    return {typeOf,repr,isInstance,typeName:(type:RuntimeValue)=>type.kind==="type"?type.value.name:type.kind,
      isSubclass:(actual:RuntimeValue,requested:RuntimeValue)=>{
        const method=invocation.lookupSpecial?.(requested,"__subclasscheck__");
        if(method!==undefined){if(!invocation.truth)throw Error("exception normalization requires a truth policy");return invocation.truth(invocation.call(method,[actual]));}
        if(actual.kind!=="type"||requested.kind!=="type")return false;
        for(const base of actual.value.mro){meter.checkpoint();if(base===requested.value)return true;}return false;
      }
    };
  }
  /** Validation failures stay outside the generator; normalization failures
   * become the exception injected by a subsequent lifecycle resume. */
  throwError(requested:RuntimeValue,value:RuntimeValue,invocation:BuiltinInvocationContext):RuntimeRaisedException {
    const context=this.normalization(invocation),{meter}=this;
    if(this.exceptionClass(requested)===undefined) {
      if(!context.isInstance(requested))throw new PythonRuntimeError("TypeError",`exceptions must be classes or instances deriving from BaseException, not ${context.typeOf(requested).value.name}`);
      if(value.kind!=="none")throw new PythonRuntimeError("TypeError","instance exception may not have a separate value");
      return new RuntimeRaisedException(requested as InstanceValue,meter);
    }
    meter.checkpoint(0,384);
    const normalized=normalizeThrownException(requested,value,{
      ...context,isNone:value=>value.kind==="none",tupleItems:value=>runtimeTuplePayload(value)?.items,
      call:(type,args)=>invocation.call(type,args),
      failure:error=>{
        const prepared=this.prepare(error);
        if(!(prepared instanceof RuntimeRaisedException))throw prepared;
        return prepared.value;
      }
    },meter);
    return new RuntimeRaisedException(normalized as InstanceValue,meter);
  }
  raise(statement:Extract<Statement,{kind:"raise"}>,evaluate:(expression:Expression)=>RuntimeValue,invocation:BuiltinInvocationContext):never {
    const {meter,values}=this,normalization=this.normalization(invocation),{typeOf,repr,isInstance}=normalization;
    return executeRaise(statement,{
      evaluate,isClass:value=>this.exceptionClass(value)!==undefined,isInstance,isNone:value=>value.kind==="none",typeOf,
      call:type=>invocation.call(type,[]),repr,
      setCause:(exception,cause)=>runtimeExceptionPayload(exception)!.assignCause(cause===null?null:cause.value as InstanceValue,meter),
      active:()=>this.active===null?undefined:{value:this.active},
      reraise:value=>{throw new RuntimeRaisedException(value as InstanceValue,meter);},
      raise:(type,value)=>{
        const normalized=normalizeRaisedException(type,value,{
          ...normalization,
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
