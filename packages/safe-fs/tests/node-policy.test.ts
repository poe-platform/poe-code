import { describe, expect, it } from "vitest";
import { getSystemErrorMap } from "node:util";
import { FsError, isErrnoCode } from "../src/contracts/errors.js";
import type { FileSystem } from "../src/contracts/filesystem.js";
import { compareResolvedEntries, registerEntryAuthority } from "../src/fs/mount/comparison.js";
import type { EntryView } from "../src/fs/mount/comparison.js";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";
import { MockS3Client } from "../src/fs/s3/mock.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { queryS3Head, recordMockS3Head, recordS3Stat, registerS3EntryOwner, getOwnedS3Entry } from "../src/fs/s3/authority.js";

function view(): EntryView {
  return {
    filesystem: { capabilities: {} } as FileSystem,
    path: "/file",
    readOnly: false,
    stat: { type: "file", size: 0, mode: 0o644, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }
  };
}

describe("Node policy preservation", () => {
  it("retains every supported native errno and ENOTSUP alias", () => {
    for (const [errno, [code]] of getSystemErrorMap()) {
      if (isErrnoCode(code) && code !== "EOPNOTSUPP") expect(new FsError(code).errno).toBe(errno);
    }
    expect(new FsError("EOPNOTSUPP").errno).toBe(new FsError("ENOTSUP").errno);
  });

  it("retains ALS through callbacks discarding options and isolates unrelated calls", async () => {
    const own = view();
    const peer = view();
    const independent = view();
    let resume!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>(resolve => { resume = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let invoked = 0;
    own.filesystem.compareEntry = async () => {
      invoked++;
      entered();
      await paused;
      expect(await compareResolvedEntries(own, peer)).toBe("unknown");
      return "same";
    };
    registerEntryAuthority(independent.filesystem, async () => "distinct");
    const pending = compareResolvedEntries(own, peer);
    await started;
    try {
      expect(await compareResolvedEntries(independent, peer)).toBe("distinct");
    } finally {
      resume();
    }
    expect(await pending).toBe("same");
    expect(invoked).toBe(1);
  });

  it("keeps exact S3 invocation proofs, refusing clones, replay and query cross-binding", async () => {
    const input = { Bucket: "bucket", Key: "file" };
    const storage = {};
    const own = view();
    const comparison = async () => "unknown" as const;
    registerS3EntryOwner(own.filesystem, path => path, () => true, comparison);
    const output = {};
    const accepted = await queryS3Head(input, async () => {
      await Promise.resolve();
      recordMockS3Head(output, input, storage);
      return output;
    });
    recordS3Stat(own.filesystem, "/file", own.stat, accepted);
    expect(getOwnedS3Entry(own)).toEqual({ storage, key: "file" });
    expect(getOwnedS3Entry({ ...own, stat: { ...own.stat } })).toBeUndefined();
    expect(getOwnedS3Entry({ ...own, path: "/elsewhere" })).toBeUndefined();
    for (const mode of ["clone", "replay", "cross-query"] as const) {
      const target = { ...own, stat: { ...own.stat } };
      const result = await queryS3Head(input, async () => {
        if (mode === "replay") return output;
        const inner = {};
        if (mode === "clone") {
          recordMockS3Head(inner, input, storage);
          return { ...inner };
        }
        return queryS3Head(input, async () => {
          recordMockS3Head(inner, input, storage);
          return inner;
        });
      });
      recordS3Stat(own.filesystem, "/file", target.stat, result);
      expect(getOwnedS3Entry(target)).toBeUndefined();
    }
  });

  it("retains S3 and memory cross-adapter authority in one registry", async () => {
    const transport = new MockS3Client({ buckets: ["test"] });
    const left = new S3FileSystem({ transport, bucket: "test" });
    const right = new S3FileSystem({ transport, bucket: "test" });
    const memory = new MemoryFileSystem();
    await left.writeFile("/file", new Uint8Array([1]));
    await memory.writeFile("/file", new Uint8Array([1]));
    expect(await left.compareEntry("/file", new ReadOnlyFileSystem(right), "/file")).toBe("same");
    expect(await memory.compareEntry("/file", left, "/file")).toBe("distinct");
    const head = transport.headObject.bind(transport);
    transport.headObject = async (input, options) => ({ ...await head(input, options) });
    expect(await memory.compareEntry("/file", left, "/file")).toBe("unknown");
  });

  it("does not cross-bind overlapping identical queries sharing a returned object", async () => {
    const input = { Bucket: "bucket", Key: "file" };
    const output = {};
    const firstStorage = {};
    const secondStorage = {};
    const first = view();
    const second = view();
    const comparison = async () => "unknown" as const;
    registerS3EntryOwner(first.filesystem, path => path, () => true, comparison);
    registerS3EntryOwner(second.filesystem, path => path, () => true, comparison);
    let resume!: () => void;
    const pause = new Promise<void>(resolve => { resume = resolve; });
    const pending = queryS3Head(input, async () => {
      recordMockS3Head(output, input, firstStorage);
      await pause;
      return output;
    });
    try {
      const observed = await queryS3Head(input, async () => {
        await Promise.resolve();
        recordMockS3Head(output, input, secondStorage);
        return output;
      });
      recordS3Stat(second.filesystem, "/file", second.stat, observed);
      expect(getOwnedS3Entry(second)).toEqual({ storage: secondStorage, key: "file" });
    } finally {
      resume();
    }
    recordS3Stat(first.filesystem, "/file", first.stat, await pending);
    expect(getOwnedS3Entry(first)).toBeUndefined();
  });
});
