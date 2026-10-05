import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createLlmCommand } from "./command.js";
import { createLlmService } from "./service.js";
import type { LlmProvider, LlmRequest, LlmInputSource } from "./types.js";
import fixtures from "./fixtures/models-async-0.27.1.json" with {type: "json"};

function provider(): LlmProvider {
  return {name: "FixtureModel", models: [
    {id: "plain", aliases: ["p"]},
    {id: "paired", aliases: ["a"], asyncModel: {
      displayName: "FixtureAsync (async): paired", capabilities: ["tools", "schema"],
      options: {count: {type: "integer", description: "Async count"}}
    }}
  ], complete() {throw new Error("discovery cannot invoke model");}};
}
for (const fixture of fixtures) test(`pinned async model catalog: ${fixture.argv.join(" ")}`, async () => {
  let stdout = "", stderr = "";
  const result = await createLlmCommand({providers: [provider()], defaultModel: "plain"}).execute({
    command: "llm", args: fixture.argv, fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: {[Symbol.asyncIterator]() {throw new Error("discovery cannot read stdin");}},
    stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  assert.deepEqual({stdout, stderr, exitCode: result.exitCode}, {stdout: fixture.stdout, stderr: fixture.stderr, exitCode: fixture.exitCode});
});

test("shared async resolution uses paired metadata and forwards typed mode/options", async () => {
  const requests: LlmRequest[] = [];
  const p = {...provider(), async *complete(request: LlmRequest) {requests.push(request); yield "done";}};
  const service = createLlmService({providers: [p], defaultModel: "paired"});
  assert.equal(service.resolve("a", {async: true}).model.displayName, "FixtureAsync (async): paired");
  assert.equal(service.resolve(undefined, {async: true}).model.id, "paired");
  assert.throws(() => service.resolve("plain", {async: true}), {message: "Unknown async model (sync model exists): plain"});
  assert.throws(() => service.resolve("missing", {async: true}), {message: "Unknown model: missing"});
  const base = {prompt: "hello", attachments: [], options: {count: "2"}, signal: new AbortController().signal};
  for await (const ignored of service.stream({...base, async: true, schema: {type: "object"}})) void ignored;
  assert.equal(requests.length, 1); assert.equal(requests[0]!.async, true); assert.deepEqual(requests[0]!.options, {count: 2});
  assert.throws(() => service.complete({...base, schema: {type: "object"}}), /does not support schema/);
});

test("source requests admit async-only schemas and clean up rejected async models", async () => {
  let disposed = 0, invoked = 0;
  const source = (): LlmInputSource => ({bytes: {async *[Symbol.asyncIterator]() {yield new TextEncoder().encode("hello");}}, async dispose() {disposed++;}});
  const service = createLlmService({providers: [{...provider(), async *completeSources(request) {
    invoked++; assert.equal(request.async, true);
    for await (const ignored of request.prompt.bytes) void ignored;
    yield "done";
  }}]});
  for await (const ignored of service.streamSources!({async: true, model: "paired", prompt: source(), attachments: [], options: {}, schema: {type: "object"}, signal: new AbortController().signal})) void ignored;
  assert.equal(invoked, 1); assert.equal(disposed, 1);
  await assert.rejects(async () => {
    for await (const ignored of service.streamSources!({async: true, model: "plain", prompt: source(), attachments: [], options: {}, signal: new AbortController().signal})) void ignored;
  }, /Unknown async model/);
  assert.equal(invoked, 1); assert.equal(disposed, 2);
});

test("paired definitions snapshot independent mutable options and capabilities", () => {
  const capabilities: ("tools" | "schema")[] = ["tools"];
  const options = {count: {type: "integer" as const, maximum: 3}};
  const service = createLlmService({providers: [{...provider(), models: [{id: "paired", capabilities: [], asyncModel: {options, capabilities}}]}]});
  capabilities.push("schema"); options.count.maximum = 100;
  const model = service.resolve("paired", {async: true}).model;
  assert.deepEqual(model.capabilities, ["tools"]); assert.equal(model.options!.count!.maximum, 3);
  assert.deepEqual(service.resolve("paired").model.capabilities, []);
  assert.ok(Object.isFrozen(model)); assert.ok(Object.isFrozen(model.options!.count));
  const rebuilt = createLlmService({providers: [{...provider(), models: service.models.map(entry => entry.model)}]});
  assert.deepEqual(rebuilt.resolve("paired", {async: true}).model, model);
});

test("paired async metadata cannot override shared identity or nest registrations", () => {
  for (const asyncModel of [null, [], {id: "other"}, {aliases: ["other"]}, {asyncModel: {}}]) {
    assert.throws(() => createLlmService({providers: [{...provider(), models: [{id: "paired", asyncModel} as unknown as LlmProvider["models"][number]]}]}), /Invalid paired async model/);
  }
});

test("paired model IDs remain query terms when custom display text omits them", async () => {
  const {selectLlmModelByQuery} = await import("./model-selection.js");
  const service = createLlmService({providers: [{...provider(), models: [{id: "paired", displayName: "Friendly", asyncModel: {}}]}]});
  assert.equal((await selectLlmModelByQuery(service.models, ["paired"])).model.id, "paired");
  let stdout = "";
  const result = await createLlmCommand({service}).execute({command: "llm", args: ["models", "-q", "paired"],
    fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: {[Symbol.asyncIterator]() {throw new Error("no stdin");}}, stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}
  });
  assert.equal(result.exitCode, 0); assert.equal(stdout, "Friendly\n");
});
