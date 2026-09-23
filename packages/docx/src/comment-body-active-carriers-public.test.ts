import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process-content"] as const)
for (const route of ["model", "model-sdk", "model-cli", "sdk", "sdk-batch", "cli", "cli-batch"] as const)
for (const action of route.startsWith("model") ? ["list", "get"] as const : ["list", "get", "set", "remove"] as const)
it(`classic comment body active ${carrier}; strict=${strict}; kind=${kind}; route=${route}; action=${action}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const relationships = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const comment = (id: number, value: string) => `<w:comment w:id="${id}" w:author="Archive" w:initials="AR" w:date="2026-03-04T05:06:07Z"><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:comment>`;
  const active = comment(7, "Active海🌊"), inactive = comment(11, "Inactive retained");
  const wrapped = carrier === "direct" ? active : carrier === "process-content" ? `<f:carrier mc:ProcessContent="f:carrier">${active}</f:carrier>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "choice" ? inactive : active}</mc:Fallback></mc:AlternateContent>`;
  const selected = "word/comments.xml", stored = `<w:comments xmlns:w="${word}" xmlns:f="urn:original:comment-body-carrier" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f">${comment(2, "Direct retained")}${wrapped}<!--retain--><?audit exact?></w:comments>`;
  const input = await textFixture('<w:p><w:r><w:t>Body retained</w:t></w:r></w:p>', { comments: { kind: "comments", xml: stored } }, strict, { kind }), before = readPackage(input), original = input.slice();
  const memory = Volume.fromJSON({ "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, read = action === "list" || action === "get", operation = `comments.${action}` as "comments.list" | "comments.get" | "comments.set" | "comments.remove";
  const options = action === "list" ? {} : action === "set" ? { comment: 2, text: "Updated海🌊" } : { comment: 2 };
  const modelOperations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: relationships + "/comments" }, resultHandle: "part" },
    { operation: "model.parts.comments.CommentsPart.comments.get", receiver: ref("part"), arguments: {}, resultHandle: "comments" },
    ...(action === "list" ? [{ operation: "model.comments.Comments.__len__.get", receiver: ref("comments"), arguments: {} }] : [{ operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId: 7 }, resultHandle: "comment" }, { operation: "model.comments.Comment.text.get", receiver: ref("comment"), arguments: {} }])
  ];
  let data: unknown;
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const document = await api.Document(input, context), part = document.part.part_related_by(relationships + "/comments");
    expect(part).toBeInstanceOf(api.CommentsPart); if (!(part instanceof api.CommentsPart)) throw new Error("Missing owned comments part");
    data = action === "list" ? part.comments.length : part.comments.get(7)?.text;
    expect([...part.comments].map(value => value.comment_id)).toEqual([2, 7]); await document.save(sink);
  } else if (route === "model-sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations: modelOperations }, context); data = batch.results.at(-1)!.value; expect(batch.affected).toBe(0); await batch.save(sink);
  } else if (route === "sdk") {
    if (read) data = await api.inspectDocumentComments(input, { operation, options } as api.CommentReadRequest, context);
    else data = await api.editDocumentComments(input, { operation, options: { ...options, output: "-" } } as api.CommentEditRequest, { ...context, stdout: sink });
  } else if (route === "sdk-batch") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations: [{ operation, arguments: options }] }, read ? {} : { output: "-" }, { ...context, stdout: sink }); data = result.results[0]!.data; expect(result.publication === null).toBe(read);
  } else {
    const fs = new MemoryFileSystem(), destination = encode("Retained destination"); await fs.writeFile("/source", input); await fs.writeFile("/destination", destination);
    const batch = { version: 1, operations: route === "model-cli" ? modelOperations : [{ operation, arguments: options }] }; await fs.writeFile("/operations", encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const command = route === "cli" ? `docx comments ${action} /source${action === "list" ? "" : " --comment 2"}${action === "set" ? " --text Updated海🌊" : ""}` : "docx batch /source --ops-file /operations";
      const result = await shell.exec(command + (read ? "" : " --output /destination --force") + " --json");
      expect(await fs.readFile("/source")).toEqual(original); if (result.exitCode !== 0 || read) expect(await fs.readFile("/destination")).toEqual(destination);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(true); expect(envelope.affected).toBe(read ? 0 : 1); data = route === "cli" ? envelope.data : envelope.data.results.at(-1).data;
      if (!read) memory.writeFileSync("/output", await fs.readFile("/destination"));
    } finally { await shell.dispose(); }
  }
  if (route.startsWith("model")) expect(data).toBe(action === "list" ? 2 : "Active海🌊");
  else if (read) {
    const items: { comment_id?: number; details?: { commentId: number }; text: string }[] = "item" in (data as { item?: unknown }) ? [(data as { item: { details: { commentId: number }; text: string } }).item] : (data as { items: { comment_id?: number; details?: { commentId: number }; text: string }[] }).items;
    expect(items.map(value => value.comment_id ?? value.details?.commentId)).toEqual(action === "list" ? [2, 7] : [7]); expect(items.at(-1)!.text).toBe("Active海🌊");
  } else expect(data).toMatchObject({ changed: true, changes: [{ kind: action === "set" ? "replace" : "remove" }] });
  if (read && !route.startsWith("model")) expect(memory.statSync("/output").size).toBe(0);
  const output = read && !route.startsWith("model") ? input : route === "model-cli" ? input : new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect([...after.keys()]).toEqual([...before.keys()]); for (const [name, bytes] of before) if (read || name !== selected) expect(after.get(name), name).toEqual(bytes);
  if (read) expect(output).toEqual(input); else {
    const xml = new TextDecoder().decode(after.get(selected)!); expect(xml).toContain(comment(2, "Direct retained")); expect(xml).toContain("<!--retain--><?audit exact?>"); if (carrier === "choice" || carrier === "fallback") expect(xml).toContain(inactive);
    expect((await api.validateDocument(output, context)).valid).toBe(true); const document = await api.Document(output, context); expect(document.comments.get(7)?.text ?? null).toBe(action === "set" ? "Updated海🌊" : null); expect(document.comments.length).toBe(action === "set" ? 2 : 1);
  }
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(before);
});
