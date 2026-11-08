import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import * as native from "../dist/index.js";
import * as reference from "tiny-mcp-client";
function mockChild() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, killed: false, kills: [] });
  child.kill = signal => { child.kills.push(signal); child.killed = true; child.signalCode = signal; child.emit("exit", null, signal); return true; };
  child.cleanup = () => { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); };
  return child;
}
test("own in-memory transports exchange bytes and resolve closure once", async () => {
  for (const factory of [native, reference]) {
    const pair = factory.createInMemoryTransportPair();
    const read = [];
    pair.serverTransport.readable.on("data", chunk => read.push(chunk.toString()));
    pair.clientTransport.writable.write("hello\n");
    assert.deepEqual(read, ["hello\n"]);
    const reason = new Error("done");
    pair.clientTransport.dispose(reason); pair.clientTransport.dispose(new Error("later"));
    assert.equal((await pair.clientTransport.closed).reason, reason);
    assert.equal(pair.clientTransport.writable.writableEnded, true);
    assert.equal(pair.serverTransport.writable.writableEnded, true);
    pair.clientTransport.readable.destroy(); pair.clientTransport.writable.destroy();
  }
});
test("stdio transports preserve spawn options, bounded UTF16 stderr and idempotent process cleanup", async () => {
  for (const factory of [native, reference]) {
    const child = mockChild(); let observed;
    const env = { TASK_TEST: "yes" };
    const transport = new factory.StdioTransport({ command: "mock", args: ["arg"], cwd: "/example", env, spawn(...args) { observed = args; return child; } });
    try {
      assert.deepEqual(observed, ["mock", ["arg"], { cwd: "/example", env, stdio: ["pipe", "pipe", "pipe"] }]);
      assert.equal(transport.readable, child.stdout); assert.equal(transport.writable, child.stdin);
      const bytes = Buffer.from("\ufeff🦊é");
      for (const byte of bytes) child.stderr.write(Buffer.from([byte]));
      assert.equal(transport.getStderrOutput(), "🦊é");
      child.stderr.emit("data", "a".repeat(65535) + "🦊");
      const expected = ("🦊é" + "a".repeat(65535) + "🦊").slice(-65536);
      assert.equal(transport.getStderrOutput(), expected);
      transport.dispose(); transport.dispose();
      assert.deepEqual(child.kills, ["SIGTERM"]);
      assert.equal((await transport.closed).signal, "SIGTERM");
      assert.equal(child.stdin.writableEnded, true);
    } finally { transport.dispose(); child.cleanup(); }
  }
});
test("stdio stream errors, process errors and exit metadata settle closure exactly once", async () => {
  for (const factory of [native, reference]) for (const source of ["stdin", "stdout", "stderr", "process", "exit"]) {
    const child = mockChild();
    const transport = new factory.StdioTransport({ command: "mock", spawn: () => child });
    try {
      const reason = new Error(source);
      if (source === "process") child.emit("error", reason);
      else if (source === "exit") { child.exitCode = 7; child.emit("exit", 7, null); }
      else child[source].emit("error", reason);
      const closed = await transport.closed;
      if (source !== "exit") assert.equal(closed.reason, reason);
      else { assert.equal(closed.code, 7); assert.equal(closed.reason.message, "Stdio transport process exited"); }
      child.emit("exit", 9, null);
      assert.equal(await transport.closed, closed);
    } finally { transport.dispose(); child.cleanup(); }
  }
});
test("stdio decoder flushes truncated UTF8 at end and mixed string chunks preserve raw UTF16", async () => {
  for (const factory of [native, reference]) {
    const child = mockChild();
    const transport = new factory.StdioTransport({ command: "mock", spawn: () => child });
    try {
      child.stderr.emit("data", Buffer.from([0xe2, 0x82]));
      child.stderr.emit("data", "text\ud800");
      child.stderr.emit("data", Buffer.from([0xf0, 0x9f]));
      child.stderr.emit("end");
      assert.equal(transport.getStderrOutput(), "�text\ud800�");
    } finally { transport.dispose(); child.cleanup(); }
  }
});

test("stdio stderr tails match the reference across seeded malformed and split byte chunks", async () => {
  const nativeChild = mockChild(); const referenceChild = mockChild();
  const actual = new native.StdioTransport({ command: "mock", spawn: () => nativeChild });
  const expected = new reference.StdioTransport({ command: "mock", spawn: () => referenceChild });
  let seed = 0x73a015b2;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  try {
    for (let sample = 0; sample < 256; sample++) {
      const bytes = Buffer.from(Array.from({ length: random() % 96 }, () => random() & 255));
      for (let position = 0; position < bytes.length;) {
        const length = 1 + random() % 7;
        const part = bytes.subarray(position, position += length);
        nativeChild.stderr.emit("data", part); referenceChild.stderr.emit("data", part);
      }
      if (sample % 7 === 0) {
        const text = String.fromCharCode(random() & 65535, random() & 65535);
        nativeChild.stderr.emit("data", text); referenceChild.stderr.emit("data", text);
      }
      assert.equal(actual.getStderrOutput(), expected.getStderrOutput());
    }
    nativeChild.stderr.emit("end"); referenceChild.stderr.emit("end");
    assert.equal(actual.getStderrOutput(), expected.getStderrOutput());
  } finally { actual.dispose(); expected.dispose(); nativeChild.cleanup(); referenceChild.cleanup(); }
});
test("stdio disposal does not kill an exited or already-killed child", async () => {
  for (const factory of [native, reference]) for (const key of ["exitCode", "signalCode", "killed"]) {
    const child = mockChild();
    child[key] = key === "exitCode" ? 0 : key === "signalCode" ? "SIGINT" : true;
    const transport = new factory.StdioTransport({ command: "mock", spawn: () => child });
    try { transport.dispose(); assert.equal(child.kills.length, 0); assert.equal(child.stdin.writableEnded, true); }
    finally { child.cleanup(); }
  }
});
test("in-memory stream errors retain their actual closure reason", async () => {
  for (const factory of [native, reference]) for (const stream of ["readable", "writable"]) {
    const pair = factory.createInMemoryTransportPair(); const reason = new Error(stream);
    pair.clientTransport[stream].emit("error", reason);
    assert.equal((await pair.clientTransport.closed).reason, reason);
    pair.clientTransport.readable.destroy(); pair.clientTransport.writable.destroy();
  }
});
