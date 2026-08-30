import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { MountFileSystem } from "../../../src/fs/mount/index.js";
import { OverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { ReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { MockS3Client, S3FileSystem } from "../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "../../fs/webdav/mock.js";
import { Shell, metadataCommands, standardCommands } from "../../../src/index.js";
import { namespace, run, snapshot } from "./helpers.js";

for (const backend of ["memory", "real", "mount", "overlay", "s3", "webdav", "readonly"] as const) test(`metadata actual ${backend} capabilities and shell workflow`, async context => {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/work", { mode: 0o755 });
  await backing.writeFile("/work/file", Uint8Array.of(0, 255, 10), { mode: 0o640 });
  const original = await snapshot(backing);
  let fs: FileSystem;
  const upper = new MemoryFileSystem();
  if (backend === "real") fs = await createRealFileSystem({ root: await namespace(context) });
  else if (backend === "mount") fs = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/work": new MemoryFileSystem() } });
  else if (backend === "overlay") fs = new OverlayFileSystem({ lower: new ReadOnlyFileSystem(backing), upper });
  else if (backend === "readonly") fs = new ReadOnlyFileSystem(backing);
  else if (backend === "s3") fs = new S3FileSystem({ bucket: "metadata", transport: new MockS3Client({ buckets: ["metadata"] }) });
  else if (backend === "webdav") fs = new WebDavFileSystem({ baseUrl: "https://metadata.test/dav/", fetch: new MockDav().fetch });
  else fs = backing;
  if (!["memory", "overlay", "readonly"].includes(backend)) {
    await fs.mkdir("/work", { recursive: true });
    await fs.writeFile("/work/file", Uint8Array.of(0, 255, 10));
  }
  const before = await snapshot(fs);
  const fields = await run("stat", ["-c%s:%a:%F", "file"], fs);
  assert.equal(fields.exitCode, 0, fields.stderr);
  assert.equal(fields.stdout.toString(), `3:${((await fs.stat("/work/file")).mode & 0o7777).toString(8)}:regular file\n`);
  const permissions = backend !== "s3" && backend !== "webdav" && backend !== "readonly";
  const mode = await run("chmod", ["600", "file"], fs);
  const temporary = await run("mktemp", ["private.XXXXXX"], fs);
  if (!permissions) {
    assert.equal(mode.exitCode, 1);
    assert.equal(temporary.exitCode, 1);
    assert.match(mode.stderr, backend === "readonly" ? /EROFS/u : /ENOTSUP/u);
    assert.match(temporary.stderr, backend === "readonly" ? /EROFS/u : /ENOTSUP/u);
    assert.deepEqual(await snapshot(fs), before);
    await assert.rejects(fs.chmod!("/work/file", 0o600), error => error instanceof FsError && error.code === (backend === "readonly" ? "EROFS" : "ENOTSUP"));
    const dryRun = await run("mktemp", ["-u", "preview.XXXX"], fs);
    assert.equal(dryRun.exitCode, 0, dryRun.stderr);
    assert.match(dryRun.stdout.toString(), /^preview\.[a-zA-Z0-9]{4}\n$/u);
    assert.deepEqual(await snapshot(fs), before);
  } else {
    assert.equal(mode.exitCode, 0, mode.stderr);
    assert.equal(temporary.exitCode, 0, temporary.stderr);
    assert.equal((await fs.stat("/work/file")).mode & 0o777, 0o600);
    const created = `/work/${temporary.stdout.toString().trimEnd()}`;
    assert.equal((await fs.stat(created)).mode & 0o777, 0o600);
    assert.deepEqual(await fs.readFile(created), new Uint8Array());
    const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(metadataCommands());
    try {
      const result = await shell.exec('file=$(mktemp job.XXXXXX); printf "binary-ready" > "$file"; chmod u=rw,go= "$file"; stat -c "%a:%s" "$file" | cat');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "600:12\n");
      assert.equal(result.stderr, "");
      const names = (await fs.readdir("/work")).map(entry => entry.name);
      assert.equal(names.length, 3);
      const job = names.find(name => name.startsWith("job."));
      assert.ok(job);
      assert.equal(Buffer.from(await fs.readFile(`/work/${job}`)).toString(), "binary-ready");
    } finally { await shell.dispose(); }
  }
  assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(0, 255, 10));
  if (backend === "overlay" || backend === "readonly") assert.deepEqual(await snapshot(backing), original);
});

test("MemoryFS enforces owner bits but does not implement host identities", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Uint8Array.of(1));
  assert.equal((await run("chmod", ["000", "file"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/work/file")).mode & 0o777, 0);
  await assert.rejects(fs.readFile("/work/file"), error => error instanceof FsError && error.code === "EACCES");
  await assert.rejects(fs.writeFile("/work/file", Uint8Array.of(2)), error => error instanceof FsError && error.code === "EACCES");
  assert.equal((await run("stat", ["-c%a", "file"], fs)).stdout.toString(), "0\n");
  assert.equal((await run("chmod", ["600", "file"], fs)).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(1));
});
