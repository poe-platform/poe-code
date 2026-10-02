import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const raw of ["-7", " &#x9;-007&#xA; "])
for (const route of ["model", "model-sdk", "model-cli", "sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`rejects native comment IDs outside the declared public domain without rewriting them; strict=${strict}; kind=${kind}; raw=${raw}; route=${route}`, async () => {
  const input = await textFixture(`<w:p><w:commentRangeStart w:id="${raw}"/><w:r><w:t>Range</w:t></w:r><w:commentRangeEnd w:id="-0007"/><w:r><w:commentReference w:id="-7"/></w:r></w:p>`, { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="${raw}" w:author="Archive"><w:p><w:r><w:t>Signed note</w:t></w:r></w:p></w:comment></w:comments>` } }, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, ref = (resultHandle: string) => ({ resultHandle });
  const operations = [{ operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" }, { operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId: -7 }, resultHandle: "note" }, { operation: "model.comments.Comment.comment_id.get", receiver: ref("note"), arguments: {} }], batch = { version: 1 as const, operations: [{ operation: "comments.get", arguments: { comment: 1 } }] };
  const native = readPackage(input).get("word/comments.xml")!;
  expect(await api.getDocumentXml(input, context, { part: "/word/comments.xml", raw: true })).toEqual(native);
  if (route === "model") await expect((async () => { const doc = await api.Document(input, context); return doc.comments.get(-7); })()).rejects.toMatchObject({ code: "invalid-package" });
  else if (route === "model-sdk") await expect(api.applyStyleModelBatch(input, { version: 1, operations }, context)).rejects.toMatchObject({ code: "invalid-package", operationIndex: 0 });
  else if (route === "sdk") await expect(api.inspectDocumentComments(input, { operation: "comments.get", options: { comment: 1 } }, context)).rejects.toMatchObject({ code: "invalid-package" });
  else if (route === "sdk-batch") await expect(api.executeDocumentBatch(input, batch, { dryRun: true }, context)).rejects.toMatchObject({ code: "invalid-package", operationIndex: 0 });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained destination")); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const response = await shell.exec((route === "cli" ? "docx comments get /input --comment 1" : `docx batch /input --ops-json '${JSON.stringify(route === "model-cli" ? { version: 1, operations } : batch)}' --dry-run`) + " --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(1); const envelope = JSON.parse(response.stdout); expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [expect.objectContaining({ code: "invalid-package" })] });
      const rawResult = await shell.exec("docx xml get /input --part /word/comments.xml --raw > /native"); expect(rawResult.exitCode, rawResult.stderr).toBe(0); expect(await fs.readFile("/native")).toEqual(native);
      expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retained destination"); } finally { await shell.dispose(); }
  }
  expect(memory.statSync("/output").size).toBe(0);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
