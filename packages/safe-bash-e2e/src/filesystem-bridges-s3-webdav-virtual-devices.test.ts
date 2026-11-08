import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createDeviceFileSystem } from "@poe-platform/safe-bash/devices";
import { sb, withE2EHarness } from "./harness.js";

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

interface InMemoryWebDavEntry {
  readonly kind: "file" | "directory";
  readonly data: Uint8Array;
  readonly mtimeMs: number;
  readonly atimeMs: number;
}

class InMemoryWebDavServer {
  readonly entries = new Map<string, InMemoryWebDavEntry>();
  readonly requests: Array<{
    readonly method: string;
    readonly url: string;
    readonly headers: Headers;
    readonly bodyText: string;
  }> = [];

  constructor(private readonly basePath = "/dav") {
    this.entries.set("/", {
      kind: "directory",
      data: new Uint8Array(0),
      mtimeMs: 1_700_000_000_000,
      atimeMs: 1_700_000_000_000,
    });
  }

  etagFor(vpath: string): string | undefined {
    const entry = this.entries.get(vpath);
    if (!entry) return undefined;
    const hash = createHash("sha256")
      .update(entry.kind)
      .update(entry.data)
      .digest("hex")
      .slice(0, 24);
    return `"${hash}"`;
  }

  private normalizeVpath(pathname: string): string {
    const stripped = pathname.startsWith(this.basePath)
      ? pathname.slice(this.basePath.length)
      : pathname;
    const decoded = stripped
      .split("/")
      .filter(Boolean)
      .map((seg) => decodeURIComponent(seg))
      .join("/");
    return decoded ? `/${decoded}` : "/";
  }

  private hrefFor(vpath: string, isDir: boolean): string {
    if (vpath === "/") return `${this.basePath}/`;
    const encoded = vpath
      .split("/")
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return `${this.basePath}/${encoded}${isDir ? "/" : ""}`;
  }

