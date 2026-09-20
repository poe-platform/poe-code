import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { styleDeclarationFixture } from "../tests/fixtures/style-declarations.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const variant of ["unknown-type", "duplicate-id", "valid"] as const) for (const route of ["save", "publish"] as const)
    it(`${route} distinguishes stored ${variant} style graph from caller usage; ${kind}; strict=${strict}`, async () => {
      const base = await styleDeclarationFixture(strict, kind, "single"), parts = readPackage(base.input);
      const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const style = `<w:style w:type="${variant === "unknown-type" ? "ORIGINAL_UNKNOWN" : "paragraph"}" w:styleId="Original"><w:name w:val="Original"/><w:rPr><w:i/></w:rPr></w:style>`;
      parts.set("word/styles.xml", new TextEncoder().encode(`<w:styles xmlns:w="${w}">${style}${variant === "duplicate-id" ? '<w:style w:type="character" w:styleId="Original"><w:name w:val="Other"/></w:style>' : ""}<!--retain--><?policy keep?></w:styles>`));
      const memory = Volume.fromJSON({ "/input": "", "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
      await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
      const input = new Uint8Array(memory.readFileSync("/input") as Buffer), model = await api.openDocumentStyleModel(input, textContext);
      const action = () => route === "save" ? model.save(sink) : model.publish({ output: "-" }, { ...textContext, stdout: sink, encoding: { order: "input", compression: "store" } });
      if (variant !== "valid") {
        let error: unknown;
        try { await action(); } catch (caught) { error = caught; }
        expect(error).toBeInstanceOf(api.SemanticValidationError);
        expect(error).toHaveProperty("code", "invalid-package");
        expect(memory.readFileSync("/out")).toHaveLength(0);
      } else {
        await action();
        expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(parts);
      }
      expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
    });
