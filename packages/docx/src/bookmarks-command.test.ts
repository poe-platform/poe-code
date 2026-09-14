import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, table, textContext, textFixture } from "../tests/fixtures/text.js";

async function command(bytes: Uint8Array, args: string[]) {
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(bytes), "/stdout": "" });
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: args.map(a => new TextEncoder().encode(a)), cwd: "/work", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } }, stderr: { async write() {} } });
  expect(volume.readFileSync("/work/input.docx")).toEqual(Buffer.from(bytes));
  return { ...result, stdout: new Uint8Array(volume.readFileSync("/stdout") as Buffer) };
}

it("creates, lists, renames and removes a table-contained multi-run bookmark through the CLI", async () => {
  const bytes = await textFixture(paragraph("Outside") + table([`<w:p>${run("Coastal ")}${run("survey")}</w:p>`]));
  const locations = await docx.openDocumentLocations(bytes, textContext);
  const range = locations.range(locations.at("paragraph", 1, { owner: locations.cell(locations.at("table", 1).token, "A1").token }).token, 2, 10);
  const add = await command(bytes, ["bookmarks", "add", "input.docx", "--select", range.token, "--name", "Survey", "--output", "-"]);
  expect(add.exitCode).toBe(0);
  const list = await command(add.stdout, ["bookmarks", "list", "input.docx", "--table", "1", "--cell", "A1", "--json"]);
  expect(list.exitCode).toBe(0);
  const data = JSON.parse(new TextDecoder().decode(list.stdout));
  expect(data).toMatchObject({ operation: "bookmarks.list", affected: 0, data: { items: [{ name: "Survey", location: { kind: "bookmark", positions: { bookmark: 1 } } }] } });
  const renamed = await command(add.stdout, ["bookmarks", "set", "input.docx", "--select", data.data.items[0].location.token, "--name", "SurveyFinal", "--references", "update", "--output", "-"]);
  expect(renamed.exitCode).toBe(0);
  const removed = await command(renamed.stdout, ["bookmarks", "remove", "input.docx", "--bookmark", "1", "--references", "reject", "--output", "-"]);
  expect(removed.exitCode).toBe(0);
  expect((await docx.extractDocumentText(removed.stdout, textContext)).text).toBe((await docx.extractDocumentText(bytes, textContext)).text);
  const stale = await command(renamed.stdout, ["bookmarks", "remove", "input.docx", "--select", data.data.items[0].location.token, "--references", "reject", "--dry-run", "--json"]);
  expect(stale.exitCode).toBe(1);
  expect(JSON.parse(new TextDecoder().decode(stale.stdout))).toMatchObject({ errors: [{ code: "stale-selection" }], affected: 0 });
});

it("declares bounded bookmark help, schema and capabilities without unrelated selectors", () => {
  const discovery = (...args: string[]) => docx.getDocxDiscovery(docx.parseDocxArguments(args.map(a => new TextEncoder().encode(a))))!;
  expect(discovery("help", "bookmarks", "add").human).toContain("Unicode scalar");
  expect(discovery("schema", "bookmarks", "set").data).toMatchObject({ operations: [{ id: "bookmarks.set", support: "edit" }] });
  expect(discovery("schema", "bookmarks", "list").data).toMatchObject({ operations: [{ id: "bookmarks.list", support: "read" }] });
  expect(discovery("help", "bookmarks", "set").human).not.toContain("--run");
  expect(discovery("capabilities").data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F21", subsets: expect.arrayContaining([expect.objectContaining({ name: "bookmark-ranges", level: "edit" })]) })]) });
  for (const flags of [["--run", "1"], ["--link", "1"], ["--image", "1"]])
    expect(() => docx.parseDocxArguments(["bookmarks", "list", "input.docx", ...flags].map(s => new TextEncoder().encode(s)))).toThrow();
  for (const action of ["set", "remove"])
    expect(() => docx.parseDocxArguments(["bookmarks", action, "input.docx", "--bookmark", "1", ...(action === "set" ? ["--name", "Survey"] : []), "--dry-run"].map(s => new TextEncoder().encode(s)))).toThrow();
});

it("retains generic annotation locations alongside bookmark-specific locations", async () => {
  const bytes = await textFixture(`<w:p><w:bookmarkStart w:id="5" w:name="Survey"/>${run("Coast")}<w:bookmarkEnd w:id="5"/></w:p>`);
  const document = await docx.openDocumentLocations(bytes, textContext);
  const annotations = document.list("annotation");
  expect(annotations).toHaveLength(1);
  const bookmark = document.at("bookmark", 1);
  expect(annotations[0]!.token).toBe(bookmark.token);
  expect(document.resolve(bookmark.token).kind).toBe("annotation");
  expect(document.resolve(bookmark.token, "bookmark").kind).toBe("bookmark");
});

it("prints malformed bookmark diagnostics in human output", async () => {
  const bytes = await textFixture(`<w:p><w:bookmarkStart w:id="5" w:name="Survey"/>${run("Coast")}</w:p>`);
  const result = await command(bytes, ["bookmarks", "list", "input.docx"]);
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(result.stdout)).toContain("missing-end");
});