  createFetch(): sb.WebDavFetch {
    return async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      const rawBody =
        init?.body !== undefined && init?.body !== null
          ? new Uint8Array(await new Response(init.body).arrayBuffer())
          : new Uint8Array(0);
      const bodyText = utf8Decoder.decode(rawBody);
      this.requests.push({ method, url, headers, bodyText });

      const parsed = new URL(url);
      const vpath = this.normalizeVpath(parsed.pathname);
      const entry = this.entries.get(vpath);
      const exists = entry !== undefined;
      const parentPath =
        vpath === "/" ? "/" : vpath.slice(0, vpath.lastIndexOf("/")) || "/";
      const parentEntry = this.entries.get(parentPath);

      const ifMatch = headers.get("If-Match");
      if (ifMatch) {
        const currentEtag = this.etagFor(vpath);
        if (ifMatch === "*" ? !exists : ifMatch !== currentEtag) {
          return new Response(null, { status: 412 });
        }
      }
      if (headers.get("If-None-Match") === "*" && exists) {
        return new Response(null, { status: method === "GET" ? 304 : 412 });
      }

      if (method === "PROPFIND") {
        if (!exists) return new Response(null, { status: 404 });
        const depth = headers.get("Depth") ?? "0";
        const matched: Array<[string, InMemoryWebDavEntry]> = [[vpath, entry]];
        if (depth === "1" && entry.kind === "directory") {
          for (const [childPath, childEntry] of this.entries.entries()) {
            if (childPath === "/") continue;
            const childParent =
              childPath.slice(0, childPath.lastIndexOf("/")) || "/";
            if (childParent === vpath) {
              matched.push([childPath, childEntry]);
            }
          }
        }
        const responsesXml = matched
          .map(([itemPath, item]) => {
            const isDir = item.kind === "directory";
            const href = this.hrefFor(itemPath, isDir);
            const etag = this.etagFor(itemPath)!;
            const tsMeta = JSON.stringify({
              version: 1,
              etag,
              type: isDir ? "directory" : "file",
              atimeMs: item.atimeMs,
              mtimeMs: item.mtimeMs,
            });
            return (
              `<d:response>` +
              `<d:href>${escapeXml(href)}</d:href>` +
              `<d:propstat><d:prop>` +
              `<d:resourcetype>${isDir ? "<d:collection/>" : ""}</d:resourcetype>` +
              `<d:getcontentlength>${item.data.byteLength}</d:getcontentlength>` +
              `<d:getetag>${escapeXml(etag)}</d:getetag>` +
              `<d:getlastmodified>${new Date(item.mtimeMs).toUTCString()}</d:getlastmodified>` +
              `<v:timestamps>${escapeXml(tsMeta)}</v:timestamps>` +
              `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>` +
              `</d:response>`
            );
          })
          .join("");
        const xml =
          `<?xml version="1.0" encoding="utf-8"?>` +
          `<d:multistatus xmlns:d="DAV:" xmlns:v="urn:virtual-bash:metadata">` +
          responsesXml +
          `</d:multistatus>`;
        return new Response(xml, {
          status: 207,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      }

      if (method === "GET" || method === "HEAD") {
        if (!exists) return new Response(null, { status: 404 });
        if (entry.kind === "directory") return new Response(null, { status: 405 });
        return new Response(method === "HEAD" ? null : new Uint8Array(entry.data), {
          status: 200,
          headers: {
            ETag: this.etagFor(vpath)!,
            "Content-Length": String(entry.data.byteLength),
          },
        });
      }

      if (method === "PUT") {
        if (entry?.kind === "directory") return new Response(null, { status: 405 });
        if (!parentEntry || parentEntry.kind !== "directory") {
          return new Response(null, { status: 409 });
        }
        this.entries.set(vpath, {
          kind: "file",
          data: new Uint8Array(rawBody),
          mtimeMs: 1_700_000_005_000,
          atimeMs: 1_700_000_005_000,
        });
        return new Response(null, {
          status: exists ? 204 : 201,
          headers: { ETag: this.etagFor(vpath)! },
        });
      }

      if (method === "MKCOL") {
        if (exists) return new Response(null, { status: 405 });
        if (!parentEntry || parentEntry.kind !== "directory") {
          return new Response(null, { status: 409 });
        }
        this.entries.set(vpath, {
          kind: "directory",
          data: new Uint8Array(0),
          mtimeMs: 1_700_000_000_000,
          atimeMs: 1_700_000_000_000,
        });
        return new Response(null, { status: 201 });
      }

      if (method === "DELETE") {
        if (!exists) return new Response(null, { status: 404 });
        for (const key of [...this.entries.keys()]) {
          if (key === vpath || key.startsWith(`${vpath}/`)) {
            this.entries.delete(key);
          }
        }
        return new Response(null, { status: 204 });
      }

      if (method === "COPY" || method === "MOVE") {
        if (!exists) return new Response(null, { status: 404 });
        const destHeader = headers.get("Destination");
        if (!destHeader) return new Response(null, { status: 400 });
        const destVpath = this.normalizeVpath(new URL(destHeader).pathname);
        const destExists = this.entries.has(destVpath);
        if (destExists && headers.get("Overwrite") === "F") {
          return new Response(null, { status: 412 });
        }
        const destParent =
          destVpath === "/"
            ? "/"
            : destVpath.slice(0, destVpath.lastIndexOf("/")) || "/";
        const destParentEntry = this.entries.get(destParent);
        if (!destParentEntry || destParentEntry.kind !== "directory") {
          return new Response(null, { status: 409 });
        }
        for (const key of [...this.entries.keys()]) {
          if (key === destVpath || key.startsWith(`${destVpath}/`)) {
            this.entries.delete(key);
          }
        }
        for (const [key, item] of [...this.entries.entries()]) {
          if (key === vpath || key.startsWith(`${vpath}/`)) {
            const mapped = destVpath + key.slice(vpath.length);
            this.entries.set(mapped, {
              kind: item.kind,
              data: new Uint8Array(item.data),
              mtimeMs: item.mtimeMs,
              atimeMs: item.atimeMs,
            });
            if (method === "MOVE") {
              this.entries.delete(key);
            }
          }
        }
        return new Response(null, { status: destExists ? 204 : 201 });
      }

      if (method === "PROPPATCH") {
        if (!exists) return new Response(null, { status: 404 });
        const match = /<[^:>]*:?timestamps[^>]*>([^<]+)<\//.exec(bodyText);
        if (match?.[1]) {
          const decodedJson = match[1]
            .replaceAll("&quot;", '"')
            .replaceAll("&amp;", "&")
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">")
            .replaceAll("&apos;", "'");
          const parsedTs = JSON.parse(decodedJson) as {
            atimeMs?: number;
            mtimeMs?: number;
          };
          this.entries.set(vpath, {
            ...entry,
            atimeMs: parsedTs.atimeMs ?? entry.atimeMs,
            mtimeMs: parsedTs.mtimeMs ?? entry.mtimeMs,
          });
        }
        const href = this.hrefFor(vpath, entry.kind === "directory");
        const xml =
          `<?xml version="1.0" encoding="utf-8"?>` +
          `<d:multistatus xmlns:d="DAV:" xmlns:v="urn:virtual-bash:metadata">` +
          `<d:response><d:href>${escapeXml(href)}</d:href>` +
          `<d:propstat><d:prop><v:timestamps/></d:prop>` +
          `<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` +
          `</d:multistatus>`;
        return new Response(xml, {
          status: 207,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      }

      return new Response(null, { status: 501 });
    };
  }
}

// 1. S3FileSystem + MockS3Client with small pageSize pagination
test("S3FileSystem + MockS3Client supports shell redirections, mkdir, ls, find, wc, sha256sum, and jq across paginated keys", async () => {
  const transport = new sb.MockS3Client({ buckets: ["datalake"], pageSize: 2 });
  const s3Fs = new sb.S3FileSystem({
    transport,
    bucket: "datalake",
    pageSize: 2,
  });
  const rootFs = new sb.MemoryFileSystem();
  const mounted = new sb.MountFileSystem({
    root: rootFs,
    mounts: { "/mnt/s3": s3Fs },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "mkdir -p /mnt/s3/events/2026/10",
        'printf \'{"id":1,"service":"auth","ms":12}\\n\' > /mnt/s3/events/2026/10/e1.json',
        'printf \'{"id":2,"service":"api","ms":28}\\n\' > /mnt/s3/events/2026/10/e2.json',
        'printf \'{"id":3,"service":"auth","ms":19}\\n\' > /mnt/s3/events/2026/10/e3.json',
        'printf \'{"id":4,"service":"billing","ms":45}\\n\' > /mnt/s3/events/2026/10/e4.json',
        'printf \'{"id":5,"service":"auth","ms":9}\\n\' > /mnt/s3/events/2026/10/e5.json',
        "ls /mnt/s3/events/2026/10 | wc -l | tr -d ' '",
        "find /mnt/s3/events -type f | sort | wc -l | tr -d ' '",
        "cat /mnt/s3/events/2026/10/e*.json | jq -s 'map(select(.service == \"auth\") | .ms) | add'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(res.stdout, "5\n5\n40\n");
  });
});

// 2. S3FileSystem prefix isolation across multiple tenants sharing one bucket
test("S3FileSystem prefix isolation confines multiple tenant mounts within a shared bucket without cross-tenant leakage", async () => {
  const transport = new sb.MockS3Client({ buckets: ["shared-cloud"] });
  const tenantAlpha = new sb.S3FileSystem({
    transport,
    bucket: "shared-cloud",
    prefix: "tenants/alpha/prod",
  });
  const tenantBeta = new sb.S3FileSystem({
    transport,
    bucket: "shared-cloud",
    prefix: "tenants/beta/prod",
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: {
      "/mnt/alpha": tenantAlpha,
      "/mnt/beta": tenantBeta,
    },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "mkdir -p /mnt/alpha/secrets /mnt/beta/secrets",
        "echo 'alpha-key-991' > /mnt/alpha/secrets/token.txt",
        "echo 'beta-key-772' > /mnt/beta/secrets/token.txt",
        "cat /mnt/alpha/secrets/token.txt",
        "cat /mnt/beta/secrets/token.txt",
        "ls /mnt/alpha/secrets",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(res.stdout, "alpha-key-991\nbeta-key-772\ntoken.txt\n");
  });

  const listed = await transport.listObjectsV2({ Bucket: "shared-cloud" });
  const keys = (listed.Contents ?? []).map((item) => item.Key).sort();
  assert.ok(keys.includes("tenants/alpha/prod/secrets/token.txt"));
  assert.ok(keys.includes("tenants/beta/prod/secrets/token.txt"));
  await assert.rejects(
    () => tenantAlpha.readFile("/../beta/prod/secrets/token.txt"),
    (err: unknown) => (err as { code?: string }).code === "EACCES",
  );
});

// 3. S3FileSystem VFS copyFile, allowNonAtomicRename: false refusal vs allowNonAtomicRename: true mv
test("S3FileSystem supports server-side copyFile, refuses mv when allowNonAtomicRename is false, and enables file/directory mv when allowNonAtomicRename is true", async () => {
  const transport = new sb.MockS3Client({ buckets: ["artifacts"] });
  const strictS3 = new sb.S3FileSystem({
    transport,
    bucket: "artifacts",
    prefix: "strict",
    allowNonAtomicRename: false,
  });
  const movableS3 = new sb.S3FileSystem({
    transport,
    bucket: "artifacts",
    prefix: "movable",
    allowNonAtomicRename: true,
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: {
      "/mnt/strict": strictS3,
      "/mnt/movable": movableS3,
    },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    await strictS3.writeFile("/build.txt", utf8Encoder.encode("v1-release\n"));
    await strictS3.copyFile("/build.txt", "/build-copy.txt");

    const res = await h.exec(
      [
        "cat /mnt/strict/build-copy.txt",
        "if cp /mnt/strict/build.txt /mnt/strict/shell-cp.txt 2>/dev/null; then echo 'shell_cp:ok'; else echo 'shell_cp:enotsup'; fi",
        "if mv /mnt/strict/build.txt /mnt/strict/renamed.txt 2>/dev/null; then echo 'strict_mv:unexpected'; else echo 'strict_mv:refused'; fi",
        "mkdir -p /mnt/movable/stage/sub",
        "echo 'payload-a' > /mnt/movable/stage/a.txt",
        "echo 'payload-b' > /mnt/movable/stage/sub/b.txt",
        "mv /mnt/movable/stage /mnt/movable/published",
        "test ! -e /mnt/movable/stage && echo 'stage_gone:yes'",
        "cat /mnt/movable/published/a.txt /mnt/movable/published/sub/b.txt",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      [
        "v1-release",
        "shell_cp:enotsup",
        "strict_mv:refused",
        "stage_gone:yes",
        "payload-a",
        "payload-b",
        "",
      ].join("\n"),
    );
  });
});

// 4. S3FileSystem noclobber (set -C / wx), append (>>), and metadata preservation
test("S3FileSystem enforces set -C noclobber (IfNoneMatch), supports >> append (IfMatch), and preserves mode/mtime metadata", async () => {
  const transport = new sb.MockS3Client({ buckets: ["meta-bucket"] });
  const s3Fs = new sb.S3FileSystem({ transport, bucket: "meta-bucket" });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: { "/mnt/s3": s3Fs },
  });

  await s3Fs.writeFile("/mode-seeded.txt", utf8Encoder.encode("secret\n"), {
    mode: 0o600,
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "set -C",
        "echo 'line-1' > /mnt/s3/audit.log",
        "if echo 'overwrite' > /mnt/s3/audit.log 2>/dev/null; then echo 'clobber:allowed'; else echo 'clobber:blocked'; fi",
        "echo 'line-2' >> /mnt/s3/audit.log",
        "echo 'line-3' >> /mnt/s3/audit.log",
        "touch -d '2026-05-01T12:00:00Z' /mnt/s3/audit.log",
        "cat /mnt/s3/audit.log",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      ["clobber:blocked", "line-1", "line-2", "line-3", ""].join("\n"),
    );
  });

  const seededHead = await transport.headObject({
    Bucket: "meta-bucket",
    Key: "mode-seeded.txt",
  });
  assert.equal(seededHead.Metadata?.["virtual-bash-mode"], String(0o600));

  const head = await transport.headObject({
    Bucket: "meta-bucket",
    Key: "audit.log",
  });
  assert.equal(
    head.Metadata?.["virtual-bash-mtime"],
    String(Date.parse("2026-05-01T12:00:00Z")),
  );
});

