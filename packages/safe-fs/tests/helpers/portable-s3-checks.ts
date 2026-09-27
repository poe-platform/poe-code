import { scopeFileSystem } from "../../src/core.js";
import { MockS3Client, S3FileSystem } from "../../src/fs/s3/index.js";
import { dirname } from "../../src/contracts/path.js";

export async function run(): Promise<boolean> {
  if ("Buffer" in globalThis || "process" in globalThis) throw new Error("Node globals present");
  const client = new MockS3Client({ buckets: ["bucket"] });
  await client.putObject({ Bucket: "bucket", Key: "nested/file", Body: Uint8Array.of(1, 2) });
  const fs = new S3FileSystem({ bucket: "bucket", transport: client });
  if (dirname("/nested/file") !== "/nested" || (await fs.readFile("/nested/file"))[1] !== 2) throw new Error("read failed");
  const results = await Promise.allSettled([1, 2].map(value => client.putObject({ Bucket: "bucket", Key: "exclusive", Body: Uint8Array.of(value), IfNoneMatch: "*" })));
  if (results.filter(result => result.status === "fulfilled").length !== 1) throw new Error("conditional write raced");
  await client.putObject({ Bucket: "bucket", Key: "nested/😀", Body: Uint8Array.of(3) });
  if ((await fs.readdir("/nested")).length !== 2) throw new Error("listing failed");
  let rewrite = false;
  const forwarding = new Proxy(client, { get(target, key) {
    if (key === "headObject") return (input: Parameters<typeof client.headObject>[0]) => {
      if (rewrite && input.Key === "nested/file") Object.assign(input, { Key: "nested/😀" });
      return client.headObject({ ...input });
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const forwarded = new S3FileSystem({ bucket: "bucket", transport: forwarding });
  if (await fs.compareEntry!("/nested/file", forwarded, "/nested/file") !== "same") throw new Error("forwarded identity lost");
  rewrite = true;
  if (await forwarded.compareEntry("/nested/file", fs, "/nested/😀") !== "unknown") throw new Error("mutated query acquired authority");
  let calls = 0;
  const limit = new Error("request budget exceeded");
  const scoped = scopeFileSystem(fs, () => { if (++calls > 1) throw limit; }, new AbortController().signal);
  const before = client.requests.length;
  try { await scoped.readFile("/nested/file"); throw new Error("budget bypassed"); }
  catch (error) { if (error !== limit && (error as { cause?: unknown }).cause !== limit) throw error; }
  if (client.requests.length - before > 1) throw new Error("request escaped budget");
  return true;
}
