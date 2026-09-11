import {PythonRuntimeError} from "./error.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {runtimeIntegerIndex} from "./runtime-integer-index.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeFrame} from "./runtime-program.js";
import type {Traceback} from "./traceback.js";
import type {BuiltinFunctionValue,RuntimeValue,RuntimeValues,TypeValue} from "./runtime-values.js";

export function createTracebackNewBuiltin(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter,
  create:(next:Traceback<RuntimeFrame>|null,frame:RuntimeFrame,instruction:number,line:number)=>RuntimeValue):BuiltinFunctionValue {
  meter.checkpoint(0,96);
  return values.builtinFunction({name:"__new__",owner,keywordValidation:"callee",
    invoke(positional,keywords,meter,invocation){
      meter.checkpoint();
      try {
        if(positional.length===0)throw new PythonRuntimeError("TypeError","traceback.__new__(): not enough arguments");
        const type=positional[0];
        if(type.kind!=="type"){
          const name=invocation?.typeName?.(type)??(type.kind==="instance"?type.type.value.name:type.kind==="none"?"NoneType":type.kind==="not-implemented"?"NotImplementedType":type.kind);
          meter.checkpoint(1,128+name.length*2);
          throw new PythonRuntimeError("TypeError",`traceback.__new__(X): X is not a type object (${name})`);
        }
        if(type!==owner){
          const name=type.value.name;meter.checkpoint(1,128+name.length*4);
          throw new PythonRuntimeError("TypeError",`traceback.__new__(${name}): ${name} is not a subtype of traceback`);
        }
        const count=positional.length-1,total=count+keywords.items.size;
        if(total>4)throw new PythonRuntimeError("TypeError",`traceback() takes at most 4 ${count===0?"keyword ":""}arguments (${total} given)`);
        meter.checkpoint(0,64);const args:RuntimeValue[]=[];
        for(const name of ["tb_next","tb_frame","tb_lasti","tb_lineno"]){
          const position=args.length+1,value=positional[position]??keywords.items.lookup(values.string(name))?.value;meter.checkpoint();
          if(value===undefined)throw new PythonRuntimeError("TypeError",`traceback() missing required argument '${name}' (pos ${position})`);
          args.push(value);
        }
        const frame=args[1];
        if(frame.kind!=="instance"||frame.native?.kind!=="frame"){
          const name=frame.kind==="none"?"None":invocation?.typeName?.(frame)??(frame.kind==="instance"?frame.type.value.name:frame.kind==="not-implemented"?"NotImplementedType":frame.kind);
          throw new PythonRuntimeError("TypeError",`traceback() argument 'tb_frame' must be frame, not ${diagnosticTypeName(name,meter,50)}`);
        }
        meter.checkpoint(0,32);const numbers:number[]=[];
        for(let i=2;i<4;i++){
          const integer=runtimeIntegerIndex(args[i],meter,invocation?.integerIndex);meter.checkpoint();
          if(integer< -2147483648n||integer>2147483647n)throw new PythonRuntimeError("OverflowError","Python int too large to convert to C int");
          numbers.push(Number(integer));
        }
        const next=args[0];
        let nextTraceback:Traceback<RuntimeFrame>|null=null;
        if(next.kind!=="none"){
          if(next.kind!=="instance"||next.native?.kind!=="traceback"){
            const name=invocation?.typeName?.(next)??(next.kind==="instance"?next.type.value.name:next.kind==="not-implemented"?"NotImplementedType":next.kind);
            meter.checkpoint(1,128+name.length*2);
            throw new PythonRuntimeError("TypeError",`expected traceback object or None, got '${name}'`);
          }
          nextTraceback=next.native.traceback;
        }
        return create(nextTraceback,frame.native.frame,numbers[0],numbers[1]);
      }finally{meter.checkpoint();}
    }
  });
}
