import assert from "node:assert/strict";
import test from "node:test";
import type { EntryComparison, FileSystem, FsOptions } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

type Same<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2) ? true : false;

test("comparison is additive with an exact async three-valued signature", () => {
  const exact: Same<NonNullable<FileSystem["compareEntry"]>,
    (path: string, peer: FileSystem, peerPath: string, options?: FsOptions) => Promise<EntryComparison>> = true;
  const literals: Same<EntryComparison, "same" | "distinct" | "unknown"> = true;
  const legacy: Omit<FileSystem, "compareEntry"> = createMemoryFileSystem();
  const compatible: FileSystem = legacy;
  assert.equal(exact, true);
  assert.equal(literals, true);
  assert.equal(compatible, legacy);
});

test("comparison forwarding retains paths, peer and signal without serialization", async () => {
  const controller = new AbortController();
  const peer = createMemoryFileSystem();
  const calls: unknown[][] = [];
  const compare: NonNullable<FileSystem["compareEntry"]> = async (...args) => {
    calls.push(args);
    args[3]?.signal?.throwIfAborted();
    return "unknown";
  };
  assert.equal(await compare("/literal\nsource", peer, "/literal target", { signal: controller.signal }), "unknown");
  assert.equal(calls[0]![1], peer);
  assert.equal((calls[0]![3] as FsOptions).signal, controller.signal);
  assert.equal(calls[0]![0], "/literal\nsource");
  assert.equal(calls[0]![2], "/literal target");
  const reason = new Error("cancel comparison");
  controller.abort(reason);
  await assert.rejects(compare("/source", peer, "/target", { signal: controller.signal }), error => error === reason);
});
