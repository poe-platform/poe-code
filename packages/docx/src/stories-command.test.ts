import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

async function command(input: Uint8Array, args: string[]) {
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/stdout": "", "/stderr": "" });
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map(v => new TextEncoder().encode(v)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  return { ...result, bytes: new Uint8Array(volume.readFileSync("/stdout") as Buffer), text: volume.readFileSync("/stdout", "utf8") as string, error: volume.readFileSync("/stderr", "utf8") as string };
}

it.each(["headers", "footers"])("pairs %s create, get, list and remove with the SDK and binary stdout", async kind => {
  const input = await textFixture(paragraph("Harbor"));
  const created = await command(input, [kind, "set", "/input.docx", "--section", "1", "--variant", "even", "--link-to-previous", "false", "--text", "Café tide", "-o", "-"]);
  expect(created.exitCode, created.error).toBe(0);
  const get = await command(created.bytes, [kind, "get", "/input.docx", "--section", "1", "--variant", "even", "--json"]);
  expect(get.exitCode, get.error).toBe(0);
  expect(JSON.parse(get.text)).toMatchObject({ version: 1, operation: `${kind}.get`, ok: true, affected: 0, data: { items: [{ text: "Café tide", linked: false }] }, errors: [] });
  const list = await command(created.bytes, [kind, "list", "/input.docx", "--json"]);
  expect(JSON.parse(list.text).data.items).toHaveLength(3);
  const removed = await command(created.bytes, [kind, "remove", "/input.docx", "--section", "1", "--variant", "even", "-o", "-"]);
  expect(removed.exitCode, removed.error).toBe(0);
  expect((await docx.inspectDocumentSections(removed.bytes, {}, textContext)).items[0]![kind as "headers" | "footers"].even.part).toBeNull();
});

it("advertises implemented story commands, exact result schemas and explicit intent in help", async () => {
  const input = await textFixture(paragraph("Harbor"));
  for (const kind of ["headers", "footers"]) for (const action of ["list", "get", "set", "remove"]) {
    const schema = JSON.parse((await command(input, ["schema", kind, action])).text).data.operations[0];
    expect(schema.support).toBe(["get", "list"].includes(action) ? "read" : "edit");
    expect(JSON.stringify(schema.result)).toContain("affected");
  }
  const help = await command(input, ["help", "headers", "set"]);
  expect(help.text).toContain("--link-to-previous");
  expect(help.text).toContain("clone");
  expect(help.text).toContain("Scope defaults to headers");
  expect(help.text).not.toContain("Scope defaults to body");
  expect(help.text).not.toContain("--paragraph");
  expect(help.text).not.toContain("--all  ");
  const caps = JSON.parse((await command(input, ["capabilities", "--json"])).text);
  expect(caps.data.features).toContainEqual(expect.objectContaining({ id: "F17", level: "edit" }));
});

it("returns shared failure envelopes and no output package on invalid intent", async () => {
  const input = await textFixture(paragraph("Harbor"));
  const result = await command(input, ["headers", "set", "/input.docx", "--section", "1", "--link-to-previous", "true", "--dry-run", "--json"]);
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.text)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "usage" }] });
});

it("rejects effect-free shared flags and all-section deletion at preflight", async () => {
  const input = await textFixture(paragraph("Harbor"));
  for (const args of [
    ["headers", "set", "/input.docx", "--section", "1", "--shared", "--dry-run", "--json"],
    ["headers", "remove", "/input.docx", "--all", "--dry-run", "--json"]
  ]) {
    const result = await command(input, args);
    expect(result.exitCode).toBe(2);
  }
});
