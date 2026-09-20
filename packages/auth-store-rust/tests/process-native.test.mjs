import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import * as own from "../dist/index.js";
process.env.TSX_DISABLE_CACHE="1";
const { tsImport } = await import("tsx/esm/api");
const reference=await tsImport("../../auth-store/src/index.ts",import.meta.url);
function child(){const value=new EventEmitter();for(const name of ["stdin","stdout","stderr"]){value[name]=new EventEmitter();value[name].setEncoding=()=>{};value[name].end=()=>{throw new Error("unexpected stdin write");};}return value;}
test("default Keychain processes preserve stream diagnostics and signal/spawn failure semantics",async()=> {
  const original=childProcess.spawn;
  try {
    for(const operation of ["get","set","delete"]) for(const exit of [0,44,1,null,"error"]) {
      let baseline;
      for(const factory of [reference,own]) {
        let observed;
        childProcess.spawn=(command,args,options)=> {
          observed={command,args,options};const result=child();
          queueMicrotask(()=> {
            result.stdout.emit("data","secret\r\n");result.stderr.emit("data","command diagnostics");
            if(exit==="error")result.emit("error",new Error("spawn failed"));else result.emit("close",exit,exit===null ? "SIGTERM" : undefined);
          });return result;
        };
        syncBuiltinESMExports();const store=new factory.KeychainStore({service:"s",account:"a"});
        const result=await store[operation]("value").then(value=>({value}),error=>({error:error.message}));const actual={result,observed};
        if(factory===reference)baseline=actual;else assert.deepEqual(actual,baseline);
      }
    }
  } finally {childProcess.spawn=original;syncBuiltinESMExports();}
});
