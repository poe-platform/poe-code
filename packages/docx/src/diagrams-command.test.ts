import { expect, it } from "vitest";
import { Volume } from "memfs";
import { paragraph, textFixture, textContext } from "../tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { DocumentBudget } from "./budget.js";
import { encodeLocation, type Location } from "./location-token.js";
import { diagramFixture, diagramCarrier, diagramContext } from "../tests/fixtures/diagrams.js";
import { inspectDocumentDiagrams } from "./index.js";

it.each([false, true])("pairs public SDK and CLI native diagram and unknown graphics records (%s)", async strict => {
  const input = await diagramFixture({ strict, body: '<w:p><w:r><w:t>Original passage</w:t></w:r>' + diagramCarrier(strict) + '</w:p><w:p>' + diagramCarrier(strict, "urn:original:graphics").replace('id="1"', 'id="2"') + '</w:p>' });
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input) }); let stdout = "", stderr = "";
  const result = await createDocxInspectionCommandEngine({ limits: diagramContext.limits }).execute({ args: ["diagrams", "list", "input.docx", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: diagramContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode, stderr).toBe(0);
  const cli = JSON.parse(stdout), sdk = await inspectDocumentDiagrams(input, {}, diagramContext);
  expect(cli.data.items).toEqual(sdk.items); expect(cli.warnings).toEqual(sdk.warnings);
  expect(cli.data.items).toHaveLength(5); expect(cli.locations).toEqual(sdk.items.map(item => item.location));
  expect(sdk.items.every(item => item.support === "preserve")).toBe(true);
  const observations = sdk.items.flatMap(item => item.details.observations);
  expect(observations.find(item => item.kind === "relIds")!.bindings.map(item => item.status)).toEqual(["internal", "internal", "internal", "internal"]);
  expect(observations.find(item => item.kind === "unknown-graphic")!.bindings).toEqual([]);
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
});

it("bounds located failure diagnostics, output, retention and cancellation before serialization", async () => {
  const adapter = await import("./diagrams-command.js");
  const value = { version: 1 as const, sourceSha256: "a".repeat(64), generation: 0, part: "/word/document.xml", story: "/word/document.xml", path: [0, 1, 0], range: null };
  const location: Location<"part"> = { kind: "part", token: encodeLocation(value), value, positions: {} };
  const error = { location, locations: [location] };
  const bytes = adapter.serializeDiagramMutationFailure("xml.set", error, "unsupported-edit", "Original refusal", new DocumentBudget());
  const envelope = JSON.parse(new TextDecoder().decode(bytes));
  expect(envelope).toMatchObject({ ok: false, affected: 0, data: null, locations: [location], errors: [{ code: "unsupported-edit", message: "Original refusal", location: location.token }] });
  for (const limits of [{ diagnosticBytes: 1 }, { serializedOutput: 1 }, { retainedBytes: 1 }]) {
    expect(() => adapter.serializeDiagramMutationFailure("xml.set", error, "unsupported-edit", "Original refusal", new DocumentBudget(limits))).toThrow(/limit exceeded/);
  }
  const controller = new AbortController(); controller.abort();
  expect(() => adapter.serializeDiagramMutationFailure("paragraphs.set", error, "unsupported-edit", "Original refusal", new DocumentBudget({}, controller.signal))).toThrow(/cancelled/);
});

it("reads an empty diagram inventory once without publication or mutation", async () => {
  const bytes = await textFixture(paragraph("Original bounded passage")), volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes) });
  let reads = 0, stdout = "", stderr = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["diagrams", "list", "input.docx", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { reads++; return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode, stderr).toBe(0); expect(reads).toBe(1);
  expect(JSON.parse(stdout)).toMatchObject({ operation: "diagrams.list", ok: true, data: { items: [] }, affected: 0, locations: [], warnings: [], errors: [] });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(bytes));
});

it("rejects scoped diagram selection before capability reads", async () => {
  let reads = 0;
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["diagrams", "list", "input.docx", "--scope", "headers", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { reads++; throw new Error("Poisoned capability"); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(2); expect(reads).toBe(0);
});
