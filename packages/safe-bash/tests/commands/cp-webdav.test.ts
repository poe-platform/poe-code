import assert from "node:assert/strict";
import test from "node:test";
import { WebDavFileSystem } from "../../src/fs/webdav/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { MockDav } from "../fs/webdav/mock.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../src/fs/mount/index.js";

for (const existing of [false, true]) for (const preserve of [false, true]) {
  test(`attributes-only WebDAV copy keeps content separate from mode preservation: existing=${existing}, preserve=${preserve}`, async () => {
    const local = createMemoryFileSystem();
    const payload = Uint8Array.of(0, 255, 65);
    const prior = Uint8Array.of(79, 76, 68);
    await local.mkdir("/work");
    await local.writeFile("/work/source", payload, { mode: 0o640 });
    const mock = new MockDav();
    if (existing) mock.files.set("/target", prior.slice());
    const remote = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch, requestStreamSupport: true });
    const fs = createMountFileSystem({ root: local, mounts: { "/remote": remote } });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(`cp --attributes-only ${preserve ? "--preserve=mode " : ""}source /remote/target`);
      assert.equal(result.exitCode, preserve ? 1 : 0, result.stderr);
      if (preserve) assert.match(result.stderr, /ENOTSUP/u);
      else assert.equal(result.stderr, "");
      const writes = mock.requests.filter(request => request.init.method === "PUT");
      assert.equal(writes.length, !preserve && !existing ? 1 : 0);
      if (writes[0]) assert.equal(writes[0].headers.get("If-None-Match"), "*");
      if (preserve && !existing) assert.equal(mock.files.has("/target"), false);
      else assert.deepEqual(mock.files.get("/target"), existing ? prior : new Uint8Array());
      assert.deepEqual(await local.readFile("/work/source"), payload);
      assert.equal((await local.stat("/work/source")).mode & 0o777, 0o640);
    } finally { await shell.dispose(); }
  });
}

for (const fault of ["denied", "competing-target"] as const) {
  test(`attributes-only WebDAV creation preserves server refusal: ${fault}`, async () => {
    const local = createMemoryFileSystem();
    const payload = Uint8Array.of(0, 255, 65);
    const competitor = Uint8Array.of(42);
    await local.mkdir("/work");
    await local.writeFile("/work/source", payload);
    const mock = new MockDav();
    let puts = 0;
    const remote = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", requestStreamSupport: true, fetch: async (url, init) => {
      if (init.method === "PUT") {
        puts++;
        assert.equal(new Headers(init.headers).get("If-None-Match"), "*");
        if (fault === "denied") return new Response(null, { status: 403 });
        mock.files.set("/target", competitor.slice());
      }
      return mock.fetch(url, init);
    } });
    const fs = createMountFileSystem({ root: local, mounts: { "/remote": remote } });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec("cp --attributes-only source /remote/target");
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, fault === "denied" ? /EACCES|permission denied/iu : /EEXIST|file exists/iu);
      assert.equal(puts, 1);
      if (fault === "denied") assert.equal(mock.files.has("/target"), false);
      else assert.deepEqual(mock.files.get("/target"), competitor);
      assert.deepEqual(await local.readFile("/work/source"), payload);
    } finally { await shell.dispose(); }
  });
}

for (const command of [
  "cp -r tree copied",
  "cp -R tree copied",
  "mkdir copied; cp -r tree/. copied",
  "mkdir copied; cp -r tree copied",
  "cp -r tree copied && cat copied/file",
]) {
  test(`stock WebDAV refuses unbound source reads for ${command}`, async () => {
    const mock = new MockDav();
    const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
    await fs.mkdir("/work/tree/sub", { recursive: true });
    await fs.writeFile("/work/tree/file", new TextEncoder().encode("payload\n"));
    await fs.writeFile("/work/tree/sub/deep", new TextEncoder().encode("deep\n"));
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /ENOTSUP/u);
      assert.equal(result.stdout, "");
      const destination = command === "mkdir copied; cp -r tree copied" ? "/work/copied/tree" : "/work/copied";
      await assert.rejects(fs.stat(`${destination}/file`), { code: "ENOENT" });
      await assert.rejects(fs.stat(`${destination}/sub/deep`), { code: "ENOENT" });
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/tree/file")), "payload\n");
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/tree/sub/deep")), "deep\n");
    } finally { await shell.dispose(); }
  });
}

test("stock WebDAV rejects explicit mode preservation before creating the destination", async () => {
  const mock = new MockDav();
  const fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  await fs.mkdir("/work/tree", { recursive: true });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    for (const flags of ["-Rp", "-R --preserve=mode"]) {
      const result = await shell.exec(`cp ${flags} tree copied`);
      assert.equal(result.exitCode, 1, flags);
      await assert.rejects(fs.stat("/work/copied"), { code: "ENOENT" });
    }
  } finally { await shell.dispose(); }
});
