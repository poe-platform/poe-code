import { expect, it } from "vitest";
import * as api from "./index.js";
import { styleDeclarationFixture } from "../tests/fixtures/style-declarations.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const variant of ["duplicate-same", "duplicate-distinct"] as const)
    for (const route of ["document", "document-part", "paragraph", "run", "table", "heading", "style-model"] as const)
      it(`rejects ambiguous styles at ${route} before choosing or creating definitions; ${variant}; ${kind}; strict=${strict}`, async () => {
        const { input, memory, members } = await styleDeclarationFixture(strict, kind, variant);
        await expect(api.inspectDocumentStyles(input, {}, textContext)).rejects.toBeInstanceOf(api.UnsupportedEditError);
        if (route === "style-model") await expect(api.openDocumentStyleModel(input, textContext)).rejects.toMatchObject({ code: "unsupported-edit" });
        else {
          const doc = await api.Document(input, textContext), before = doc.part.blob;
          const run = () => route === "document" ? doc.styles : route === "document-part" ? doc.part.styles : route === "paragraph" ? doc.paragraphs[0]!.style : route === "run" ? doc.paragraphs[0]!.runs[0]!.style : route === "table" ? doc.tables[0]!.style : doc.add_heading("Do not insert", 1);
          expect(run).toThrow(api.UnsupportedEditError);
          expect(doc.part.blob).toEqual(before);
          expect(doc.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊");
          doc.paragraphs[0]!.runs[0]!.bold = true;
          await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
          const after = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer));
          expect([...after.keys()]).toEqual([...members.keys()]);
          for (const [part, bytes] of members) if (part !== "word/document.xml") expect(after.get(part)).toEqual(bytes);
          expect((await api.Document(new Uint8Array(memory.readFileSync("/out") as Buffer), textContext)).paragraphs[0]!.runs[0]!.bold).toBe(true);
        }
        expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
      });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const route of ["document", "paragraph", "table"] as const)
    it(`rejects styles made ambiguous after native binding; ${route}; ${kind}; strict=${strict}`, async () => {
      const { input, memory } = await styleDeclarationFixture(strict, kind, "single");
      const doc = await api.Document(input, textContext), styles = doc.styles;
      const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
      doc.part.rels.add_relationship(`${r}/styles`, styles.part, "new-duplicate");
      const before = doc.part.blob, beforeStyles = styles.part.blob;
      expect(() => route === "document" ? doc.styles : route === "paragraph" ? doc.paragraphs[0]!.style : doc.tables[0]!.style).toThrow(api.UnsupportedEditError);
      expect(doc.part.blob).toEqual(before);
      expect(styles.part.blob).toEqual(beforeStyles);
      expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
    });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const route of ["document", "style-model"] as const)
    it(`retains earlier external styles admission rejection; ${route}; ${kind}; strict=${strict}`, async () => {
      const { input, memory } = await styleDeclarationFixture(strict, kind, "external");
      await expect(route === "document" ? api.Document(input, textContext) : api.openDocumentStyleModel(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
      expect(memory.readFileSync("/out").length).toBe(0);
      expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
    });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const variant of ["single", "absent"] as const)
    it(`retains valid or absent style declaration behavior; ${variant}; ${kind}; strict=${strict}`, async () => {
      const { input, memory } = await styleDeclarationFixture(strict, kind, variant);
      const doc = await api.Document(input, textContext);
      expect(doc.styles.default(api.WD_STYLE_TYPE.PARAGRAPH)!.name).toBe(variant === "single" ? "Original" : "Normal");
      const model = await api.openDocumentStyleModel(input, textContext);
      expect(model.styles.length).toBe(variant === "single" ? 3 : 0);
      await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
      expect((await api.Document(new Uint8Array(memory.readFileSync("/out") as Buffer), textContext)).styles.default(api.WD_STYLE_TYPE.PARAGRAPH)!.name).toBe(variant === "single" ? "Original" : "Normal");
      expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
    });
