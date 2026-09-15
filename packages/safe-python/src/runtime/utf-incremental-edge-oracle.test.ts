import {expect,it} from "vitest";
import reference from "./__snapshots__/utf-incremental-edges-3.14.7.json";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {Utf7Decoder} from "./utf7.js";
import {Utf8IncrementalDecoder} from "./utf8-incremental.js";
import {WideUnicodeDecoder} from "./utf-wide-incremental.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";

const factories={
  "utf-7":(errors:Utf8DecodeErrors)=>new Utf7Decoder(errors),
  "utf-8":(errors:Utf8DecodeErrors)=>new Utf8IncrementalDecoder(errors),
  "utf-16":(errors:Utf8DecodeErrors)=>new WideUnicodeDecoder(16,0,errors),
  "utf-16-le":(errors:Utf8DecodeErrors)=>new WideUnicodeDecoder(16,-1,errors),
  "utf-16-be":(errors:Utf8DecodeErrors)=>new WideUnicodeDecoder(16,1,errors),
  "utf-32":(errors:Utf8DecodeErrors)=>new WideUnicodeDecoder(32,0,errors),
  "utf-32-le":(errors:Utf8DecodeErrors)=>new WideUnicodeDecoder(32,-1,errors),
  "utf-32-be":(errors:Utf8DecodeErrors)=>new WideUnicodeDecoder(32,1,errors),
};

it("pins the incremental edge oracle to CPython 3.14.7, Unicode 16 and little endian",()=>{
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.byteorder).toBe("little");
});

it.each(reference.rows)("matches every split and post-failure state for $encoding/$errors/$input",row=>{
  const input=Uint8Array.from(row.input);
  expect(row.scenarios).toHaveLength(input.length+1);
  for(let split=0;split<=input.length;split++){
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
    const decoder=factories[row.encoding as keyof typeof factories](row.errors as Utf8DecodeErrors);
    const events=[];
    for(const [chunk,final] of [[input.slice(0,split),false],[input.slice(split),true]] as const){
      let result;
      try {result={text:[...decoder.decode(chunk,final,meter)]};}
      catch(error){
        if(!(error instanceof PythonDecodeError))throw error;
        result={error:[error.encoding,[...error.object],error.start,error.end,error.reason]};
      }
      const [pending,flag]=decoder.getstate(meter);
      events.push({...result,state:[[...pending],Number(flag)]});
    }
    expect(events,`split ${split}`).toEqual(row.scenarios[split]);
  }
});

it.each(Object.entries(factories))("preserves buffered %s state when cancellation precedes final input",(_encoding,create)=>{
  const decoder=create("strict"),controller=new AbortController();
  decoder.setstate([Uint8Array.of(0xef),0n]);
  const before=decoder.getstate();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  controller.abort();
  expect(()=>decoder.decode(Uint8Array.of(0xbb,0xbf),true,meter)).toThrow(ExecutionLimitError);
  expect(decoder.getstate()).toEqual(before);
});
