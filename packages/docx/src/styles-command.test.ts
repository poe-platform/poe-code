import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, getDocxDiscovery, parseDocxArguments } from "./index.js";
import { paragraph, textContext, textFixture, w } from "../tests/fixtures/text.js";

const parse = (...args: string[]) => parseDocxArguments(args.map(a => new TextEncoder().encode(a)));
it("admits nullable style relationships and document default formatting through direct flags", () => {
  expect(parse("styles", "set", "input.docx", "--name", "Coastal", "--next", "Normal", "--linked-style", "null", "--default-for-type", "false", "--dry-run").options).toMatchObject({ name: "Coastal", next: "Normal", linkedStyle: null, defaultForType: false });
  expect(parse("styles", "defaults", "set", "input.docx", "--bold", "null", "--space-after", "6pt", "--dry-run").options).toMatchObject({ bold: null, spaceAfter: { value: 6, unit: "pt" } });
});

it("lists styles without changing the admitted file and advertises implemented style operations", async () => {
  const bytes = await textFixture(paragraph("Coastal survey"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Coastal"><w:name w:val="Coastal"/><w:rPr><w:b/></w:rPr></w:style></w:styles>` } });
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(bytes) });
  let stdout = "", stderr = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["styles", "list", "input.docx", "--json"].map(a => new TextEncoder().encode(a)), cwd: "/work", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ version: 1, operation: "styles.list", ok: true, affected: 0, data: { styles: [{ id: "Coastal", name: "Coastal" }] } });
  expect(stderr).toBe("");
  expect(volume.readFileSync("/work/input.docx")).toEqual(Buffer.from(bytes));
  expect(getDocxDiscovery(parse("schema", "styles", "set"))!.data).toMatchObject({ operations: [{ id: "styles.set", support: "edit", featureIds: ["F14"] }] });
  expect(getDocxDiscovery(parse("capabilities"))!.data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F14", level: "edit" })]) });
});

it.each([["--name", ""], ["--name", "Coastal", "--priority", "-1"], ["--name", "Coastal", "--color", "zzzzzz"], ["--name", "Coastal", "--size", "0.1pt"]].map(flags => [flags]))("rejects invalid style settings before input acquisition: %j", async flags => {
  let reads = 0;
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["styles", "set", "input.docx", ...flags, "--bold", "true", "--dry-run", "--json"].map(a => new TextEncoder().encode(a)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { reads++; return new Uint8Array(); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(2);
  expect(reads).toBe(0);
});

it("publishes a style edit as pure package stdout and matches the SDK dry-run result", async () => {
  const { editDocumentStyles, inspectDocumentStyles } = await import("./styles.js");
  const bytes = await textFixture(paragraph("Coastal survey"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Coastal"><w:name w:val="Coastal"/></w:style></w:styles>` } });
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(bytes), "/output": "" });
  const execute = async (flags: string[]) => {
    volume.writeFileSync("/output", "");
    let stderr = "";
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["styles", "set", "input.docx", "--name", "Coastal", "--bold", "false", ...flags].map(a => new TextEncoder().encode(a)), cwd: "/work", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    return new Uint8Array(volume.readFileSync("/output") as Buffer);
  };
  const report = JSON.parse(new TextDecoder().decode(await execute(["--dry-run", "--json"])));
  const sdk = await editDocumentStyles(bytes, { operation: "styles.set", name: "Coastal", bold: false, dryRun: true, json: true }, { ...textContext, encoding: { order: "input", compression: "store" } });
  expect(report).toMatchObject({ operation: "styles.set", ok: true, affected: 1, data: sdk });
  const output = await execute(["--output", "-"]);
  expect([...output.slice(0, 4)]).toEqual([80, 75, 3, 4]);
  expect((await inspectDocumentStyles(output, { name: "Coastal" }, textContext)).styles).toMatchObject([{ direct: { bold: false } }]);
  expect(volume.readFileSync("/work/input.docx")).toEqual(Buffer.from(bytes));
});

it("reads document defaults and reports missing style lookup without publishing bytes", async () => {
  const bytes = await textFixture(paragraph("Coastal survey"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>` } });
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(bytes) });
  const execute = async (words: string[]) => {
    let stdout = "";
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: [...words, "--json"].map(a => new TextEncoder().encode(a)), cwd: "/work", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
    return { ...result, report: JSON.parse(stdout) };
  };
  expect(await execute(["styles", "defaults", "get", "input.docx"])).toMatchObject({ exitCode: 0, report: { ok: true, affected: 0, data: { defaults: { run: { bold: true } } } } });
  expect(await execute(["styles", "get", "input.docx", "--name", "Absent"])).toMatchObject({ exitCode: 1, report: { ok: false, affected: 0, data: null } });
  expect(volume.readFileSync("/work/input.docx")).toEqual(Buffer.from(bytes));
});

it("shows direct and inherited style properties in human inspection", async () => {
  const bytes = await textFixture(paragraph("Coastal survey"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Coastal"><w:name w:val="Coastal"/><w:rPr><w:b/></w:rPr></w:style></w:styles>` } });
  let stdout = "";
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes) });
  await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["styles", "get", "input.docx", "--name", "Coastal"].map(a => new TextEncoder().encode(a)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
  expect(stdout).toContain('Direct: {"bold":true');
  expect(stdout).toContain('Inherited result: {"bold":true');
});

it("publishes closed style inspection result schemas including nullable inherited properties", () => {
  expect(getDocxDiscovery(parse("schema", "styles", "get"))!.data).toMatchObject({ operations: [{ result: { oneOf: [{ properties: { data: { properties: {
    styles: { items: { additionalProperties: false, properties: { direct: { additionalProperties: false, properties: { bold: { oneOf: [{ type: "boolean" }, { type: "null" }] } } } } } }
  } } } }, {}] } }] });
});

it("creates Title through paragraph heading level zero and advertises the bounded heading capability", async () => {
  const { inspectDocumentStyles } = await import("./styles.js");
  const bytes = await textFixture(paragraph("Coastal survey"));
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes), "/output": "" });
  let stderr = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["paragraphs", "add", "input.docx", "--level", "0", "--text", "Coastal title", "--output", "-"].map(a => new TextEncoder().encode(a)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  const document = new Uint8Array(volume.readFileSync("/output") as Buffer);
  expect((await inspectDocumentStyles(document, { name: "Title" }, textContext)).styles).toMatchObject([{ name: "Title", type: "paragraph" }]);
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(bytes));
  expect(getDocxDiscovery(parse("capabilities"))!.data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F15", level: "edit" })]) });
  expect(getDocxDiscovery(parse("help", "paragraphs", "add"))!.human).toContain("Level 0 creates Title");
  expect(getDocxDiscovery(parse("schema", "paragraphs", "add"))!.data).toMatchObject({ operations: [{ featureIds: expect.arrayContaining(["F15"]) }] });
});

it("rejects an explicit style together with heading level zero before acquiring input", async () => {
  let reads = 0;
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["paragraphs", "add", "input.docx", "--level", "0", "--style", "Coastal", "--dry-run", "--json"].map(a => new TextEncoder().encode(a)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { reads++; return new Uint8Array(); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(2);
  expect(reads).toBe(0);
});
