import { readSuperAttribute } from "./super-attributes.js";
import type { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { KeyOperations } from "./ordered-key-map.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { resolveRuntimeClassAttribute } from "./runtime-descriptor.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import { validateAttributeName } from "./attribute-name.js";
import type { BuiltinInvocationContext, InstanceValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

interface SuperState { anchor?:TypeValue; self?:RuntimeValue; owner?:TypeValue }

/** Native super storage and slots. Construction and descriptor binding use the
 * execution's actual types and caller activation, never virtual subclass checks. */
export function installRuntimeSuper(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,keys:KeyOperations<RuntimeValue>,resolveType:(layout:RuntimeTypeLayout)=>TypeValue):void {
  meter.checkpoint(1,256);
  owner.value.namespace.items.set(values.string("__doc__"),values.string(`super() -> same as super(__class__, <first argument>)
super(type) -> unbound super object
super(type, obj) -> bound super object; requires isinstance(obj, type)
super(type, type2) -> bound super object; requires
    issubclass(type2, type)
Typical use to call a cooperative superclass method:
class C(B):
    def meth(self, arg):
        super().meth(arg)
This works for class methods too:
class C(B):
    @classmethod
    def cmeth(cls, arg):
        super().cmeth(arg)
`));
  const states=new WeakMap<RuntimeValue,SuperState>();
  const accepts=(value:RuntimeValue)=>states.has(value);
  const allocate=(type:TypeValue):InstanceValue=>{
    meter.checkpoint(1,64);
    const result=values.instance(type,type.value.hasInstanceDictionary?()=>values.dictionary(new OrderedKeyMap(keys,meter)):undefined);
    states.set(result,{});return result;
  };
  const check=(anchor:TypeValue,self:RuntimeValue,invocation:BuiltinInvocationContext):TypeValue=>{
    if(self.kind==="type")for(const base of self.value.mro){meter.checkpoint();if(base===anchor.value)return self;}
    const actual=invocation.actualType!(self);
    for(const base of actual.value.mro){meter.checkpoint();if(base===anchor.value)return actual;}
    let reported:RuntimeValue|undefined;
    try{reported=invocation.attribute!(self,"__class__");}
    catch(error){if(!runtimeExceptionMatches(error,"AttributeError",invocation))throw error;}
    if(reported?.kind==="type"&&reported!==actual)for(const base of reported.value.mro){meter.checkpoint();if(base===anchor.value)return reported;}
    throw new PythonRuntimeError("TypeError",`super(type, obj): obj (${self.kind==="type"?`type ${self.value.name}`:`instance of ${actual.value.name}`}) is not an instance or subtype of type (${anchor.value.name}).`);
  };
  owner.value.namespace.items.set(values.string("__new__"),values.builtinFunction({name:"__new__",owner,doc:"Create and return a new object.  See help(type) for accurate signature.",keywordValidation:"callee",invoke(args,_keywords,_meter,invocation){
    if(args.length===0)throw new PythonRuntimeError("TypeError","super.__new__(): not enough arguments");
    const type=args[0];
    if(type.kind!=="type")throw new PythonRuntimeError("TypeError",`super.__new__(X): X is not a type object (${invocation!.actualType!(type).value.name})`);
    let valid=false;for(const base of type.value.mro){meter.checkpoint();if(base===owner.value){valid=true;break;}}
    if(!valid)throw new PythonRuntimeError("TypeError",`super.__new__(${type.value.name}): ${type.value.name} is not a subtype of super`);
    return allocate(type);
  }}));
  owner.value.namespace.items.set(values.string("__init__"),values.wrapperDescriptor({owner,name:"__init__",doc:"Initialize self.  See help(type(self)) for accurate signature.",accepts,invoke(instance,args,keywords,_meter,invocation){
    if(keywords.items.size)throw new PythonRuntimeError("TypeError","super() takes no keyword arguments");
    if(args.length>2)throw new PythonRuntimeError("TypeError",`super() expected at most 2 arguments, got ${args.length}`);
    let anchor:RuntimeValue|undefined=args[0],self:RuntimeValue|undefined=args[1];
    if(args.length===0){
      const frame=invocation?.functionFrame,layout=frame?.code?.localLayout;
      if(frame===undefined||layout===undefined||layout.positionalCount===0)throw new PythonRuntimeError("RuntimeError","super(): no arguments");
      const locals=frame.reflectLocals();
      self=locals.lookup(layout.variableNames[0],0)?.value;
      if(self===undefined)throw new PythonRuntimeError("RuntimeError","super(): arg[0] deleted");
      if(!layout.freeNames.includes("__class__"))throw new PythonRuntimeError("RuntimeError","super(): __class__ cell not found");
      anchor=frame.namespaces.closure?.get("__class__")?.content?.value;
      if(anchor===undefined)throw new PythonRuntimeError("RuntimeError","super(): empty __class__ cell");
      if(anchor.kind!=="type")throw new PythonRuntimeError("RuntimeError",`super(): __class__ is not a type (${invocation!.actualType!(anchor).value.name})`);
    }
    if(anchor===undefined)throw Error("super argument resolution lost its anchor");
    if(anchor.kind!=="type")throw new PythonRuntimeError("TypeError",`super() argument 1 must be a type, not ${invocation!.actualType!(anchor).value.name}`);
    const bound=self===undefined||self.kind==="none"?undefined:check(anchor,self,invocation!);
    const state=states.get(instance)!;
    state.anchor=anchor;state.self=bound===undefined?undefined:self;state.owner=bound;
    return values.none;
  }}));
  for(const [name,key,doc] of [["__thisclass__","anchor","the class invoking super()"],["__self__","self","the instance invoking super(); may be None"],["__self_class__","owner","the type of the instance invoking super(); may be None"]] as const){
    meter.checkpoint(1,96);
    owner.value.namespace.items.set(values.string(name),values.memberDescriptor({owner,name,doc,accepts,get(instance){return states.get(instance)![key]??values.none;}}));
  }
  owner.value.namespace.items.set(values.string("__getattribute__"),values.wrapperDescriptor({owner,name:"__getattribute__",doc:"Return getattr(self, name).",accepts,invoke(instance,args,keywords,_meter,invocation){
    if(keywords.items.size)throw new PythonRuntimeError("TypeError","wrapper __getattribute__() takes no keyword arguments");
    if(args.length!==1)throw new PythonRuntimeError("TypeError",`expected 1 argument, got ${args.length}`);
    validateAttributeName(args[0],{typeName:invocation?.typeName},meter);
    let name="";if(args[0].kind==="str")for(const point of args[0].value){meter.checkpoint(1,4);name+=String.fromCodePoint(point);}
    const state=states.get(instance)!;
    if(name!=="__class__"&&state.owner!==undefined){
      meter.checkpoint(0,state.owner.value.mro.length*8);
      const mro=state.owner.value.mro.map(resolveType);
      const found=readSuperAttribute(state.anchor!,state.self===state.owner?null:state.self!,state.owner,mro,args[0],(base,key)=>{
        const member=base.value.namespace.items.lookup(key);
        if(member===undefined)return undefined;
        return resolveRuntimeClassAttribute(member.value,{invocation,typeOf:invocation!.actualType,slots(value){
          const get=invocation!.lookupSpecial!(value,"__get__");
          return get===undefined?undefined:{get:(self,type)=>invocation!.call(get,[self??values.none,type])};
        }},values,meter);
      },meter);
      if(found!==undefined)return found.value;
    }
    return invocation!.objectAttributeDefault!(instance,name);
  }}));
  owner.value.namespace.items.set(values.string("__get__"),values.wrapperDescriptor({owner,name:"__get__",doc:"Return an attribute of instance, which is of type owner.",accepts,invoke(instance,args,keywords,_meter,invocation){
    if(keywords.items.size)throw new PythonRuntimeError("TypeError","wrapper __get__() takes no keyword arguments");
    if(args.length===0)throw new PythonRuntimeError("TypeError","__get__ expected at least 1 argument, got 0");
    if(args.length>2)throw new PythonRuntimeError("TypeError",`__get__ expected at most 2 arguments, got ${args.length}`);
    if(args[0].kind==="none"&&(args.length===1||args[1].kind==="none"))throw new PythonRuntimeError("TypeError","__get__(None, None) is invalid");
    const state=states.get(instance)!;
    if(state.self!==undefined||args[0].kind==="none")return instance;
    const actual=invocation!.actualType!(instance);
    if(actual!==owner)return invocation!.call(actual,[state.anchor??values.none,args[0]]);
    if(state.anchor===undefined)throw Error("uninitialized super descriptor");
    const bound=check(state.anchor,args[0],invocation!),result=allocate(owner);
    states.set(result,{anchor:state.anchor,self:args[0],owner:bound});return result;
  }}));
  owner.value.namespace.items.set(values.string("__repr__"),values.wrapperDescriptor({owner,name:"__repr__",doc:"Return repr(self).",accepts,invoke(instance,args,keywords){
    if(keywords.items.size)throw new PythonRuntimeError("TypeError","wrapper __repr__() takes no keyword arguments");
    if(args.length)throw new PythonRuntimeError("TypeError",`expected 0 arguments, got ${args.length}`);
    const state=states.get(instance)!;
    return values.string(`<super: <class '${state.anchor?.value.name??"NULL"}'>, ${state.owner===undefined?"NULL":`<${state.owner.value.name} object>`}>`);
  }}));
}
