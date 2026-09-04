import assert from "node:assert/strict";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build, transform } from "esbuild";

type BrowserShell = typeof import("../../src/browser.js");
let browser: BrowserShell;

before(async () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const { resolveBrowserShellBuild } = await import(new URL("../../../../scripts/bundle-safe-bash.mjs", import.meta.url).href);
  const filesystem = await build({
    absWorkingDir: root,
    entryPoints: ["packages/safe-fs/src/core.ts"],
    bundle: true, write: false, platform: "browser", conditions: ["workerd", "worker", "browser"],
    format: "cjs", target: "es2022",
  });
  const bundle = await build(resolveBrowserShellBuild(root));
  const compiled = await transform(bundle.outputFiles!.find(output => output.path.endsWith("browser.js"))!.text, { format: "cjs" });
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto,
  });
  sandbox.canonical = runInContext(`(function(){ const module = { exports: {} }; ${filesystem.outputFiles![0]!.text}; return module.exports; })()`, sandbox);
  browser = runInContext(`(function(){ const module = { exports: {} }; const require = name => { if (name !== "poe-code/safe-fs/core") throw new Error(name); return canonical; }; ${compiled.code}; return module.exports; })()`, sandbox) as BrowserShell;
  assert.equal(runInContext("typeof Buffer + ':' + typeof process", sandbox), "undefined:undefined");
  assert.ok(Object.keys(bundle.metafile!.inputs).some(input => input.endsWith("node_modules/buffer/index.js")));
});

const cases = [
  { name: "overlapping reordered byte ranges", args: "-b 5-,2-3,1-2,2 --output-delimiter='|'", input: "abcdef\n", output: "abc|ef\n" },
  { name: "adjacent byte ranges retain current join behavior", args: "-b 1,2,3-4 --output-delimiter='|'", input: "abcdef\n", output: "abcd\n" },
  { name: "Unicode character ranges", args: "-c 2-3", input: "a😀éz\n", output: "😀é\n" },
  { name: "Unicode decoder chunk boundary", args: "-c 4096-4097", input: "a".repeat(4095) + "😀éz\n", output: "😀é\n" },
  { name: "multibyte field separator chunk boundary", args: "-d 😀 -f 2,3", input: "a".repeat(4095) + "😀é😀z\n", output: "é😀z\n" },
  { name: "complement with NUL records", args: "-z -b 2-3 --complement", input: "abcd\0efgh", output: "ad\0eh\0" },
  { name: "explicit comma delimiter", args: "-d , -f 2", input: "one,two,three\nfour,five,six\n", output: "two\nfive\n" },
  { name: "default tab delimiter", args: "-f 2", input: "one\ttwo\tthree\nfour\tfive\tsix\n", output: "two\nfive\n" },
  { name: "multiple comma fields", args: "-d , -f 1,3", input: "one,two,three,four\n", output: "one,three\n" },
  { name: "multiple tab fields", args: "-f 1,3", input: "one\ttwo\tthree\tfour\n", output: "one\tthree\n" },
  { name: "empty comma fields", args: "-d , -f 1-4", input: ",two,,\n,,,\n", output: ",two,,\n,,,\n" },
  { name: "empty tab fields", args: "-f 1-4", input: "\ttwo\t\t\n\t\t\t\n", output: "\ttwo\t\t\n\t\t\t\n" },
  { name: "empty selected fields and custom joiner", args: "-d , -f 1,3,4 --output-delimiter='|'", input: ",two,,\n", output: "||\n" },
  { name: "multibyte delimiter", args: "-d é -f 2,3", input: "oneétwoéthree\n", output: "twoéthree\n" },
  { name: "undelimited records", args: "-d , -f 2", input: "plain\n\none,two", output: "plain\n\ntwo\n" },
  { name: "only delimited records", args: "-s -d , -f 2", input: "plain\n\none,two\n", output: "two\n" },
];

for (const source of ["stdin", "file"] as const) {
  for (const specimen of cases) {
    test(`portable cut: ${specimen.name} from ${source}`, async () => {
      const fs = new browser.MemoryFileSystem();
      const shell = new browser.Shell({ fs }).use(browser.browserCommands());
      try {
        const bytes = new TextEncoder().encode(specimen.input);
        if (source === "file") await fs.writeFile("/input", bytes);
        const result = await shell.exec(`cut ${specimen.args}${source === "file" ? " /input" : ""}`, source === "stdin" ? { stdin: bytes } : {});
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, specimen.output);
      } finally { await shell.dispose(); }
    });
  }
}

test("portable cut: explicit delimiter in a browser shell pipeline", async () => {
  const shell = new browser.Shell({ fs: new browser.MemoryFileSystem() }).use(browser.browserCommands());
  try {
    const result = await shell.exec("printf 'one,two,three\\n' | cut -d , -f 2");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "two\n");
  } finally { await shell.dispose(); }
});
