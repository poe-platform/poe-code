import {expect,it} from "vitest";
import {runCli} from "./cli.js";
import {createSink} from "../test/sinks.js";
it.each(["entry.ajs","entry.js","entry.mjs"])("executes source module %s without harness export restrictions",async filename=>{
  const stdout=createSink();const stderr=createSink();
  const code=await runCli(["--source-type","module",filename],{
    readFile:async()=>"export let value=1;value++;export {value as result}",
    stat:async()=>({isFile:()=>true}),stdout,stderr});
  expect(stderr.output()).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(stdout.output())).toEqual({ok:true,returnValue:{result:2,value:2}});
});
