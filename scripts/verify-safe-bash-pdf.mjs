import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Run against the installed tarball, with its real exports and sideEffects.
export async function verifySafeBashPdf(consumer) {
  consumer = path.resolve(consumer);
  for (const [name, budget] of [["cosNull", 512], ["formatExtractedPageText", 4096]]) {
    const result = await build({
      absWorkingDir: consumer,
      stdin: { contents: `export { ${name} } from "@poe-platform/safe-bash/pdf-ast";`, resolveDir: consumer },
      bundle: true, minify: true, format: "esm", write: false, metafile: true,
    });
    const code = result.outputFiles[0].text;
    assert.ok(result.outputFiles[0].contents.length < budget, `${name}: exceeds ${budget} bytes`);
    for (const output of Object.values(result.metafile.outputs)) {
      assert.deepEqual(output.imports, [], `${name}: external dependencies`);
      for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
        assert.ok(!bytesInOutput || !["/safe-fs/", "/xml-ast/", "/saxes/", "/render/"].some(part => input.includes(part)),
          `${name}: unnecessary dependency ${input}`);
      }
    }
    const api = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
    if (name === "cosNull") {
      assert.deepEqual(api.cosNull(), { kind: "null", span: undefined });
      const span = { start: 3, end: 7 };
      assert.deepEqual(api.cosNull(span), { kind: "null", span });
    } else {
      assert.equal(api.formatExtractedPageText({ blocks: [{ lines: [{ text: "Hello PDF" }] }] }), "Hello PDF");
    }
    console.log(JSON.stringify({ profile: name, bytes: result.outputFiles[0].contents.length }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], "Usage: node scripts/verify-safe-bash-pdf.mjs <installed-consumer-directory>");
  await verifySafeBashPdf(process.argv[2]);
}
