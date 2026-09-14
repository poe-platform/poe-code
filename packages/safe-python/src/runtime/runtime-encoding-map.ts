import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {OrderedKeyMap,type KeyOperations} from "./ordered-key-map.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import type {BuiltinFunctionValue,RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

// CPython 3.14.7 Objects/unicodeobject.c: PyUnicode_BuildEncodingMap and
// encoding_map_lookup. See CPYTHON-LICENSE.txt at the package root.
// Native payloads are reachable only through their owning guest objects. They
// expose no subscription protocol; only the charmap encoder reads the trie.
const maps=new WeakMap<RuntimeValue,{level1:Uint8Array;level2:Uint8Array;level3:Uint8Array}>();

export function lookupRuntimeEncodingMap(mapping:RuntimeValue,point:number,meter:ExecutionMeter):number|undefined {
  const state=maps.get(mapping);
  if(state===undefined)return undefined;
  meter.checkpoint();
  if(point===0)return 0;
  if(point>0xffff)return -1;
  const block=state.level1[point>>11];
  if(block===255)return -1;
  const leaf=state.level2[16*block+((point>>7)&15)];
  if(leaf===255)return -1;
  return state.level3[128*leaf+(point&127)]||-1;
}

export function installRuntimeEncodingMap(type:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  type.value.namespace.items.set(values.string("__doc__"),values.none);
  type.value.namespace.items.set(values.string("size"),values.methodDescriptor({owner:type,name:"size",accepts:value=>maps.has(value),
    doc:"Return the size (in bytes) of this object.",textSignature:"($self, /)",invoke(receiver,args,keywords,meter){
      meter.checkpoint();
      if(keywords.items.size){
        meter.checkpoint(0,288);
        throw new PythonRuntimeError("TypeError","EncodingMap.size() takes no keyword arguments");
      }
      if(args.length){
        meter.checkpoint(0,320);
        throw new PythonRuntimeError("TypeError",`EncodingMap.size() takes no arguments (${args.length} given)`);
      }
      const state=maps.get(receiver)!;
      // CPython's LP64 struct includes trailing alignment padding. size() uses
      // sizeof(struct encoding_map)-1 plus both variable-length trie levels.
      return values.integer(63+state.level2.length+state.level3.length);
    }}));
  meter.checkpoint();
}

export function createRuntimeCharmapBuild(values:RuntimeValues,meter:ExecutionMeter,keys:KeyOperations<RuntimeValue>,type:()=>TypeValue):BuiltinFunctionValue {
  return values.builtinFunction({name:"charmap_build",module:"_codecs",keywordValidation:"callee",textSignature:"($module, map, /)",invoke(args,keywords,meter,context){
    let fatal=false;
    try{
      meter.checkpoint();
      if(keywords.items.size){
        meter.checkpoint(0,288);
        throw new PythonRuntimeError("TypeError","_codecs.charmap_build() takes no keyword arguments");
      }
      if(args.length!==1){
        meter.checkpoint(0,336);
        throw new PythonRuntimeError("TypeError",`_codecs.charmap_build() takes exactly one argument (${args.length} given)`);
      }
      const text=runtimeStringPayload(args[0]);
      if(text===undefined){
        const name=args[0].kind==="none"?"None":context?.typeName?.(args[0])??args[0].kind;
        const diagnostic=diagnosticTypeName(name,meter,50);
        // Type-name resolution can cross an interpreter callback. Admit the
        // exception after it returns, including the retained diagnostic text.
        meter.checkpoint(0,272+2*diagnostic.length);
        throw new PythonRuntimeError("TypeError",`charmap_build() argument must be str, not ${diagnostic}`);
      }
      const length=Math.min(text.value.length,256);
      if(length===0){
        meter.checkpoint(0,272);
        throw new PythonRuntimeError("TypeError","bad argument type for built-in operation");
      }
      meter.checkpoint(1,544);
      const level1=new Uint8Array(32).fill(255),blocks=new Uint8Array(512).fill(255);
      let count2=0,count3=0,needDictionary=text.value.codePointAt(0n,meter)!==0;
      for(let index=1;index<length;index++){
        const point=text.value.codePointAt(BigInt(index),meter);
        if(point===0||point>0xffff){needDictionary=true;break;}
        if(point===0xfffe)continue;
        if(level1[point>>11]===255)level1[point>>11]=count2++;
        if(blocks[point>>7]===255)blocks[point>>7]=count3++;
      }
      if(count2>=255||count3>=255)needDictionary=true;
      if(needDictionary){
        const dictionary=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
        for(let index=0;index<length;index++)dictionary.items.set(values.integer(text.value.codePointAt(BigInt(index),meter)),values.integer(index));
        return dictionary;
      }
      meter.checkpoint(1,64+16*count2+128*count3);
      const level2=new Uint8Array(16*count2).fill(255),level3=new Uint8Array(128*count3);
      let leaf=0;
      for(let index=1;index<length;index++){
        const point=text.value.codePointAt(BigInt(index),meter);
        if(point===0xfffe)continue;
        const offset=16*level1[point>>11]+((point>>7)&15);
        if(level2[offset]===255)level2[offset]=leaf++;
        level3[128*level2[offset]+(point&127)]=index;
      }
      const result=values.instance(type());
      maps.set(result,{level1,level2,level3});
      return result;
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }});
}
