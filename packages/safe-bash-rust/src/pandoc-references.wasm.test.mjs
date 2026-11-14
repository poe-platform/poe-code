import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("../../safe-bash-command-pandoc/src/fixtures/reference-links.json", import.meta.url), "utf8"));
function targets(value) {
  if (Array.isArray(value)) return value.flatMap(targets);
  if (!value || typeof value !== "object") return [];
  return [...(["Link", "Image"].includes(value.t) ? [{kind: value.t, target: value.c.at(-1)}] : []), ...Object.values(value).flatMap(targets)];
}

test("reference links match native Pandoc fixtures", async () => {
  const bash = await createRustWasmBash({forceNative: true, cwd: "/"});
  try {
    for (const fixture of fixtures) {
      await bash.fs.writeFile("/input.md", fixture.source);
      const result = await bash.exec("pandoc -f markdown -t json /input.md");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(targets(JSON.parse(result.stdout)), fixture.targets, fixture.name);
      const plain = await bash.exec("pandoc -f markdown -t plain /input.md");
      assert.equal(plain.exitCode, 0, plain.stderr);
      assert.equal(plain.stdout, fixture.plain, fixture.name);
    }
  } finally {await bash.dispose();}
});

test("duplicate precedence follows the reader dialect", async () => {
  const bash = await createRustWasmBash({forceNative: true, cwd: "/"});
  try {
    await bash.fs.writeFile("/input.md", "[a][id]\n\n[id]: /first\n[id]: /second");
    for (const from of ["markdown", "markdown_strict", "markdown_phpextra", "markdown_mmd", "gfm", "commonmark", "commonmark_x"]) {
      const result = await bash.exec(`pandoc -f ${from} -t json /input.md`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(targets(JSON.parse(result.stdout)), [{kind: "Link", target: [["gfm", "commonmark", "commonmark_x"].includes(from) ? "/first" : "/second", ""]}], from);
    }
  } finally {await bash.dispose();}
});

test("definitions follow combined and file-scope inputs", async () => {
  const bash = await createRustWasmBash({forceNative: true, cwd: "/"});
  try {
    await bash.fs.writeFile("/a.md", "[a][id]"); await bash.fs.writeFile("/b.md", "[id]: /target");
    for (const [flag, expected] of [["", "a\n"], ["--file-scope", "[a][id]\n"]]) {
      const result = await bash.exec(`pandoc -f markdown -t plain /a.md /b.md ${flag}`);
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, expected);
    }
  } finally {await bash.dispose();}
});
