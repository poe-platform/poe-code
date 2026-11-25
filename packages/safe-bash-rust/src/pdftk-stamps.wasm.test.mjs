import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {PdfDocument} from "@poe-code/pdf-ast";
import {createRustWasmBash} from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("../../../tests/fixtures/media/pdftk-stamp-parity.json", import.meta.url), "utf8"));
for (const fixture of fixtures) test(`pdftk stamp geometry matches JavaScript: ${fixture.name}`, async () => {
  const input = Buffer.from(fixture.input, "base64"), stamp = Buffer.from(fixture.stamp, "base64");
  const shell = await createRustWasmBash({forceNative: true, cwd: "/", files: {"/in": input, "/stamp": stamp}});
  try {
    const names = (await shell.fs.readdir("/")).map(entry => entry.name);
    const result = await shell.exec("pdftk " + fixture.args.join(" "));
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [fixture.status, fixture.stdout, fixture.stderr]);
    const doc = PdfDocument.load(await shell.fs.readFile("/out"));
    assert.equal(doc.getPageCount(), fixture.pages);
    assert.equal(Buffer.from(doc.getPage(0).getRawContentStream()).toString(), fixture.content);
    assert.deepEqual(await shell.fs.readFile("/in"), new Uint8Array(input));
    assert.deepEqual(await shell.fs.readFile("/stamp"), new Uint8Array(stamp));
    assert.deepEqual((await shell.fs.readdir("/")).map(entry => entry.name).sort(), [...names, "out"].sort());
  } finally {await shell.dispose();}
});
