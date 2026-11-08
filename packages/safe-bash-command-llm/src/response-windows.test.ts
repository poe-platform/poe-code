import assert from "node:assert/strict";
import test from "node:test";
import { openAiBytes } from "./openai-http.js";

test("large transport chunks produce independent bounded windows without losing bytes", async () => {
  const borrowed = new Uint8Array(16 * 1024 * 1024 + 7).fill(37);
  let retired = 0, total = 0, windows = 0;
  async function* source() {
    try { yield borrowed; } finally { retired++; }
  }
  for await (const chunk of openAiBytes(source(), new AbortController().signal)) {
    assert.ok(chunk.byteLength <= 16384, "owned copies must fit one response window");
    assert.notEqual(chunk.buffer, borrowed.buffer);
    assert.ok(chunk.every(value => value === 37));
    total += chunk.byteLength;
    windows++;
    chunk.fill(0);
  }
  assert.equal(total, borrowed.byteLength);
  assert.equal(windows, 1025);
  assert.equal(retired, 1);
  assert.equal(borrowed[0], 37);
});

test("timer cancellation interrupts a single large transport chunk and retires its source", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel response");
  let retired = 0, bytes = 0;
  async function* source() {
    try { yield new Uint8Array(4 * 1024 * 1024); } finally { retired++; }
  }
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(async () => {
      for await (const chunk of openAiBytes(source(), controller.signal)) bytes += chunk.byteLength;
    }, error => error === reason);
    assert.ok(bytes < 4 * 1024 * 1024);
    for (let index = 0; index < 10; index++) await Promise.resolve();
    assert.equal(retired, 1);
  } finally { clearTimeout(timer); }
});

test("response quota applies to the entire admitted chunk before any window escapes", async () => {
  let retired = 0, outputs = 0;
  async function* source() {
    try { yield new Uint8Array(32769); } finally { retired++; }
  }
  await assert.rejects(async () => {
    for await (const ignoredChunk of openAiBytes(source(), new AbortController().signal, 32768)) outputs++;
  }, /response byte limit exceeded/);
  assert.equal(outputs, 0);
  assert.equal(retired, 1);
});
