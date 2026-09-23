import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext } from "../tests/fixtures/text.js";

const fields = ["paragraph", "character", "table", "majorFont", "minorFont"] as const;
for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const) for (const field of fields) for (const control of ["\t", "\n", "\r", "\u007f", "\u0085"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} rejects control U+${control.codePointAt(0)!.toString(16)} in ${field} creation font; ${kind} ${dialect}`, async () => {
  const font = `Original${control}Font`, content = { version: 1, blocks: [], ...(field === "majorFont" || field === "minorFont" ? { theme: { name: "Original", majorFont: "Original Major", minorFont: "Original Minor", [field]: font } } : { styles: [{ name: "Original Style", type: field, font }] }) };
  const memory = Volume.fromJSON({ "/existing": "Retain existing output", "/stdout": "" }), sink = { async write(b: Uint8Array) { memory.appendFileSync("/stdout", b); } };
  if (route === "sdk") await expect(api.createDocument({ dialect, kind, content: content as api.DocxContent }, { output: "-" }, { ...textContext, encoding: { order: "name", compression: "store" }, stdout: sink })).rejects.toMatchObject({ code: "usage" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/existing", new TextEncoder().encode("Retain existing output"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx create --kind ${kind} --dialect ${dialect} --content-json '${JSON.stringify(content)}' --output - > /stdout`); expect(result.exitCode, result.stdout + result.stderr).toBe(2); expect(result.stderr).toContain("Invalid content"); expect(result.stdout).toBe(""); memory.writeFileSync("/stdout", await fs.readFile("/stdout")); expect(new TextDecoder().decode(await fs.readFile("/existing"))).toBe("Retain existing output"); } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/stdout").length).toBe(0); expect(memory.readFileSync("/existing", "utf8")).toBe("Retain existing output");
});

for (const strict of [false, true]) for (const control of ["\u007f", "\u0085"])
it(`live model rejects font control U+${control.codePointAt(0)!.toString(16)} without changing owner; strict=${strict}`, async () => {
  const { textFixture } = await import("../tests/fixtures/text.js");
  const input = await textFixture('<w:p><w:r><w:rPr><w:b/><w:rFonts w:ascii="Original" w:hAnsi="Original"/></w:rPr><w:t>日本 é 🌊 עברית</w:t></w:r></w:p>', {}, strict), doc = await api.Document(input, textContext);
  expect(() => { doc.paragraphs[0]!.runs[0]!.font.name = `Original${control}Font`; }).toThrowError(expect.objectContaining({ code: "usage" }));
  expect(doc.paragraphs[0]!.runs[0]!.font.name).toBe("Original"); expect(doc.paragraphs[0]!.runs[0]!.bold).toBe(true);
  const volume = Volume.fromJSON({ "/saved": "" }); await doc.save({ async write(b) { volume.appendFileSync("/saved", b); } });
  const { readPackage } = await import("../tests/assertions.js"); expect(readPackage(new Uint8Array(volume.readFileSync("/saved") as Buffer))).toEqual(readPackage(input));
});

for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const) for (const field of fields) for (const font of ["", "日本 é עברית 🌊 Serif"]) for (const route of ["sdk", "shell"] as const)
it(`${route} ${font ? "retains logical Unicode" : "rejects empty"} ${field} creation font; ${kind} ${dialect}`, async () => {
  const content = { version: 1, blocks: [], ...(field === "majorFont" || field === "minorFont" ? { theme: { name: "Original", majorFont: "Original Major", minorFont: "Original Minor", [field]: font } } : { styles: [{ name: "Original Style", type: field, font }] }) } as api.DocxContent;
  const volume = Volume.fromJSON({ "/out": "" }), sink = { async write(b: Uint8Array) { volume.appendFileSync("/out", b); } };
  if (route === "sdk") {
    const run = () => api.createDocument({ dialect, kind, content }, { output: "-" }, { ...textContext, encoding: { order: "name", compression: "store" }, stdout: sink });
    if (font) await run(); else await expect(run()).rejects.toMatchObject({ code: "usage" });
  } else {
    const fs = new MemoryFileSystem(), shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx create --kind ${kind} --dialect ${dialect} --content-json '${JSON.stringify(content)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(font ? 0 : 2); volume.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  if (!font) { expect(output.length).toBe(0); return; }
  const doc = await api.Document(output, textContext);
  if (field === "majorFont" || field === "minorFont") {
    const theme = (await api.inspectDocument(output, textContext)).fontResources.themes[0]!;
    expect(theme.fonts).toContainEqual({ family: field === "majorFont" ? "major" : "minor", slot: "latin", script: null, typeface: font });
  } else {
    const style = doc.styles.at("Original Style"); expect(style).toBeInstanceOf(api.CharacterStyle);
    if (!(style instanceof api.CharacterStyle)) throw new Error("Expected a font-owning style.");
    expect(style.font.name).toBe(font);
  }
  volume.writeFileSync("/saved", ""); await doc.save({ async write(b) { volume.appendFileSync("/saved", b); } });
  const { readPackage, assertPackageLinks } = await import("../tests/assertions.js"); const parts = readPackage(output); assertPackageLinks(parts); expect(readPackage(new Uint8Array(volume.readFileSync("/saved") as Buffer))).toEqual(parts);
});

it("rejects every Unicode Cc value in each typed creation font field before producing output", async () => {
  for (const field of fields) for (const code of [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 33 }, (_, i) => i + 127)]) {
    const font = `Original${String.fromCodePoint(code)}Font`, content = { version: 1, blocks: [], ...(field === "majorFont" || field === "minorFont" ? { theme: { name: "Original", majorFont: "Original Major", minorFont: "Original Minor", [field]: font } } : { styles: [{ name: "Original Style", type: field, font }] }) } as api.DocxContent;
    await expect(api.createDocumentArchive({ content }, textContext), `${field} U+${code.toString(16)}`).rejects.toMatchObject({ code: "usage" });
  }
});
