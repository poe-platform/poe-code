import type {Statement} from "../statement-ast.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {LexicalFrame} from "./lexical-frame.js";
import {lookupNamespace} from "./namespace-lookup.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeModuleFilename} from "./runtime-module.js";
import {representationObject} from "./representation-protocol.js";
import {runtimeTruth} from "./runtime-truth.js";
import {runtimeGetItem} from "./runtime-subscription.js";
import {runtimeIterate} from "./runtime-iteration.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import type {RuntimeFrame} from "./runtime-program.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** IMPORT_NAME calls the active frame's builtins, independently of a local or
 * global __import__ binding. Loading modules is the hook's responsibility; this
 * instruction does not acquire filesystem or process capabilities. */
export function executeRuntimeImportStatement(statement:Extract<Statement,{kind:"import"|"import-from"}>,frame:RuntimeFrame,values:RuntimeValues,invocation:BuiltinInvocationContext,meter:ExecutionMeter):void {
  let fatal=false;
  try {
    meter.checkpoint(1,256);
    const attribute=invocation.attribute;
    if(attribute===undefined)throw new Error("imports require the interpreter attribute protocol");
    const optional=(object:RuntimeValue,name:string):RuntimeValue|undefined=>{
      let terminal=false;
      try{
        try{return attribute(object,name);}
        catch(error){
          if(error instanceof ExecutionLimitError)throw error;
          // Attribute lookup and exception classification are separate service
          // boundaries. A cancelled lookup cannot enter classification.
          meter.checkpoint();
          if(!runtimeExceptionMatches(error,"AttributeError",invocation))throw error;
        }
      }catch(error){terminal=error instanceof ExecutionLimitError;throw error;}
      finally{if(!terminal)meter.checkpoint();}
    };
    const text=(value:RuntimeValue):string|undefined=>{
      const payload=runtimeStringPayload(value);
      if(payload===undefined)return undefined;
      let result="";
      for(const point of payload.value){meter.checkpoint(1,4);result+=String.fromCodePoint(point);}
      return result;
    };
    const member=(object:RuntimeValue,name:string):RuntimeValue=>{
      const value=optional(object,name);
      if(value!==undefined)return value;
      const rawName=optional(object,"__name__"),moduleName=rawName===undefined?undefined:text(rawName);
      const spec=optional(object,"__spec__");
      let filename:RuntimeValue|undefined,initializing=false;
      if(spec!==undefined){
        const located=optional(spec,"has_location");
        if(located!==undefined&&runtimeTruth(located,meter,invocation)){
          const origin=optional(spec,"origin");
          if(origin!==undefined&&runtimeStringPayload(origin)!==undefined)filename=origin;
        }
        filename??=runtimeModuleFilename(object,values,meter);
        const pending=optional(spec,"_initializing");
        if(pending!==undefined)initializing=runtimeTruth(pending,meter,invocation);
      }
      if(invocation.formatting===undefined)throw Error("import diagnostics require interpreter formatting");
      const imported=text(representationObject(values.string(name),"repr",invocation.formatting,meter))!;
      const owner=text(representationObject(moduleName===undefined?values.string("<unknown module name>"):rawName!,"repr",invocation.formatting,meter))!;
      const location=filename===undefined?undefined:text(representationObject(filename,"str",invocation.formatting,meter))!;
      meter.checkpoint(1,256+imported.length*2+owner.length*2+(location?.length??0)*2);
      const message=initializing
        ?`cannot import name ${imported} from partially initialized module ${owner} (most likely due to a circular import)${location===undefined?"":` (${location})`}`
        :`cannot import name ${imported} from ${owner} (${location??"unknown location"})`;
      const error=new PythonRuntimeError("ImportError",message);
      const prepared=invocation.prepareException?.(error);
      if(!(prepared instanceof RuntimeRaisedException))throw new Error("imports require interpreter exception preparation");
      const state=runtimeExceptionPayload(prepared.value)!;
      state.assignMember("name",moduleName===undefined?values.none:rawName!,meter);
      state.assignMember("name_from",values.string(name),meter);
      state.assignMember("path",filename??values.none,meter);
      throw prepared;
    };
    const load=(name:string,fromlist:RuntimeValue,level:number):RuntimeValue=>{
      const importer=lookupNamespace(frame.namespaces.builtins,"__import__");
      if(importer===undefined)throw new PythonRuntimeError("ImportError","__import__ not found");
      const globals=frame.namespaces.globals.object;
      if(globals===undefined)throw new Error("import requires the original guest globals dictionary");
      const locals=frame instanceof LexicalFrame?values.none:(frame.namespaces.locals??frame.namespaces.globals).object;
      if(locals===undefined)throw new Error("import requires the original guest locals mapping");
      const result=invocation.call(importer.value,[values.string(name),globals,locals,fromlist,values.integer(level)]);
      meter.checkpoint();
      return result;
    };
    if(statement.kind==="import-from"){
      meter.checkpoint(1,64+statement.module.length*8+(statement.imports==="*"?8:statement.imports.length*16));
      const names=statement.imports==="*"?["*"]:statement.imports.map(item=>item.path[0].name);
      const source=load(statement.module.map(part=>part.name).join("."),values.tuple(names.map(name=>values.string(name))),statement.level);
      if(statement.imports!=="*"){
        for(const item of statement.imports){meter.checkpoint();frame.store((item.alias??item.path[0]).name,member(source,item.path[0].name));}
        return;
      }
      let exports=optional(source,"__all__");
      const skipPrivate=exports===undefined;
      if(exports===undefined){
        const dictionary=optional(source,"__dict__");
        if(dictionary===undefined)throw new PythonRuntimeError("ImportError","from-import-* object has no __dict__ and no __all__");
        const keys=invocation.call(attribute(dictionary,"keys"),[]),iterator=runtimeIterate(keys,values,meter,invocation.iteration);
        const snapshot=values.list([]);
        for(let next=iterator.next();!next.done;next=iterator.next()){meter.checkpoint();snapshot.items.append(next.value);}
        exports=snapshot;
      }
      for(let index=0n;;index++){
        meter.checkpoint();
        let exported:RuntimeValue;
        try{
          if(exports.kind==="list"||exports.kind==="tuple"||exports.kind==="str"||exports.kind==="bytes"||exports.kind==="range")exported=runtimeGetItem(exports,values.integer(index),values,meter,invocation);
          else if(invocation.iteration?.hasSequenceItem(exports))exported=invocation.iteration.getItem(exports,index);
          else if(exports.kind==="dict"||exports.kind==="mappingproxy")throw new PythonRuntimeError("TypeError",`${exports.kind} is not a sequence`);
          else throw new PythonRuntimeError("TypeError",`'${diagnosticTypeName(invocation.typeName!(exports),meter)}' object does not support indexing`);
        }catch(error){if(runtimeExceptionMatches(error,"IndexError",invocation))break;throw error;}
        const name=text(exported);
        if(name===undefined){
          const moduleName=attribute(source,"__name__"),display=text(moduleName);
          if(display===undefined)throw new PythonRuntimeError("TypeError",`module __name__ must be a string, not ${invocation.typeName!(moduleName)}`);
          throw new PythonRuntimeError("TypeError",`${skipPrivate?"Key":"Item"} in ${display}.${skipPrivate?"__dict__":"__all__"} must be str, not ${invocation.typeName!(exported)}`);
        }
        if(skipPrivate&&name.startsWith("_"))continue;
        frame.store(name,attribute(source,name));
      }
      return;
    }
    for(const item of statement.imports){
      meter.checkpoint(1,64+item.path.length*8);
      let result=load(item.path.map(part=>part.name).join("."),values.none,0);
      if(item.alias!==null){
        for(const part of item.path.slice(1)){
          result=member(result,part.name);
          meter.checkpoint();
        }
      }
      frame.store((item.alias??item.path[0]).name,result);
    }
  }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally{if(!fatal)meter.checkpoint();}
}
