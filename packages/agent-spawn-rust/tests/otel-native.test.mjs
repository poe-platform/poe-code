import assert from "node:assert/strict";
import { test, mock } from "node:test";
import http from "node:http";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../agent-spawn/src/native-otel.ts", import.meta.url);
const own = await import("../dist/index.js");
const servers = [];
let nextAddress = { port: 41234 },
  failure;
mock.method(http, "createServer", (handler) => {
  const server = new EventEmitter();
  Object.assign(server, {
    handler,
    closes: 0,
    listen(port, host, ready) {
      assert.equal(port, 0);
      assert.equal(host, "127.0.0.1");
      queueMicrotask(() => (failure === undefined ? ready() : server.emit("error", failure)));
    },
    address() {
      return nextAddress;
    },
    close(done) {
      this.closes++;
      done?.();
    }
  });
  servers.push(server);
  return server;
});
syncBuiltinESMExports();
const warnings = [];
mock.method(console, "warn", (message) => warnings.push(message));
async function request(server, url, chunks, contentType) {
  let statusCode,
    body,
    headers = {};
  const result = new Promise((resolve) => {
    const response = {
      set statusCode(value) {
        statusCode = value;
      },
      setHeader(name, value) {
        headers[name] = value;
      },
      end(value) {
        body = value;
        resolve({ statusCode, body, headers });
      }
    };
    server.handler(
      {
        url,
        headers: { "content-type": contentType },
        async *[Symbol.asyncIterator]() {
          yield* chunks;
        }
      },
      response
    );
  });
  return result;
}
async function fixture(api, agent, content) {
  const capture = await api.startNativeOtelCapture(agent, content),
    server = servers.at(-1);
  assert.ok(capture);
  const env = { ...capture.env, OTEL_RESOURCE_ATTRIBUTES: "poe.code.spawn.id=<uuid>" };
  assert.equal(capture.env.OTEL_RESOURCE_ATTRIBUTES, `poe.code.spawn.id=${capture.correlationId}`);
  const responses = [];
  for (const [path, payload, type] of [
    ["/prefix/v1/traces", [Buffer.from('{"a":'), "1}"], "application/json"],
    ["/v1/logs", [new Uint8Array([0, 255, 1])], "application/x-protobuf"],
    ["/v1/metrics", ["null"], "application/json; charset=utf-8"],
    ["/v1/traces", ["invalid"], "application/json"],
    ["/v1/metrics?ignored", ["invalid"], "application/json"],
    ["/v1/LOGS", ["{}"], "application/json"],
    [undefined, ["{}"], "application/json"],
    ["/v1/logs", [], "application/json"],
    ["/v1/logs", ["not-json"], "application/JSON"],
    ["/v1/traces", ["[1,true]"], "json"],
    ["/v1/logs", ["text"], undefined]
  ])
    responses.push(await request(server, path, payload, type));
  const records = await capture.drain();
  assert.equal(server.closes, 1);
  return { env, args: capture.args, records, responses };
}
test("owned telemetry capture preserves declarations, chunking, route suffixes and host JSON semantics", async () => {
  for (const agent of ["codex", "claude", "opencode", "goose"])
    for (const content of [false, true])
      assert.deepEqual(await fixture(own, agent, content), await fixture(original, agent, content));
});
test("unsupported telemetry avoids receiver allocation and keeps diagnostics", async () => {
  for (const agent of ["pi", "unknown", "", "gemini-cli"])
    for (const api of [original, own]) {
      const count = servers.length;
      assert.equal(await api.startNativeOtelCapture(agent), undefined);
      assert.equal(servers.length, count);
      assert.equal(
        warnings.at(-1),
        `warning: agent "${agent}" does not emit OpenTelemetry; running without OTel capture`
      );
    }
});
test("receiver startup preserves address failures and original socket error identity", async () => {
  for (const address of [null, "pipe"])
    for (const api of [original, own]) {
      nextAddress = address;
      await assert.rejects(api.startNativeOtelCapture("codex"), {
        message: "Failed to start native OTel receiver"
      });
      assert.equal(servers.at(-1).closes, 1);
    }
  nextAddress = { port: 41234 };
  failure = new Error("socket startup");
  for (const api of [original, own])
    await assert.rejects(api.startNativeOtelCapture("codex"), (error) => error === failure);
  failure = undefined;
});