// 5. S3FileSystem rmdir snapshot-marker semantics vs non-empty refusal and rm -rf
test("S3FileSystem rmdir removes empty explicit directory markers, rejects non-empty prefixes, and rm -rf purges subtrees", async () => {
  const transport = new sb.MockS3Client({ buckets: ["dirs-bucket"] });
  const s3Fs = new sb.S3FileSystem({ transport, bucket: "dirs-bucket" });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: { "/mnt/s3": s3Fs },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "mkdir -p /mnt/s3/empty-dir /mnt/s3/populated/sub",
        "echo 'item' > /mnt/s3/populated/sub/file.txt",
        "rmdir /mnt/s3/empty-dir",
        "test ! -e /mnt/s3/empty-dir && echo 'empty_removed:yes'",
        "if rmdir /mnt/s3/populated 2>/dev/null; then echo 'nonempty:removed'; else echo 'nonempty:refused'; fi",
        "rm -rf /mnt/s3/populated",
        "test ! -e /mnt/s3/populated && echo 'subtree_purged:yes'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      [
        "empty_removed:yes",
        "nonempty:refused",
        "subtree_purged:yes",
        "",
      ].join("\n"),
    );
  });
});

// 6. S3FileSystem readOnly mode and MockS3Client authorize policy hook
test("S3FileSystem readOnly mode and MockS3Client authorize callback enforce fine-grained access control", async () => {
  const deniedOps: string[] = [];
  const transport = new sb.MockS3Client({
    buckets: ["governed"],
    authorize(req) {
      const key = "Key" in req.input ? req.input.Key : req.input.Prefix ?? "";
      if (req.operation === "deleteObject" || key.startsWith("restricted/")) {
        deniedOps.push(`${req.operation}:${key}`);
        throw new sb.S3ServiceError("AccessDenied", 403, "Access Denied");
      }
    },
  });

  const writableS3 = new sb.S3FileSystem({ transport, bucket: "governed" });
  await writableS3.mkdir("/public", { recursive: true });
  await writableS3.writeFile("/public/readme.txt", utf8Encoder.encode("hello s3\n"));

  const readOnlyS3 = new sb.S3FileSystem({
    transport,
    bucket: "governed",
    readOnly: true,
  });

  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: {
      "/mnt/ro": readOnlyS3,
      "/mnt/rw": writableS3,
    },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "cat /mnt/ro/public/readme.txt",
        "if echo 'mutate' > /mnt/ro/public/new.txt 2>/dev/null; then echo 'ro_write:ok'; else echo 'ro_write:denied'; fi",
        "echo 'allowed' > /mnt/rw/public/added.txt",
        "if rm /mnt/rw/public/added.txt 2>/dev/null; then echo 'delete:ok'; else echo 'delete:denied'; fi",
        "if echo 'secret' > /mnt/rw/restricted/data.txt 2>/dev/null; then echo 'restricted:ok'; else echo 'restricted:denied'; fi",
        "cat /mnt/rw/public/added.txt",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      [
        "hello s3",
        "ro_write:denied",
        "delete:denied",
        "restricted:denied",
        "allowed",
        "",
      ].join("\n"),
    );
    assert.ok(deniedOps.length >= 2);
  });
});

// 7. S3FileSystem streaming compression and archive workflows (gzip, xz, bzip2, tar)
test("S3FileSystem supports streaming gzip, bzip2, xz, and tar archive pipelines via standard input/output redirections", async () => {
  const transport = new sb.MockS3Client({ buckets: ["archives"] });
  const s3Fs = new sb.S3FileSystem({
    transport,
    bucket: "archives",
    allowNonAtomicRename: true,
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: { "/mnt/s3": s3Fs },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "mkdir -p /mnt/s3/src /mnt/s3/out /workspace/stage",
        "printf 'alpha\\nbeta\\ngamma\\n' > /mnt/s3/src/lines.txt",
        "gzip -c < /mnt/s3/src/lines.txt > /mnt/s3/out/lines.txt.gz",
        "zcat < /mnt/s3/out/lines.txt.gz | wc -l | tr -d ' '",
        "bzip2 -c < /mnt/s3/src/lines.txt > /mnt/s3/out/lines.txt.bz2",
        "bzcat < /mnt/s3/out/lines.txt.bz2 | head -n 1",
        "xz -c < /mnt/s3/src/lines.txt > /mnt/s3/out/lines.txt.xz",
        "xzcat < /mnt/s3/out/lines.txt.xz | tail -n 1",
        "cat /mnt/s3/src/lines.txt > /workspace/stage/lines.txt",
        "tar -cJf - -C /workspace/stage lines.txt > /mnt/s3/out/bundle.tar.xz",
        "tar -xOf - lines.txt < /mnt/s3/out/bundle.tar.xz | cmp -s - /mnt/s3/src/lines.txt && echo 'tar_xz_s3:identical'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(res.stdout, "3\nalpha\ngamma\ntar_xz_s3:identical\n");
  });
});

