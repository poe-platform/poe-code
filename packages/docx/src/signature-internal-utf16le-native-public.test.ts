import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const { Document, createDocxInspectionCommandEngine, inspectDocument, inspectDocumentSignatures, writeArchive } = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textFixture, textContext as fixtureContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const textContext = { limits: fixtureContext.limits, signal: fixtureContext.signal };
const enc = (value: string) => new TextEncoder().encode(value);
const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const sig = "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"])
for (const owner of ["root", "document"]) for (const codec of ["utf16le"])
for (const carrier of ["direct", "choice", "fallback", "process", "inactive"])
for (const media of ["native", "native-parameter", "generic", "lookalike"])
for (const route of ["model", "sdk", "shell"])
it(`native ${route} independently inventories ${media} signature in ${owner}/${carrier}/${codec}; ${kind} strict=${strict}`, async () => {
  const encodeXml = (value: string) => new Uint8Array(Buffer.from("\ufeff" + value, "utf16le"));
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict));
  const name = owner === "root" ? "_rels/.rels" : "word/_rels/document.xml.rels";
  const type = media === "lookalike" ? "urn:original:payload" : pr + "/digital-signature/signature";
  const row = `<Relationship Id="seal" Type="${type}" Target="${owner === "root" ? "" : "../"}assets/seal.xml"/>`;
  const wrapped = carrier === "direct" ? row : carrier === "process" ? `<f:pass xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f" mc:ProcessContent="f:pass">${row}</f:pass>` : `<mc:AlternateContent xmlns:mc="${mc}" xmlns:pr="${pr}" xmlns:f="urn:original:future"><mc:Choice Requires="${carrier === "fallback" ? "f" : "pr"}">${carrier === "choice" ? row : ""}</mc:Choice><mc:Fallback>${carrier === "choice" ? "" : row}</mc:Fallback></mc:AlternateContent>`;
  parts.set(name, encodeXml(new TextDecoder().decode(parts.get(name)!).replace("</Relationships>", '<!--retain-->' + wrapped + '<?retain coast?></Relationships>')));
  const mime = media === "native" ? sig.toUpperCase() : media === "native-parameter" ? sig + "; audit=coast" : media === "lookalike" ? "application/xml; audit=digital-signature-xmlsignature+xml" : "application/xml";
  let types = new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("</Types>", `<Override PartName="/assets/seal.xml" ContentType="${mime}"/></Types>`);
  if (kind === "dotx") types = types.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml");
  parts.set("[Content_Types].xml", enc(types));
  parts.set("assets/seal.xml", encodeXml('<s:Signature xmlns:s="http://www.w3.org/2000/09/xmldsig#"><!--inert original record--></s:Signature>'));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const admitted = media !== "native-parameter", activeSignature = media !== "lookalike" && carrier !== "inactive", signed = media === "native" || activeSignature;
  if (route === "model") {
    if (!admitted) await expect(Document(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
    else {
      const doc = await Document(input, textContext), part = doc.part.package.parts.find(part => String(part.partname) === "/assets/seal.xml");
      if (carrier === "inactive") expect(part).toBeUndefined();
      else expect(part!.blob).toEqual(parts.get("assets/seal.xml"));
      const edit = () => { doc.paragraphs[0]!.text = "Revised coast"; };
      if (signed) {
        expect(edit).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
        await expect(doc.save(sink)).rejects.toMatchObject({ code: "unsupported-edit" });
        expect(memory.readFileSync("/output")).toHaveLength(0);
        expect(doc.paragraphs[0]!.text).toBe("Original coast");
        expect(readPackage(input)).toEqual(parts);
      } else {
        edit(); await doc.save(sink);
        const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
        for (const [part, bytes] of parts) if (part !== "word/document.xml") expect(saved.get(part)).toEqual(bytes);
        expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Revised coast");
      }
    }
  } else if (route === "sdk") {
    if (!admitted) {
      await expect(inspectDocument(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
      await expect(inspectDocumentSignatures(input, {}, textContext)).rejects.toMatchObject({ code: "invalid-package" });
    } else {
      const info = await inspectDocument(input, textContext), list = await inspectDocumentSignatures(input, {}, textContext);
      expect(info.signed).toBe(signed); expect(info.signatures).toEqual({ parts: signed ? ["/assets/seal.xml"] : [], verified: null });
      expect(info.features.find(feature => feature.id === "F43")?.detected).toBe(signed);
      const bytes = parts.get("assets/seal.xml")!, sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, "0")).join("");
      expect(list.verified).toBeNull(); expect(list.items.map(item => ({ name: item.name, details: item.details }))).toEqual(signed ? [{ name: "/assets/seal.xml", details: { kind: "signatures", parts: [{ name: "/assets/seal.xml", contentType: mime, bytes: bytes.length, sha256 }] } }] : []);
      expect(list.relationships).toEqual(activeSignature ? [{ owner: owner === "root" ? "/" : "/word/document.xml", id: "seal", type, target: "/assets/seal.xml", external: false }] : []);
    }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/sentinel", enc("retain"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    for (const command of ["inspect", "signatures list"]) {
      const result = await shell.exec(`docx ${command} /input --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(admitted ? 0 : 1);
      const envelope = JSON.parse(result.stdout);
      if (!admitted) expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] });
      else {
        expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [] });
        if (command === "inspect") expect(envelope.data).toMatchObject({ signed, signatures: { parts: signed ? ["/assets/seal.xml"] : [], verified: null } });
        else { expect(envelope.data.verified).toBeNull(); expect(envelope.data.items.map((item: { name: string }) => item.name)).toEqual(signed ? ["/assets/seal.xml"] : []); expect(envelope.data.relationships).toHaveLength(activeSignature ? 1 : 0); }
      }
    }
    expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/sentinel")).toEqual(enc("retain"));
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
