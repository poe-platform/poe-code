import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {formatObject} from "./format-protocol.js";
import {runtimeIntegerIndex} from "./runtime-integer-index.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {runtimeIterate} from "./runtime-iteration.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {resolveRuntimeRelativeImport} from "./runtime-relative-import.js";
import {renderQuotedPoints} from "./quoted-representation.js";
import type {BuiltinFunctionValue,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Import only interpreter-owned module objects supplied by the session. Module
 * discovery services must populate this registry explicitly; a guest name never
 * becomes a host path or a host JavaScript import. */
export function createRuntimeModuleImport(modules:ReadonlyMap<string,RuntimeValue>,values:RuntimeValues,meter:ExecutionMeter,load?:(name:string)=>RuntimeValue|undefined):BuiltinFunctionValue {
  meter.checkpoint(1,96);
  return values.builtinFunction({name:"__import__",keywordValidation:"callee",textSignature:"($module, /, name, globals=None, locals=None, fromlist=(), level=0)",invoke(args,keywords,meter,invocation){
    let fatal=false;
    try{
      meter.checkpoint(1,128);
      const parameters=["name","globals","locals","fromlist","level"],bound=[...args];
      if(args.length+keywords.items.size>5)throw new PythonRuntimeError("TypeError",`__import__() takes at most 5 arguments (${args.length+keywords.items.size} given)`);
      const text=(value:RuntimeValue)=>{
        const payload=runtimeStringPayload(value);if(payload===undefined)return undefined;
        let result="";for(const point of payload.value){meter.checkpoint(1,4);result+=String.fromCodePoint(point);}return result;
      };
      for(const [key,value] of keywords.items.snapshot()){
        const name=text(key),index=name===undefined?-1:parameters.indexOf(name);
        if(index<0)throw new PythonRuntimeError("TypeError",`__import__() got an unexpected keyword argument '${name}'`);
        if(index<args.length)throw new PythonRuntimeError("TypeError",`argument for __import__() given by name ('${name}') and position (${index+1})`);
        bound[index]=value;
      }
      if(bound[0]===undefined)throw new PythonRuntimeError("TypeError","__import__() missing required argument 'name' (pos 1)");
      const level=bound[4]===undefined?0n:runtimeIntegerIndex(bound[4],meter,invocation?.integerIndex);
      if(level < -2147483648n||level>2147483647n)throw new PythonRuntimeError("OverflowError","Python int too large to convert to C int");
      const name=text(bound[0]);
      if(name===undefined)throw new PythonRuntimeError("TypeError","module name must be a string");
      if(level<0n)throw new PythonRuntimeError("ValueError","level must be >= 0");
      if(level===0n&&name.length===0)throw new PythonRuntimeError("ValueError","Empty module name");
      if(level!==0n&&invocation===undefined)throw Error("relative imports require an interpreter invocation context");
      const absolute=level===0n?name:resolveRuntimeRelativeImport(name,bound[1],Number(level),values,meter,invocation!);
      const missing=(name:string,parent?:string,cause?:unknown):never=>{
        const quoted=text(values.stringPoints(renderQuotedPoints(values.string(name).value,"repr",meter)));
        const owner=parent===undefined?undefined:text(values.stringPoints(renderQuotedPoints(values.string(parent).value,"repr",meter)));
        const error=new PythonRuntimeError("ModuleNotFoundError",`No module named ${quoted}${owner===undefined?"":`; ${owner} is not a package`}`),prepared=invocation?.prepareException?.(error);
        if(prepared instanceof RuntimeRaisedException){
          const state=runtimeExceptionPayload(prepared.value)!;
          state.assignMember("name",values.string(name),meter);
          if(parent!==undefined){
            const context=invocation?.prepareException?.(cause);
            if(context instanceof RuntimeRaisedException)state.assignContext(context.value,meter);
            state.assignCause(null,meter);
          }
        }
        throw prepared??error;
      };
      const find=(name:string):RuntimeValue=>{
        meter.checkpoint();
        const cached=modules.get(name);
        if(cached!==undefined)return cached;
        const leave=invocation?.enterRecursiveCall?.();
        try{
        meter.checkpoint(name.length,64+name.length*2);
        const separator=name.lastIndexOf('.');
        let parent:RuntimeValue|undefined;
        if(separator>=0){
          const parentName=name.slice(0,separator);
          parent=find(parentName);
          // Parent execution can itself import this child. Only uncached
          // children consult the live package attribute protocol.
          const initialized=modules.get(name);
          if(initialized!==undefined)return initialized;
          if(invocation?.attribute===undefined)throw Error("module imports require interpreter attributes");
          try{invocation.attribute(parent,"__path__");}
          catch(error){
            if(!runtimeExceptionMatches(error,"AttributeError",invocation))throw error;
            missing(name,parentName,error);
          }
          meter.checkpoint();
          const reentrant=modules.get(name);
          if(reentrant!==undefined)return reentrant;
        }
        const result=load?.(name);
        meter.checkpoint();
        if(result!==undefined&&parent!==undefined){
          // Publication follows successful execution and cache insertion. A
          // setter can reenter imports or fail without unloading the child.
          if(invocation?.setAttribute===undefined)throw Error("module imports require interpreter attribute mutation");
          const child=name.slice(separator+1);
          try{invocation.setAttribute(parent,child,result);}
          catch(error){
            if(!runtimeExceptionMatches(error,"AttributeError",invocation))throw error;
            if(invocation.warn===undefined)throw Error("module imports require interpreter warnings");
            invocation.warn("ImportWarning",`Cannot set an attribute on '${name.slice(0,separator)}' for child module '${child}'`);
          }
          meter.checkpoint();
        }
        return result??missing(name);
        }finally{leave?.();}
      };
      const module=find(absolute);
      const fromlist=bound[3];
      if(fromlist!==undefined&&invocation?.truth?.(fromlist)){
        // __import__ probes the module attribute protocol even for a nonpackage.
        // PEP 562 hooks and module-subclass descriptors may fail or suspend here.
        if(invocation.attribute===undefined)throw Error("module imports require interpreter attributes");
        let packagePath:RuntimeValue|undefined;
        try{packagePath=invocation.attribute(module,"__path__");}
        catch(error){if(!runtimeExceptionMatches(error,"AttributeError",invocation))throw error;}
        meter.checkpoint();
        if(packagePath!==undefined&&module.kind==='instance'&&module.dictionary!==undefined){
          const attribute=invocation.attribute;
          const handleFromlist=(members:RuntimeValue,recursive:boolean):void=>{
            const iterator=runtimeIterate(members,values,meter,invocation.iteration);
            for(let next=iterator.next();!next.done;next=iterator.next()){
              const member=text(next.value);
              if(member===undefined){
                if(invocation.actualType===undefined||invocation.formatting===undefined||invocation.binary===undefined)throw Error("module imports require interpreter type and formatting protocols");
                const where=recursive?invocation.binary('+',attribute(module,'__name__'),values.string('.__all__')):values.string("``from list''");
                const location=text(formatObject(where,undefined,invocation.formatting,meter));
                const typeName=attribute(invocation.actualType(next.value),'__name__');
                const label=text(formatObject(typeName,undefined,invocation.formatting,meter));
                throw new PythonRuntimeError("TypeError",`Item in ${location} must be str, not ${label}`);
              }
              if(invocation.compareTruth===undefined)throw Error("module imports require interpreter comparison");
              if(invocation.compareTruth('==',next.value,values.string('*'))){
                if(!recursive){
                  let hasAll=false;
                  try{attribute(module,'__all__');hasAll=true;}
                  catch(error){if(!runtimeExceptionMatches(error,'AttributeError',invocation))throw error;}
                  meter.checkpoint();
                  if(hasAll)handleFromlist(attribute(module,'__all__'),true);
                }
                continue;
              }
              // _handle_fromlist uses hasattr, not a module-dictionary probe.
              // PEP 562 and module subclasses can supply even a known encoding,
              // or fail before the loader has any reason to execute its source.
              let present=false;
              try {
                attribute(module,member,invocation.attributeKey?.(next.value));
                present=true;
              } catch(error) {
                if(!runtimeExceptionMatches(error,"AttributeError",invocation))throw error;
              }
              meter.checkpoint();
              if(!present){
                if(invocation.formatting===undefined)throw Error("module imports require interpreter formatting");
                const parent=text(formatObject(attribute(module,'__name__'),undefined,invocation.formatting,meter));
                const child=text(formatObject(next.value,undefined,invocation.formatting,meter));
                meter.checkpoint();
                const fromName=`${parent}.${child}`;
                try{find(fromName);}
                catch(error){
                  // _handle_fromlist ignores a missing requested child, even
                  // when its live parent is no longer a package. Dependency
                  // failures inside an existing child still propagate.
                  if(!runtimeExceptionMatches(error,"ModuleNotFoundError",invocation))throw error;
                  const prepared=invocation.prepareException?.(error);
                  const missingName=prepared instanceof RuntimeRaisedException?runtimeExceptionPayload(prepared.value)!.member("name",meter):undefined;
                  if(missingName===undefined||text(missingName)!==fromName||modules.get(fromName)?.kind==="none")throw error;
                }
              }
            }
          };
          handleFromlist(fromlist,false);
        }
        return module;
      }
      const dot=name.indexOf(".");
      if(dot<0)return module;
      const first=level===0n?name.slice(0,dot):absolute.slice(0,absolute.length-name.length+dot);
      const root=modules.get(first);
      if(root===undefined)throw Error("registered submodules require their parent module");
      return root;
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }});
}
