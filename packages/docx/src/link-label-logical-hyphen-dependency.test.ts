import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const scope of ["body", "headers", "footers", "comments", "footnotes", "endnotes"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const leaf of ["noBreakHyphen", "softHyphen"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} logical link ${leaf} agrees with story text; scope=${scope}; carrier=${carrier}; ${kind}; strict=${strict}`, async () => {
  const inert = '<f:shadow f:keep="original"><w:t>INERT</w:t></f:shadow>', active = `<w:t>é日本עברית🌊</w:t><w:${leaf}/><w:ptab/><w:t>tail</w:t><w:lastRenderedPageBreak/>`;
  const wrapped = carrier === "direct" ? active + inert : carrier === "process" ? `<f:pass>${active}${inert}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inert}</mc:Fallback></mc:AlternateContent>`;
  const p = `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:link-hyphen" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:hyperlink w:anchor="local" w:history="1"><w:r><w:rPr><w:rtl/></w:rPr>${wrapped}</w:r></w:hyperlink><!--retained--><?policy keep?></w:p>`;
  const storyKind = scope === "headers" ? "header" : scope === "footers" ? "footer" : scope;
  const root = scope === "headers" ? "hdr" : scope === "footers" ? "ftr" : scope;
  const contents = scope === "comments" ? `<w:comment w:id="7">${p}</w:comment>` : scope === "footnotes" ? `<w:footnote w:id="7">${p}</w:footnote>` : scope === "endnotes" ? `<w:endnote w:id="7">${p}</w:endnote>` : p;
  const parts = readPackage(await textFixture(scope === "body" ? p : scope === "headers" || scope === "footers" ? `<w:p/><w:sectPr xmlns:r="${r}"><w:${scope === "headers" ? "header" : "footer"}Reference w:type="default" r:id="owned"/></w:sectPr>` : "<w:p/>", scope === "body" ? {} : { owned: { kind: storyKind, xml: `<w:${root} xmlns:w="${w}">${contents}</w:${root}>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const v = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), expected = `é日本עברית🌊${leaf === "noBreakHyphen" ? "\u2011" : "\u00ad"}\ttail`;
  expect((await api.extractDocumentText(input, textContext, { scope })).text).toBe(expected);
  let items: api.LinkListData["items"];
  if (route === "sdk") items = (await api.inspectDocumentLinks(input, { scope }, textContext)).items;
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx links list /input --scope ${scope} --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); expect(envelope.affected).toBe(0); expect(envelope.errors).toEqual([]); items = envelope.data.items; expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("retained destination"); }
    finally { await shell.dispose(); }
  }
  expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ text: expected, contains_page_break: true, address: "", fragment: "local", url: "", history: true });
  expect(v.readFileSync("/input")).toEqual(Buffer.from(input)); assertPackageLinks(readPackage(input));
});
