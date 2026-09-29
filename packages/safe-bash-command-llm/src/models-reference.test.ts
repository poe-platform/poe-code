import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import reference from "./fixtures/models-reference.json" with { type: "json" };
test("pinned models listing intersects query terms, unions explicit model IDs and filters schemas",async t=>{
 const options={temperature:{type:"number" as const,minimum:0,maximum:2,nullable:true,description:"Sampling temperature"}};
 const command=createLlmCommand({defaultModel:"fixture-chat",providers:[{name:"FixtureModel",models:[{id:"fixture-chat",aliases:["echo"],options},{id:"fixture-schema",aliases:["structured"],capabilities:["schema"],options}],complete(){throw new Error("listing must not execute a provider");}}]});
 for(const fixture of reference.cases.filter(item=>item.argv[0]==="models")){
  await t.test(JSON.stringify(fixture.argv), async () => {
  const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
  const result=await command.execute({command:"llm",args:fixture.argv,fs:new MemoryFileSystem(),cwd:"/",env:{},signal:new AbortController().signal,stdin:toByteSource(""),stdout:{async write(chunk){chunks.push(chunk.slice());}},stderr:{async write(chunk){errors.push(chunk.slice());}}});
  assert.equal(result.exitCode,fixture.exitCode,JSON.stringify(fixture.argv));
  assert.equal(Buffer.concat(chunks).toString(),fixture.stdout,JSON.stringify(fixture.argv));
  assert.equal(Buffer.concat(errors).toString(),fixture.stderr,JSON.stringify(fixture.argv));
  });
 }
});


 test("model option descriptions wrap like the pinned reference", async () => {
 const reference = (await import("./fixtures/model-description-reference.json", { with: { type: "json" } })).default;
 const command = createLlmCommand({providers:[{name:"FixtureModel",models:[{id:"fixture-description", options:{temperature:{type:"number", nullable:true, description:reference.description}}}],complete(){throw new Error("listing must not execute a provider");}}]});
 const fixture=reference.cases[0]!;
 const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
 const result=await command.execute({command:"llm",args:fixture.argv,fs:new MemoryFileSystem(),cwd:"/",env:{},signal:new AbortController().signal,stdin:toByteSource(""),stdout:{async write(chunk){chunks.push(chunk.slice());}},stderr:{async write(chunk){errors.push(chunk.slice());}}});
 assert.equal(result.exitCode,fixture.exitCode);
 assert.equal(Buffer.concat(chunks).toString(),fixture.stdout);
 assert.equal(Buffer.concat(errors).toString(),fixture.stderr);
 });
