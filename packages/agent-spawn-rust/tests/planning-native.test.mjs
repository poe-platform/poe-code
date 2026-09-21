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
