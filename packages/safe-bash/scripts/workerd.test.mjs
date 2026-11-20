import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

test("public document converter includes its embedded font and data licenses", async () => {
  for (const name of ["Liberation", "DejaVu", "NotoSansSC", "JetBrainsMono", "Unicode", "Python"]) {
    const expected = await readFile(new URL(`../../document-converter-rust/dist/LICENSE.${name}`, import.meta.url));
    const actual = await readFile(new URL(`../dist/document-converter/LICENSE.${name}`, import.meta.url));
    assert.deepEqual(actual, expected, name);
  }
});

test("portable Pandoc exports DOCX and PDF in workerd without runtime compilation", { timeout: 30000 }, async () => {
  const outdir = new URL("../../../out/workerd-documents/", import.meta.url).pathname;
  const result = await build({
    stdin: { resolveDir: new URL("../", import.meta.url).pathname, contents: `
      import { convert } from "@poe-platform/safe-bash/commands/pandoc";
      export default { async fetch() {
        if (typeof Buffer !== "undefined" || typeof process !== "undefined") throw new Error("Node globals present");
        const outputs = await Promise.all(["docx", "pdf"].map(async to => {
          const output = await convert([{bytes: new TextEncoder().encode("# Portable export\\n\\nShared **Rust** document.")}],
            {from: "commonmark", to}, {yield: async () => {}});
          if (output.kind !== "binary") throw new Error("Expected binary " + to);
          const signature = [...output.bytes.subarray(0, 4)];
          const text = await convert([{bytes: output.bytes}], {from: to, to: "plain"}, {yield: async () => {}});
          if (text.kind !== "text" || !text.text.includes("Portable export") || !text.text.includes("Rust"))
            throw new Error("Document content did not survive " + to + " readback");
          return {to, signature};
        }));
        return Response.json(outputs);
      }};
    ` },
    bundle: true, platform: "browser", format: "esm", conditions: ["workerd"], write: false, logLevel: "silent",
    tsconfigRaw: {}, alias: { "poe-code/safe-fs/core": "@poe-code/safe-fs/core" },
    loader: { ".wasm": "copy" }, outdir,
  });
  const worker = new Miniflare({
    rootPath: new URL("../../../out/", import.meta.url).pathname, modulesRoot: outdir,
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
    assert.deepEqual(JSON.parse(body), [
      {to: "docx", signature: [80, 75, 3, 4]},
      {to: "pdf", signature: [37, 80, 68, 70]},
    ]);
  } finally { await worker.dispose(); }
});

test("portable shell executes in workerd without Node compatibility", { timeout: 30000 }, async () => {
  const result = await build({
    stdin: { resolveDir: new URL("../", import.meta.url).pathname, contents: `
      import { Shell, MemoryFileSystem, agentCommands, networkCommands } from "@poe-platform/safe-bash";
      export default { async fetch() {
        if (typeof Buffer !== "undefined" || typeof process !== "undefined") throw new Error("Node globals present");
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", new TextEncoder().encode("alpha\\nbeta\\n"));
        const shell = new Shell({ fs }).use(agentCommands());
        shell.use(networkCommands({
          authorize: ({ url }) => url === "https://example.test/data",
          async transport(request) {
            const body = [];
            for await (const chunk of request.body) body.push(...chunk);
            if (new TextDecoder().decode(Uint8Array.from(body)) !== "alpha\\nbeta\\n")
              throw new Error("Portable upload bytes changed");
            return { status: 200, statusText: "OK", headers: [],
              body: (async function* () { yield Uint8Array.of(0, 128, 255); })(), async dispose() {} };
          }
        }));
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
            ['file -b /input', 'ASCII text\\n'],
            ['printf "<p>hello</p>" | html-to-markdown', 'hello\\n'],
            ['tar -cf /data.tar -C / input; tar -xOf /data.tar', 'alpha\\nbeta\\n'],
            ['printf "alpha" | sha256sum', '8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8  -\\n'],
          ]) {
            const result = await shell.exec(script);
            if (result.exitCode !== 0 || result.stdout !== expected || result.stderr !== "")
              throw new Error(JSON.stringify({ script, expected, result }));
          }
          let delivered = 0;
          let produced = 0;
          let peakOutstanding = 0;
          shell.register({ name: "stream-fixture", async execute({ stdout, stderr }) {
            const chunk = new Uint8Array(4096);
            for (let index = 0; index < 256; index++) {
              chunk.fill(index);
              produced += chunk.length;
              peakOutstanding = Math.max(peakOutstanding, produced - delivered);
              await stdout.write(chunk);
            }
            await stderr.write(Uint8Array.of(0, 255));
            return { exitCode: 7 };
          } });
          let errors = 0;
          const streamed = await shell.exec('stream-fixture', {
            captureOutput: false,
            stdout: { async write(chunk) {
              const expected = delivered / 4096;
              await Promise.resolve();
              if (chunk.length !== 4096 || !chunk.every(byte => byte === expected))
                throw new Error("Streaming byte ownership changed");
              delivered += chunk.length;
            } },
            stderr: { async write(chunk) {
              if (chunk.length !== 2 || chunk[0] !== 0 || chunk[1] !== 255)
                throw new Error("Streaming stderr changed");
              errors++;
            } },
          });
          if (streamed.exitCode !== 7 || streamed.stdoutBytes.length || streamed.stderrBytes.length ||
              streamed.stdout || streamed.stderr || delivered !== 1048576 || errors !== 1 || peakOutstanding !== 4096)
            throw new Error("Noncapturing portable execution failed");
          const download = await shell.exec('curl -sS --data-binary @/input https://example.test/data -o /download');
          if (download.exitCode !== 0 || download.stderr !== "" ||
              JSON.stringify([...await fs.readFile("/download")]) !== "[0,128,255]")
            throw new Error("Portable download bytes changed: " + download.stderr);
          const patch = await shell.exec('apply_patch', {
            stdin: "*** Begin Patch\\n*** Update File: /input\\n@@\\n-alpha\\n+gamma\\n*** End Patch\\n"
          });
          if (patch.exitCode !== 0 || new TextDecoder().decode(await fs.readFile("/input")) !== "gamma\\nbeta\\n")
            throw new Error("Portable patch failed: " + patch.stderr);
          await fs.writeFile("/original", new TextEncoder().encode("alpha\\nbeta\\n"));
          const difference = await shell.exec('diff -u /original /input');
          if (difference.exitCode !== 1 || !difference.stdout.includes("-alpha\\n+gamma\\n"))
            throw new Error("Portable difference failed");
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
