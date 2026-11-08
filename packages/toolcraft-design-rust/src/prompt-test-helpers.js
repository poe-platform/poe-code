import {PassThrough,Writable} from "node:stream";
import {harnessPolicy} from "./test-harness-host.js";

export function createPromptHarness(options={}){
  const chunks=[],frames=[],rawModes=[];
  const input=new PassThrough();
  const output=new Writable({write(chunk,_encoding,callback){harnessPolicy("capture",[chunk,chunks,frames]);callback();}});
  harnessPolicy("promptInput",[input,options]);
  input.setRawMode=enabled=>{rawModes.push(enabled);};
  harnessPolicy("promptOutput",[output,options,frames]);
  return {input,output,rawModes,getOutput:()=>chunks.join("")};
}

export async function tick(){await new Promise(resolve=>setImmediate(resolve));}
