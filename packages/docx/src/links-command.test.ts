import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

async function command(bytes: Uint8Array, args: string[]) {
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(bytes), "/stdout": "" });
  let stderr = "";
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: args.map(a => new TextEncoder().encode(a)), cwd: "/work", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(volume.readFileSync("/work/input.docx")).toEqual(Buffer.from(bytes));
  return { ...result, stderr, stdout: new Uint8Array(volume.readFileSync("/stdout") as Buffer) };
}

it("uses the same link SDK through direct CLI creation, listing, edit and explicit content deletion", async () => {
  const bytes = await textFixture(paragraph("Map: "));
  const add = await command(bytes, ["links", "add", "input.docx", "--paragraph", "1", "--text", "Coast", "--target", "https://coast.invalid/#map", "--output", "-"]);
  expect(add.exitCode).toBe(0);
  expect(add.stderr).toBe("");
  const list = await command(add.stdout, ["links", "list", "input.docx", "--json"]);
  expect(list.exitCode).toBe(0);
  const read = JSON.parse(new TextDecoder().decode(list.stdout));
  expect(read).toMatchObject({ version: 1, operation: "links.list", ok: true, affected: 0, data: await docx.inspectDocumentLinks(add.stdout, {}, textContext) });
  const args = ["links", "set", "input.docx", "--select", read.data.items[0].location.token, "--bookmark", "Overview", "--dry-run", "--json"];
  const set = await command(add.stdout, args);
  expect(set.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(set.stdout))).toMatchObject({ operation: "links.set", affected: 1, data: await docx.editDocumentLinks(add.stdout, { operation: "links.set", options: { select: read.data.items[0].location.token, bookmark: "Overview", dryRun: true, json: true } }, { ...textContext, encoding: { order: "input", compression: "store" } }) });
  const remove = await command(add.stdout, ["links", "remove", "input.docx", "--link", "1", "--delete-content", "--output", "-"]);
  expect(remove.exitCode).toBe(0);
  expect((await docx.extractDocumentText(remove.stdout, textContext)).text).toBe("Map: ");
});

it("advertises bounded link behavior in help, schema and capabilities", () => {
  const discovery = (...args: string[]) => docx.getDocxDiscovery(docx.parseDocxArguments(args.map(a => new TextEncoder().encode(a))))!;
  expect(discovery("help", "links", "remove").human).toContain("unwrap");
  expect(discovery("help", "links", "add").human).toContain("Never fetch");
  expect(discovery("schema", "links", "remove").data).toMatchObject({ operations: [{ id: "links.remove", support: "edit" }] });
  expect(discovery("schema", "links", "list").data).toMatchObject({ operations: [{ id: "links.list", support: "read" }] });
  expect(discovery("help", "links", "remove").human).not.toContain("--bookmark");
  expect(discovery("help", "links", "add").human).not.toContain("--run");
  expect(discovery("capabilities").data).toMatchObject({ features: expect.arrayContaining([{ id: "F21", level: "edit", subsets: expect.any(Array), detected: null }]) });
});

it("rejects inapplicable link selectors instead of silently ignoring them", () => {
  for (const flags of [["--bookmark", "1"], ["--run", "1"], ["--image", "1"]])
    expect(() => docx.parseDocxArguments(["links", "list", "input.docx", ...flags].map(s => new TextEncoder().encode(s)))).toThrow();
});

it("keeps internal anchor strings in declared batch types and validation", () => {
  const operation: docx.DocxBatchItemMap["links.set"] = { operation: "links.set", arguments: { link: 1, bookmark: "Overview" } };
  expect(docx.validateDocxBatch({ version: 1, operations: [operation] }).operations[0]).toEqual(operation);
});

it.each(["https:coast.invalid", "https://coast.invalid/map\u00a0inset", "https://coast.invalid/map\u0085inset"])("rejects malformed URLs before input reads and emits common usage status: %j", async target => {
  let reads = 0, stdout = "";
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["links", "add", "input.docx", "--paragraph", "1", "--text", "Coast", "--target", target, "--dry-run", "--json"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { reads++; throw new Error("Unexpected read"); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(2);
  expect(reads).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: "usage" }] });
});
