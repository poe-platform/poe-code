import assert from "node:assert/strict";
import test from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";

test("portable shell runs default network factories and all WinZip AES strengths", async context => {
  const { api } = await portableRuntime(`
    globalThis.fetch = async () => new Response("portable response");
    export { Shell } from "./packages/safe-bash/src/shell/index.ts";
    export { MemoryFileSystem } from "./packages/safe-bash/src/fs/memory/index.ts";
    export * from "./packages/safe-bash/src/commands/network/public.ts";
    export * from "./packages/safe-bash/src/commands/archive/index.ts";
  `);
  assert.equal(api.createCurlCommand().name, "curl");
  assert.equal(api.createWgetCommand().name, "wget");
  const fs = new api.MemoryFileSystem();
  const shell = new api.Shell({ fs }).use(api.networkCommands()).use(api.archiveCommands({ zipHost: { entropy: length => crypto.getRandomValues(new Uint8Array(length)) } }));
  context.after(() => shell.dispose());
  await fs.writeFile("/input.txt", new TextEncoder().encode("portable encrypted content\n"));
  for (const strength of [128, 192, 256]) {
    for (const version of [1, 2]) {
      const archive = `/aes-${strength}-${version}.zip`;
      const zipped = await shell.exec(`zip -Z store --encryption aes-${strength}-ae${version} -P password ${archive} /input.txt`);
      assert.equal(zipped.exitCode, 0, zipped.stderr);
      const read = await shell.exec(`unzip -p -P password ${archive}`);
      assert.equal(read.exitCode, 0, read.stderr);
      assert.equal(read.stdout, "portable encrypted content\n");
      assert.notEqual((await shell.exec(`unzip -p -P wrong ${archive}`)).exitCode, 0);
    }
  }
});

test("portable network accepts default and explicit unlimited quotas without Buffer", async context => {
  const { api } = await portableRuntime(`
    globalThis.fetch = async request => new Response(new URL(request.url).searchParams.get("message") ?? "download");
    export { Shell } from "./packages/safe-bash/src/shell/index.ts";
    export { MemoryFileSystem } from "./packages/safe-bash/src/fs/memory/index.ts";
    export * from "./packages/safe-bash/src/commands/network/public.ts";
  `);
  for (const limits of [undefined, { maxUrls: Infinity, maxBufferBytes: Infinity }]) {
    const options = { authorize: () => true, ...(limits ? { limits } : {}) };
    assert.equal(api.createCurlCommand(options).name, "curl");
    assert.equal(api.createWgetCommand(options).name, "wget");
    const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.networkCommands(options));
    context.after(() => shell.dispose());
    const query = await shell.exec("curl -G --data-urlencode 'message=héllo世界' https://example.test/");
    assert.equal(query.exitCode, 0, query.stderr);
    assert.equal(query.stdout, "héllo世界");
    const download = await shell.exec("wget -q -O - https://example.test/");
    assert.equal(download.exitCode, 0, download.stderr);
    assert.equal(download.stdout, "download");
  }
});
