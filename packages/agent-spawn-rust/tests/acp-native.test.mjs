import assert from "node:assert/strict";
import { test, mock } from "node:test";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Volume, createFsFromVolume } from "memfs";
const own = await import("../dist/index.js"),
  original = await import("../../agent-spawn/dist/index.js");
const memory = createFsFromVolume(new Volume()),
  launches = [];
for (const name of ["existsSync", "readFileSync", "mkdirSync"])
  mock.method(fs, name, memory[name].bind(memory));
for (const name of [
  "lstat",
  "mkdir",
  "readFile",
  "writeFile",
  "rename",
  "unlink",
  "readdir",
  "stat",
  "rm"
])
  mock.method(fs.promises, name, memory.promises[name].bind(memory.promises));
mock.method(childProcess, "spawn", (command, args, options) => {
  const child = new EventEmitter();
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null
  });
  const requests = [];
  launches.push({ command, args, options, requests });
  const send = (message) =>
    child.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  let pending = "",
    prompt;
  child.stdin.on("data", (chunk) => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      requests.push(message);
      if (message.method === "initialize")
        send({
          id: message.id,
          result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true } }
        });
      else if (message.method === "session/new")
        send({ id: message.id, result: { sessionId: "session-native" } });
      else if (message.method === "session/load") send({ id: message.id, result: {} });
      else if (message.method === "session/prompt") {
        prompt = message;
        send({
          id: "permission",
          method: "session/request_permission",
          params: {
            sessionId: message.params.sessionId,
            toolCall: { toolCallId: "tool", title: "Write file" },
            options: [
              { kind: "reject_always", optionId: "all", name: "Reject all" },
              { kind: "reject_once", optionId: "once", name: "Reject" }
            ]
          }
        });
      } else if (message.id === "permission") {
        send({
          method: "session/update",
          params: {
            sessionId: prompt.params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Hello native" }
            }
          }
        });
        send({
          id: prompt.id,
          result: { stopReason: "end_turn", _meta: { usage: { inputTokens: 7, outputTokens: 3 } } }
        });
      }
    }
  });
  child.kill = (signal) => {
    child.signalCode = signal;
    child.stdout.end();
    child.stderr.end();
    queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };
  return child;
});
syncBuiltinESMExports();
test("ACP executes the real owned client, protocol and permissions against reference", async () => {
  for (const api of [original, own]) {
    const contexts = [];
    const handle = api.spawnAcp({
      agentId: "opencode",
      prompt: "private",
      cwd: "/work",
      mode: "auto",
      env: { OWNED: "yes", REMOVED: undefined },
      middlewares: [
        async (ctx, next) => {
          await next();
          contexts.push(ctx);
        }
      ]
    });
    const result = await handle.done,
      events = [];
    for await (const event of handle.events) events.push(event);
    assert.deepEqual(result, {
      stdout: "Hello native\n",
      stderr: "",
      exitCode: 0,
      threadId: "session-native",
      usage: { inputTokens: 7, outputTokens: 3 }
    });
    assert.deepEqual(
      events.map((event) => event.event),
      ["session_start", "permission_rejected", "agent_message"]
    );
    assert.equal(events[2]._meta.raw.content.text, "Hello native");
    assert.equal(typeof events[2]._meta.ts, "number");
    assert.equal(contexts[0].events.length, 3);
    const launch = launches.at(-1);
    assert.equal(launch.options.env.OWNED, "yes");
    assert.equal(Object.hasOwn(launch.options.env, "REMOVED"), false);
    assert.deepEqual(launch.requests.find((message) => message.id === "permission").result, {
      outcome: { outcome: "selected", optionId: "once" }
    });
  }
});
test("ACP loading, delivery disposal and runtime validation preserve producer history", async () => {
  const handle = own.spawnAcp({
    agentId: "opencode",
    prompt: "private",
    cwd: "/work",
    resumeThreadId: "existing"
  });
  const iterator = handle.events[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.return();
  assert.equal((await handle.done).threadId, "existing");
  assert.equal((await iterator.next()).done, true);
  assert.ok(launches.at(-1).requests.some((message) => message.method === "session/load"));
  assert.throws(
    () => own.spawnAcp({ agentId: "opencode", prompt: "p", detach: false }),
    /runtime overrides/
  );
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => own.spawnAcp({ agentId: "opencode", prompt: "p", signal: controller.signal }),
    { name: "AbortError" }
  );
});

test("ACP retains hidden own MCP fields across native validation", async () => {
  const server = Object.defineProperties(
    {},
    {
      command: { value: "docs-reader" },
      args: { value: ["serve"] },
      env: { value: { LEVEL: "debug" } }
    }
  );
  for (const api of [original, own]) {
    const handle = api.spawnAcp({
      agentId: "opencode",
      prompt: "private",
      cwd: "/work",
      mcpServers: { docs: server }
    });
    const events = [];
    for await (const event of handle.events) events.push(event);
    assert.equal((await handle.done).exitCode, 0);
    assert.deepEqual(
      launches.at(-1).requests.find((message) => message.method === "session/new").params
        .mcpServers,
      [
        {
          name: "docs",
          command: "docs-reader",
          args: ["serve"],
          env: [{ name: "LEVEL", value: "debug" }]
        }
      ]
    );
  }
});
