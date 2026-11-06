import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryFileSystem, Shell, pandocCommands } from "@poe-platform/safe-bash";
import { RustWasmBash } from "@poe-code/safe-bash-rust";

// Optional native comparison: PANDOC_BIN must point to Pandoc 3.11.
// Fixtures were generated with -f gfm -t json, then -f json -t html --wrap=none.
const fixtures = new URL("../../safe-bash-rust/src/commands/fixtures/", import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, fixtures), "utf8");

test("Pandoc JSON tables survive native, TypeScript and forceNative Wasm pipes", async () => {
  const input = fixture("pandoc-table.json");
  const html = fixture("pandoc-table.html");
  const ts = new Shell({ fs: new MemoryFileSystem(), cwd: "/" }).use(pandocCommands());
  const rust = new RustWasmBash({ forceNative: true, cwd: "/" });
  try {
    for (const shell of [ts, rust]) {
      const json = await shell.exec("pandoc -f json -t json", { stdin: input });
      assert.equal(json.exitCode, 0, json.stderr);
      assert.deepEqual(JSON.parse(json.stdout), JSON.parse(input));
      const rendered = await shell.exec("pandoc -f json -t html --wrap=none", { stdin: json.stdout });
      assert.equal(rendered.exitCode, 0, rendered.stderr);
      assert.equal(rendered.stdout, html);
    }
    const complex = fixture("pandoc-table-complex.json");
    const roundtrip = await rust.exec("pandoc -f json -t json", { stdin: complex });
    assert.equal(roundtrip.exitCode, 0, roundtrip.stderr);
    assert.deepEqual(JSON.parse(roundtrip.stdout), JSON.parse(complex));
  } finally {
    rust.dispose();
  }
});

test("Pandoc table fixtures match native 3.11", { skip: !process.env.PANDOC_BIN }, () => {
  const native = (args: string[], input: string) => execFileSync(process.env.PANDOC_BIN!, args, { input, encoding: "utf8" });
  assert.match(native(["--version"], ""), /^pandoc 3\.11\n/);
  const generated = native(["-f", "gfm", "-t", "json"], "Before\n\n| A | B |\n| --- | ---: |\n| **x** | 2 |\n\nAfter\n");
  assert.deepEqual(JSON.parse(generated), JSON.parse(fixture("pandoc-table.json")));
  for (const name of ["pandoc-table.json", "pandoc-table-complex.json"]) {
    const input = fixture(name);
    assert.deepEqual(JSON.parse(native(["-f", "json", "-t", "json"], input)), JSON.parse(input));
  }
  assert.equal(native(["-f", "json", "-t", "html", "--wrap=none"], generated), fixture("pandoc-table.html"));
});
