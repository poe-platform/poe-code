import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

test("portable shell executes in workerd without Node compatibility", { timeout: 30000 }, async () => {
  const result = await build({
    stdin: { resolveDir: new URL("../", import.meta.url).pathname, contents: `
      import { Shell, MemoryFileSystem, agentCommands } from "@poe-platform/safe-bash";
      export default { async fetch() {
        if (typeof Buffer !== "undefined" || typeof process !== "undefined") throw new Error("Node globals present");
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", new TextEncoder().encode("alpha\\nbeta\\n"));
        const shell = new Shell({ fs }).use(agentCommands());
        try {
          for (const [script, expected] of [
            ['echo pre{1..3}post', 'pre1post pre2post pre3post\\n'],
            ['value=$(cat /input); printf "%s" "$value"', 'alpha\\nbeta'],
            ['printf "é😀" | wc -c', '6\\n'],
            ['[[ a < b ]] && echo ordered', 'ordered\\n'],
            ['cat /input | head -n 1', 'alpha\\n'],
            ['find /input -type f', '/input\\n'],
            ['du --apparent-size -b /input', '11\\t/input\\n'],
            ['expr 2 + 2', '4\\n'],
            ['column -t /input', 'alpha\\nbeta\\n'],
            ['printf "<p>hello</p>" | html-to-markdown', 'hello\\n'],
            ['tar -cf /data.tar -C / input; tar -xOf /data.tar', 'alpha\\nbeta\\n'],
            ['printf "alpha" | sha256sum', '8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8  -\\n'],
          ]) {
            const result = await shell.exec(script);
            if (result.exitCode !== 0 || result.stdout !== expected || result.stderr !== "")
              throw new Error(JSON.stringify({ script, expected, result }));
          }
          return Response.json({ ok: true });
        } finally { await shell.dispose(); }
      }};
    ` },
    bundle: true, platform: "browser", format: "esm", conditions: ["workerd"], write: false, logLevel: "silent",
    tsconfigRaw: {},
    // The workspace postbuild targets the CLI distribution's canonical FS
    // name. Resolve that name to the same compiled portable workspace API.
    alias: { "poe-code/safe-fs/core": "@poe-code/safe-fs/core" },
    loader: { ".wasm": "copy" }, outdir: new URL("../../../out/workerd/", import.meta.url).pathname,
  });
  const worker = new Miniflare({
    rootPath: new URL("../../../out/", import.meta.url).pathname,
    modulesRoot: new URL("../../../out/workerd/", import.meta.url).pathname,
    modules: [...result.outputFiles].sort((a, b) => Number(a.path.endsWith(".wasm")) - Number(b.path.endsWith(".wasm"))).map(file => ({
      type: file.path.endsWith(".wasm") ? "CompiledWasm" : "ESModule",
      path: file.path, contents: file.path.endsWith(".wasm") ? file.contents : file.text,
    })),
    compatibilityDate: "2026-07-08", compatibilityFlags: [],
  });
  try {
    const response = await worker.dispatchFetch("http://fixture/");
    const body = await response.text();
    assert.equal(response.status, 200, body);
    assert.deepEqual(JSON.parse(body), { ok: true });
  } finally { await worker.dispose(); }
});
