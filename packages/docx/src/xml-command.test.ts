import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, getDocxDiscovery, parseDocxArguments, getDocumentXml } from "./index.js";
import { textContext as context, textFixture, paragraph, w } from "../tests/fixtures/text.js";

async function run(args: string[], replacement = `<w:document xmlns:w="${w}"><w:body>${paragraph("Revised coast")}</w:body></w:document>`) {
  const volume = Volume.fromJSON({ "/replacement": replacement, "/stdout": "", "/stderr": "" });
  volume.writeFileSync("/input", await textFixture(paragraph("Original coast")));
  let reads = 0;
  const result = await createDocxInspectionCommandEngine({ limits: context.limits }).execute({
    args: args.map(arg => new TextEncoder().encode(arg)), cwd: "/", signal: context.signal,
    filesystem: { async readFile(path) { reads++; return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(replacement); } },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  return { result, volume, reads };
}
it("executes XML raw and structured reads through the same SDK", async () => {
  for (const args of [["--raw"], ["--pretty", "--json"], ["--json"]]) {
    const { result, volume } = await run(["xml", "get", "/input", "--part", "/word/document.xml", ...args]);
    expect(result.exitCode).toBe(0);
    const expected = await getDocumentXml(new Uint8Array(volume.readFileSync("/input") as Buffer), context, { part: "/word/document.xml", raw: args.includes("--raw"), pretty: args.includes("--pretty") });
    if (expected instanceof Uint8Array) expect(new Uint8Array(volume.readFileSync("/stdout") as Buffer)).toEqual(expected);
    else expect(JSON.parse(String(volume.readFileSync("/stdout", "utf8")))).toMatchObject({ operation: "xml.get", ok: true, data: expected, affected: 0 });
    expect(volume.readFileSync("/stderr", "utf8")).toBe("");
  }
});
it("replaces XML from an explicit file or stdin and publishes only package bytes", async () => {
  for (const file of ["/replacement", "-"]) {
    const { result, volume } = await run(["xml", "set", "/input", "--part", "/word/document.xml", "--file", file, "--output", "-"]);
    expect(result.exitCode).toBe(0);
    const xml = await getDocumentXml(new Uint8Array(volume.readFileSync("/stdout") as Buffer), context, { part: "/word/document.xml", raw: true });
    expect(new TextDecoder().decode(xml as Uint8Array)).toBe(volume.readFileSync("/replacement", "utf8"));
  }
});
it("dry-runs replacements with JSON and rejects invalid XML without publishing", async () => {
  const args = ["xml", "set", "/input", "--part", "/word/document.xml", "--file", "/replacement", "--dry-run", "--json"];
  const { result, volume } = await run(args);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(String(volume.readFileSync("/stdout", "utf8")))).toMatchObject({ operation: "xml.set", ok: true, data: { dryRun: true, changed: true, output: null }, affected: 1 });
  const invalid = await run(args, "<bad>");
  expect(invalid.result.exitCode).toBe(1);
  expect(JSON.parse(String(invalid.volume.readFileSync("/stdout", "utf8")))).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-xml" }] });
});
it("preflights repeated part selectors and shared stdin before acquisition", async () => {
  for (const args of [
    ["xml", "get", "/input", "--part", "/word/document.xml", "--part", "/word/styles.xml"],
    ["xml", "set", "-", "--part", "/word/document.xml", "--file", "-", "--dry-run"]
  ]) { const { result, reads } = await run(args); expect(result.exitCode).toBe(2); expect(reads).toBe(0); }
});
it("advertises bounded XML read and replacement with display serialization help", () => {
  const discover = (...args: string[]) => getDocxDiscovery(parseDocxArguments(args.map(arg => new TextEncoder().encode(arg))))!;
  expect(discover("schema", "xml", "get").data).toMatchObject({ operations: [{ id: "xml.get", support: "read" }] });
  expect(discover("schema", "xml", "set").data).toMatchObject({ operations: [{ id: "xml.set", support: "edit" }] });
  expect(discover("help", "xml", "get").human).toContain("display serialization");
  expect(discover("capabilities").data).toMatchObject({ features: expect.arrayContaining([{ id: "F07", level: "edit", subsets: expect.any(Array), detected: null }]) });
});

it("bounds XML failure diagnostics without exposing replacement contents", async () => {
  const { result, volume } = await run(["xml", "set", "/input", "--part", "/word/document.xml", "--file", "/replacement", "--dry-run", "--limit", "diagnosticBytes=16"], "<secret>");
  expect(result.exitCode).toBe(1);
  expect(volume.statSync("/stderr").size).toBeLessThanOrEqual(16);
  expect(String(volume.readFileSync("/stderr", "utf8"))).not.toContain("secret");
});

it("reports possible partial binary stdout when replacement publication fails", async () => {
  const volume = Volume.fromJSON({ "/input": Buffer.from(await textFixture(paragraph("Original coast"))), "/replacement": `<w:document xmlns:w="${w}"><w:body>${paragraph("Revised coast")}</w:body></w:document>`, "/stdout": "", "/stderr": "" });
  const result = await createDocxInspectionCommandEngine({ limits: context.limits }).execute({
    args: ["xml", "set", "/input", "--part", "/word/document.xml", "--file", "/replacement", "--output", "-"].map(arg => new TextEncoder().encode(arg)), cwd: "/", signal: context.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes.subarray(0, 4)); throw new Error("output unavailable"); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  expect(result.exitCode).toBe(3);
  expect(volume.statSync("/stdout").size).toBe(4);
  expect(String(volume.readFileSync("/stderr", "utf8"))).toContain("partial");
});

it("keeps allow-empty parity for missing explicit parts", async () => {
  const { result, volume } = await run(["xml", "set", "/input", "--part", "/absent.xml", "--file", "/replacement", "--allow-empty", "--dry-run", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(String(volume.readFileSync("/stdout", "utf8")))).toMatchObject({ affected: 0, data: { changed: false, changes: [] } });
});

it("emits plain XML within its exact raw-byte output limit", async () => {
  const input = await textFixture(paragraph("Original coast"));
  const raw = await getDocumentXml(input, context, { part: "/word/document.xml", raw: true }) as Uint8Array;
  const { result, volume } = await run(["xml", "get", "/input", "--part", "/word/document.xml", "--limit", `serializedOutput=${raw.length}`]);
  expect(result.exitCode).toBe(0);
  expect(new Uint8Array(volume.readFileSync("/stdout") as Buffer)).toEqual(raw);
});
