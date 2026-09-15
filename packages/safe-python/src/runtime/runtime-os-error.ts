import {createExceptionNewBuiltin} from "./builtin-exception-new.js";
import {createExceptionRepresentationDescriptor} from "./builtin-exception-representation.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {initializeOsErrorArguments} from "./os-error-arguments.js";
import {representationObject} from "./representation-protocol.js";
import {RuntimeExceptionState,runtimeExceptionPayload} from "./runtime-exception-state.js";
import {runtimeIntegerIndex} from "./runtime-integer-index.js";
import {runtimeIntegerPayload} from "./runtime-integer-payload.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** CPython 3.14.7 errno subclass selection on the pinned macOS platform.
 * Numeric guest errno values never consult the host operating system. */
const errnoTypes=[
  [1,"PermissionError"],[2,"FileNotFoundError"],[3,"ProcessLookupError"],[4,"InterruptedError"],
  [10,"ChildProcessError"],[13,"PermissionError"],[17,"FileExistsError"],[20,"NotADirectoryError"],
  [21,"IsADirectoryError"],[32,"BrokenPipeError"],[35,"BlockingIOError"],[36,"BlockingIOError"],
  [37,"BlockingIOError"],[53,"ConnectionAbortedError"],[54,"ConnectionResetError"],[58,"BrokenPipeError"],
  [60,"TimeoutError"],[61,"ConnectionRefusedError"],[107,"PermissionError"]
] as const;

/** Specialized allocator plus complete native field/representation protocols.
 * Exception links and dictionary storage stay in the shared exception family. */
