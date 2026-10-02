import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { w, textContext, textFixture } from "../tests/fixtures/text.js";

const cases = [
 { label: "missing exact name", args: { linkedStyle: "missing" }, code: "missing-selection" },
 { label: "ID is not a name", args: { linkedStyle: "c0" }, code: "missing-selection" },
 { label: "custom names are exact", args: { linkedStyle: " first character " }, code: "missing-selection" },
 { label: "same-type link", args: { linkedStyle: "Base" }, code: "usage" },
 { label: "self link", args: { linkedStyle: "Harbor" }, code: "usage" },
 { label: "null default", args: { defaultForType: null }, code: "usage" },
 { label: "numeric link", args: { linkedStyle: 7 }, code: "usage" },
 { label: "extra field", args: { linkedStyle: null, alternate: true }, code: "usage" },
 { label: "ambiguous native target", args: { linkedStyle: "First character" }, code: "ambiguous-selection", extra: '<w:style w:type="character" w:styleId="other"><w:name w:val="First character"/></w:style>' },
 { label: "duplicate native link", args: { linkedStyle: null }, code: "unsupported-edit", inner: '<w:link w:val="c0"/>' }
] as const;
for (const strict of [false, true]) for (const route of ["model", "sdk", "shell"] as const) for (const value of cases)
 it(`${route} rejects advanced style ${value.label} without publication; strict=${strict}`, async () => {
  const xml = `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="p0"><w:name w:val="Harbor"/><w:link w:val="c0"/>${"inner" in value ? value.inner : ""}</w:style><w:style w:type="paragraph" w:styleId="p1"><w:name w:val="Base"/></w:style><w:style w:type="character" w:styleId="c0"><w:name w:val="First character"/><w:link w:val="p0"/></w:style>${"extra" in value ? value.extra : ""}</w:styles>`;
  const input = await textFixture('<w:p><w:r><w:t>Original</w:t></w:r></w:p>', { styles: { kind: "styles", xml } }, strict), memory = Volume.fromJSON({ "/out": "" });
  const operations = [{ operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" }, { operation: "model.styles.styles.Styles.__getitem__.call", receiver: { resultHandle: "styles" }, arguments: { key: "Harbor" }, resultHandle: "style" }, { operation: "styles.links.set", receiver: { resultHandle: "style" }, arguments: value.args }], batch = { version: 1, operations };
  if (route === "model") await expect(api.applyStyleModelBatch(input, batch, textContext)).rejects.toMatchObject({ code: value.code });
  else if (route === "sdk") await expect(api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: value.code });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(value.code === "usage" ? 2 : 1); expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/out")).toHaveLength(0); } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/out")).toHaveLength(0);
 });