// 8. createS3Transport custom client wrapper with capability negotiation and operation telemetry
test("createS3Transport wraps an S3Client with explicit capabilities and tracks operation counts across shell pipelines", async () => {
  const backing = new sb.MockS3Client({ buckets: ["telemetry"] });
  const opCounts: Record<string, number> = {};
  const count = (op: string) => {
    opCounts[op] = (opCounts[op] ?? 0) + 1;
  };

  const customTransport = sb.createS3Transport(
    {
      headObject(input, options) {
        count("headObject");
        return backing.headObject(input, options);
      },
      getObject(input, options) {
        count("getObject");
        return backing.getObject(input, options);
      },
      putObject(input, options) {
        count("putObject");
        return backing.putObject(input, options);
      },
      listObjectsV2(input, options) {
        count("listObjectsV2");
        return backing.listObjectsV2(input, options);
      },
      copyObject(input, options) {
        count("copyObject");
        return backing.copyObject(input, options);
      },
      deleteObject(input, options) {
        count("deleteObject");
        return backing.deleteObject(input, options);
      },
      getObjectStream(input, options) {
        count("getObjectStream");
        return backing.getObjectStream(input, options);
      },
      putObjectStream(input, options) {
        count("putObjectStream");
        return backing.putObjectStream(input, options);
      },
    },
    {
      conditionalPut: true,
      conditionalCopy: true,
      conditionalDelete: true,
      streamingRead: true,
      streamingWrite: true,
    },
  );

  const s3Fs = new sb.S3FileSystem({
    transport: customTransport,
    bucket: "telemetry",
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: { "/mnt/s3": s3Fs },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "echo 'first' > /mnt/s3/doc.txt",
        "echo 'second' >> /mnt/s3/doc.txt",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    await s3Fs.copyFile("/doc.txt", "/doc-backup.txt");
    const res2 = await h.exec(
      [
        "cat /mnt/s3/doc-backup.txt",
        "rm /mnt/s3/doc.txt",
      ].join("\n"),
    );
    assert.equal(res2.exitCode, 0, `stderr: ${res2.stderr}`);
    assert.equal(res2.stdout, "first\nsecond\n");
  });

  assert.ok(((opCounts.putObject ?? 0) + (opCounts.putObjectStream ?? 0)) >= 2);
  assert.ok((opCounts.copyObject ?? 0) >= 1);
  assert.ok(((opCounts.getObject ?? 0) + (opCounts.getObjectStream ?? 0)) >= 1);
  assert.ok((opCounts.deleteObject ?? 0) >= 1);
});

