import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const metadata = [
  ["thread", "commentsExtended", "http://schemas.microsoft.com/office/word/2012/wordml", "commentsEx", "http://schemas.microsoft.com/office/2011/relationships/commentsExtended", '<m:commentEx m:paraId="000000A1" m:done="1"/><m:commentEx m:paraId="000000B2" m:paraIdParent="000000A1" m:done="0"/>'],
  ["ids", "commentsIds", "http://schemas.microsoft.com/office/word/2016/wordml/cid", "commentsIds", "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds", '<m:commentId m:paraId="000000A1" m:durableId="00000011"/><m:commentId m:paraId="000000B2" m:durableId="00000022"/>'],
  ["extra", "commentsExtensible", "http://schemas.microsoft.com/office/word/2018/wordml/cex", "commentsExtensible", "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible", '<m:commentExtensible m:durableId="00000011" m:dateUtc="2026-01-02T03:04:05Z"/><m:commentExtensible m:durableId="00000022"/>'],
  ["authors", "people", "http://schemas.microsoft.com/office/word/2012/wordml", "people", "http://schemas.microsoft.com/office/2011/relationships/people", '<m:person m:author="Mira"><m:presenceInfo m:providerId="None" m:userId="Mira"/></m:person>']
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const runtime of ["source", "native"] as const) for (const route of ["sdk", "cli"] as const)
for (const action of ["set-reply", "remove-reply", "remove-parent"] as const)
it(`verified modern utility synchronization remains supported; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}; action=${action}`, async () => {
  const product: typeof api = runtime === "native" ? native as unknown as typeof api : api;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const initial = await textFixture('<w:p><w:r><w:t>Retained outside</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}" xmlns:p="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="4" w:author="Mira"><w:p p:paraId="000000A1"><w:r><w:t>Parent</w:t></w:r></w:p></w:comment><w:comment w:id="9" w:author="Mira"><w:p p:paraId="000000B2"><w:r><w:t>Reply</w:t></w:r></w:p></w:comment><!--retain--><?audit exact?></w:comments>` },
    ...Object.fromEntries(metadata.map(([name, type, namespace, root, , contents]) => [name, { kind: type, xml: `<m:${root} xmlns:m="${namespace}">${contents}</m:${root}>` }]))
  }, strict, { kind });
  const parts = readPackage(initial), editor = new product.DocumentXmlEditor(parts.get("word/_rels/document.xml.rels")!);
  for (const [name, , , , relationship] of metadata) editor.setAttribute(editor.root.children.find(node => node.attributes.some(a => a.localName === "Id" && a.value === name))!, "Type", relationship);
  parts.set("word/_rels/document.xml.rels", editor.serialize());
  if (codec !== "utf8") for (const [name, bytes] of parts) {
    const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
    if (codec === "utf16be") encoded.swap16();
    parts.set(name, new Uint8Array(encoded));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "", "/model": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const model = await product.Document(input, context);
  expect(model.comments.get(4)!.text).toBe("Parent"); expect(model.comments.get(9)!.text).toBe("Reply");
  await model.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/model", bytes); } });
  expect(new Uint8Array(memory.readFileSync("/model") as Buffer)).toEqual(original);
  const rejected = action === "remove-parent";
  let output: Uint8Array | undefined;
  if (route === "sdk") {
    const request: api.CommentEditRequest = action === "set-reply" ? { operation: "comments.set", options: { comment: 2, text: "Updated 海🌊", output: "-" } } : { operation: "comments.remove", options: { comment: rejected ? 1 : 2, output: "-" } };
    const pending = product.editDocumentComments(input, request, { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } });
    if (rejected) { await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.statSync("/output").size).toBe(0); }
    else { expect((await pending).changed).toBe(true); output = new Uint8Array(memory.readFileSync("/output") as Buffer); }
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/output", destination);
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec(`docx comments ${action === "set-reply" ? "set" : "remove"} /input --comment ${rejected ? 1 : 2}${action === "set-reply" ? ' --text "Updated 海🌊"' : ""} --output /output --force --json`);
      expect(response.exitCode, response.stdout + response.stderr).toBe(rejected ? 1 : 0);
      if (rejected) { expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/output")).toEqual(destination); }
      else { expect(JSON.parse(response.stdout).ok).toBe(true); output = await fs.readFile("/output"); }
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original);
  if (output) {
    const saved = readPackage(output), dirty = new Set(action === "set-reply" ? ["word/comments.xml"] : ["word/comments.xml", "word/thread.xml", "word/ids.xml", "word/extra.xml"]);
    expect([...saved.keys()]).toEqual([...parts.keys()]);
    for (const [name, bytes] of parts) if (!dirty.has(name)) expect(saved.get(name), name).toEqual(bytes);
    const reopened = await product.Document(output, context);
    expect(reopened.comments.get(4)!.text).toBe("Parent");
    if (action === "set-reply") expect(reopened.comments.get(9)!.text).toBe("Updated 海🌊");
    else {
      expect(reopened.comments.get(9)).toBeNull();
      for (const name of ["thread", "ids", "extra"]) {
        const metadataEditor = new product.DocumentXmlEditor(saved.get(`word/${name}.xml`)!);
        expect(metadataEditor.root.children).toHaveLength(1);
        expect(metadataEditor.root.children[0]!.attributes.some(a => a.value === (name === "extra" ? "00000011" : "000000A1"))).toBe(true);
      }
    }
  }
});