export function createOsErrorAllocator(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,owns:(type:TypeValue)=>boolean,resolve:(name:string)=>TypeValue){
  const lookup=(type:TypeValue,name:string)=>{
    const key=values.string(name);
    for(const base of type.value.mro){meter.checkpoint();const found=base.namespace.items.lookup(key);if(found!==undefined)return found.value;}
    return undefined;
  };
  const accepts=(value:RuntimeValue)=>value.kind==="instance"&&runtimeExceptionPayload(value)!==undefined&&value.type.value.mro.includes(owner.value);
  const signedIndex=(value:RuntimeValue,invocation:BuiltinInvocationContext)=>{
    const result=runtimeIntegerIndex(value,meter,invocation.integerIndex);
    if(BigInt.asIntN(64,result)!==result)throw new PythonRuntimeError("ValueError",`cannot fit '${diagnosticTypeName(invocation.typeName!(value),meter)}' into an index-sized integer`);
    return result;
  };
  const initialize=(receiver:RuntimeValue,args:readonly RuntimeValue[],invocation:BuiltinInvocationContext)=>{
    if(receiver.kind!=="instance")throw Error("OSError requires native instance storage");
    const state=runtimeExceptionPayload(receiver)!;
    initializeOsErrorArguments(args,{
      none:values.none,blocking:receiver.type===resolve("BlockingIOError"),
      numeric:value=>{
        const native=value.kind==="instance"?value.native:value;
        return runtimeIntegerPayload(value)!==undefined||native?.kind==="float"||native?.kind==="complex"||["__int__","__float__","__index__"].some(name=>invocation.hasSpecial!(value,name));
      },
      index:value=>signedIndex(value,invocation),
      setMember:(name,value)=>state.assignMember(name,typeof value==="bigint"?values.integer(value):value,meter),
      setArgs:result=>{
        const original=result===args?values.argumentTuples.get(args):undefined;
        state.assignArgs(original?.offset===0?original.tuple:values.tuple(result),meter);
      }
    },meter);
  };
  const defer=(type:TypeValue)=>lookup(type,"__init__")!==initializer&&lookup(type,"__new__")===allocator;
  const initializer=values.wrapperDescriptor({owner,name:"__init__",doc:"Initialize self.  See help(type(self)) for accurate signature.",textSignature:"($self, /, *args, **kwargs)",accepts,
    invoke(receiver,args,keywords,_meter,invocation){
      meter.checkpoint();
      if(receiver.kind!=="instance"||invocation===undefined)throw Error("OSError initialization requires an interpreter");
      if(defer(receiver.type)){
        if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${diagnosticTypeName(receiver.type.value.diagnosticName,meter)}() takes no keyword arguments`);
        initialize(receiver,args,invocation);
      }
      return values.none;
    }
  });
  owner.value.namespace.items.set(values.string("__init__"),initializer);
  let errnoMap:ReturnType<typeof owner.value.namespace.items.emptyCopy>|undefined;
  const allocator=createExceptionNewBuiltin(owner,values,meter,owns,"arguments",(requested,args,keywords,invocation)=>{
    if(invocation===undefined)throw Error("OSError allocation requires an interpreter");
    let type=requested;
    const deferred=defer(type);
    if(!deferred){
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${diagnosticTypeName(type.value.diagnosticName,meter)}() takes no keyword arguments`);
      if(type===owner&&args.length>=2&&args.length<=5&&runtimeIntegerPayload(args[0])!==undefined){
        if(errnoMap===undefined){
          errnoMap=owner.value.namespace.items.emptyCopy();
          for(const [number,name] of errnoTypes)errnoMap.set(values.integer(number),resolve(name));
        }
        const selected=errnoMap.lookup(args[0])?.value;
        if(selected!==undefined){if(selected.kind!=="type")throw Error("invalid errno type");type=selected;}
      }
    }
    const state=new RuntimeExceptionState(values.tuple([]),meter);
    state.assignMember("characters_written",values.integer(-1),meter);
    const result=values.instance(type,()=>values.dictionary(owner.value.namespace.items.emptyCopy()),state);
    if(!deferred)initialize(result,args,invocation);
    return result;
  });
  for(const [name,doc] of [["errno","POSIX exception code"],["strerror","exception strerror"],["filename","exception filename"],["filename2","second exception filename"]] as const){
    owner.value.namespace.items.set(values.string(name),values.memberDescriptor({owner,name,doc,accepts,
      get:receiver=>runtimeExceptionPayload(receiver)!.member(name,meter)??values.none,
      set:(receiver,value)=>runtimeExceptionPayload(receiver)!.assignMember(name,value,meter),
      delete:receiver=>runtimeExceptionPayload(receiver)!.assignMember(name,undefined,meter)
    }));
  }
  owner.value.namespace.items.set(values.string("characters_written"),values.getsetDescriptor({owner,name:"characters_written",accepts,
    get(receiver){
      const value=runtimeExceptionPayload(receiver)!.member("characters_written",meter);
      if(value===undefined||value.kind==="int"&&value.value===-1n)throw new PythonRuntimeError("AttributeError","characters_written");
      return value;
    },
    set(receiver,value,_meter,invocation){
      if(invocation===undefined)throw Error("written count requires an interpreter index protocol");
      const result=signedIndex(value,invocation);
      runtimeExceptionPayload(receiver)!.assignMember("characters_written",values.integer(result),meter);
    },
    delete(receiver){
      const state=runtimeExceptionPayload(receiver)!,value=state.member("characters_written",meter);
      if(value===undefined||value.kind==="int"&&value.value===-1n)throw new PythonRuntimeError("AttributeError","characters_written");
      state.assignMember("characters_written",values.integer(-1),meter);
    }
  }));
  const baseString=createExceptionRepresentationDescriptor("__str__",owner,values,meter);
  owner.value.namespace.items.set(values.string("__str__"),values.wrapperDescriptor({owner,name:"__str__",doc:"Return str(self).",textSignature:"($self, /)",accepts,
    invoke(receiver,args,keywords,_meter,invocation){
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError","wrapper __str__() takes no keyword arguments");
      if(args.length!==0)throw new PythonRuntimeError("TypeError",`expected 0 arguments, got ${args.length}`);
      if(invocation?.formatting===undefined)throw Error("OSError rendering requires guest representation");
      const state=runtimeExceptionPayload(receiver)!,errno=state.member("errno",meter),message=state.member("strerror",meter),first=state.member("filename",meter),second=state.member("filename2",meter);
      if(first===undefined&&(errno===undefined||message===undefined))return invocation.call(baseString,[receiver]);
      const context=invocation.formatting;
      const render=(value:RuntimeValue|undefined,mode:"str"|"repr")=>context.string(representationObject(value??values.none,mode,context,meter))!;
      let text=values.string("[Errno ").value.concat(render(errno,"str"),meter).concat(values.string("] ").value,meter).concat(render(message,"str"),meter);
      if(first!==undefined){
        text=text.concat(values.string(": ").value,meter).concat(render(first,"repr"),meter);
        if(second!==undefined)text=text.concat(values.string(" -> ").value,meter).concat(render(second,"repr"),meter);
      }
      return values.stringPoints(text);
    }
  }));
  owner.value.namespace.items.set(values.string("__reduce__"),values.methodDescriptor({owner,name:"__reduce__",textSignature:"($self, /)",accepts,
    invoke(receiver,positional,keywords,_meter,_invocation,bound){
      if(receiver.kind!=="instance")throw Error("OSError reduction requires native storage");
      const name=bound?receiver.type.value.name:owner.value.name;
      if(keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${name}.__reduce__() takes no keyword arguments`);
      if(positional.length!==0)throw new PythonRuntimeError("TypeError",`${name}.__reduce__() takes no arguments (${positional.length} given)`);
      const state=runtimeExceptionPayload(receiver)!,first=state.member("filename",meter),second=state.member("filename2",meter);
      const args=state.args.items.length===2&&first!==undefined?values.tuple(second===undefined?[...state.args.items,first]:[...state.args.items,first,values.none,second]):state.args;
      const dictionary=receiver.state.dictionaryObject;
      return values.tuple(dictionary===undefined?[receiver.type,args]:[receiver.type,args,dictionary]);
    }
  }));
  return allocator;
}
