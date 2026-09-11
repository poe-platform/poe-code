import {expect,it} from "vitest";
import {detectSourceEncoding} from "./source-encoding.js";
import {PythonSyntaxError} from "./source.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

const bytes=(text:string)=>new TextEncoder().encode(text);
it.each([
  ["", "utf-8"], ["x=1", "utf-8"], ["# coding: latin_1\nx=1", "iso-8859-1"],
  ["#!/usr/bin/python\n# coding=cp1252", "cp1252"], ["\n# coding: ASCII", "ASCII"],
  [" \t\f# -*- coding: UTF_8 -*-", "utf-8"], ["# coding: utf-8-anything", "utf-8"],
  ["# coding: ISO_LATIN_1-extra", "iso-8859-1"], ["# coding: latin-10", "latin-10"],
  ["x=1 # coding: latin-1", "utf-8"], ["x=1\n# coding: latin-1", "utf-8"],
  ["# comment\n# comment\n# coding: latin-1", "utf-8"], ["# Coding: latin-1", "utf-8"],
  ["# coding: ! coding=latin-1", "iso-8859-1"], ["# coding: x.y_2-3", "x.y_2-3"],
  ["\\\n# coding: latin-1", "utf-8"], ["# hello\r# coding: latin-1\rx=1", "iso-8859-1"],
  ["# hello\r\n# coding: latin-1", "iso-8859-1"], ["# coding: ascii\n# coding: latin-1", "ascii"]
])("detects source declaration %j",(source,encoding)=>{
  expect(detectSourceEncoding(bytes(source))).toEqual({encoding,bomLength:0});
});
it("recognizes only a complete initial UTF-8 BOM",()=>{
  expect(detectSourceEncoding(bytes("\ufeff# coding: UTF_8\nx=1"))).toEqual({encoding:"utf-8",bomLength:3});
  expect(detectSourceEncoding(new Uint8Array([0xef,0xbb]))).toEqual({encoding:"utf-8",bomLength:0});
});
it.each(["latin-1","utf8","unknown"])("rejects a BOM conflicting with %s before codec lookup",encoding=>{
  expect(()=>detectSourceEncoding(bytes(`\ufeff# coding: ${encoding}`),{filename:"bytes.py"})).toThrow(PythonSyntaxError);
  expect(()=>detectSourceEncoding(bytes(`\ufeff# coding: ${encoding}`),{filename:"bytes.py"})).toThrow("with BOM");
});
it("charges scans and output storage and observes cancellation",()=>{
  for(const limits of [{maxSteps:10,maxAllocatedBytes:100000},{maxSteps:100000,maxAllocatedBytes:0}]){
    expect(()=>detectSourceEncoding(bytes("#"+" ".repeat(1000)+"coding: ascii"),{meter:new ExecutionBudget(limits)})).toThrow(ExecutionLimitError);
  }
  const controller=new AbortController();controller.abort();
  expect(()=>detectSourceEncoding(bytes(""),{meter:new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:1000,signal:controller.signal})})).toThrow(ExecutionLimitError);
});
it("does not scan source content beyond the two declaration lines",()=>{
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000});
  expect(detectSourceEncoding(bytes("#\n#\n"+"x".repeat(10000)),{meter})).toEqual({encoding:"utf-8",bomLength:0});
});
