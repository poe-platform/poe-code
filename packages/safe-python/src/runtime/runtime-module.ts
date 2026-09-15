import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {OrderedKeyMap,type KeyOperations} from "./ordered-key-map.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeDictionaryPayload} from "./runtime-dictionary-payload.js";
import {installRuntimeModuleAnnotations} from "./runtime-module-annotations.js";
import type {RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

const moduleLayouts = new WeakSet<TypeValue["value"]>();

/** PyModule_GetFilenameObject reads native module storage, bypassing module
 * subclass descriptors and PEP 562 hooks. Nonmodules and nontext filenames
 * have no usable import-error location. */
export function runtimeModuleFilename(value:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter):RuntimeValue|undefined {
  if(value.kind!=="instance")return undefined;
  for(const layout of value.type.value.mro){
    meter.checkpoint();
    if(!moduleLayouts.has(layout))continue;
    const filename=value.dictionary?.items.lookup(values.string("__file__"))?.value;
    return filename!==undefined&&runtimeStringPayload(filename)!==undefined?filename:undefined;
  }
  return undefined;
}

/** Module dictionaries are guest objects. Attribute reads consult descriptors
 * first, then the live namespace and its PEP 562 fallback. No host properties
 * or ambient import paths participate in this protocol. */
export function installRuntimeModule(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,keys:KeyOperations<RuntimeValue>):void {
  moduleLayouts.add(owner.value);
  installRuntimeModuleAnnotations(owner,values,meter,keys);
  const namespace=owner.value.namespace.items;
  const accepts=(value:RuntimeValue)=>value.kind==="instance"&&value.type.value.mro.includes(owner.value);
  const text=(value:RuntimeValue)=>{
    const payload=runtimeStringPayload(value);
    if(payload===undefined)return undefined;
    let result="";for(const point of payload.value){meter.checkpoint(1,4);result+=String.fromCodePoint(point);}return result;
  };
  namespace.set(values.string("__doc__"),values.string("Create a module object.\n\nThe name must be a string; the optional doc argument can have any type."));
  namespace.set(values.string("__dict__"),values.memberDescriptor({owner,name:"__dict__",accepts,get:receiver=>{
    if(receiver.kind!=="instance"||receiver.dictionary===undefined)throw Error("module requires namespace storage");
    return receiver.dictionary;
  }}));
  namespace.set(values.string("__new__"),values.builtinFunction({name:"__new__",owner,keywordValidation:"callee",invoke(args,_keywords,meter,invocation){
    meter.checkpoint();
    const type=args[0];
    if(type===undefined)throw new PythonRuntimeError("TypeError","module.__new__(): not enough arguments");
    if(type.kind!=="type")throw new PythonRuntimeError("TypeError",`module.__new__(X): X is not a type object (${invocation?.typeName?.(type)??type.kind})`);
    if(!type.value.mro.includes(owner.value))throw new PythonRuntimeError("TypeError",`module.__new__(${type.value.name}): ${type.value.name} is not a subtype of module`);
    return values.instance(type,values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter)));
  }}));
  namespace.set(values.string("__init__"),values.wrapperDescriptor({owner,name:"__init__",accepts,invoke(receiver,args,keywords,meter,invocation){
    meter.checkpoint();
    if(receiver.kind!=="instance"||receiver.dictionary===undefined)throw Error("module requires namespace storage");
    if(args.length+keywords.items.size>2)throw new PythonRuntimeError("TypeError",`module() takes at most 2 arguments (${args.length+keywords.items.size} given)`);
    const bound=[...args];
    for(const [key,value] of keywords.items.snapshot()){
      const name=text(key),index=name==="name"?0:name==="doc"?1:-1;
      if(index<0)throw new PythonRuntimeError("TypeError",`module() got an unexpected keyword argument '${name}'`);
      if(index<args.length)throw new PythonRuntimeError("TypeError",`argument for module() given by name ('${name}') and position (${index+1})`);
      bound[index]=value;
    }
    if(bound[0]===undefined)throw new PythonRuntimeError("TypeError","module() missing required argument 'name' (pos 1)");
    if(text(bound[0])===undefined)throw new PythonRuntimeError("TypeError",`module() argument 'name' must be str, not ${invocation?.typeName?.(bound[0])??bound[0].kind}`);
    for(const [name,value] of [["__name__",bound[0]],["__doc__",bound[1]??values.none],["__package__",values.none],["__loader__",values.none],["__spec__",values.none]] as const)receiver.dictionary.items.set(values.string(name),value);
    return values.none;
  }}));
  namespace.set(values.string("__getattribute__"),values.wrapperDescriptor({owner,name:"__getattribute__",accepts,invoke(receiver,args,keywords,meter,invocation){
    meter.checkpoint();
    if(keywords.items.size)throw new PythonRuntimeError("TypeError","wrapper __getattribute__() takes no keyword arguments");
    if(args.length!==1)throw new PythonRuntimeError("TypeError",`expected 1 argument, got ${args.length}`);
    const name=text(args[0]);
    if(name===undefined)throw new PythonRuntimeError("TypeError",`attribute name must be string, not '${invocation?.typeName?.(args[0])??args[0].kind}'`);
    if(invocation?.objectAttributeDefault===undefined||receiver.kind!=="instance")throw Error("module lookup requires the interpreter attribute protocol");
    try{return invocation.objectAttributeDefault(receiver,name,invocation.attributeKey?.(args[0]));}
    catch(error){if(!runtimeExceptionMatches(error,"AttributeError",invocation))throw error;}
    const fallback=receiver.dictionary?.items.lookup(values.string("__getattr__"));
    if(fallback!==undefined)return invocation.call(fallback.value,[args[0]]);
    const moduleName=receiver.dictionary?.items.lookup(values.string("__name__"))?.value;
    const label=moduleName===undefined?undefined:text(moduleName);
    throw new PythonRuntimeError("AttributeError",label===undefined?`module has no attribute '${name}'`:`module '${label}' has no attribute '${name}'`);
  }}));
  namespace.set(values.string("__dir__"),values.methodDescriptor({owner,name:"__dir__",accepts,
    doc:"__dir__() -> list\nspecialized dir() implementation",textSignature:"($self, /)",
    invoke(receiver,args,keywords,meter,invocation,bound){
    meter.checkpoint();
    const name=bound?"__dir__":"module.__dir__";
    if(keywords.items.size)throw new PythonRuntimeError("TypeError",`${name}() takes no keyword arguments`);
    if(args.length)throw new PythonRuntimeError("TypeError",`${name}() takes no arguments (${args.length} given)`);
    if(invocation?.attribute===undefined)throw Error("module dir requires interpreter attributes");
    // PyObject_GetAttr observes subclass descriptors and __getattribute__.
    // Once acquired, the dictionary uses native lookup and key order.
    const dictionary=runtimeDictionaryPayload(invocation.attribute(receiver,"__dict__"));
    meter.checkpoint();
    if(dictionary===undefined)throw new PythonRuntimeError("TypeError","<module>.__dict__ is not a dictionary");
    const custom=dictionary.items.lookup(values.string("__dir__"));
    if(custom!==undefined)return invocation.call(custom.value,[]);
    return values.list(dictionary.items.snapshot().map(([key])=>key));
  }}));
}
