import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/pdfinfo-custom-parity.json", import.meta.url), "utf8"));
for (const fixture of fixtures) test(`pdfinfo custom metadata handling matches JavaScript: ${fixture.name}/${fixture.args.join(" ")}`, async () => {
  const bytes = Buffer.from(fixture.pdf, "base64");
  const shell = await createRustWasmBash({forceNative: true, cwd: "/", files: {"/in.pdf": bytes}});
  try {
    const result = await shell.exec("pdfinfo " + fixture.args.map(arg => "'" + arg.replaceAll("'", "'\"'\"'") + "'").join(" "));
    assert.deepEqual([result.exitCode, result.stderr, Buffer.from(result.stdoutBytes)],
      [fixture.status, fixture.stderr, Buffer.from(fixture.stdout, "base64")]);
    assert.deepEqual(await shell.fs.readFile("/in.pdf"), new Uint8Array(bytes));
  } finally {await shell.dispose();}
});
