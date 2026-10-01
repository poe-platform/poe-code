import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createLlmConfiguration } from "./configuration.js";

test("configuration uses canonical caller storage, preserves unrelated aliases and resolves chains", async () => {
  const fs = new MemoryFileSystem();
  const signal = new AbortController().signal;
  const configuration = createLlmConfiguration({ fs, cwd: "/", env: { LLM_USER_PATH: "/settings" }, signal });
  await configuration.setAlias("tiny", "fixture-chat");
  await configuration.setAlias("nested", "tiny");
  assert.equal(await configuration.resolveAlias("nested"), "fixture-chat");
  assert.deepEqual(await configuration.aliases(), { tiny: "fixture-chat", nested: "fixture-chat" });
  assert.equal(new TextDecoder().decode(await fs.readFile("/settings/aliases.json")), '{\n    "tiny": "fixture-chat",\n    "nested": "fixture-chat"\n}\n');
  await configuration.removeAlias("nested");
  assert.deepEqual(await configuration.aliases(), { tiny: "fixture-chat" });
  await assert.rejects(configuration.removeAlias("missing"), /No such alias: missing/);
});

test("configuration persists defaults and model option strings without touching other models", async () => {
  const fs = new MemoryFileSystem();
  const signal = new AbortController().signal;
  const configuration = createLlmConfiguration({ fs, cwd: "/", env: { LLM_USER_PATH: "/settings" }, signal });
  await configuration.setDefaultModel("fixture-chat");
  assert.equal(await configuration.defaultModel(), "fixture-chat");
  assert.equal(new TextDecoder().decode(await fs.readFile("/settings/default_model.txt")), "fixture-chat");
  await configuration.setModelOption("fixture-chat", "temperature", "0.5");
  await configuration.setModelOption("other", "seed", "12");
  assert.deepEqual(await configuration.modelOptions("fixture-chat"), { temperature: "0.5" });
  await configuration.clearModelOption("fixture-chat", "temperature");
  assert.deepEqual(await configuration.modelOptions("fixture-chat"), {});
  assert.deepEqual(await configuration.modelOptions("other"), { seed: "12" });
});

test("concurrent configurations sharing caller storage preserve both updates", async () => {
  const fs = new MemoryFileSystem();
  const context = { fs, cwd: "/", env: { LLM_USER_PATH: "/settings" }, signal: new AbortController().signal };
  const first = createLlmConfiguration(context), second = createLlmConfiguration(context);
  await Promise.all([first.setAlias("one", "model-one"), second.setAlias("two", "model-two")]);
  assert.deepEqual(await first.aliases(), { one: "model-one", two: "model-two" });
  await Promise.all([first.setModelOption("chat", "temperature", "0.5"), second.setModelOption("chat", "seed", "7")]);
  assert.deepEqual(await first.modelOptions("chat"), { temperature: "0.5", seed: "7" });
});

test("malformed state and cycles fail without rewriting caller state", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/settings");
  const configuration = createLlmConfiguration({ fs, cwd: "/", env: { LLM_USER_PATH: "/settings" }, signal: new AbortController().signal });
  const malformed = new TextEncoder().encode('{"wrong": 1}');
  await fs.writeFile("/settings/aliases.json", malformed);
  await assert.rejects(configuration.setAlias("new", "model"), /Invalid aliases.json/);
  assert.deepEqual(await fs.readFile("/settings/aliases.json"), malformed);
  await fs.writeFile("/settings/aliases.json", new TextEncoder().encode('{"one":"two","two":"one"}'));
  await assert.rejects(configuration.resolveAlias("one"), /Alias cycle/);
});

test("configuration treats prototype names as owned data and propagates cancellation", async () => {
  const fs = new MemoryFileSystem(), controller = new AbortController();
  const configuration = createLlmConfiguration({ fs, cwd: "/", env: { LLM_USER_PATH: "/settings" }, signal: controller.signal });
  await configuration.setAlias("__proto__", "fixture-chat");
  assert.equal(await configuration.resolveAlias("__proto__"), "fixture-chat");
  const reason = new Error("cancelled");
  controller.abort(reason);
  await assert.rejects(configuration.setAlias("cancelled", "model"), error => error === reason);
  const stored = JSON.parse(new TextDecoder().decode(await fs.readFile("/settings/aliases.json"))) as Record<string, string>;
  assert.deepEqual(Object.keys(stored), ["__proto__"]);
});

test("named model defaults share bounded canonical storage and clear atomically", async () => {
  const fs = new MemoryFileSystem();
  const signal = new AbortController().signal;
  const configuration = createLlmConfiguration({fs,cwd:"/",env:{LLM_USER_PATH:"/settings"},signal});
  await configuration.setDefaultModel(" chat \n");
  await configuration.setDefaultModel("embedding","default_embedding_model.txt");
  await configuration.setDefaultModel("custom","profile.txt");
  assert.equal(await configuration.defaultModel(),"chat");
  assert.equal(await configuration.defaultModel("default_embedding_model.txt"),"embedding");
  assert.equal(await configuration.defaultModel("profile.txt"),"custom");
  await configuration.setDefaultModel(null,"default_embedding_model.txt");
  assert.equal(await configuration.defaultModel("default_embedding_model.txt"),undefined);
  assert.equal(await configuration.defaultModel(),"chat");
  for (const name of ["keys.json","../private.txt","/private.txt"]) {
    await assert.rejects(configuration.defaultModel(name),/default filename/);
  }
});

test("clearing a default does not delete a concurrent replacement", async () => {
  const fs = new MemoryFileSystem();
  const configuration = createLlmConfiguration({fs,cwd:"/",env:{LLM_USER_PATH:"/settings"},signal:new AbortController().signal});
  await configuration.setDefaultModel("original");
  const remove = fs.removeFileConditional.bind(fs);
  fs.removeFileConditional = async (path, options) => {
    await fs.writeFile(path,new TextEncoder().encode("replacement"));
    return remove(path,options);
  };
  await assert.rejects(configuration.setDefaultModel(null), (error: unknown) => (error as {code?:string}).code === "EAGAIN");
  assert.equal(await configuration.defaultModel(),"replacement");
});
