import {expect,it} from "vitest";
import reference from "./__snapshots__/utf7-shift-boundaries-3.14.7.json";
import {PythonDecodeError} from "./decode-error.js";
import {decodeUtf7} from "./utf7.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";

it("matches pinned UTF-7 shift termination across every following byte and seeded malformed runs",()=>{
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  for(const row of reference.rows){
    let actual;
    try{
      const result=decodeUtf7(new Uint8Array(row.input),row.errors as Utf8DecodeErrors,undefined,row.final);
      actual={result:[[...result.text],result.consumed]};
    }catch(error){
      if(!(error instanceof PythonDecodeError))throw error;
      const initial=error.initial??error;
      actual={error:[error.encoding,[...error.object],error.start,error.end,error.reason],args:[error.encoding,[...error.object],initial.start,initial.end,initial.reason]};
    }
    expect(actual,JSON.stringify(row)).toEqual(row.result===undefined?{error:row.error,args:row.args}:{result:row.result});
  }
});
