import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { saveFixture } from "../tests/fixtures/save-output.js";
import { nativePartSourceCases, nativePartSourceParts } from "../tests/fixtures/native-part-exact-source.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["document", "template"] as const)
for (const row of [769, 771]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact API witness R${row}; ${kind}; strict=${strict}`, async () => {
  const f = nativePartSourceParts(nativePartSourceCases[3]!, strict, kind);
  if (row === 771) f.parts.set("[Content_Types].xml", new TextEncoder().encode(
    new TextDecoder().decode(f.parts.get("[Content_Types].xml"))
      .replace(`wordprocessingml.${kind}.main+xml`, "spreadsheetml.sheet.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" }), env = saveFixture();
  await api.writeArchive({ comment: new Uint8Array(), members: [...f.parts].map(([name, bytes]) =>
    ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
  { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), path = row === 769 ? "/work/foobar.docx" : "/work/foobar.xlsx";
  env.volume.writeFileSync(path, input);
  const context = { ...textContext, binaryResolver: { ...env.vfs, capability: "source" } };
  const observe = (data: api.InspectionData) => {
    expect(data.kind).toBe(kind === "document" ? "docx" : "dotx");
    expect(data.dialect).toBe(strict ? "strict" : "transitional");
    expect(data.counts.paragraphs).toBe(1); expect(data.counts.runs).toBe(1);
    expect(data.parts.map(part => part.name)).toContain("/audit/retained.bin");
  };
  if (route === "model") {
    const pending = api.Document({ path, capability: "source" }, context); expect(pending).toBeInstanceOf(Promise);
    if (row === 771) await expect(pending).rejects.toMatchObject({ code: "unsupported-profile" });
    else {
      const doc = await pending; expect(doc).toBeInstanceOf(api.DocumentView);
      expect(doc.part.document.equals(doc)).toBe(true);
      expect(doc.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊");
      await doc.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
      const saved = readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer)); assertPackageLinks(saved);
      for (const [name, bytes] of f.parts) expect(saved.get(name), name).toEqual(bytes);
    }
  } else if (route === "sdk") {
    const pending = api.inspectDocument(new Uint8Array(env.volume.readFileSync(path) as Buffer), context);
    expect(pending).toBeInstanceOf(Promise);
    if (row === 771) await expect(pending).rejects.toMatchObject({ code: "unsupported-profile" });
    else observe(await pending);
  } else {
    const fs = new MemoryFileSystem(); await fs.mkdir("/work"); await fs.writeFile(path, input);
    await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const r = await shell.exec(`docx inspect ${path} --json`), envelope = JSON.parse(r.stdout);
      expect(r.exitCode, r.stdout + r.stderr).toBe(row === 771 ? 1 : 0);
      expect(envelope.affected).toBe(0);
      if (row === 771) { expect(envelope.ok).toBe(false); expect(envelope.errors).toMatchObject([{ code: "unsupported-profile" }]); }
      else observe(envelope.data);
      expect(await fs.readFile(path)).toEqual(input);
      expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
    } finally { await shell.dispose(); }
  }
  expect(env.volume.readFileSync(path)).toEqual(Buffer.from(input));
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  if (row === 771 || route !== "model") expect(volume.readFileSync("/out")).toHaveLength(0);
});

for (const kind of ["docx", "dotx"] as const) for (const dialect of ["transitional", "strict"] as const)
for (const route of ["model", "sdk", "shell"] as const) {
  // The no-input model factory exposes only its default kind/dialect. Explicit
  // creation options belong to the declared SDK/CLI create operation.
  if (route === "model" && (kind !== "docx" || dialect !== "transitional")) continue;
  it(`${route} independently executes exact API witness R770; ${kind}; dialect=${dialect}`, async () => {
    const volume = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    if (route === "model") {
      const pending = api.Document(undefined, textContext); expect(pending).toBeInstanceOf(Promise);
      const doc = await pending; expect(doc).toBeInstanceOf(api.DocumentView); await doc.save(sink);
    } else if (route === "sdk") await api.createDocument({ kind, dialect }, { output: "-" },
      { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
    else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/default-document.docx", new TextEncoder().encode("Original source witness must never be acquired"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const r = await shell.exec(`docx create --kind ${kind} --dialect ${dialect} --output /out --json`);
        expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(JSON.parse(r.stdout).ok).toBe(true);
        volume.writeFileSync("/out", await fs.readFile("/out"));
        expect(new TextDecoder().decode(await fs.readFile("/default-document.docx"))).toBe("Original source witness must never be acquired");
      } finally { await shell.dispose(); }
    }
    const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer), parts = readPackage(bytes); assertPackageLinks(parts);
    const doc = await api.Document(bytes, textContext); expect(doc.paragraphs.length).toBe(1);
    expect(doc.paragraphs[0]!.text).toBe(""); expect(doc.styles.at("Normal").name).toBe("Normal");
    expect(doc.part.content_type).toBe(`application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml`);
    expect(doc.part.element.namespace).toBe(dialect === "strict" ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main");
    const section = doc.sections.at(0); expect(section.page_width!.emu).toBe(api.Inches(8.5).emu);
    expect(section.page_height!.emu).toBe(api.Inches(11).emu); expect(section.left_margin!.emu).toBe(api.Inches(1).emu);
    expect(section.right_margin!.emu).toBe(api.Inches(1).emu);
    expect([...parts.keys()].some(name => name.includes("default-document"))).toBe(false);
    const xml = [...parts.values()].map(value => new TextDecoder().decode(value)).join("");
    expect(xml).not.toContain("dcterms:created"); expect(xml).not.toContain("dcterms:modified");
  });
}
