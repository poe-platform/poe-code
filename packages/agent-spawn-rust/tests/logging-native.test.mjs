import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { Volume, createFsFromVolume } from "memfs";
const own = await import("../dist/index.js"),
  original = await import("../../agent-spawn/dist/index.js");
test("redaction admits cyclic secret inputs and strips raw metadata before serialization", async () => {
  const input = { secret: "secret" };
  input.self = input;
  const raw = {};
  raw.self = raw;
  const events = [
    { event: "tool_start", id: "one", title: "private", input, _meta: { raw, trace: "keep" } },
    { event: "tool_complete", id: "one", path: "secret" },
    { event: "agent_message", text: "secret" }
  ];
  const saved = {};
  const volume = Volume.fromJSON({}),
    memory = createFsFromVolume(volume);
  for (const name of ["mkdir", "open", "readFile", "lstat", "realpath"]) {
    saved[name] = fs.promises[name];
    fs.promises[name] = memory.promises[name].bind(memory.promises);
  }
  syncBuiltinESMExports();
  try {
    for (const api of [original, own]) {
      volume.reset();
      const ctx = {
        sessionId: "session/one",
        agent: "my 👩‍💻 agent",
        startedAt: new Date("2026-03-20T12:34:56.007Z"),
        logDir: "/logs",
        events,
        usage: { inputTokens: 0, outputTokens: 0 }
      };
      await api.spawnLog(ctx, async () => {});
      assert.equal(ctx.logFile, "/logs/20260320-123456-007-my-----agent-session-one.jsonl");
      assert.equal(ctx.logError, undefined);
      const rows = (await memory.promises.readFile(ctx.logFile, "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.deepEqual(rows, [
        {
          event: "tool_start",
          id: "one",
          title: "[redacted]",
          input: "[redacted]",
          _meta: { trace: "keep" }
        },
        { event: "tool_complete", id: "one", path: "[redacted]" },
        { event: "agent_message", text: "[redacted]" }
      ]);
      assert.equal(events[0].input, input);
      assert.equal(events[0]._meta.raw, raw);
    }
  } finally {
    Object.assign(fs.promises, saved);
    syncBuiltinESMExports();
  }
});
