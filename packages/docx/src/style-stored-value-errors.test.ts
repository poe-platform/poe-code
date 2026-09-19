import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const cases = [
  { name: "defined boolean", markup: '<w:style w:type="paragraph" w:styleId="Atlas"><w:name w:val="Atlas"/><w:semiHidden w:val="perhaps"/></w:style>', read: (styles: api.Styles) => styles.at("Atlas").hidden },
  { name: "defined integer", markup: '<w:style w:type="paragraph" w:styleId="Atlas"><w:name w:val="Atlas"/><w:uiPriority w:val="1.5"/></w:style>', read: (styles: api.Styles) => styles.at("Atlas").priority },
  { name: "unsafe defined integer", markup: '<w:style w:type="paragraph" w:styleId="Atlas"><w:name w:val="Atlas"/><w:uiPriority w:val="9007199254740992"/></w:style>', read: (styles: api.Styles) => styles.at("Atlas").priority },
  { name: "latent default boolean", markup: '<w:latentStyles w:defSemiHidden="perhaps"/>', read: (styles: api.Styles) => styles.latent_styles.default_to_hidden },
  { name: "latent default integer", markup: '<w:latentStyles w:count="1.5"/>', read: (styles: api.Styles) => styles.latent_styles.load_count },
  { name: "latent override boolean", markup: '<w:latentStyles><w:lsdException w:name="Atlas" w:locked="perhaps"/></w:latentStyles>', read: (styles: api.Styles) => styles.latent_styles.at("Atlas").locked }
];

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const scenario of cases) for (const route of ["model", "sdk", "cli"] as const)
it(`reports stored ${scenario.name} with a neutral value error; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const active = scenario.markup, inert = '<w:style w:type="paragraph" w:styleId="Inert"><w:name w:val="Inert"/></w:style>';
  const content = carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inert}</mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:stored-style" mc:Ignorable="f" mc:ProcessContent="f:pass">${content}<!--retain--><?policy keep?></w:styles>` } }, strict));
  const enc = (value: string) => new TextEncoder().encode(value);
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  if (route === "model") {
    const rejection = (async () => {
      const document = await api.Document(input, textContext), before = document.part.blob;
      try { scenario.read(document.styles); } finally { expect(document.part.blob).toEqual(before); }
    })();
    await expect(rejection).rejects.toBeInstanceOf(api.InvalidDocumentError);
    await expect(rejection).rejects.toMatchObject({ code: "invalid-package" });
  } else if (route === "sdk") {
    const rejection = api.inspectDocumentStyles(input, {}, textContext);
    await expect(rejection).rejects.toBeInstanceOf(api.InvalidDocumentError);
    await expect(rejection).rejects.toMatchObject({ code: "invalid-package" });
  }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retain destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx styles list /input --json"), envelope = JSON.parse(result.stdout);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(enc("Retain destination"));
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
  expect(readPackage(input)).toEqual(parts);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const lexical of ["0", "1", "true", "false", "on", "off"])
it(`retains admitted stored style lexical values and inert invalid alternatives; ${lexical}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const expected = ["1", "true", "on"].includes(lexical);
  const active = `<w:latentStyles w:defSemiHidden="${lexical}" w:count="7"><w:lsdException w:name="Atlas" w:locked="${lexical}"/></w:latentStyles><w:style w:type="paragraph" w:styleId="Atlas"><w:name w:val="Atlas"/><w:semiHidden w:val="${lexical}"/><w:uiPriority w:val="7"/></w:style>`;
  const invalid = '<w:latentStyles w:count="1.5" w:defSemiHidden="perhaps"/><w:style w:type="paragraph" w:styleId="Inert"><w:name w:val="Inert"/><w:semiHidden w:val="perhaps"/></w:style>';
  const content = carrier === "direct" ? active + `<f:opaque>${invalid}</f:opaque>` : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${invalid}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : invalid}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : invalid}</mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:stored-style" mc:Ignorable="f" mc:ProcessContent="f:pass">${content}<!--retain--><?policy keep?></w:styles>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), document = await api.Document(input, textContext);
  expect(document.styles.at("Atlas").hidden).toBe(expected); expect(document.styles.at("Atlas").priority).toBe(7);
  expect(document.styles.latent_styles.default_to_hidden).toBe(expected); expect(document.styles.latent_styles.load_count).toBe(7);
  expect(document.styles.latent_styles.at("Atlas").locked).toBe(expected);
  expect((await api.inspectDocumentStyles(input, {}, textContext)).styles[0]).toMatchObject({ hidden: expected, priority: 7 });
  await document.save({ async write(bytes) { volume.appendFileSync("/output", bytes); } });
  expect(readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer))).toEqual(parts);
  expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
});
