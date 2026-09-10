import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionPayload } from "./runtime-exception-state.js";
import { suggestName } from "./name-suggestion.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

export interface ExceptionArgumentMember {
  readonly members:readonly {readonly name:string;readonly doc:string;readonly source?:"single-argument"}[];
  /** First-argument fields clear on empty initialization; all-argument fields
   * retain their prior value when called without arguments. Keyword fields use
   * their member name and validate after replacing args, before changing state. */
  readonly arguments:"first"|"all"|"keyword";
}

export function installExceptionArgumentMember(owner:TypeValue,spec:ExceptionArgumentMember,values:RuntimeValues,meter:ExecutionMeter):void {
  const accepts=(value:RuntimeValue,meter:ExecutionMeter)=>{
    if(value.kind!=="instance"||runtimeExceptionPayload(value)===undefined)return false;
    for(const base of value.type.value.mro){meter.checkpoint();if(base===owner.value)return true;}
    return false;
  };
  meter.checkpoint(0,64+16*spec.members.length);
  const names=spec.members.filter(member=>member.source===undefined).map(member=>member.name);
  for(const member of spec.members) {
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(member.name),values.memberDescriptor({owner,name:member.name,doc:member.doc,accepts,
      get(value,meter){return runtimeExceptionPayload(value)!.member(member.name,meter)??values.none;},
      set(value,input,meter){runtimeExceptionPayload(value)!.assignMember(member.name,input,meter);},
      delete(value,meter){runtimeExceptionPayload(value)!.assignMember(member.name,undefined,meter);}
    }));
  }
  meter.checkpoint(0,96);
  owner.value.namespace.items.set(values.string("__init__"),values.wrapperDescriptor({owner,name:"__init__",doc:"Initialize self.  See help(type(self)) for accurate signature.",accepts,
    invoke(receiver,positional,keywords,meter) {
      meter.checkpoint();
      if(receiver.kind!=="instance")throw Error("exception initialization requires an instance");
      if(spec.arguments!=="keyword"&&keywords.items.size!==0)throw new PythonRuntimeError("TypeError",`${diagnosticTypeName(receiver.type.value.name,meter)}() takes no keyword arguments`);
      const args=values.tuple(positional),storage=runtimeExceptionPayload(receiver)!;
      storage.assignArgs(args,meter);
      if(spec.arguments==="keyword") {
        const count=keywords.items.size;
        if(count>names.length)throw new PythonRuntimeError("TypeError",`${owner.value.name}() takes at most ${names.length} keyword argument${names.length===1?"":"s"} (${count} given)`);
        meter.checkpoint(0,32+8*names.length);
        const inputs=new Array<RuntimeValue|undefined>(names.length);
        for(const [key,value] of keywords.items.snapshot()) {
          if(key.kind!=="str")throw new PythonRuntimeError("TypeError","keywords must be strings");
          let label="";
          for(const point of key.value){meter.checkpoint(1,point>0xffff?4:2);label+=String.fromCodePoint(point);}
          meter.checkpoint(names.length);
          const index=names.indexOf(label);
          if(index===-1) {
            const suggestion=suggestName(label,names,meter),hint=suggestion===undefined?"":`. Did you mean '${suggestion}'?`;
            throw new PythonRuntimeError("TypeError",`${owner.value.name}() got an unexpected keyword argument '${label}'${hint}`);
          }
          inputs[index]=value;
        }
        for(let index=0;index<names.length;index++)storage.assignMember(names[index],inputs[index],meter);
        for(const member of spec.members)if(member.source==="single-argument")storage.assignMember(member.name,args.items.length===1?args.items[0]:undefined,meter);
        return values.none;
      }
      if(args.items.length!==0||spec.arguments==="first")storage.assignMember(names[0],args.items.length===0?undefined:spec.arguments==="all"&&args.items.length>1?args:args.items[0],meter);
      return values.none;
    }
  }));
}
