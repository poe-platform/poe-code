import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, textContext, textFixture, w } from "../tests/fixtures/text.js";

async function command(bytes: Uint8Array, args: string[]) {
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes), "/stdout": "" });
  let stderr = "";
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(output) { volume.appendFileSync("/stdout", output); } },
    stderr: { async write(output) { stderr += new TextDecoder().decode(output); } }
  });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(bytes));
  return { ...result, stderr, stdout: new Uint8Array(volume.readFileSync("/stdout") as Buffer) };
}

it.each(["footnote", "endnote"] as const)("exposes %s reads and mutations through the same SDK domain", async kind => {
  const input = await textFixture(paragraph("Survey"));
  const added = await command(input, ["notes", "add", "input.docx", "--kind", kind, "--paragraph", "1", "--text", "Source", "--output", "-"]);
  expect(added.exitCode, added.stderr).toBe(0);
  expect(added.stderr).toBe("");
  for (const action of ["list", "get"] as const) {
    const read = await command(added.stdout, ["notes", action, "input.docx", "--kind", kind, "--note", "1", "--json"]);
    expect(read.exitCode, read.stderr).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(read.stdout))).toMatchObject({
      version: 1, operation: `notes.${action}`, ok: true, affected: 0,
      data: await docx.inspectDocumentNotes(added.stdout, { operation: `notes.${action}`, options: { kind, note: 1 } }, textContext)
    });
  }
  const dry = await command(added.stdout, ["notes", "set", "input.docx", "--kind", kind, "--note", "1", "--text", "Revised", "--dry-run", "--json"]);
  expect(dry.exitCode, dry.stderr).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(dry.stdout))).toMatchObject({ affected: 1, data: { changed: true, dryRun: true, output: null } });
  const set = await command(added.stdout, ["notes", "set", "input.docx", "--kind", kind, "--note", "1", "--text", "Revised", "--output", "-"]);
  expect(set.exitCode, set.stderr).toBe(0);
  expect((await docx.inspectDocumentNotes(set.stdout, { operation: "notes.get", options: { kind, note: 1 } }, textContext)).items[0]!.text).toBe("Revised");
  const removed = await command(set.stdout, ["notes", "remove", "input.docx", "--kind", kind, "--note", "1", "--output", "-"]);
  expect(removed.exitCode, removed.stderr).toBe(0);
  expect((await docx.inspectDocumentNotes(removed.stdout, { operation: "notes.list", options: { kind } }, textContext)).items).toEqual([]);
});

it.each(["footnote", "endnote"])("retains %s review history through reference removal flags", async kind => {
  const body = `<w:${kind} w:id="2"><w:p><w:ins w:id="14" w:author="Editor" w:date="2026-01-01T00:00:00Z">${run("Recorded addition")}</w:ins></w:p></w:${kind}>`;
  const input = await textFixture(`<w:p><w:r><w:${kind}Reference w:id="2"/></w:r></w:p>`, {
    [kind + "s"]: { kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}">${body}</w:${kind}s>` }
  });
  const removed = await command(input, ["notes", "remove", "input.docx", "--kind", kind, "--note", "1", "--output", "-"]);
  expect(removed.exitCode, removed.stderr).toBe(0);
  const archive = await docx.readDocumentArchive(removed.stdout, textContext);
  expect(new TextDecoder().decode(archive.members.find(member => member.name === `word/${kind}s.xml`)!.bytes)).toContain(body);
  expect((await docx.inspectDocumentNotes(removed.stdout, { operation: "notes.list", options: {} }, textContext)).items[0]!.references).toEqual([]);
});
