import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

for (const condition of ["browser", "workerd"]) {
  test(`${condition} network platform resolves without Node capabilities`, async () => {
    const directory = new URL("../../../", import.meta.url);
    const pkg = JSON.parse(await readFile(new URL("package.json", directory), "utf8"));
    const target = pkg.imports["#safe-bash-network-platform"][condition];
    assert.equal(target, "./dist/commands/network/platform-portable.js");
    const result = await build({
      alias: { "#safe-bash-network-platform": fileURLToPath(new URL(target.replace("./dist/", "./src/").replace(".js", ".ts"), directory)) },
      stdin: { contents: 'export * from "#safe-bash-network-platform";', resolveDir: fileURLToPath(new URL("../../../src/commands/network/", import.meta.url)) },
      platform: "browser", conditions: [condition], bundle: true, format: "esm", write: false,
      metafile: true,
    });
    assert.equal(Object.keys(result.metafile!.inputs).some(path => path.endsWith("/transport.ts")), false);
    const api = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles![0]!.text).toString("base64"));
    assert.equal(api.requiresFiniteUrlLimits, true);
    assert.throws(() => api.createDefaultHttpTransport(), /explicit HTTP transport/);
    for (const name of ["X-Test", "!#$%&'*+-.^_`|~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"]) api.validateHeaderName(name);
    for (const name of ["", "a:b", "a b", "a\r\nB", "é"]) assert.throws(() => api.validateHeaderName(name));
    for (const value of ["", "value\twith spaces", "\u0080\u00ff"]) api.validateHeaderValue("X-Test", value);
    for (const value of ["\0", "\r", "\n", "\u007f", "\u0100"]) assert.throws(() => api.validateHeaderValue("X-Test", value));
    const bytes = api.randomBytes(18);
    assert.equal(bytes.length, 18);
    assert.ok(bytes instanceof Uint8Array);
  });
}
