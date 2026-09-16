import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, extractDocumentText, getDocxDiscovery, parseDocxArguments } from "./index.js";
import { textFixture, textContext, paragraph, table } from "../tests/fixtures/text.js";

it("uses the extraction SDK for text aliases, JSON and scoped memfs reads", async () => {
  const bytes = await textFixture(paragraph("Coast é海") + table([paragraph("West"), paragraph("East")]));
  const volume = Volume.fromJSON({ "/work/report.docx": Buffer.from(bytes) });
  const before = volume.toJSON();
  const engine = createDocxInspectionCommandEngine({ limits: textContext.limits });
  for (const args of [["text", "report.docx", "--json"], ["text", "get", "report.docx", "--table", "1", "--cell", "B1", "--json"], ["text", "report.docx"]]) {
    let stdout = "";
    let stderr = "";
    const result = await engine.execute({ args: args.map(x => new TextEncoder().encode(x)), cwd: "/work", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
      stdin: { async *[Symbol.asyncIterator]() { throw new Error("unexpected stdin"); yield new Uint8Array(); } },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode).toBe(0);
    const expected = await extractDocumentText(bytes, textContext, args.includes("--cell") ? { table: 1, cell: "B1" } : {});
    if (args.includes("--json")) {
      expect(JSON.parse(stdout)).toMatchObject({ version: 1, operation: "text.get", ok: true, data: expected, affected: 0, errors: [], warnings: [] });
      expect(JSON.parse(stdout).locations).toEqual([...new Map(expected.segments.map(s => [s.location.token, s.location])).values()]);
    } else expect(stdout).toBe(expected.text);
    expect(stderr).toBe("");
  }
  expect(volume.toJSON()).toEqual(before);
});

it("publishes extraction support, result fields and the fixed hidden-text policy", () => {
  const discovery = (...args: string[]) => getDocxDiscovery(parseDocxArguments(args.map(x => new TextEncoder().encode(x))))!;
  expect(discovery("schema", "text").data).toMatchObject({ operations: [{ id: "text.get", support: "read", result: { oneOf: [{ properties: { data: { properties: { text: { type: "string" }, hiddenText: { const: "include" }, segments: { type: "array" } } } } }, {}] } }] });
  expect(discovery("help", "text").human).toContain("Hidden text is included");
  expect(discovery("capabilities").data).toMatchObject({ features: expect.arrayContaining([{ id: "F08", level: "read", subsets: expect.any(Array), detected: null }]) });
});

it("reports invalid text views as JSON regardless of flag order without acquiring input", async () => {
  for (const args of [["text", "file", "--view", "invalid", "--json"], ["text", "file", "--json", "--view", "invalid"]]) {
    let stdout = "";
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: args.map(x => new TextEncoder().encode(x)), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile() { throw new Error("unexpected input read"); } },
      stdin: { async *[Symbol.asyncIterator]() { throw new Error("unexpected stdin"); yield new Uint8Array(); } },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(2);
    expect(stdout).not.toBe("");
    expect(JSON.parse(stdout)).toMatchObject({ operation: "text.get", ok: false, data: null, errors: [{ code: "usage" }], affected: 0 });
  }
});

it("executes preserving replacements through the CLI and publishes support", async () => {
  const bytes = await textFixture(paragraph("coast coast"));
  const engine = createDocxInspectionCommandEngine({ limits: textContext.limits });
  for (const [flags, code, affected] of [
    [["--all", "--bold", "false", "--italic", "true"], 0, 2],
    [["--first"], 0, 1], [["--occurrence", "3"], 1, 0],
    [["--occurrence", "3", "--allow-empty"], 0, 0], [[], 2, 0]
  ] as const) {
    let stdout = "";
    const result = await engine.execute({ args: ["text", "replace", "report.docx", "--find", "coast", "--with", "shore", ...flags, "--dry-run", "--json"].map(x => new TextEncoder().encode(x)),
      cwd: "/work", signal: textContext.signal, filesystem: { async readFile() { return bytes; } },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(code);
    expect(JSON.parse(stdout)).toMatchObject({ operation: "text.replace", ok: code === 0, affected });
  }
  const schema = getDocxDiscovery(parseDocxArguments(["schema", "text", "replace"].map(x => new TextEncoder().encode(x))))!;
  expect(schema.data).toMatchObject({ operations: [{ id: "text.replace", support: "edit", featureIds: expect.arrayContaining(["F10"]) }] });
});

it("uses singular wording for one replaced match", async () => {
  let stdout = "";
  const bytes = await textFixture(paragraph("coast"));
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["text", "replace", "input", "--find", "coast", "--with", "shore", "--first", "--dry-run"].map(x => new TextEncoder().encode(x)),
    cwd: "/", signal: textContext.signal, filesystem: { async readFile() { return bytes; } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect(stdout).toBe("docx text replace: dry-run; 1 match replaced\n");
});
