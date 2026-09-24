import assert from "node:assert/strict";
import test from "node:test";
import { WebDavFileSystem } from "../../src/fs/webdav/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { MockDav } from "../fs/webdav/mock.js";

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
