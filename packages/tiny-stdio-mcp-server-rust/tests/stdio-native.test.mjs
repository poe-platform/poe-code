import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const addon = createRequire(import.meta.url)("../dist/tiny-stdio-mcp-server-rust.node");

test("invalid numeric tokens cannot settle a different native output frame", () => {
  const output = new addon.NativeStdioOutput(64);
  const submitted = output.enqueue("one");
  for (const token of [submitted.token + 0.5, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(output.returned(token, true), []);
    assert.deepEqual(output.completed(token), []);
    assert.equal(output.pending, 1);
  }
  assert.deepEqual(output.returned(submitted.token, true), []);
  assert.equal(output.completed(submitted.token)[0].kind, "complete");
  assert.equal(output.pending, 0);
});

test("actual native framer preserves split bytes and raw UTF16 strings", () => {
  const input = new addon.NativeStdioInput(64, 128);
  const bytes = Buffer.from("é🦀\r\n");
  const lines = [];
  for (const byte of bytes) lines.push(...input.push(Buffer.from([byte])).lines);
  lines.push(...input.push("\ud800").lines);
  lines.push(...input.finish().lines);
  assert.deepEqual(lines, ["é🦀", "\ud800"]);
});

test("native frame batches retain admitted lines and bound the batch size", () => {
  const input = new addon.NativeStdioInput(4, 2);
  const result = input.push("one\ntwo\nlonger\n");
  assert.deepEqual(result.lines, ["one", "two"]);
  assert.equal(result.error, "Stdio input line byte limit exceeded");
  const many = new addon.NativeStdioInput(4, 2).push("a\nb\nc\n");
  assert.deepEqual(many.lines, ["a", "b"]);
  assert.equal(many.error, "Stdio pending message limit exceeded");
  const stopped = new addon.NativeStdioInput(64, 1);
  assert.equal(stopped.push("a\nb\ntrailing").error, "Stdio pending message limit exceeded");
  assert.deepEqual(stopped.finish(), { lines: [], error: "Stdio input is closed" });
});

test("native wire dispatch parses once and keeps request IDs outside callback arguments", () => {
  const server = new addon.NativeServer({ name: "wire", version: "1" });
  const session = server.createSession();
  assert.equal(
    server.dispatchLine(session, '{"jsonrpc":"2.0","method":"initialize"}').action.type,
    "none"
  );
  assert.equal(
    server.dispatchLine(session, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}').action.type,
    "error"
  );
  const initialized = server.dispatchLine(
    session,
    '{"jsonrpc":"2.0","id":"one","method":"initialize"}'
  );
  assert.equal(initialized.id, "one");
  assert.equal(initialized.isNotification, false);
  assert.equal(initialized.action.type, "reply");
  server.setTool({ name: "echo", inputSchema: { type: "object" } }, false);
  const called = server.dispatchLine(
    session,
    '{"jsonrpc":"2.0","id":"\\ud800","method":"tools/call","params":{"name":"echo","arguments":{"text":"\\udfff"}}}'
  );
  assert.equal(called.id, "\ud800");
  assert.deepEqual(called.action.arguments, { text: "\udfff" });
  assert.equal(called.action.type, "invoke");
  assert.equal(server.activeRequestCount, 1);
  assert.equal(server.finishRequest(called.action.token), true);
  server.closeSession(session);
});
