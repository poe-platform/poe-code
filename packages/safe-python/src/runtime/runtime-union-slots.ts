import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {KeyOperations} from "./ordered-key-map.js";
import {constructRuntimeUnion} from "./runtime-union-construction.js";
import {runtimeUnionPayload} from "./runtime-union-state.js";
import {runtimeTypingTypeRepr} from "./runtime-typing-type-repr.js";
import {RuntimeHashError} from "./runtime-hash-error.js";
import type {RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

/** Ordinary numeric descriptors leave reflected/metaclass precedence to the
 * existing binary dispatcher. They do not intercept type expressions globally. */
export function installRuntimeUnionOperators(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,keys:KeyOperations<RuntimeValue>,noneType:()=>TypeValue,unionType:()=>TypeValue):void {
  const classReceiver=owner===owner.metaclass;
  for(const name of ["__or__","__ror__"] as const){
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc:name==="__or__"?"Return self|value.":"Return value|self.",textSignature:"($self, value, /)",accepts:receiver=>classReceiver?receiver.kind==="type":runtimeUnionPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation){
        meter.checkpoint();
        if(keywords.items.size)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
        if(positional.length!==1)throw new PythonRuntimeError("TypeError",`expected 1 argument, got ${positional.length}`);
        return constructRuntimeUnion(name==="__or__"?receiver:positional[0],name==="__or__"?positional[0]:receiver,values,meter,keys,noneType,unionType,invocation);
      }
    }));
  }
}

export function installRuntimeUnionSlots(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,keys:KeyOperations<RuntimeValue>,noneType:()=>TypeValue,unionType:()=>TypeValue):void {
  installRuntimeUnionOperators(owner,values,meter,keys,noneType,unionType);
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("__args__"),values.memberDescriptor({owner,name:"__args__",accepts:receiver=>runtimeUnionPayload(receiver)!==undefined,get:receiver=>runtimeUnionPayload(receiver)!.args}));
  for(const [name,doc] of [
    ["__repr__","Return repr(self)."], ["__hash__","Return hash(self)."],
    ["__eq__","Return self==value."], ["__ne__","Return self!=value."],
    ["__lt__","Return self<value."], ["__le__","Return self<=value."],
    ["__gt__","Return self>value."], ["__ge__","Return self>=value."]
  ] as const){
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(name),values.wrapperDescriptor({owner,name,doc,textSignature:name==="__repr__"||name==="__hash__"?"($self, /)":"($self, value, /)",accepts:receiver=>runtimeUnionPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation){
        meter.checkpoint();const count=name==="__repr__"||name==="__hash__"?0:1;
        if(keywords.items.size)throw new PythonRuntimeError("TypeError",`wrapper ${name}() takes no keyword arguments`);
        if(positional.length!==count)throw new PythonRuntimeError("TypeError",`expected ${count} argument${count===1?"":"s"}, got ${positional.length}`);
        // Union's rich-comparison slot declines ordering without inspecting
        // either operand. Operator reflection belongs to the binary dispatcher.
        if(name==="__lt__"||name==="__le__"||name==="__gt__"||name==="__ge__")return values.notImplemented;
        const state=runtimeUnionPayload(receiver)!;
        try{
          if(name==="__repr__"){
            meter.checkpoint(0,32);const parts:string[]=[];let length=0;
            for(const arg of state.args.items){meter.checkpoint(1,8);const text=runtimeTypingTypeRepr(arg,noneType(),meter,invocation);length+=text.length+(parts.length?3:0);parts.push(text);}
            meter.checkpoint(0,length*2);return values.string(parts.join(" | "));
          }
          if(name==="__hash__"){
            if(state.unhashable){
              for(const arg of state.unhashable.items){meter.checkpoint();keys.hash(arg);}
              throw new PythonRuntimeError("TypeError",`union contains ${state.unhashable.items.length} unhashable elements`);
            }
            return values.integer(state.hashable.items.keySetHash());
          }
          const other=runtimeUnionPayload(positional[0]);if(!other)return values.notImplemented;
          let equal=state.hashable.items.hasEqualKeys(other.hashable.items);
          const a=state.unhashable?.items,b=other.unhashable?.items;
          if(equal&&a&&b){
            equal=a.length===b.length;
            meter.checkpoint(0,120);
            for(const [source,target] of [[a,b],[b,a]]){
              if(!equal)break;
              for(const arg of source){
                let found=false;for(const candidate of target){meter.checkpoint();if(candidate===arg||keys.equal(candidate,arg)){found=true;break;}}
                if(!found){equal=false;break;}
              }
            }
          }else if(equal&&(a!==undefined||b!==undefined))equal=false;
          return values.boolean(name==="__eq__"?equal:!equal);
        }catch(error){throw error instanceof RuntimeHashError?error.original:error;}
        finally{meter.checkpoint();}
      }
    }));
  }
}
