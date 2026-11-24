import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/qpdf-catalog-parity.json", import.meta.url), "utf8"));
const sources = Object.fromEntries(["strict-catalogs", "recovered-catalogs"].map(corpus => [corpus,
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${corpus}.json`, import.meta.url), "utf8")).cases]));
for (const fixture of fixtures) test(`qpdf catalog behavior matches JavaScript: ${fixture.corpus}/${fixture.name}/${fixture.flags}`, async () => {
  const bytes = Buffer.from(sources[fixture.corpus][fixture.name].pdf, "base64");
  const shell = await createRustWasmBash({forceNative: true, cwd: "/", files: {"/in.pdf": bytes, "/out.pdf": "original"}});
  try {
    const command = "qpdf in.pdf " + fixture.flags;
    const result = await shell.exec(command);
    assert.deepEqual([result.exitCode, result.stderr, Buffer.from(result.stdoutBytes)],
      [fixture.status, fixture.stderr, Buffer.from(fixture.stdout, "base64")]);
    if (fixture.outputPages !== undefined) {
      const output = await shell.exec("qpdf out.pdf --show-npages");
      assert.deepEqual([output.exitCode, output.stdout, output.stderr], [0, `${fixture.outputPages}\n`, ""]);
    } else assert.deepEqual(await shell.fs.readFile("/out.pdf"), new TextEncoder().encode("original"));
    if (fixture.replacementPages !== undefined) {
      const output = await shell.exec("qpdf in.pdf --show-npages");
      assert.deepEqual([output.exitCode, output.stdout, output.stderr], [0, `${fixture.replacementPages}\n`, ""]);
    } else assert.deepEqual(await shell.fs.readFile("/in.pdf"), new Uint8Array(bytes));
    if (fixture.stderr && (fixture.corpus === "strict-catalogs" && (fixture.flags.startsWith("--show") || fixture.flags === "--check") || fixture.flags === "--show-npages")) {
      const limit = result.stdoutBytes.length + Buffer.byteLength(result.stderr);
      const exact = await shell.exec(command, {limits: {maxOutputBytes: limit}});
      assert.deepEqual([exact.exitCode, exact.stdout, exact.stderr], [result.exitCode, result.stdout, result.stderr]);
      await assert.rejects(shell.exec(command, {limits: {maxOutputBytes: limit - 1}}), {name: "ShellLimitError", limit: "maxOutputBytes"});
    }
  } finally {await shell.dispose();}
});
