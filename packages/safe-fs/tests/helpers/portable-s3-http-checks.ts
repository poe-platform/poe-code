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
  const objects = new Map([["a", 1], ["b", 2], ["nested/c", 3]]);
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (!new Headers(init?.headers).get("authorization")?.startsWith("AWS4-HMAC-SHA256 ")) throw new Error("unsigned directory request");
    if (init?.method === "HEAD") {
      const size = objects.get(decodeURIComponent(url.pathname.slice("/bucket/".length)));
      return new Response(null, {status: size === undefined ? 404 : 200, headers: size === undefined ? {} : {"content-length": String(size), etag: '"version"'}});
    }
    const prefix = url.searchParams.get("prefix") ?? "", delimiter = url.searchParams.get("delimiter");
    const entries = new Map<string,string>();
    for (const [key,size] of objects) if (key.startsWith(prefix)) {
      const slash = key.indexOf("/", prefix.length);
      if (delimiter && slash >= 0) { const name = key.slice(0,slash+1); entries.set(name, `<CommonPrefixes><Prefix>${name}</Prefix></CommonPrefixes>`); }
      else entries.set(key, `<Contents><Key>${key}</Key><Size>${size}</Size><ETag>&quot;version&quot;</ETag><LastModified>2026-10-03T00:00:00Z</LastModified></Contents>`);
    }
    const offset = Number(url.searchParams.get("continuation-token") ?? 0), count = Number(url.searchParams.get("max-keys") ?? 1000);
    const values = [...entries].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,value]) => value);
    const next = Math.min(values.length,offset+count), truncated = next < values.length;
    return new Response(`<ListBucketResult><IsTruncated>${truncated}</IsTruncated>${values.slice(offset,next).join("")}${truncated ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}</ListBucketResult>`);
  };
  const paged = new S3FileSystem({bucket:"bucket",transport,pageSize:1});
  paged.readdir = async () => {throw new Error("S3 iterator used eager listing");};
  const names = [];
  for await (const entry of paged.iterateDirectory("/")) names.push([entry.name,entry.type]);
  if (JSON.stringify(names) !== JSON.stringify([["a","file"],["b","file"],["nested","directory"]])) throw new Error("Signed paginated directory iteration failed");
  return true;
}
