import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRustWasmBash } from "./index.js";

const xrefs = JSON.parse(readFileSync(new URL("../../pdf-ast/src/fixtures/qpdf-prefixed-xrefs.json", import.meta.url), "utf8"));

for (const kind of ["table", "stream", "incremental", "unindexed", "linearized"]) {
  test(`uses the header-relative ${kind} xref through native-only Wasm`, async () => {
    const bytes = readFileSync(new URL(`../../pdf-ast/src/fixtures/qpdf-prefixed-${kind}.pdf`, import.meta.url));
    const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
    try {
      for (const prefixed of [false, true]) {
        await bash.fs.writeFile("/in.pdf", prefixed ? bytes : bytes.subarray(14));
        const checked = await bash.exec("qpdf /in.pdf --check");
        assert.equal(checked.exitCode, 0, checked.stderr); assert.equal(checked.stderr, "");
        const pages = await bash.exec("qpdf /in.pdf --show-npages");
        assert.equal(pages.exitCode, 0, pages.stderr); assert.equal(pages.stdout, "1\n");
        const xref = await bash.exec("qpdf /in.pdf --show-xref");
        assert.equal(xref.exitCode, 0, xref.stderr); assert.equal(xref.stdout, xrefs[kind]);
        const info = await bash.exec("pdfinfo /in.pdf");
        assert.equal(info.exitCode, 0, info.stderr);
        assert.match(info.stdout, kind === "incremental" ? /Page size:\s+222 x 333 pts/ : /Page size:\s+10 x 20 pts/);
      }
    } finally { await bash.dispose(); }
  });
}
