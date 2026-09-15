import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget} from "./execution-budget.js";
import {PythonEncodeError} from "./encode-error.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {SingleByteTableCodec} from "./single-byte-table-codec.js";
import {singleByteTables} from "./single-byte-tables.js";

// External CPython 3.14.7 oracle: charmap surrogateescape retains the first
// callback's args while subsequent faults update the native location fields.
it.each(singleByteTables)("retains first error arguments across $name surrogateescape faults",table=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000}),values=new RuntimeValues(meter);
  const keys={hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const exceptions=new RuntimeExceptionExecution(new RuntimeTypeRegistry(values,keys,meter),values,meter);
  const codec=new SingleByteTableCodec(table,meter);
  for(const points of [[0xdc80,65,0x10ffff],[0xdc80,0xdc81,65,0xdc82,65,0x10ffff]]){
    const source=values.stringPoints(new CodePointString(Uint32Array.from(points),meter));
    let failure:unknown;
    try{codec.encode(source.value,"surrogateescape",meter);}catch(error){failure=error;}
    expect(failure).toBeInstanceOf(PythonEncodeError);
    const prepared=exceptions.prepare(failure,{unicodeObject:source});
    expect(prepared).toBeInstanceOf(RuntimeRaisedException);
    const state=runtimeExceptionPayload((prepared as RuntimeRaisedException).value)!;
    const firstEnd=points[1]===65?1:2;
    expect(state.args.items).toEqual([values.string("charmap"),source,values.integer(0),values.integer(firstEnd),values.string("character maps to <undefined>")]);
    expect(state.member("object",meter)).toBe(source);
    expect(state.member("start",meter)).toEqual(values.integer(points.length-1));
    expect(state.member("end",meter)).toEqual(values.integer(points.length));
  }
});
