import {expect,it} from "vitest";
import {PythonDecodeError} from "./decode-error.js";

it.each([
  [-1,0,"bytes in position -1--1"],
  [1,2,"bytes in position 1-1"],
  [5,6,"bytes in position 5-5"],
  [0,1,"byte 0x78 in position 0"],
  [0,0,"bytes in position 0--1"],
  [3,1,"bytes in position 3-0"],
] as const)("formats decode fault (%s, %s) without indexing outside the object",(start,end,location)=>{
  const error=new PythonDecodeError("punycode",new Uint8Array([120]),start,end,"bad");
  expect(error.message).toBe(`'punycode' codec can't decode ${location}: bad`);
  expect(error.start).toBe(start);expect(error.end).toBe(end);
});
