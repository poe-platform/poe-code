import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {PdfDocument} from "@poe-code/pdf-ast";
import {createRustWasmBash} from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/qpdf-label-parity.json", import.meta.url), "utf8"));
for (const fixture of fixtures.cases) test(`qpdf page labels match JavaScript: ${fixture.args.join(" ")}`, async () => {
  const bytes = Buffer.from(fixtures.pdf, "base64");
  const shell = await createRustWasmBash({forceNative: true, cwd: "/", files: {"/in.pdf": bytes, "/out.pdf": "KEEP"}});
  try {
    const originalNames = (await shell.fs.readdir("/")).map(entry => entry.name);
    const result = await shell.exec("qpdf " + fixture.args.join(" "));
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [fixture.status, fixture.stdout, fixture.stderr]);
    if (fixture.status !== 0 || !fixture.args.includes("--replace-input")) {
      assert.deepEqual(await shell.fs.readFile("/in.pdf"), new Uint8Array(bytes));
    }
    if (!fixture.outputs["out.pdf"]) assert.equal(await shell.readText("/out.pdf"), "KEEP");
    assert.deepEqual((await shell.fs.readdir("/")).map(entry => entry.name).sort(),
      [...new Set([...originalNames, ...Object.keys(fixture.outputs)])].sort());
    for (const [name, expected] of Object.entries(fixture.outputs)) {
      const doc = PdfDocument.load(await shell.fs.readFile("/" + name));
      assert.equal(doc.getPageCount(), expected.pages);
      const report = await shell.exec(`qpdf ${name} --json --json-key=pagelabels`);
      assert.deepEqual([report.exitCode, report.stderr], [0, ""]);
      assert.deepEqual(JSON.parse(report.stdout).pagelabels, expected.labels);
    }
  } finally {await shell.dispose();}
});
