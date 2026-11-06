import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryFileSystem, Shell, pandocCommands } from "@poe-platform/safe-bash";
import { RustWasmBash } from "@poe-code/safe-bash-rust";

// Optional native comparison: PANDOC_BIN must point to Pandoc 3.11.
// Fixtures were generated with -f gfm -t json, then -f json -t html --wrap=none.
const fixtures = new URL("./fixtures/", import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, fixtures), "utf8");

test("Pandoc JSON tables survive TypeScript and bridged Wasm pipes", async () => {
  const input = fixture("pandoc-table.json");
  const createCompanion = () => {
    const fs = new MemoryFileSystem();
    return { fs, shell: new Shell({ fs, cwd: "/" }).use(pandocCommands()) };
  };
  const ts = createCompanion().shell;
  const rust = new RustWasmBash({ forceNative: false, cwd: "/", companionFactory: createCompanion });
  const expected = [
    '<p>Before</p>', '<table>',
    '<colgroup><col><col style="text-align:right"></colgroup>',
    '<thead>', '<tr><th scope="col">A</th><th scope="col" style="text-align:right">B</th></tr>',
    '</thead>', '<tbody>', '<tr><td><strong>x</strong></td><td style="text-align:right">2</td></tr>',
    '</tbody>', '</table>', '<p>After</p>', ''
  ].join("\n");
  try {
    for (const shell of [ts, rust]) {
      const json = await shell.exec("pandoc -f json -t json", { stdin: input });
      assert.equal(json.exitCode, 0, json.stderr);
      assert.deepEqual(JSON.parse(json.stdout), JSON.parse(input));
      const rendered = await shell.exec("pandoc -f json -t html --wrap=none", { stdin: json.stdout });
      assert.equal(rendered.exitCode, 0, rendered.stderr);
      assert.equal(rendered.stdout, expected);
    }
  } finally {
    rust.dispose();
  }
});

test("forceNative Wasm explicitly rejects Pandoc JSON input without losing an existing output file", async () => {
  const rust = new RustWasmBash({ forceNative: true, cwd: "/" });
  try {
    for (const format of ["json", "html"]) {
      for (const output of ["", " -o /result"]) {
        await rust.fs.writeFile("/result", "existing output");
        const result = await rust.exec(`pandoc -f json -t ${format} --wrap=none${output}`, { stdin: fixture("pandoc-table.json") });
        assert.notEqual(result.exitCode, 0);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /requires the TypeScript safe-bash bridge/);
        assert.equal(new TextDecoder().decode(await rust.fs.readFile("/result")), "existing output");
      }
    }
  } finally {
    rust.dispose();
  }
});

test("Pandoc table fixtures match native 3.11", { skip: !process.env.PANDOC_BIN }, () => {
  const native = (args: string[], input: string) => execFileSync(process.env.PANDOC_BIN!, args, { input, encoding: "utf8" });
  assert.match(native(["--version"], ""), /^pandoc 3\.11\n/);
  const generated = native(["-f", "gfm", "-t", "json"], "Before\n\n| A | B |\n| --- | ---: |\n| **x** | 2 |\n\nAfter\n");
  assert.deepEqual(JSON.parse(generated), JSON.parse(fixture("pandoc-table.json")));
  assert.deepEqual(JSON.parse(native(["-f", "json", "-t", "json"], generated)), JSON.parse(generated));
  assert.equal(native(["-f", "json", "-t", "html", "--wrap=none"], generated), fixture("pandoc-table.html"));
});
