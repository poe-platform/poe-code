import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/qpdf-range-parity.json", import.meta.url), "utf8"));
for (const fixture of fixtures) test(`qpdf range diagnostics match JavaScript: ${fixture.corpus}/${fixture.name}/${fixture.args.join(" ")}`, async () => {
  const {cases} = JSON.parse(readFileSync(new URL(`../tests/fixtures/${fixture.corpus}.json`, import.meta.url), "utf8"));
  const bytes = Buffer.from(cases[fixture.name].pdf, "base64");
  const shell = await createRustWasmBash({forceNative: true, cwd: "/", files: {"/in.pdf": bytes, "/out.pdf": "KEEP"}});
  try {
    const result = await shell.exec("qpdf " + fixture.args.join(" "));
    assert.deepEqual([result.exitCode, result.stderr, Buffer.from(result.stdoutBytes)],
      [fixture.status, fixture.stderr, Buffer.from(fixture.stdout, "base64")]);
    assert.deepEqual(await shell.fs.readFile("/in.pdf"), new Uint8Array(bytes));
    assert.deepEqual(await shell.fs.readFile("/out.pdf"), new TextEncoder().encode("KEEP"));
  } finally {await shell.dispose();}
});
