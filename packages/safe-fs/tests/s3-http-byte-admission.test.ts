import { expect, it, vi } from "vitest";
import { createS3HttpTransport } from "../src/fs/s3/http/index.js";

it.each([["a", 1024], ["é", 512], ["€", 341], ["😀", 256]] as const)(
  "admits exactly 1024 UTF-8 key bytes for %s before requesting credentials",
  async (character, count) => {
    const stopped = new Error("credential boundary");
    const credentials = vi.fn(async () => { throw stopped; });
    const transport = createS3HttpTransport({ endpoint: "https://example.invalid", region: "us-east-1", credentials });
    const prefix = character.repeat(count);
    const key = prefix + "a".repeat(1024 - new TextEncoder().encode(prefix).length);
    await expect(transport.headObject({ Bucket: "bucket", Key: key })).rejects.toBe(stopped);
    await expect(transport.headObject({ Bucket: "bucket", Key: key + "a" })).rejects.toMatchObject({ code: "InvalidArgument" });
    expect(credentials).toHaveBeenCalledTimes(1);
  }
);

it("checks metadata and list argument byte limits before requesting credentials", async () => {
  const stopped = new Error("credential boundary");
  const credentials = vi.fn(async () => { throw stopped; });
  const transport = createS3HttpTransport({ endpoint: "https://example.invalid", region: "us-east-1", credentials });
  await expect(transport.putObject({ Bucket: "bucket", Key: "key", Body: new Uint8Array(), Metadata: { k: "a".repeat(2047) } })).rejects.toBe(stopped);
  await expect(transport.putObject({ Bucket: "bucket", Key: "key", Body: new Uint8Array(), Metadata: { k: "a".repeat(2048) } })).rejects.toMatchObject({ code: "InvalidArgument" });
  await expect(transport.listObjectsV2({ Bucket: "bucket", Prefix: "a".repeat(8192) })).rejects.toBe(stopped);
  await expect(transport.listObjectsV2({ Bucket: "bucket", Prefix: "😀".repeat(2048) + "a" })).rejects.toMatchObject({ code: "InvalidArgument" });
  expect(credentials).toHaveBeenCalledTimes(2);
});
