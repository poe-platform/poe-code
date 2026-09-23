import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem, MockS3Client, OverlayFileSystem, S3FileSystem } from "../../../src/index.js";

test("overlay rejects an S3 lower without retained file and ancestor identities", async () => {
  const transport = new MockS3Client({ buckets: ["overlay-identity"] });
  const lower = new S3FileSystem({ transport, bucket: "overlay-identity" });
  await lower.writeFile("/input", Buffer.from("Original"));
  const overlay = new OverlayFileSystem({ lower, upper: new MemoryFileSystem() });
  await assert.rejects(overlay.readFile("/input"), { code: "ENOTSUP" });
});
