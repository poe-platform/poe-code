import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosString, dictSet } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

function outlineFixture(mode = "direct") {
  const doc = PdfDocument.create(), first = doc.addPage(), second = doc.addPage();
  const root = doc.cos.resolveDict(doc.cos.rootRef)!;
  const outlines = cosDict({ Type: cosName("Outlines") }), outlinesRef = doc.cos.allocateObject(outlines);
  const chapter = cosDict({ Title: cosString("Chapter"), Parent: outlinesRef, Count: cosNumber(1), Dest: cosArray([first.ref, cosName("Fit")]) });
  if (mode === "name") {
    dictSet(root, "Dests", cosDict({ chapter: cosArray([first.ref, cosName("Fit")]) }));
    dictSet(chapter, "Dest", cosName("chapter"));
  }
  if (mode === "name-tree") {
    dictSet(root, "Names", cosDict({ Dests: cosDict({ Kids: cosArray([doc.cos.allocateObject(cosDict({ Limits: cosArray([cosString("chapter"), cosString("chapter")]), Names: cosArray([cosString("chapter"), cosDict({ D: cosArray([first.ref, cosName("Fit")]) })]) }))]) }) }));
    dictSet(chapter, "Dest", cosString("chapter"));
  }
  const chapterRef = doc.cos.allocateObject(chapter);
  const section = cosDict({ Title: cosString("Section"), Parent: chapterRef, A: cosDict({ S: cosName("GoTo"), D: cosArray([second.ref, cosName("Fit")]) }) });
  const sectionRef = doc.cos.allocateObject(section);
  const sibling = cosDict({ Title: cosString(""), Parent: outlinesRef, Count: cosNumber(-1) });
  const siblingRef = doc.cos.allocateObject(sibling);
  dictSet(chapter, "First", sectionRef); dictSet(chapter, "Last", sectionRef); dictSet(chapter, "Next", siblingRef);
  dictSet(outlines, "First", chapterRef); dictSet(outlines, "Last", siblingRef); dictSet(root, "Outlines", outlinesRef);
  const ref = (node: { objectNumber: number; generationNumber: number }) => `${node.objectNumber} ${node.generationNumber} R`;
  // Parsed output verified against native qpdf 12.4.2 for JSON versions 1 and 2.
  return { bytes: doc.save(), expected: [
    { title: "Chapter", object: ref(chapterRef), dest: [ref(first.ref), "/Fit"], destpageposfrom1: 1, open: true, kids: [
      { title: "Section", object: ref(sectionRef), dest: [ref(second.ref), "/Fit"], destpageposfrom1: 2, open: true, kids: [] }
    ] },
    { title: "", object: ref(siblingRef), dest: null, destpageposfrom1: null, open: false, kids: [] }
  ] };
}

for (const mode of ["direct", "name", "name-tree"]) for (const version of [1, 2]) for (const selected of [false, true]) it(`preserves native outline hierarchy and fields in JSON ${version} (${mode}, selected=${selected})`, async () => {
  const { bytes, expected } = outlineFixture(mode);
  const args = [`--json=${version}`, ...(selected ? ["--json-key=outlines"] : []), "in.pdf"];
  for (const run of [runQpdfCli, runQpdfCliSync]) {
    const result = await run(args, new Map([["in.pdf", bytes]]));
    assert.equal(result.exitCode, 0); assert.deepEqual(JSON.parse(result.stdout).outlines, expected);
  }
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", bytes);
  const stdout: Uint8Array[] = [];
  const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write() {} } });
  assert.equal(result.exitCode, 0); assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString()).outlines, expected);
});