// 9. createS3HttpTransport SigV4 request signing and XML protocol handling over in-memory request factory
test("createS3HttpTransport signs SigV4 requests and executes S3FileSystem shell reads/writes via an in-memory HTTP request factory", async () => {
  const objects = new Map<string, { body: Uint8Array; meta: Record<string, string> }>();
  const signedHeadersSeen: string[] = [];

  const requestFactory: sb.S3HttpRequestFactory = (
    options: RequestOptions,
    onResponse?: (res: IncomingMessage) => void,
  ): ClientRequest => {
    const reqStream = new PassThrough();
    const chunks: Buffer[] = [];
    reqStream.on("data", (chunk: Buffer) => chunks.push(chunk));

    const clientReq = Object.assign(reqStream, {
      abort() {
        reqStream.destroy();
      },
      setTimeout() {
        return clientReq;
      },
    }) as unknown as ClientRequest;

    reqStream.on("finish", () => {
      const reqBody = new Uint8Array(Buffer.concat(chunks));
      const rawHeaders = (options.headers ?? {}) as Record<string, string | undefined>;
      const headers = new Map<string, string>();
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (v !== undefined) headers.set(k.toLowerCase(), String(v));
      }
      const auth = headers.get("authorization") ?? "";
      signedHeadersSeen.push(auth);

      const method = (options.method ?? "GET").toUpperCase();
      const parsedUrl = new URL(options.path ?? "/", "https://s3.us-east-1.amazonaws.com");
      // path style: /bucket/key...
      const pathParts = parsedUrl.pathname.slice(1).split("/");
      const key = pathParts.slice(1).map((p) => decodeURIComponent(p)).join("/");

      const sendResponse = (
        statusCode: number,
        resHeaders: Record<string, string>,
        bodyBytes: Uint8Array,
      ) => {
        const resStream = new PassThrough();
        const lowerHeaders = Object.fromEntries(
          Object.entries(resHeaders).map(([k, v]) => [k.toLowerCase(), v]),
        );
        const headersDistinct = Object.fromEntries(
          Object.entries(resHeaders).map(([k, v]) => [k.toLowerCase(), [v]]),
        );
        const incoming = Object.assign(resStream, {
          statusCode,
          complete: true,
          headers: lowerHeaders,
          headersDistinct,
          rawHeaders: Object.entries(resHeaders).flat(),
        }) as unknown as IncomingMessage;
        onResponse?.(incoming);
        resStream.end(Buffer.from(bodyBytes));
      };

      if (method === "GET" && parsedUrl.searchParams.get("list-type") === "2") {
        const prefix = parsedUrl.searchParams.get("prefix") ?? "";
        const delimiter = parsedUrl.searchParams.get("delimiter") ?? "";
        const maxKeys = Number(parsedUrl.searchParams.get("max-keys") ?? "1000");
        const contentsXml: string[] = [];
        const commonPrefixes = new Set<string>();

        const sortedEntries = [...objects.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        );
        for (const [objKey, obj] of sortedEntries) {
          if (!objKey.startsWith(prefix)) continue;
          const rest = objKey.slice(prefix.length);
          if (delimiter && rest.includes(delimiter)) {
            const idx = rest.indexOf(delimiter);
            commonPrefixes.add(prefix + rest.slice(0, idx + delimiter.length));
            continue;
          }
          const etag = `"${createHash("md5").update(obj.body).digest("hex")}"`;
          contentsXml.push(
            `<Contents><Key>${escapeXml(objKey)}</Key><Size>${obj.body.byteLength}</Size><ETag>${escapeXml(etag)}</ETag><LastModified>2026-08-01T00:00:00.000Z</LastModified></Contents>`,
          );
        }
        const cpXml = [...commonPrefixes]
          .sort()
          .map((cp) => `<CommonPrefixes><Prefix>${escapeXml(cp)}</Prefix></CommonPrefixes>`)
          ;
        const allItems = [...contentsXml, ...cpXml];
        const pageItems = allItems.slice(0, maxKeys);
        const isTruncated = allItems.length > maxKeys;
        const xml =
          `<?xml version="1.0" encoding="utf-8"?>` +
          `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
          `<Name>sigv4-bucket</Name>` +
          `<Prefix>${escapeXml(prefix)}</Prefix>` +
          `<KeyCount>${pageItems.length}</KeyCount>` +
          `<MaxKeys>${maxKeys}</MaxKeys>` +
          `<IsTruncated>${isTruncated ? "true" : "false"}</IsTruncated>` +
          (isTruncated ? `<NextContinuationToken>next-page</NextContinuationToken>` : "") +
          pageItems.join("") +
          `</ListBucketResult>`;
        sendResponse(200, { "content-type": "application/xml" }, utf8Encoder.encode(xml));
        return;
      }

      if (method === "HEAD") {
        const found = objects.get(key);
        if (!found) {
          sendResponse(404, {}, new Uint8Array(0));
          return;
        }
        const etag = `"${createHash("md5").update(found.body).digest("hex")}"`;
        sendResponse(
          200,
          {
            "content-length": String(found.body.byteLength),
            etag,
            "last-modified": "Sat, 01 Aug 2026 00:00:00 GMT",
            ...found.meta,
          },
          new Uint8Array(0),
        );
        return;
      }

      if (method === "GET") {
        const found = objects.get(key);
        if (!found) {
          const errXml = `<Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>`;
          sendResponse(404, { "content-type": "application/xml" }, utf8Encoder.encode(errXml));
          return;
        }
        const etag = `"${createHash("md5").update(found.body).digest("hex")}"`;
        sendResponse(
          200,
          {
            "content-length": String(found.body.byteLength),
            etag,
            "last-modified": "Sat, 01 Aug 2026 00:00:00 GMT",
            ...found.meta,
          },
          found.body,
        );
        return;
      }

      if (method === "PUT") {
        const meta: Record<string, string> = {};
        for (const [k, v] of headers.entries()) {
          if (k.startsWith("x-amz-meta-")) meta[k] = v;
        }
        objects.set(key, { body: reqBody, meta });
        const etag = `"${createHash("md5").update(reqBody).digest("hex")}"`;
        sendResponse(200, { etag }, new Uint8Array(0));
        return;
      }

      if (method === "DELETE") {
        objects.delete(key);
        sendResponse(204, {}, new Uint8Array(0));
        return;
      }

      sendResponse(501, {}, new Uint8Array(0));
    });

    return clientReq;
  };

  const httpTransport = sb.createS3HttpTransport({
    endpoint: "https://s3.us-east-1.amazonaws.com",
    region: "us-east-1",
    credentials: {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      sessionToken: "SESSION_TOKEN_EXAMPLE",
    },
    clock: () => new Date("2026-08-01T00:00:00Z"),
    request: requestFactory,
    verifiedConditionalOperations: { put: true, copy: true, delete: true },
  });

  const s3Fs = new sb.S3FileSystem({
    transport: httpTransport,
    bucket: "sigv4-bucket",
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: { "/mnt/sigv4": s3Fs },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    await s3Fs.mkdir("/reports", { recursive: true });
    await s3Fs.writeFile(
      "/reports/q3.csv",
      utf8Encoder.encode("region,revenue\nus-east,1200\neu-west,950\n"),
    );
    const res = await h.exec(
      [
        "ls /mnt/sigv4/reports",
        "cat /mnt/sigv4/reports/q3.csv | awk -F, 'NR>1 {sum+=$2} END {print sum}'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(res.stdout, "q3.csv\n2150\n");
  });

  assert.ok(signedHeadersSeen.length >= 3);
  for (const auth of signedHeadersSeen) {
    assert.ok(
      auth.startsWith(
        "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260801/us-east-1/s3/aws4_request",
      ),
      `unexpected Authorization header: ${auth}`,
    );
  }
});

// 10. WebDavFileSystem full shell lifecycle (PROPFIND, GET, PUT, MKCOL, COPY, MOVE, DELETE)
test("WebDavFileSystem supports mkdir, file writes, reads, copyFile, mv, ls, find, and rm -rf over an in-memory WebDAV server", async () => {
  const dav = new InMemoryWebDavServer("/dav");
  const webdavFs = new sb.WebDavFileSystem({
    baseUrl: "https://webdav.example.invalid/dav/",
    fetch: dav.createFetch(),
    requestStreamSupport: true,
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: { "/mnt/dav": webdavFs },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "mkdir -p /mnt/dav/projects/alpha",
        "echo 'design-doc-v1' > /mnt/dav/projects/alpha/spec.md",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    await webdavFs.copyFile(
      "/projects/alpha/spec.md",
      "/projects/alpha/spec-backup.md",
    );
    const res2 = await h.exec(
      [
        "mv /mnt/dav/projects/alpha/spec.md /mnt/dav/projects/alpha/spec-final.md",
        "ls /mnt/dav/projects/alpha | sort",
        "cat /mnt/dav/projects/alpha/spec-final.md",
        "rm -rf /mnt/dav/projects/alpha",
        "test ! -e /mnt/dav/projects/alpha && echo 'dav_cleaned:yes'",
      ].join("\n"),
    );
    assert.equal(res2.exitCode, 0, `stderr: ${res2.stderr}`);
    assert.equal(
      res2.stdout,
      [
        "spec-backup.md",
        "spec-final.md",
        "design-doc-v1",
        "dav_cleaned:yes",
        "",
      ].join("\n"),
    );
  });

  const methodsUsed = new Set(dav.requests.map((r) => r.method));
  for (const expectedMethod of ["PROPFIND", "MKCOL", "PUT", "GET", "COPY", "MOVE", "DELETE"]) {
    assert.ok(methodsUsed.has(expectedMethod), `expected WebDAV method ${expectedMethod}`);
  }
});

// 11. WebDavFileSystem headers, noclobber (set -C), append (>>), and touch timestamps
test("WebDavFileSystem forwards explicit headers, enforces set -C noclobber, supports >> append with ETag preconditions, and updates timestamps", async () => {
  const dav = new InMemoryWebDavServer("/dav");
  const webdavFs = new sb.WebDavFileSystem({
    baseUrl: "https://webdav.example.invalid/dav/",
    fetch: dav.createFetch(),
    headers: {
      Authorization: "Bearer dav-token-secret-42",
      "X-Tenant-ID": "acme-corp",
    },
    overwritePolicy: "etag",
    requestStreamSupport: true,
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: { "/mnt/dav": webdavFs },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "set -C",
        "echo 'entry-1' > /mnt/dav/journal.txt",
        "if echo 'clobber' > /mnt/dav/journal.txt 2>/dev/null; then echo 'dav_clobber:ok'; else echo 'dav_clobber:blocked'; fi",
        "echo 'entry-2' >> /mnt/dav/journal.txt",
        "touch -d '2026-09-15T08:30:00Z' /mnt/dav/journal.txt",
        "cat /mnt/dav/journal.txt",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      ["dav_clobber:blocked", "entry-1", "entry-2", ""].join("\n"),
    );
  });

  for (const req of dav.requests) {
    assert.equal(req.headers.get("Authorization"), "Bearer dav-token-secret-42");
    assert.equal(req.headers.get("X-Tenant-ID"), "acme-corp");
  }
  const stat = await webdavFs.stat("/journal.txt");
  assert.equal(stat.mtimeMs, Date.parse("2026-09-15T08:30:00Z"));
});

// 12. WebDavFileSystem security confinement against out-of-root PROPFIND href injection
test("WebDavFileSystem rejects hostile PROPFIND Multi-Status responses that reference out-of-root href paths", async () => {
  const hostileXml =
    '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' +
    "<d:response><d:href>/outside-root/passwd</d:href>" +
    "<d:propstat><d:prop><d:resourcetype/><d:getcontentlength>12</d:getcontentlength></d:prop>" +
    "<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>";

  const hostileDav = new sb.WebDavFileSystem({
    baseUrl: "https://webdav.example.invalid/dav/",
    fetch: async () =>
      new Response(hostileXml, {
        status: 207,
        headers: { "Content-Type": "application/xml" },
      }),
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: { "/mnt/hostile": hostileDav },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      "if cat /mnt/hostile/passwd 2>/dev/null; then echo 'escaped'; else echo 'confined'; fi",
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "confined\n");
  });
});

// 13. createDeviceFileSystem virtual character devices (/dev/null, /dev/zero, /dev/random, /dev/urandom)
test("createDeviceFileSystem provides /dev/null, /dev/zero, /dev/random, and /dev/urandom character devices for dd, head, od, and xxd", async () => {
  await withE2EHarness({ mountDev: true, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "ls /dev | sort | tr '\\n' ' ' && echo ''",
        "cat /dev/null | wc -c | tr -d ' '",
        "echo 'discarded payload' > /dev/null",
        "echo 'discarded zero' > /dev/zero",
        "dd if=/dev/zero bs=128 count=4 status=none | wc -c | tr -d ' '",
        "head -c 16 /dev/zero | xxd -p",
        "head -c 32 /dev/urandom | xxd -p -c 32 | awk '{print length($0)}'",
        "dd if=/dev/random bs=24 count=1 status=none | wc -c | tr -d ' '",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      [
        "null random urandom zero ",
        "0",
        "512",
        "00000000000000000000000000000000",
        "64",
        "24",
        "",
      ].join("\n"),
    );
  });
});

// 14. createDeviceFileSystem write/create/mutation invariants
test("createDeviceFileSystem permits noclobber writes to /dev/null and rejects read-only writes and device mutations", async () => {
  const devFs = createDeviceFileSystem();
  const rootFs = new sb.MemoryFileSystem();
  const mounted = new sb.MountFileSystem({
    root: rootFs,
    mounts: { "/dev": devFs },
  });

  await withE2EHarness({ fs: mounted, mountDev: false, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "if echo 'entropy' > /dev/urandom 2>/dev/null; then echo 'urandom_write:ok'; else echo 'urandom_write:denied'; fi",
        "if (set -C; echo 'test' > /dev/null) 2>/dev/null; then echo 'noclobber_dev:ok'; else echo 'noclobber_dev:denied'; fi",
        "if mkdir /dev/subdir 2>/dev/null; then echo 'dev_mkdir:ok'; else echo 'dev_mkdir:denied'; fi",
        "if rm /dev/null 2>/dev/null; then echo 'dev_rm:ok'; else echo 'dev_rm:denied'; fi",
        "if echo 'regular' > /dev/custom_device 2>/dev/null; then echo 'dev_create:ok'; else echo 'dev_create:denied'; fi",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      [
        "urandom_write:denied",
        "noclobber_dev:ok",
        "dev_mkdir:denied",
        "dev_rm:denied",
        "dev_create:denied",
        "",
      ].join("\n"),
    );
  });
});

// 15. Cross-backend data engineering pipeline: WebDAV -> Memory scratch (sqlite3 + jq) -> S3 archive publication
test("Cross-backend pipeline stages WebDAV telemetry into local SQLite + jq, packages tar.xz, and publishes verified artifacts to S3", async () => {
  const dav = new InMemoryWebDavServer("/dav");
  const webdavFs = new sb.WebDavFileSystem({
    baseUrl: "https://webdav.example.invalid/dav/",
    fetch: dav.createFetch(),
  });
  const s3Transport = new sb.MockS3Client({ buckets: ["warehouse"] });
  const s3Fs = new sb.S3FileSystem({
    transport: s3Transport,
    bucket: "warehouse",
    prefix: "curated/2026-10",
  });
  const rootFs = new sb.MemoryFileSystem();
  const mounted = new sb.MountFileSystem({
    root: rootFs,
    mounts: {
      "/mnt/webdav": webdavFs,
      "/mnt/s3": s3Fs,
      "/dev": createDeviceFileSystem(),
    },
  });

  await webdavFs.mkdir("/ingest", { recursive: true });
  await webdavFs.writeFile(
    "/ingest/orders.csv",
    utf8Encoder.encode(
      [
        "order_id,customer,amount,status",
        "101,alice,250,paid",
        "102,bob,80,cancelled",
        "103,alice,175,paid",
        "104,charlie,320,paid",
        "",
      ].join("\n"),
    ),
  );

  await withE2EHarness({ fs: mounted, mountDev: false, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "mkdir -p /workspace/stage /mnt/s3/releases",
        "cat /mnt/webdav/ingest/orders.csv > /workspace/stage/orders.csv",
        "sqlite3 /workspace/stage/warehouse.db <<'SQL'",
        "CREATE TABLE orders (order_id INTEGER, customer TEXT, amount INTEGER, status TEXT);",
        ".mode csv",
        ".import --skip 1 /workspace/stage/orders.csv orders",
        "SQL",
        `sqlite3 -json /workspace/stage/warehouse.db "SELECT customer, SUM(amount) AS total_paid, COUNT(*) AS orders_count FROM orders WHERE status = 'paid' GROUP BY customer ORDER BY total_paid DESC;" > /workspace/stage/summary.json`,
        "jq -c '.[]' /workspace/stage/summary.json > /mnt/s3/releases/summary.jsonl",
        "tar -cJf - -C /workspace/stage summary.json orders.csv > /mnt/s3/releases/curated-bundle.tar.xz",
        "sha256sum /mnt/s3/releases/summary.jsonl /mnt/s3/releases/curated-bundle.tar.xz > /mnt/s3/releases/SHA256SUMS",
        "sha256sum -c /mnt/s3/releases/SHA256SUMS",
        "cat /mnt/s3/releases/summary.jsonl",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      [
        "/mnt/s3/releases/summary.jsonl: OK",
        "/mnt/s3/releases/curated-bundle.tar.xz: OK",
        '{"customer":"alice","total_paid":425,"orders_count":2}',
        '{"customer":"charlie","total_paid":320,"orders_count":1}',
        "",
      ].join("\n"),
    );
  });
});

// 16. OverlayFileSystem copy-on-write over Memory layers vs non-retained S3 lower layer refusal
test("OverlayFileSystem supports copy-on-write edits and whiteouts on Memory layers while rejecting non-retained S3 lower layers with ENOTSUP", async () => {
  let s3MutateCount = 0;
  const transport = new sb.MockS3Client({
    buckets: ["base-layer"],
    authorize(req) {
      if (
        req.operation === "putObject" ||
        req.operation === "deleteObject" ||
        req.operation === "copyObject"
      ) {
        s3MutateCount++;
      }
    },
  });

  const seedS3 = new sb.S3FileSystem({ transport, bucket: "base-layer" });
  await seedS3.mkdir("/app/config", { recursive: true });
  await seedS3.writeFile(
    "/app/config/settings.json",
    utf8Encoder.encode('{"env":"production","replicas":3,"debug":false}\n'),
  );
  s3MutateCount = 0;

  const s3Overlay = new sb.OverlayFileSystem({
    lower: new sb.ReadOnlyFileSystem(seedS3),
    upper: new sb.MemoryFileSystem(),
  });
  await assert.rejects(
    () => s3Overlay.readFile("/app/config/settings.json"),
    (err: unknown) => (err as { code?: string }).code === "ENOTSUP",
  );

  const lowerMem = new sb.MemoryFileSystem();
  await lowerMem.mkdir("/app/config", { recursive: true });
  await lowerMem.writeFile(
    "/app/config/settings.json",
    utf8Encoder.encode('{"env":"production","replicas":3,"debug":false}\n'),
  );
  await lowerMem.writeFile(
    "/app/config/legacy.conf",
    utf8Encoder.encode("legacy_mode=true\n"),
  );
  const upperMem = new sb.MemoryFileSystem();
  const overlay = new sb.OverlayFileSystem({
    lower: lowerMem,
    upper: upperMem,
  });

  await withE2EHarness({ fs: overlay, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "jq '.replicas = 5 | .debug = true' /app/config/settings.json > /app/config/settings.json.tmp",
        "mv /app/config/settings.json.tmp /app/config/settings.json",
        "rm /app/config/legacy.conf",
        "echo 'overlay_only=1' > /app/config/override.conf",
        "ls /app/config | sort",
        "jq -c . /app/config/settings.json",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      [
        "override.conf",
        "settings.json",
        '{"env":"production","replicas":5,"debug":true}',
        "",
      ].join("\n"),
    );
  });

  assert.equal(s3MutateCount, 0, "S3 lower layer must receive zero mutation requests");
  const originalSettings = utf8Decoder.decode(
    await lowerMem.readFile("/app/config/settings.json"),
  );
  assert.equal(originalSettings, '{"env":"production","replicas":3,"debug":false}\n');
  const originalLegacy = utf8Decoder.decode(
    await lowerMem.readFile("/app/config/legacy.conf"),
  );
  assert.equal(originalLegacy, "legacy_mode=true\n");
});

// 17. df command reporting across multi-mount hybrid topologies
test("df reports filesystem usage, types, inodes, and totals across multi-mount hybrid VFS topologies", async () => {
  const customDf = sb.dfCommands({
    replace: true,
    mounts: [
      {
        source: "memory://root",
        fstype: "memfs",
        target: "/",
        totalBytes: 64 * 1024 * 1024,
        usedBytes: 8 * 1024 * 1024,
        totalInodes: 65536,
        usedInodes: 512,
      },
      {
        source: "devfs",
        fstype: "devtmpfs",
        target: "/dev",
        totalBytes: 0,
        usedBytes: 0,
        totalInodes: 16,
        usedInodes: 4,
        pseudo: true,
      },
      {
        source: "s3://warehouse/curated",
        fstype: "s3fs",
        target: "/mnt/s3",
        totalBytes: 1024 * 1024 * 1024,
        usedBytes: 256 * 1024 * 1024,
        totalInodes: 1_000_000,
        usedInodes: 12_500,
      },
      {
        source: "https://webdav.example.invalid/dav",
        fstype: "webdav",
        target: "/mnt/webdav",
        totalBytes: 512 * 1024 * 1024,
        usedBytes: 128 * 1024 * 1024,
        totalInodes: 250_000,
        usedInodes: 3_200,
      },
    ],
  });

  const s3Fs = new sb.S3FileSystem({
    transport: new sb.MockS3Client({ buckets: ["warehouse"] }),
    bucket: "warehouse",
  });
  const dav = new InMemoryWebDavServer("/dav");
  const webdavFs = new sb.WebDavFileSystem({
    baseUrl: "https://webdav.example.invalid/dav/",
    fetch: dav.createFetch(),
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: {
      "/dev": createDeviceFileSystem(),
      "/mnt/s3": s3Fs,
      "/mnt/webdav": webdavFs,
    },
  });

  await withE2EHarness(
    { fs: mounted, mountDev: false, plugins: [customDf], cwd: "/workspace" },
    async (h) => {
      await h.exec("mkdir -p /mnt/s3/datasets /mnt/webdav/shared");
      const res = await h.exec(
        [
          "df -T /mnt/s3/datasets | awk 'NR==2 {print $1, $2, $7}'",
          "df -t webdav --output=source,fstype,target | awk 'NR==2 {print $1, $2, $3}'",
          "df -a -t devtmpfs --output=source,fstype,target | awk 'NR==2 {print $1, $2, $3}'",
          "df -i /mnt/s3 | awk 'NR==2 {print $2, $3, $6}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(
        res.stdout,
        [
          "s3://warehouse/curated s3fs /mnt/s3",
          "https://webdav.example.invalid/dav webdav /mnt/webdav",
          "devfs devtmpfs /dev",
          "1000000 12500 /mnt/s3",
          "",
        ].join("\n"),
      );
    },
  );
});

// 18. apply_patch and diff/patch atomic capability enforcement on remote mounts vs staged local publication
test("apply_patch and patch refuse direct non-atomic remote S3/WebDAV mutations while supporting local staging and remote publication", async () => {
  let patchedBytes: Uint8Array = new Uint8Array(0);
  await withE2EHarness({ cwd: "/workspace" }, async (localH) => {
    const localRes = await localH.exec(
      [
        "mkdir -p /workspace/stage",
        "printf 'export const PORT = 3000;\\nexport const HOST = \"localhost\";\\n' > /workspace/stage/config.ts",
        "cp /workspace/stage/config.ts /workspace/stage/dav-config.ts",
        "apply_patch <<'PATCH' > /dev/null",
        "*** Begin Patch",
        "*** Update File: stage/config.ts",
        "@@",
        "-export const PORT = 3000;",
        "+export const PORT = 8080;",
        " export const HOST = \"localhost\";",
        "+export const TLS = true;",
        "*** End Patch",
        "PATCH",
        "diff -u /workspace/stage/dav-config.ts /workspace/stage/config.ts > /workspace/stage/config.patch || true",
        "patch -u /workspace/stage/dav-config.ts -i /workspace/stage/config.patch >/dev/null",
        "cmp -s /workspace/stage/config.ts /workspace/stage/dav-config.ts && echo 'local_staged:identical'",
      ].join("\n"),
    );
    assert.equal(localRes.exitCode, 0, `stderr: ${localRes.stderr}`);
    assert.equal(localRes.stdout, "local_staged:identical\n");
    patchedBytes = await localH.fs.readFile("/workspace/stage/config.ts");
  });

  const s3Fs = new sb.S3FileSystem({
    transport: new sb.MockS3Client({ buckets: ["code-bucket"] }),
    bucket: "code-bucket",
    allowNonAtomicRename: true,
  });
  const dav = new InMemoryWebDavServer("/dav");
  const webdavFs = new sb.WebDavFileSystem({
    baseUrl: "https://webdav.example.invalid/dav/",
    fetch: dav.createFetch(),
    requestStreamSupport: true,
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: {
      "/mnt/s3": s3Fs,
      "/mnt/dav": webdavFs,
    },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    await h.fs.writeFile("/workspace/patched-config.ts", patchedBytes);
    const res = await h.exec(
      [
        "mkdir -p /mnt/s3/src /mnt/dav/src",
        "printf 'export const PORT = 3000;\\nexport const HOST = \"localhost\";\\n' > /mnt/s3/src/config.ts",
        "cat /mnt/s3/src/config.ts > /mnt/dav/src/config.ts",
        "if (cd /mnt/s3 && apply_patch <<'PATCH') 2>/dev/null",
        "*** Begin Patch",
        "*** Update File: src/config.ts",
        "@@",
        "-export const PORT = 3000;",
        "+export const PORT = 8080;",
        "*** End Patch",
        "PATCH",
        "then echo 'remote_patch:unexpected'; else echo 'remote_patch:refused'; fi",
        "cat /workspace/patched-config.ts > /mnt/s3/src/config.ts",
        "cat /workspace/patched-config.ts > /mnt/dav/src/config.ts",
        "cmp -s /mnt/s3/src/config.ts /mnt/dav/src/config.ts && echo 's3_dav_patched:identical'",
        "cat /mnt/dav/src/config.ts",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      [
        "remote_patch:refused",
        "s3_dav_patched:identical",
        "export const PORT = 8080;",
        'export const HOST = "localhost";',
        "export const TLS = true;",
        "",
      ].join("\n"),
    );
  });
});

// 19. xan and csvkit analytical pipelines reading from S3 partitions and writing to WebDAV
test("xan and csvkit analytical pipelines filter and project partitioned CSVs from S3FileSystem and publish reports to WebDavFileSystem", async () => {
  const s3Fs = new sb.S3FileSystem({
    transport: new sb.MockS3Client({ buckets: ["analytics"] }),
    bucket: "analytics",
  });
  const dav = new InMemoryWebDavServer("/dav");
  const webdavFs = new sb.WebDavFileSystem({
    baseUrl: "https://webdav.example.invalid/dav/",
    fetch: dav.createFetch(),
    requestStreamSupport: true,
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: {
      "/mnt/s3": s3Fs,
      "/mnt/dav": webdavFs,
    },
  });

  await s3Fs.mkdir("/partitions", { recursive: true });
  await s3Fs.writeFile(
    "/partitions/part-01.csv",
    utf8Encoder.encode("team,service,cost\ncore,auth,120\ncore,db,340\ngrowth,ads,210\n"),
  );
  await s3Fs.writeFile(
    "/partitions/part-02.csv",
    utf8Encoder.encode("team,service,cost\ncore,cache,90\ngrowth,email,150\ninfra,k8s,500\n"),
  );
  await webdavFs.mkdir("/reports", { recursive: true });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "{ head -n 1 /mnt/s3/partitions/part-01.csv; tail -n +2 /mnt/s3/partitions/part-01.csv; tail -n +2 /mnt/s3/partitions/part-02.csv; } > /mnt/s3/partitions/combined.csv",
        "xan count /mnt/s3/partitions/combined.csv",
        "csvgrep -c team -m core /mnt/s3/partitions/combined.csv | xan select service,cost > /mnt/dav/reports/core-services.csv",
        "cat /mnt/dav/reports/core-services.csv",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      [
        "6",
        "service,cost",
        "auth,120",
        "db,340",
        "cache,90",
        "",
      ].join("\n"),
    );
  });
});

// 20. S3FileSystem and WebDavFileSystem maxReadBytes / maxListEntries bounds and AbortSignal cancellation
test("S3FileSystem and WebDavFileSystem enforce maxReadBytes and maxListEntries resource bounds and honor AbortSignal cancellation", async () => {
  const transport = new sb.MockS3Client({ buckets: ["bounded"] });
  const seedFs = new sb.S3FileSystem({ transport, bucket: "bounded" });
  await seedFs.mkdir("/items", { recursive: true });
  await seedFs.writeFile("/items/small.txt", utf8Encoder.encode("ok-payload\n"));
  await seedFs.writeFile("/items/huge.bin", new Uint8Array(4096).fill(65));
  for (let i = 1; i <= 6; i++) {
    await seedFs.writeFile(`/items/f${i}.txt`, utf8Encoder.encode(`item-${i}\n`));
  }

  const boundedReadS3 = new sb.S3FileSystem({
    transport,
    bucket: "bounded",
    maxReadBytes: 512,
    maxStreamBytes: 512,
  });
  const boundedListS3 = new sb.S3FileSystem({
    transport,
    bucket: "bounded",
    maxListEntries: 3,
    pageSize: 2,
  });
  const mounted = new sb.MountFileSystem({
    root: new sb.MemoryFileSystem(),
    mounts: {
      "/mnt/read-cap": boundedReadS3,
      "/mnt/list-cap": boundedListS3,
    },
  });

  await withE2EHarness({ fs: mounted, cwd: "/workspace" }, async (h) => {
    const res = await h.exec(
      [
        "cat /mnt/read-cap/items/small.txt",
        "if cat /mnt/read-cap/items/huge.bin >/dev/null 2>&1; then echo 'huge_read:ok'; else echo 'huge_read:blocked'; fi",
        "if ls /mnt/list-cap/items >/dev/null 2>&1; then echo 'list_cap:ok'; else echo 'list_cap:blocked'; fi",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
    assert.equal(
      res.stdout,
      ["ok-payload", "huge_read:blocked", "list_cap:blocked", ""].join("\n"),
    );

    const abortController = new AbortController();
    abortController.abort(new Error("user cancelled remote VFS operation"));
    await assert.rejects(() =>
      h.shell.exec("cat /mnt/read-cap/items/small.txt", {
        signal: abortController.signal,
      }),
    );
  });
});
