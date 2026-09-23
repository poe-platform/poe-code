import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";

const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "cli"] as const)
for (const member of ["comment-id", "comment-date", "comment-add-run", "comments-paragraphs", "settings-not-equal-self", "settings-not-equal-null", "settings-not-equal-number"] as const)
it(`review forbids aliases and maps inequality; strict=${strict}; kind=${kind}; route=${route}; member=${member}`, async () => {
  const input = await textFixture("<w:p/>", {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="23"><w:p><w:r><w:t>Retained</w:t></w:r></w:p></w:comment></w:comments>` },
    settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:compat/><!--retained--><?audit exact?></w:settings>` }
  }, strict, { kind });
  const inequality = member.startsWith("settings-"), expected = member !== "settings-not-equal-self";
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  const operations: Record<string, unknown>[] = inequality ? [
    { operation: "model.document.Document.settings.get", receiver: ref("document"), arguments: {}, resultHandle: "settings" },
    { operation: "model.settings.Settings.__ne__.call", receiver: ref("settings"), arguments: { other: member.endsWith("self") ? ref("settings") : member.endsWith("null") ? null : 0 } }
  ] : [
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId: 23 }, resultHandle: "comment" },
    { operation: member === "comments-paragraphs" ? "model.comments.Comments.paragraphs.get" : member === "comment-id" ? "model.comments.Comment.id.get" : member === "comment-date" ? "model.comments.Comment.date.get" : "model.comments.Comment.add_run.call", receiver: ref(member === "comments-paragraphs" ? "comments" : "comment"), arguments: {} }
  ];
  if (route === "model") {
    const doc = await api.Document(input, context);
    if (inequality) expect(!doc.settings.equals(member.endsWith("self") ? doc.settings : member.endsWith("null") ? null : 0)).toBe(expected);
    else {
      const alias = member === "comments-paragraphs" ? "paragraphs" : member === "comment-id" ? "id" : member === "comment-date" ? "date" : "add_run";
      expect(alias in (member === "comments-paragraphs" ? doc.comments : doc.comments.get(23)!)).toBe(false);
    }
  } else if (route === "sdk") {
    const pending = api.executeDocumentBatch(input, { version: 1, operations }, { dryRun: true }, context);
    if (inequality) { const result = await pending; expect(result.results.at(-1)!.data).toBe(expected); expect(result.results.every(item => item.affected === 0)).toBe(true); expect(result.publication).toMatchObject({ changed: false, changes: [], dryRun: true, output: null }); }
    else await expect(pending).rejects.toMatchObject({ code: "usage" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = new TextEncoder().encode("Retained destination"); await fs.writeFile("/destination", retained); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /operations --dry-run --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(inequality ? 0 : 2);
      const envelope = JSON.parse(result.stdout); expect(envelope.affected).toBe(0);
      if (inequality) { expect(envelope.data.results.at(-1).data).toBe(expected); expect(envelope.data.publication).toMatchObject({ changed: false, changes: [], dryRun: true, output: null }); }
      else expect(envelope.errors[0].code).toBe("usage");
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(retained);
    } finally { await shell.dispose(); }
  }
  expect(memory.statSync("/output").size).toBe(0); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
