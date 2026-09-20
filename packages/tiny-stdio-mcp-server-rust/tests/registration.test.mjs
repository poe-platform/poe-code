import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../dist/index.js";

test("registration uses the admitted name without invoking proxy property reads", async () => {
  const server = createServer({ name: "test", version: "0" });
  let effects = 0;
  const definition = new Proxy(
    { name: "echo", inputSchema: { type: "object" } },
    {
      get(target, key, receiver) {
        effects++;
        return Reflect.get(target, key, receiver);
      }
    }
  );
  server.registerTool(definition, () => "first");
  assert.equal(effects, 0);
  await server.handleMessage("initialize");
  assert.equal(
    (await server.handleMessage("tools/call", { name: "echo" })).result.content[0].text,
    "first"
  );
  assert.equal(server.removeTool("echo"), true);
  server.registerTool(definition, () => "second");
  assert.equal(effects, 0);
  assert.equal(
    (await server.handleMessage("tools/call", { name: "echo" })).result.content[0].text,
    "second"
  );
});

test("tool removal retains UTF16 name identity and cannot remove a replacement-character name", async () => {
  const server = createServer({ name: "test", version: "0" });
  server.tool("\ud800", "Surrogate", { type: "object" }, () => "surrogate");
  server.tool("\ufffd", "Replacement", { type: "object" }, () => "replacement");
  assert.equal(server.removeTool("\ud800"), true);
  assert.equal(server.removeTool("\ud800"), false);
  await server.handleMessage("initialize");
  assert.equal((await server.handleMessage("tools/call", { name: "\ud800" })).error.code, -32602);
  assert.equal(
    (await server.handleMessage("tools/call", { name: "\ufffd" })).result.content[0].text,
    "replacement"
  );
});
