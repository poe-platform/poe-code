import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { PdfDocument, cosArray, cosString, serializeCosDocument } from "@poe-code/pdf-ast";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const fixture = readFileSync(new URL("../../pdf-ast/src/fixtures/qpdf-shared-images.pdf", import.meta.url));
const doc = PdfDocument.create();
doc.addPage();
const objects = [...doc.cos.objects.values()];
const identified = serializeCosDocument({ objects, rootRef: doc.cos.rootRef, idArray: cosArray([cosString("first"), cosString("second")]) });
const unidentified = serializeCosDocument({ objects, rootRef: doc.cos.rootRef });

for (const [name, bytes, ids] of [
  ["shared images", fixture, ["b:31415926535897932384626433832795", "b:8ac11ee4c57d8296385005b618cd2698"]],
  ["literal IDs", identified, ["b:6669727374", "b:7365636f6e64"]],
  ["no ID", unidentified, undefined]
] as const) {
  it(`preserves trailer IDs in JSON for ${name}`, async () => {
    const input = PdfDocument.load(bytes);
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      for (const selection of [[], ["--json-object=trailer"]]) {
        const result = await run(["--json=2", "--json-key=qpdf", ...selection, "in.pdf"], new Map([["in.pdf", bytes]]));
        assert.equal(result.exitCode, 0, result.stderr);
        const trailer = JSON.parse(result.stdout).qpdf[1].trailer.value;
        assert.deepEqual(trailer["/ID"], ids);
        assert.equal(trailer["/Root"], `${input.cos.rootRef.objectNumber} ${input.cos.rootRef.generationNumber} R`);
        assert.equal(trailer["/Size"], input.cos.maxObjectNumber + 1);
      }
    }
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.pdf", bytes);
    const args = ["--json=2", "--json-key=qpdf", "--json-object=trailer", "in.pdf"];
    const carrier = createCommandArguments(args);
    const stdout: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({
      command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: (async function* () { yield assert.fail("unexpected stdin read"); })(),
      stdout: { async write(chunk: Uint8Array) { stdout.push(chunk.slice()); } },
      stderr: { async write(chunk: Uint8Array) { assert.fail(new TextDecoder().decode(chunk)); } }
    });
    const expected = await runQpdfCli(args, new Map([["in.pdf", bytes]]));
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.concat(stdout).toString(), expected.stdout);
  });
}
