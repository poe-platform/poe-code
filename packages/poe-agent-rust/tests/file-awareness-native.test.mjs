import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/file-awareness.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../poe-agent/src/runtime/file-awareness.ts", import.meta.url);
test("file awareness normalizes paths and owns ordered independent Set snapshots", () => {
  for (const cwd of ["/project", ".", "", "C:\\project", "/project/\ud800"]) {
    const a = own.createFileAwarenessTracker(cwd),
      b = original.createFileAwarenessTracker(cwd);
    for (const path of [
      "file",
      "./file",
      "../other",
      "/absolute",
      "",
      " ",
      "x/../file",
      "🌍/file",
      "\ud800",
      "x\\file"
    ]) {
      a.recordRead(path);
      b.recordRead(path);
      a.recordWrite(path);
      b.recordWrite(path);
    }
    assert.deepEqual(a.snapshot(), b.snapshot());
    const copy = a.snapshot();
    copy.readFiles.clear();
    copy.modifiedFiles.add("mutated");
    assert.deepEqual(a.snapshot(), b.snapshot());
  }
});
test("tool admission preserves inherited path getters, exact tool names and opaque failures", () => {
  const cases = [
    null,
    [],
    {},
    { path: 12 },
    { path: "" },
    { path: " \ufeff " },
    { path: " file " },
    Object.create({ path: "inherited" })
  ];
  for (const args of cases)
    for (const tool of ["read_file", "write_file", "edit", "read", " read_file ", null]) {
      const a = own.createFileAwarenessTracker("/project"),
        b = original.createFileAwarenessTracker("/project");
      own.recordToolFileAwareness({ tracker: a, args, tool });
      original.recordToolFileAwareness({ tracker: b, args, tool });
      assert.deepEqual(a.snapshot(), b.snapshot());
    }
  for (const api of [original, own]) {
    const events = [],
      tracker = {
        recordRead(path) {
          events.push(["read", path]);
        },
        recordWrite(path) {
          events.push(["write", path]);
        }
      };
    api.recordToolFileAwareness({
      tracker,
      get args() {
        events.push("args");
        return {
          get path() {
            events.push("path");
            return " x ";
          }
        };
      },
      get tool() {
        events.push("tool");
        return "read_file";
      }
    });
    assert.deepEqual(events, ["args", "path", "tool", ["read", " x "]]);
    const reason = Symbol("private");
    assert.throws(
      () =>
        api.recordToolFileAwareness({
          tracker,
          tool: "read_file",
          args: {
            get path() {
              throw reason;
            }
          }
        }),
      (error) => error === reason
    );
    let calls = 0;
    api.recordToolFileAwareness({
      tracker,
      args: { path: " " },
      get tool() {
        calls++;
        throw reason;
      }
    });
    assert.equal(calls, 0);
  }
});
