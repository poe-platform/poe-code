import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as shared from "@poe-code/safe-fs";
import * as contracts from "@poe-code/safe-fs/contracts";
import * as memory from "@poe-code/safe-fs/fs/memory";
import * as real from "@poe-code/safe-fs/fs/real";
import * as s3 from "@poe-code/safe-fs/fs/s3";
import * as http from "@poe-code/safe-fs/fs/s3/http";
import * as webdav from "@poe-code/safe-fs/fs/webdav";
import * as readonly from "@poe-code/safe-fs/fs/readonly";
import * as mount from "@poe-code/safe-fs/fs/mount";
import * as overlay from "@poe-code/safe-fs/fs/overlay";
import * as bridge from "@poe-code/safe-fs/node";

const manifest: { dependencies?: Record<string, string> } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

describe("public package boundary", () => {
  it("is a private ESM extraction with no runtime dependencies", () => {
    expect(manifest).toMatchObject({
      name: "@poe-code/safe-fs",
      version: "0.0.0-dev",
      private: true,
      type: "module"
    });
    expect(Object.keys((manifest as { dependencies?: object }).dependencies ?? {})).toEqual([]);
  });

  it.each([
    [contracts, "FsError"],
    [contracts, "isFsError"],
    [memory, "MemoryFileSystem"],
    [memory, "createMemoryFileSystem"],
    [real, "RealFileSystem"],
    [real, "createRealFileSystem"],
    [s3, "S3FileSystem"],
    [s3, "S3RenameError"],
    [s3, "S3ServiceError"],
    [s3, "MockS3Client"],
    [s3, "createS3Transport"],
    [http, "createS3HttpTransport"],
    [webdav, "WebDavFileSystem"],
    [readonly, "ReadOnlyFileSystem"],
    [readonly, "createReadOnlyFileSystem"],
    [mount, "MountFileSystem"],
    [mount, "createMountFileSystem"],
    [overlay, "OverlayFileSystem"],
    [overlay, "createOverlayFileSystem"],
    [bridge, "createNodeFsBridge"]
  ] as const)("keeps root and subpath identities identical: %s / %s", (entry, name) => {
    expect(Reflect.get(shared, name)).toBeTypeOf("function");
    expect(Reflect.get(entry, name)).toBe(Reflect.get(shared, name));
  });

  it("does not export shell or interpreter integration", () => {
    for (const name of [
      "Shell",
      "createShell",
      "makeSafeJsFsModule",
      "safejs",
      "createBytePipe",
      "registerEntryAuthority"
    ]) {
      expect(shared).not.toHaveProperty(name);
    }
  });

  it("retains FsError identity through conversion and adapters", async () => {
    const filesystem = new memory.MemoryFileSystem();
    const error = await filesystem.stat("/missing").catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(shared.FsError);
    expect(contracts.isFsError(error, "ENOENT")).toBe(true);
    expect(shared.toFsError(error)).toBe(error);
    expect(
      new shared.S3RenameError("/from", "/to", "copy", [], [], new shared.FsError("EIO"))
    ).toBeInstanceOf(contracts.FsError);
  });
});
