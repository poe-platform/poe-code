import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/index.js";
import * as reference from "../../agent-spawn/dist/index.js";
import * as originalMcp from "../../agent-spawn/dist/configs/mcp.js";
test("all builtin launch permutations agree with the original without running an agent", () => {
  const normalize = (callback) => {
    try {
      return { value: callback() };
    } catch (error) {
      return { error: error.message };
    }
  };
  let cases = 0;
  for (const id of [
    "claude-code",
    "codex",
    "cursor",
    "pi",
    "opencode",
    "goose",
    "unknown",
    "claude-desktop"
  ])
    for (const mode of [undefined, "yolo", "auto", "edit", "read"])
      for (const model of [
        undefined,
        "",
        " ",
        "poe/anthropic/claude-opus-4.6",
        "openai/gpt-5",
        "x\ud800"
      ])
        for (const useStdin of [false, true])
          for (const resumeThreadId of [undefined, "session", "{{cwd}}"]) {
            const options = {
              prompt: "private 🌍\ntext",
              mode,
              model,
              useStdin,
              resumeThreadId,
              cwd: "/work",
              args: ["extra"]
            };
            assert.deepEqual(
              normalize(() => own.buildSpawnArgs(id, options)),
              normalize(() => reference.buildSpawnArgs(id, options)),
              JSON.stringify({ id, options })
            );
            cases++;
          }
  assert.equal(cases, 1440);
});
test("MCP serializers preserve UTF-16 payloads and prototype-named data", () => {
  const servers = JSON.parse(
    '{"__proto__":{"command":"node","args":["a\\ud800"],"env":{"constructor":"x","__proto__":"data"}},"odd.name":{"command":"q\\ud800"}}'
  );
  for (const name of [
    "toJsonMcpServers",
    "serializeJsonMcpArgs",
    "serializeCodexMcpArgs",
    "serializeOpenCodeMcpEnv"
  ])
    assert.deepEqual(own[name](servers), originalMcp[name](servers), name);
  const simple = { odd: { command: "x\ud800", args: ["y\udc00"] } };
  assert.deepEqual(own.serializeGooseMcpArgs(simple), originalMcp.serializeGooseMcpArgs(simple));
});
test("environment deletion and insertion order survive null-prototype records", () => {
  const a = JSON.parse('{"__proto__":"safe","PATH":"a","constructor":"own"}'),
    b = { PATH: undefined, NEW: "value" },
    c = { PATH: "b" };
  assert.deepEqual(
    own.mergeSpawnEnvironment(a, undefined, b, c),
    reference.mergeSpawnEnvironment(a, undefined, b, c)
  );
  assert.equal(Object.getPrototypeOf(own.mergeSpawnEnvironment(a)), null);
});
test("ACP argument recipes agree for empty, absent and null option values", () => {
  for (const id of ["gemini-cli", "opencode", "goose"]) {
    const acp = own.getAcpSpawnConfig(id),
      original = reference.getAcpSpawnConfig(id);
    for (const model of [undefined, "", " ", "poe/gemini-pro"])
      for (const mode of [undefined, "yolo", "auto", "edit", "read"])
        for (const mcpServers of [
          undefined,
          null,
          {},
          { one: { command: "node" } },
          { "x\ud800": { command: "node" } }
        ]) {
          const options = { model, mode, mcpServers };
          const invoke = (config) =>
            typeof config.acpArgs === "function" ? config.acpArgs(options) : config.acpArgs;
          assert.deepEqual(invoke(acp), invoke(original), JSON.stringify({ id, options }));
        }
  }
});
test("retry captures its callback once before asynchronous attempts", async () => {
  for (const implementation of [reference, own]) {
    let finish,
      calls = 0;
    const once = () => ({
      events: { async *[Symbol.asyncIterator]() {} },
      result: new Promise((resolve) => {
        calls++;
        finish = resolve;
      })
    });
    const options = { maxAttempts: 2, backoffMs: 0, isRetryable: () => false };
    const handle = implementation.createSpawnRetry(once)("agent", {}, options);
    options.isRetryable = () => {
      throw Error("mutated callback must not run");
    };
    finish({ exitCode: 1 });
    assert.equal((await handle.result).exitCode, 1);
    assert.equal(calls, 1);
    for await (const ignored of handle.events) void ignored;
  }
});
test("parallel preserves payload identity and cleans linked cancellation listeners", async () => {
  const { getEventListeners } = await import("node:events");
  for (const implementation of [reference, own]) {
    const parent = new AbortController(),
      individual = new AbortController(),
      payload = {};
    payload.self = payload;
    let complete;
    const parallel = implementation.createSpawnParallel((_service, options) => ({
      events: { async *[Symbol.asyncIterator]() {} },
      result: new Promise((resolve) => {
        complete = () => resolve({ exitCode: 0, payload, signal: options.signal });
      })
    }));
    const result = parallel([["agent", { signal: individual.signal }]], { signal: parent.signal });
    assert.equal(getEventListeners(parent.signal, "abort").length, 1);
    assert.equal(getEventListeners(individual.signal, "abort").length, 1);
    complete();
    const [value] = await result;
    assert.equal(value.payload, payload);
    assert.equal(getEventListeners(parent.signal, "abort").length, 0);
    assert.equal(getEventListeners(individual.signal, "abort").length, 0);
  }
});
test("command options getters are read once and UTF-8 streams retain complete text", async () => {
  for (const implementation of [reference, own]) {
    let reads = 0;
    const options = {
      get stdin() {
        reads++;
        return reads === 1 ? "first 🌍" : "incorrect second value";
      }
    };
    const result = await implementation.runCommand(
      process.execPath,
      ["-e", "process.stdin.pipe(process.stdout)"],
      options
    );
    assert.equal(result.stdout, "first 🌍");
    assert.equal(result.exitCode, 0);
    assert.equal(reads, 1);
  }
});
