import assert from "node:assert/strict";
import { test } from "node:test";
import { build, type BuildOptions } from "esbuild";
import { expandUrls } from "../../../src/commands/network/glob.js";
import { limitsFor } from "../../../src/commands/network/shared.js";
import { fixture, run } from "./helpers.js";
import { toByteSource } from "safe-bash-contracts";
import path from "node:path";

const { resolveBrowserShellBuild }: {
  resolveBrowserShellBuild(rootDir: string): BuildOptions & { entryPoints: { "commands/network/index.browser": string } };
} = await import(new URL("../../../../../scripts/bundle-safe-bash.mjs", import.meta.url).href);

test("portable network registration permits disabled and explicit expansion quotas", async context => {
  const recipe = resolveBrowserShellBuild(process.cwd().endsWith("safe-bash") ? process.cwd() + "/../.." : process.cwd());
  const root = path.resolve(recipe.absWorkingDir!);
  const core = path.join(root, "packages/safe-fs/src/core.ts");
  const result = await build({ ...recipe, entryPoints: [recipe.entryPoints["commands/network/index.browser"]], external: [], alias: {
    ...recipe.alias, "@poe-code/safe-fs/runtime-core": core, "@poe-code/safe-fs/fs/memory": core, "@poe-code/safe-fs/core": core, "@poe-code/safe-fs": core,
    "poe-code/safe-fs/core": core, "poe-code/safe-fs": core,
    "@poe-code/xml-ast": path.join(root, "packages/xml-ast/src/index.ts"),
  }, write: false, sourcemap: false });
  const api = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles![0]!.text).toString("base64"));
  for (const create of [api.networkCommands, api.createCurlCommand, api.createWgetCommand]) {
    for (const limits of [undefined, { maxUrls: 8 }, { maxBufferBytes: 1024 }, { maxUrls: Infinity, maxBufferBytes: 1024 }]) {
      assert.doesNotThrow(() => create({ authorize: () => false, transport: async () => assert.fail("transport"), limits }));
    }
    assert.doesNotThrow(() => create({ authorize: () => false, transport: async () => assert.fail("transport"), limits: { maxUrls: 8, maxBufferBytes: 1024 } }));
    assert.doesNotThrow(() => create());
  }
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; return new Response("portable default"); });
  for (const create of [api.createCurlCommand, api.createWgetCommand]) {
    const command = create({ authorize: () => true });
    let output = "", stderr = "";
    const result = await command.execute({ command: command.name,
      args: command.name === "curl" ? ["https://example.test/"] : ["-O", "-", "https://example.test/"],
      cwd: "/work", env: {}, fs: await fixture(), stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output, "portable default");
  }
  assert.equal(calls, 2);
});

test("range projection includes prefixes and capture copies before allocation", context => {
  const allocation = context.mock.method(Array, "from", () => assert.fail("range allocated before admission"));
  assert.throws(() => expandUrls(["https://offline.invalid/" + "x".repeat(100) + "[1-100]"], false,
    limitsFor({ maxUrls: 100, maxBufferBytes: 1024 })), /buffer|work/i);
  assert.equal(allocation.mock.callCount(), 0);
});

test("range projection admits cumulative expansion work before allocation", context => {
  const original = Array.from;
  let calls = 0;
  context.mock.method(Array, "from", (...args: Parameters<typeof Array.from>) => {
    calls++;
    assert.equal(calls, 1, "second range allocated before cumulative admission");
    return Reflect.apply(original, Array, args);
  });
  assert.throws(() => expandUrls(["https://offline.invalid/[1-2][1-2]"], false,
    limitsFor({ maxUrls: 4, maxBufferBytes: 170 })), /buffer|work/i);
});

test("expansion rejection precedes authorization; admitted URLs retain per-request policy", async () => {
  let authorizations = 0;
  let transfers = 0;
  const options = { limits: { maxUrls: 4, maxBufferBytes: 1024 },
    authorize: () => { authorizations++; return false; },
    transport: async () => { transfers++; return assert.fail("denied transport"); } };
  const rejected = await run(["https://offline.invalid/[1-50000]"], { options });
  assert.equal(rejected.exitCode, 2);
  assert.equal(authorizations, 0);
  const admitted = await run(["https://offline.invalid/[1-2]"], { options });
  assert.equal(admitted.exitCode, 7);
  assert.equal(authorizations, 2);
  assert.equal(transfers, 0);
});
