import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const timestamp = "2026-03-04T05:06:07Z";
const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const noteKind of ["footnote", "endnote"] as const)
for (const scopeKind of ["selected-kind", "all-stories"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`classic comment lifecycle in admitted note story; strict=${strict}; kind=${kind}; note=${noteKind}; scope=${scopeKind}; route=${route}`, async () => {
  const scope = scopeKind === "all-stories" ? "all-stories" : noteKind === "footnote" ? "footnotes" : "endnotes";
  const notes = `<w:${noteKind}s xmlns:w="${w}"><!--notes retained--><w:${noteKind} w:id="12"><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Coastal 🌊</w:t></w:r><w:r><w:t> survey</w:t></w:r></w:p></w:${noteKind}><w:${noteKind} w:id="17"><w:p><w:r><w:t>Unselected note</w:t></w:r></w:p></w:${noteKind}><?audit notes?></w:${noteKind}s>`;
  const input = await textFixture(`<w:p><w:r><w:t>Retained body</w:t></w:r><w:r><w:${noteKind}Reference w:id="12"/></w:r><w:r><w:${noteKind}Reference w:id="17"/></w:r></w:p>`, {
    notes: { kind: `${noteKind}s`, xml: notes },
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="2" w:author="Archivist"><w:p><w:r><w:t>Unselected comment</w:t></w:r></w:p></w:comment><!--comments retained--><?audit comments?></w:comments>` }
  }, strict, { kind });
  const before = readPackage(input), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  const locations = await api.openDocumentLocations(input, context);
  const paragraph = locations.list("paragraph", { scope }).find(value => value.value.part === "/word/notes.xml")!;
  expect(paragraph.value.part).toBe("/word/notes.xml");
  expect(locations.text({ select: paragraph.token }).text).toBe("Coastal 🌊 survey");
  const select = locations.range(paragraph.token, 0, [..."Coastal 🌊 survey"].length).token;
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retained destination"));
  const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const execute = async (bytes: Uint8Array, operation: "comments.add" | "comments.set" | "comments.remove", arguments_: Record<string, unknown>) => {
    memory.writeFileSync("/output", "");
    if (route === "sdk") await api.editDocumentComments(bytes, { operation, options: { ...arguments_, output: "-" } } as api.CommentEditRequest, { ...context, stdout: sink });
    else if (route === "sdk-batch") await api.executeDocumentBatch(bytes, { version: 1, operations: [{ operation, arguments: arguments_ }] }, { output: "-" }, { ...context, stdout: sink });
    else {
      await fs.writeFile("/current", bytes); await fs.writeFile("/destination", enc("Retained destination"));
      const batch = { version: 1, operations: [{ operation, arguments: arguments_ }] };
      await fs.writeFile("/operations", enc(JSON.stringify(batch)));
      const command = route === "cli-batch" ? "docx batch /current --ops-file /operations" : `docx ${operation.split(".").join(" ")} /current --select '${String(arguments_.select)}'` + (operation === "comments.add" ? ` --text 'Added note' --author '' --initials null --timestamp ${timestamp}` : operation === "comments.set" ? " --text 'Updated note'" : "");
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 1, errors: [] });
      expect(await fs.readFile("/current")).toEqual(bytes);
      memory.writeFileSync("/output", await fs.readFile("/destination"));
    }
    return new Uint8Array(memory.readFileSync("/output") as Buffer);
  };
  try {
    const added = await execute(input, "comments.add", { select, text: "Added note", author: "", initials: null, timestamp });
    const inventory = await api.inspectDocumentComments(added, { operation: "comments.list", options: {} }, context);
    const comment = inventory.items.find(value => value.comment_id === 3)!;
    expect(comment).toMatchObject({ comment_id: 3, text: "Added note", author: "", initials: null, timestamp, issues: [], range: { start: { part: "/word/notes.xml" }, end: { part: "/word/notes.xml" } } });
    expect((await api.extractDocumentText(added, context, { scope: noteKind === "footnote" ? "footnotes" : "endnotes" })).text).toBe("Coastal 🌊 survey\n\nUnselected note");
    const saved = readPackage(added); assertPackageLinks(saved);
    for (const [name, bytes] of before) if (!["word/notes.xml", "word/comments.xml"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
    expect([...saved.keys()]).toEqual([...before.keys()]);
    const notesXml = new TextDecoder().decode(saved.get("word/notes.xml"));
    expect(notesXml).toContain("<!--notes retained-->"); expect(notesXml).toContain("<?audit notes?>"); expect(notesXml).toContain("<w:i/>"); expect(notesXml).toContain("Unselected note");
    const changed = await execute(added, "comments.set", { select: comment.location.token, text: "Updated note" });
    expect(readPackage(changed).get("word/notes.xml")).toEqual(saved.get("word/notes.xml"));
    const updated = (await api.inspectDocumentComments(changed, { operation: "comments.list", options: {} }, context)).items.find(value => value.comment_id === 3)!;
    expect(updated.text).toBe("Updated note");
    const removed = await execute(changed, "comments.remove", { select: updated.location.token });
    const final = readPackage(removed);
    expect(final.get("word/notes.xml")).toEqual(before.get("word/notes.xml"));
    const remaining = (await api.inspectDocumentComments(removed, { operation: "comments.list", options: {} }, context)).items;
    expect(remaining.map(value => [value.comment_id, value.text])).toEqual([[2, "Unselected comment"]]);
    for (const [name, bytes] of before) if (name !== "word/comments.xml") expect(final.get(name), name).toEqual(bytes);
    expect(await fs.readFile("/input")).toEqual(input); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  } finally { await shell.dispose(); }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const noteKind of ["footnote", "endnote"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`shared note comment anchor refuses atomically; strict=${strict}; kind=${kind}; note=${noteKind}; route=${route}`, async () => {
  const scope = noteKind === "footnote" ? "footnotes" : "endnotes";
  const input = await textFixture(`<w:p><w:r><w:${noteKind}Reference w:id="12"/></w:r><w:r><w:${noteKind}Reference w:id="12"/></w:r></w:p>`, {
    notes: { kind: `${noteKind}s`, xml: `<w:${noteKind}s xmlns:w="${w}"><w:${noteKind} w:id="12"><w:p><w:r><w:t>Shared anchor</w:t></w:r></w:p></w:${noteKind}></w:${noteKind}s>` }
  }, strict, { kind });
  const locations = await api.openDocumentLocations(input, textContext);
  const select = locations.range(locations.at("paragraph", 1, { scope }).token, 0, [..."Shared anchor"].length).token;
  expect((await api.inspectDocumentNotes(input, { operation: "notes.list", options: { kind: noteKind } }, textContext)).items[0]!.references).toHaveLength(2);
  const arguments_ = { select, author: "", timestamp, text: "Unsafe shared annotation" };
  const batch = { version: 1 as const, operations: [{ operation: "comments.add" as const, arguments: arguments_ }] };
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  if (route === "sdk" || route === "sdk-batch") {
    const pending = route === "sdk" ? api.editDocumentComments(input, { operation: "comments.add", options: { ...arguments_, output: "-" } }, context) : api.executeDocumentBatch(input, batch, { output: "-" }, context);
    await expect(pending).rejects.toMatchObject({ code: "ambiguous-selection" });
    expect(memory.statSync("/output").size).toBe(0);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = enc("Retained destination"); await fs.writeFile("/destination", retained); await fs.writeFile("/operations", enc(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? `docx comments add /input --select '${select}' --author '' --timestamp ${timestamp} --text 'Unsafe shared annotation'` : "docx batch /input --ops-file /operations";
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: "ambiguous-selection" }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(retained);
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
