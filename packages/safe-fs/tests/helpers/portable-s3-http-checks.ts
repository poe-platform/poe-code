import { createS3HttpTransport } from "../../src/fs/s3/http/index.js";
import { S3FileSystem } from "../../src/fs/s3/index.js";

export async function run(): Promise<boolean> {
  if ("Buffer" in globalThis || "process" in globalThis) throw new Error("Node globals present");
  const bytes = Uint8Array.of(0, 128, 255);
  let requests = 0;
  globalThis.fetch = async (url, init) => {
    requests++;
    if (!String(url).startsWith("https://s3.example/bucket") || init?.redirect !== "manual") throw new Error("incorrect request target");
    const headers = new Headers(init.headers);
    if (!headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256 ")) throw new Error("unsigned request");
    if (new URL(String(url)).search) return new Response("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>");
    return new Response(init.method === "HEAD" ? null : bytes, { headers: { "content-length": "3", etag: '"version"' } });
  };
  const transport = createS3HttpTransport({ endpoint: "https://s3.example", region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "secret" },
    maxPutBytes: Infinity, maxGetBytes: Infinity, maxXmlBytes: Infinity });
  const fs = new S3FileSystem({ bucket: "bucket", transport });
  const actual = await fs.readFile("/file");
  if (actual.length !== 3 || actual[2] !== 255 || requests < 1) throw new Error("binary read failed");
  await transport.putObject({ Bucket: "bucket", Key: "file", Body: bytes });
  const listing = await transport.listObjectsV2({ Bucket: "bucket" });
  if (listing.IsTruncated !== false) throw new Error("XML listing failed");
  return true;
}
