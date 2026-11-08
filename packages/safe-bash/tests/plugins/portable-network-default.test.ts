import assert from "node:assert/strict";
import test from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";

test("network public entry runs curl and wget with Fetch and no Node globals", async context => {
  const { api } = await portableRuntime(`
    globalThis.fetch = async request => {
      if (request.credentials !== "omit" || request.redirect !== "manual") throw new Error("unsafe fetch defaults");
      return new Response("portable response");
    };
    export { Shell } from "./packages/safe-bash/src/shell/index.ts";
    export { MemoryFileSystem } from "./packages/safe-bash/src/fs/memory/index.ts";
    export * from "./packages/safe-bash/src/commands/network/index.ts";
  `);
  const fs = new api.MemoryFileSystem();
  const shell = new api.Shell({ fs }).use(api.networkCommands({ authorize: () => true }));
  context.after(() => shell.dispose());
  for (const command of ["curl https://example.com/", "wget -O - https://example.com/"]) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "portable response");
  }
});

test("default root loads without Node globals and executes shell variables", async context => {
  const { api } = await portableRuntime('export * from "./packages/safe-bash/src/index.ts";');
  const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("x=10; echo $x");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "10\n");
});
