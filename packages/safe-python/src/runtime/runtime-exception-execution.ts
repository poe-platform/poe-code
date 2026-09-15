import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import { PythonSyntaxError } from "../source.js";
import { PythonIndentationError, PythonTabError } from "../indentation.js";
import { PythonRuntimeError } from "./error.js";
import { PythonUnicodeMessageError,PythonUnicodeSyntaxError } from "./unicode-message-error.js";
import { PythonNameError } from "./name-error.js";
import { PythonEncodeError } from "./encode-error.js";
import { PythonDecodeError } from "./decode-error.js";
import { ExecutionLimitError,type ExecutionMeter } from "./execution-budget.js";
import { HandledExceptionState } from "./exception-state.js";
import { matchExceptionType } from "./exception-matching.js";
import { createRaiseContinuation, executeRaise, type RaiseContext } from "./raise-execution.js";
import { normalizeRaisedException } from "./raise-normalization.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import { PythonKeyError } from "./runtime-dictionary-access.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import { RuntimeExceptionState, runtimeExceptionPayload } from "./runtime-exception-state.js";
import { runtimeTuplePayload } from "./runtime-tuple-payload.js";
import type { RuntimeFrame } from "./runtime-program.js";
import type { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import type { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { standardExceptionCatalog, type StandardExceptionName } from "./standard-exception-catalog.js";
import type { StatementContext } from "./statement-execution.js";
import type { BuiltinInvocationContext, ExceptionPreparationValues, InstanceValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { createExceptionAddNoteDescriptor } from "./builtin-exception-add-note.js";
import { GeneratorExecution,type GeneratorInput,type GeneratorDelegation } from "./generator-execution.js";
import type { CallStack } from "./call-stack.js";
import { LexicalFrame } from "./lexical-frame.js";
import { normalizeThrownException } from "./throw-normalization.js";
import type {RuntimeSuspensionNames} from "./runtime-generator-state.js";

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
  wrapAnext(wrapped:RuntimeValue,defaultValue:RuntimeValue):InstanceValue {
    this.meter.checkpoint(1,64);
    return this.values.instance(this.registry.anextAwaitableType(),undefined,Object.freeze({kind:"anext_awaitable",wrapped,defaultValue,exceptions:this}));
  }

  /** Native completion does not implicitly chain the caller's handled error. */
  completion(value:RuntimeValue,preserveNone=false):RuntimeRaisedException {
    this.meter.checkpoint(0,8);
    return new RuntimeRaisedException(this.native("StopIteration",value.kind==="none"&&!preserveNone?[]:[value]),this.meter);
  }

  /** Internal termination signals bypass guest constructors and caller chaining. */
  signal(name:"GeneratorExit"|"StopAsyncIteration"):RuntimeRaisedException {
    return new RuntimeRaisedException(this.native(name,[]),this.meter);
  }

  /** Replace a guest protocol error with a contextual diagnostic, retaining its
   * original cause/context. Opaque host failures and execution limits escape. */
  caused(error:unknown,name:StandardExceptionName,message:string):RuntimeRaisedException {
    const original=this.prepare(error);
    if(!(original instanceof RuntimeRaisedException))throw original;
    const value=this.native(name,[this.values.string(message)]),storage=runtimeExceptionPayload(value)!;
    storage.assignCause(original.value,this.meter);storage.assignContext(original.value,this.meter);
    return new RuntimeRaisedException(value,this.meter);
  }

  /** Execute the codec's `except UnicodeDecodeError` replacement using guest
   * descriptors and the actual exception constructor. Attribute/index failures
   * are raised while the original exception is handled, before suppression. */
  rewriteDecodeError(error:unknown,encoding:string,source:RuntimeValue,invocation:BuiltinInvocationContext):never {
    const original=this.prepare(error),{values,meter}=this;
    if(!(original instanceof RuntimeRaisedException))throw original;
    if(invocation.attribute===undefined)throw Error("codec exception rewriting requires guest attributes");
    const restore=this.#handled.enter(original.value);
    try {
      meter.checkpoint();
      const start=invocation.attribute(original.value,"start");
      meter.checkpoint();
      const end=invocation.attribute(original.value,"end");
      meter.checkpoint();
      const reason=invocation.attribute(original.value,"reason");
      meter.checkpoint();
      const replacement=invocation.call(this.registry.exceptionType("UnicodeDecodeError"),[values.string(encoding),source,start,end,reason]);
      meter.checkpoint();
      if(replacement.kind!=="instance")throw Error("UnicodeDecodeError construction requires an exception instance");
      const state=runtimeExceptionPayload(replacement)!;
      state.assignCause(null,meter);
      throw this.chain(replacement);
    }catch(failure){
      // Descriptors and constructors can cancel and then return or fail. Do
      // not invoke another guest boundary or expose a catchable failure after
      // cancellation; preserve an existing fatal failure without rechecking.
      if(!(failure instanceof ExecutionLimitError))meter.checkpoint();
      throw this.prepare(failure);
    }
    finally{restore();}
  }

  /** Assemble an unstarted generator/coroutine around a trusted resumable body.
   * Only the running body owns a call-stack entry and saved exception activation. */
  generator(driver:(input:GeneratorInput<RuntimeValue>)=>IteratorResult<RuntimeValue,RuntimeValue>,frame:object,calls:Pick<CallStack<object>,"enter">,delegation?:GeneratorDelegation<RuntimeValue>,kind:"generator"|"coroutine"|"async-generator"="generator",functionNames?:Readonly<RuntimeSuspensionNames>):InstanceValue {
    const {values,meter}=this;
    const executionKind=kind==="async-generator"?"async generator":kind;
    meter.checkpoint(0,512);
    const handled=this.#handled.createFrame(meter);
    const execution=new GeneratorExecution<RuntimeValue>(input=>{
      try {
        if(input.kind==="throw"&&input.error instanceof RuntimeRaisedException) {
          meter.checkpoint(0,32);
          input={...input,error:this.chain(input.error.value,"local")};
        }
        return driver(input);
      }
      catch(error){throw this.prepare(error);}
    },{
      none:values.none,frame,kind:executionKind,delegation,enterDelegated:activate=>calls.enter(frame,{activate,retainCaller:false}),
      finish:()=>{if(frame instanceof LexicalFrame)frame.inlineLocals.length=0;},
      enter:()=>{
        meter.checkpoint(0,64);
        const leave=calls.enter(frame,{retainCaller:false});
        let restore:()=>void;
        try {restore=this.#handled.activate(handled,meter);}
        catch(error){leave();throw error;}
        return ()=>{restore();leave();};
      },
      generatorExit:()=>new RuntimeRaisedException(this.native("GeneratorExit",[]),meter),
      isGeneratorExit:error=>this.matches(error,"GeneratorExit"),
      isStopIteration:error=>this.matches(error,"StopIteration"),
      isStopAsyncIteration:error=>this.matches(error,"StopAsyncIteration"),
      wrapStopIteration:error=>{
        const original=this.prepare(error);
        if(!(original instanceof RuntimeRaisedException))throw Error("generator conversion requires native StopIteration");
        const termination=this.matches(original,"StopIteration")?"StopIteration":"StopAsyncIteration";
        const replacement=this.native("RuntimeError",[values.string(`${executionKind} raised ${termination}`)]),storage=runtimeExceptionPayload(replacement)!;
        storage.assignCause(original.value,meter);storage.assignContext(original.value,meter);
        return new RuntimeRaisedException(replacement,meter);
      }
    },meter);
    let result:InstanceValue;
    const code=frame instanceof LexicalFrame?frame.code:undefined;
    const originalNames=functionNames??code;
    let names:RuntimeSuspensionNames|undefined;
    if(originalNames!==undefined){meter.checkpoint(1,48);names={name:originalNames.name,qualifiedName:originalNames.qualifiedName};}
    if(kind==="async-generator") {
      meter.checkpoint(0,64);
      result=values.instance(this.registry.asyncGeneratorType(),undefined,Object.freeze({kind:"async_generator",execution,exceptions:this,code,names,activity:{running:false,closed:false}}));
    }
    else result=values.instance(kind==="generator"?this.registry.generatorType():this.registry.coroutineType(),undefined,Object.freeze({kind,execution,exceptions:this,code,names}));
    if(frame instanceof LexicalFrame)this.registry.registerFrameGenerator(frame,result);
    return result;
  }

  private exceptionClass(value:RuntimeValue) {
    this.meter.checkpoint();
    if(value.kind!=="type")return undefined;
    for(let base:RuntimeTypeLayout|undefined=value.value;base!==undefined;base=base.layoutBase) {
      this.meter.checkpoint();if(base===this.registry.baseExceptionType().value)return value.value;
    }
    return undefined;
  }
  /** A new raise, including native handlers raising an existing instance.
   * Ordinary propagation must not replace the exception's existing context. */
  chain(value:InstanceValue,source:"active"|"local"="active"):RuntimeRaisedException {
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
  /** _PyTokenizer_raise_init_error fetches the current error before calling
   * guest code. It preserves SyntaxError instances/args and otherwise renders
   * ValueError/LookupError descendants into a new native SyntaxError. Failures
   * of rendering or filename assignment propagate without another translation. */
  sourceFailure(error:unknown,filename:RuntimeValue,invocation:BuiltinInvocationContext):never {
    let fatal=error instanceof ExecutionLimitError;
    try {
      if(fatal)throw error;
      const {values,meter}=this;
      meter.checkpoint();
      const syntax=this.matches(error,"SyntaxError");
      if(!syntax&&!this.matches(error,"ValueError")&&!this.matches(error,"LookupError"))throw error;
      const prepared=this.prepare(error,{unraised:true,syntaxFilename:filename});
      if(!(prepared instanceof RuntimeRaisedException))throw prepared;
      if(syntax){
        if(invocation.setAttribute===undefined)throw Error("source exceptions require guest attribute mutation");
        invocation.setAttribute(prepared.value,"filename",filename);
        meter.checkpoint();
        throw prepared;
      }
      if(invocation.formatting===undefined)throw Error("source exceptions require guest formatting");
      const message=representationObject(prepared.value,"str",invocation.formatting,meter);
      meter.checkpoint();
      const line=values.integer(0),offset=values.integer(-1);
      const details=values.tuple([filename,line,offset,values.none]);
      const replacement=this.native("SyntaxError",[message,details]),state=runtimeExceptionPayload(replacement)!;
      for(const [name,value] of [["msg",message],["filename",filename],["lineno",line],["offset",offset],["text",values.none],["end_lineno",values.none],["end_offset",values.none]] as const)state.assignMember(name,value,meter);
      throw this.chain(replacement);
    }catch(failure){fatal=failure instanceof ExecutionLimitError;throw failure;}
    finally{if(!fatal)this.meter.checkpoint();}
  }
  prepare(failure:unknown,retained?:ExceptionPreparationValues):unknown {
    // Hash provenance is internal. Operations which do not add a container
    // diagnostic must propagate the original exception without rendering it.
    while(failure instanceof RuntimeHashError){this.meter.checkpoint();failure=failure.original;}
    const error=failure;
    if(error instanceof PythonSyntaxError) {
      const {values,meter}=this;
      meter.checkpoint(0,64);
      const message=error instanceof PythonUnicodeSyntaxError?values.stringPoints(error.messagePoints):values.string(error.message);
      const filename=retained?.syntaxFilename??values.string(error.filename),line=values.integer(error.position.line),offset=values.integer(error.position.column+1);
      const text=error.sourceLine===undefined?values.none:values.string(error.sourceLine);
      const endLine=error.endPosition===undefined?values.none:values.integer(error.endPosition.line),endOffset=error.endPosition===undefined?values.none:values.integer(error.endPosition.column+1);
      const argumentFilename=error.argumentFilename===undefined?filename:error.argumentFilename===null?values.none:values.string(error.argumentFilename);
      const details=values.tuple(error.endPosition===undefined?[argumentFilename,line,offset,text]:[argumentFilename,line,offset,text,endLine,endOffset]);
      const value=this.native(this.parserType(error),[message,details]),storage=runtimeExceptionPayload(value)!;
      storage.assignMember("msg",message,meter);storage.assignMember("filename",filename,meter);
      storage.assignMember("lineno",line,meter);storage.assignMember("offset",offset,meter);
      storage.assignMember("text",text,meter);storage.assignMember("end_lineno",endLine,meter);storage.assignMember("end_offset",endOffset,meter);
      return retained?.unraised?new RuntimeRaisedException(value,meter):this.chain(value);
    }
    if(!(error instanceof PythonRuntimeError)||!Object.hasOwn(standardExceptionCatalog,error.name))return error;
    const codec=error instanceof PythonEncodeError||error instanceof PythonDecodeError;
    this.meter.checkpoint(0,codec?80:0);
    const args=codec?[this.values.string(error.encoding),retained?.unicodeObject??(error instanceof PythonEncodeError?this.values.stringPoints(error.object):this.values.bytes(error.object)),this.values.integer(error.start),this.values.integer(error.end),this.values.string(error.reason)]:error instanceof PythonKeyError?error.args:error instanceof PythonUnicodeMessageError?[this.values.stringPoints(error.messagePoints)]:error.argumentMessage===undefined?[]:[this.values.string(error.argumentMessage)];
    // Built-in surrogate handlers reuse the first Unicode error. Its args
    // retain that first fault while the live fields describe the final failure.
    const initial=codec?error.initial:undefined;
    this.meter.checkpoint(0,initial===undefined?0:40);
    const value=this.native(error.name as StandardExceptionName,initial===undefined?args:[args[0],args[1],this.values.integer(initial.start),this.values.integer(initial.end),this.values.string(initial.reason)]);
    // Syntax errors raised before parsing have only a message argument. They
    // still initialize the native msg member, leaving all locations unset.
    if(args.length!==0&&error.name==="SyntaxError")runtimeExceptionPayload(value)!.assignMember("msg",args[0],this.meter);
    if(error instanceof PythonNameError)runtimeExceptionPayload(value)!.assignMember("name",this.values.string(error.identifier),this.meter);
    if(error.name==="AttributeError"&&retained?.attribute!==undefined){
      const storage=runtimeExceptionPayload(value)!;
      storage.assignMember("name",retained.attribute.name,this.meter);
      storage.assignMember("obj",retained.attribute.object,this.meter);
    }
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
    const result=retained?.unraised?new RuntimeRaisedException(value,this.meter):this.chain(value);
    if(error.chaining!==undefined){
      const context=this.prepare(error.chaining.context);
      if(!(context instanceof RuntimeRaisedException))throw context;
      const storage=runtimeExceptionPayload(value)!;
      storage.assignContext(context.value,this.meter);
      storage.assignSuppression(error.chaining.suppressContext??false,this.meter);
    }
    return result;
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
  /** Classify a raw throw target without constructing it or invoking guest
   * subclass checks. Delegated GeneratorExit handling precedes normalization. */
  matchesThrowTarget(value:RuntimeValue,name:StandardExceptionName):boolean {
    const type=value.kind==="type"?value:value.kind==="instance"&&runtimeExceptionPayload(value)!==undefined?value.type:undefined;
    if(type===undefined)return false;
    const target=this.registry.exceptionType(name).value;
    for(const base of type.value.mro){this.meter.checkpoint();if(base===target)return true;}
    return false;
  }
  arguments(error:unknown):readonly RuntimeValue[]|undefined {
    this.meter.checkpoint();
    if(error instanceof RuntimeRaisedException)return runtimeExceptionPayload(error.value)?.args.items;
    return error instanceof PythonKeyError?error.args:undefined;
  }
  describe(error:unknown,name:"TypeError",formatting:RepresentationContext<RuntimeValue>):(()=>string)|undefined {
    this.meter.checkpoint();
    if(!(error instanceof RuntimeRaisedException)||error.value.type!==this.registry.exceptionType(name))return undefined;
    this.meter.checkpoint(0,32);
    return ()=>{
      const rendered=representationObject(error.value,"str",formatting,this.meter);
      let text="";
      for(const point of formatting.string(rendered)!){this.meter.checkpoint(1,point>0xffff?4:2);text+=String.fromCodePoint(point);}
      return text;
    };
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
      meter.checkpoint();
      return prepared;
    } catch(failure) {
      // Formatting and note attachment can cross explicit service boundaries.
      // Observe cancellation before preparing or chaining their failures;
      // already fatal failures retain their identity.
      if(!(failure instanceof ExecutionLimitError))meter.checkpoint();
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
  throwError(requested:RuntimeValue,value:RuntimeValue,invocation:BuiltinInvocationContext,traceback?:RuntimeValue):RuntimeRaisedException {
    this.meter.checkpoint();
    if(traceback!==undefined&&traceback.kind!=="none"&&(traceback.kind!=="instance"||traceback.native?.kind!=="traceback"))throw new PythonRuntimeError("TypeError","throw() third argument must be a traceback object");
    const context=this.normalization(invocation),{meter}=this;
    let normalized:RuntimeValue,failed=false;
    try {
      if(this.exceptionClass(requested)===undefined) {
        if(!context.isInstance(requested))throw new PythonRuntimeError("TypeError",`exceptions must be classes or instances deriving from BaseException, not ${context.typeOf(requested).value.name}`);
        if(value.kind!=="none")throw new PythonRuntimeError("TypeError","instance exception may not have a separate value");
        normalized=requested;
      } else {
        meter.checkpoint(0,384);
        normalized=normalizeThrownException(requested,value,{
          ...context,isNone:value=>value.kind==="none",tupleItems:value=>runtimeTuplePayload(value)?.items,
          call:(type,args)=>invocation.call(type,args),
          failure:error=>{
            const prepared=this.prepare(error);
            if(!(prepared instanceof RuntimeRaisedException))throw prepared;
            failed=true;
            return prepared.value;
          }
        },meter);
      }
      const result=new RuntimeRaisedException(normalized as InstanceValue,meter);
      // Normalization failures retain their own traceback; None preserves an
      // existing exception traceback rather than explicitly clearing it.
      if(!failed&&traceback?.kind==="instance")runtimeExceptionPayload(result.value)!.assignTraceback(traceback,meter);
      return result;
    }finally{meter.checkpoint();}
  }
  raise(statement:Extract<Statement,{kind:"raise"}>,evaluate:(expression:Expression)=>RuntimeValue,invocation:BuiltinInvocationContext):never {
    return executeRaise(statement,this.raising(evaluate,invocation),this.meter);
  }
  raiseContinuation(statement:Extract<Statement,{kind:"raise"}>,evaluate:(expression:Expression)=>Generator<RuntimeValue,RuntimeValue,RuntimeValue>,invocation:BuiltinInvocationContext):Generator<RuntimeValue,never,RuntimeValue> {
    return createRaiseContinuation(statement,this.raising(evaluate,invocation),this.meter);
  }
  private raising<Evaluate>(evaluate:Evaluate,invocation:BuiltinInvocationContext):Omit<RaiseContext<RuntimeValue>,"evaluate">&{evaluate:Evaluate} {
    const {meter,values}=this,normalization=this.normalization(invocation),{typeOf,repr,isInstance}=normalization;
    meter.checkpoint(0,384);
    return {
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
    };
  }
}
