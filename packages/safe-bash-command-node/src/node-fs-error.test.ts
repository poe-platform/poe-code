import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "safe-bash-contracts/errors";
import { fsDescriptor } from "./commands/node/host.js";

test("Node serializes branded filesystem errors without exposing the brand", () => {
  const error = new FsError("ENOENT", { path: "/missing.json", syscall: "lstat" });
  const descriptor = fsDescriptor(error);
  assert.ok(descriptor);
  assert.equal(descriptor.code, "ENOENT");
  assert.equal(descriptor.path, "/missing.json");
  assert.deepEqual(Object.getOwnPropertySymbols(descriptor), []);
});

test("Node still refuses unexpected symbols and accessor-backed error fields", () => {
  const extra = new FsError("ENOENT");
  Object.defineProperty(extra, Symbol("extra"), { value: true });
  assert.equal(fsDescriptor(extra), undefined);
  const accessor = new FsError("ENOENT");
  let reads = 0;
  Object.defineProperty(accessor, "path", { get() { reads++; return "/private"; } });
  assert.equal(fsDescriptor(accessor), undefined);
  assert.equal(reads, 0);
});
