import { parseComplexText } from "./complex-text.js";
import { convertRuntimeComplexSpecial } from "./runtime-complex-special.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { convertRuntimeFloat,convertRuntimeFloatNumber } from "./runtime-float-construction.js";
import { runtimeFloatPayload } from "./runtime-float-payload.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import { runtimeComplexPayload } from "./runtime-complex-payload.js";
import type { BuiltinInvocationContext,DictionaryValue,RuntimeValue,RuntimeValues } from "./runtime-values.js";

/** Native complex allocation. Only the single positional form parses strings
 * or preserves exact complex identity. Imaginary arguments use real-number
 * conversion, never __complex__; complex arguments in the two-field form are
 * retained with Python 3.14 deprecation warnings. */
export function constructRuntimeComplex(positional:readonly RuntimeValue[],keywords:DictionaryValue,values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):Extract<RuntimeValue,{kind:"complex"}> {
  meter.checkpoint();
  const count=positional.length+keywords.items.size;
  if(count>2)throw new PythonRuntimeError("TypeError",`complex() takes at most 2 ${positional.length===0?"keyword ":""}arguments (${count} given)`);
  if(count===0)return values.complex(0,0);
  const single=positional.length===1&&keywords.items.size===0;
  let real=positional[0],imag=positional[1];
  for(const [key,value] of keywords.items.snapshot()) {
    meter.checkpoint();
    if(key.kind!=="str")throw new PythonRuntimeError("TypeError","keywords must be strings");
    let name="";for(const point of key.value){meter.checkpoint(1,point>0xffff?4:2);name+=String.fromCodePoint(point);}
    if(name!=="real"&&name!=="imag")throw new PythonRuntimeError("TypeError",`complex() got an unexpected keyword argument '${name}'`);
    const position=name==="real"?0:1;
    if(positional.length>position)throw new PythonRuntimeError("TypeError",`argument for complex() given by name ('${name}') and position (${position+1})`);
    if(name==="real")real=value;else imag=value;
  }
  if(single&&real.kind==="str") {
    const parsed=parseComplexText(real.value,meter);return values.complex(parsed.real,parsed.imaginary);
  }
  meter.checkpoint(0,256);
  const typeName=(value:RuntimeValue):string=>{
    const name=invocation?.typeName?.(value)??(value.kind==="none"?"NoneType":value.kind==="not-implemented"?"NotImplementedType":value.kind);
    meter.checkpoint(1,name.length*2);return name;
  };
  const complexMethod=(source:RuntimeValue):Extract<RuntimeValue,{kind:"complex"}>|undefined=>{
    meter.checkpoint();
    if(source.kind==="complex")return source;
    const converted=convertRuntimeComplexSpecial(source,values,meter,invocation);
    if(converted!==undefined)return converted;
    const payload=runtimeComplexPayload(source);
    return payload===undefined?undefined:values.complex(payload.real,payload.imaginary);
  };
  const converted=real===undefined?undefined:complexMethod(real);
  if(single) {
    if(converted!==undefined)return converted;
    const floating=runtimeFloatPayload(real)??convertRuntimeFloatNumber(real,values,meter,invocation);
    if(floating!==undefined)return values.complex(floating.value,0);
    throw new PythonRuntimeError("TypeError",`complex() argument must be a string or a number, not ${typeName(real)}`);
  }
  const hasRealProtocol=(source:RuntimeValue):boolean=>{
    meter.checkpoint();
    if(runtimeFloatPayload(source)!==undefined||runtimeIntegerPayload(source)!==undefined)return true;
    if(invocation?.hasSpecial!==undefined)return invocation.hasSpecial(source,"__float__")||invocation.hasSpecial(source,"__index__");
    return invocation?.lookupSpecial?.(source,"__float__")!==undefined||invocation?.lookupSpecial?.(source,"__index__")!==undefined||invocation?.integerIndex?.lookupIndex(source)!==undefined;
  };
  if(real!==undefined&&converted===undefined&&!hasRealProtocol(real))throw new PythonRuntimeError("TypeError",`complex() argument 'real' must be a real number, not ${typeName(real)}`);
  const imaginaryPayload=imag===undefined?undefined:runtimeComplexPayload(imag);
  if(imag!==undefined&&imaginaryPayload===undefined&&!hasRealProtocol(imag))throw new PythonRuntimeError("TypeError",`complex() argument 'imag' must be a real number, not ${typeName(imag)}`);
  if(converted!==undefined&&!hasRealProtocol(real!))invocation?.warn?.("DeprecationWarning",`complex() argument 'real' must be a real number, not ${typeName(real!)}`);
  meter.checkpoint(0,128);
  const floatContext={invocation,buffers:invocation?.buffers,byteArray:invocation?.bytes?.byteArray?.bind(invocation.bytes)};
  const first=converted??(real===undefined?undefined:convertRuntimeFloat(real,values,meter,floatContext));
  const second=imag===undefined?undefined:imaginaryPayload??convertRuntimeFloat(imag,values,meter,floatContext);
  if(second?.kind==="complex")invocation?.warn?.("DeprecationWarning",`complex() argument 'imag' must be a real number, not ${typeName(imag!)}`);
  meter.checkpoint();
  let resultReal=first===undefined?0:first.kind==="complex"?first.real:first.value;
  let resultImag=second===undefined?first?.kind==="complex"?first.imaginary:0:second.kind==="complex"?second.real:second.value;
  if(second?.kind==="complex")resultReal-=second.imaginary;
  if(first?.kind==="complex"&&imag!==undefined)resultImag+=first.imaginary;
  return values.complex(resultReal,resultImag);
}
