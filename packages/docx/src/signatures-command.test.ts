import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { signatureFixture } from "../tests/fixtures/signatures.js";

async function execute(args: string[], suppliedInput?: Uint8Array) {
  const input = suppliedInput ?? await textFixture(paragraph("Coastal record"));
  const volume = Volume.fromJSON({ "/out": "", "/err": "" });
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  return { ...result, stdout: String(volume.readFileSync("/out", "utf8")), stderr: String(volume.readFileSync("/err", "utf8")) };
}

it("lists signature structures through the public command contract without verification", async () => {
  const result = await execute(["signatures", "list", "/input", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ operation: "signatures.list", ok: true, affected: 0, data: { items: [], relationships: [], verified: null } });
});

it("matches SDK inventory and exact stripping effects for multiple signatures", async () => {
  const input = await signatureFixture();
  const listed = await execute(["signatures", "list", "/input", "--json"], input);
  expect(listed.exitCode).toBe(0);
  expect(JSON.parse(listed.stdout).data).toEqual(await docx.inspectDocumentSignatures(input, {}, textContext));
  const removed = await execute(["signatures", "remove", "/input", "--dry-run", "--json"], input);
  expect(removed.exitCode).toBe(0);
  expect(JSON.parse(removed.stdout).data).toEqual(await docx.stripDocumentSignatures(input, { dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } }));
});

it("rejects signed edits and unsafe stripping through the common error contract", async () => {
  const signed = await signatureFixture();
  const edit = await execute(["text", "replace", "/input", "--find", "Harbor", "--with", "Coastal", "--all", "--dry-run", "--json"], signed);
  expect(edit.exitCode).toBe(1);
  expect(JSON.parse(edit.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] });
  const unsafe = await execute(["signatures", "remove", "/input", "--dry-run", "--json"], await signatureFixture("incoming"));
  expect(unsafe.exitCode).toBe(1);
  expect(JSON.parse(unsafe.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] });
});

it("requires explicit no-change consent for an unsigned package", async () => {
  const rejected = await execute(["signatures", "remove", "/input", "--dry-run", "--json"]);
  expect(rejected.exitCode).toBe(1);
  const allowed = await execute(["signatures", "remove", "/input", "--dry-run", "--allow-empty", "--json"]);
  expect(allowed.exitCode).toBe(0);
  expect(JSON.parse(allowed.stdout)).toMatchObject({ operation: "signatures.remove", affected: 0, data: { changed: false, dryRun: true, removedParts: [], removedRelationships: [], removedContentTypes: [] } });
});

it("publishes truthful signature discovery and rejects story selectors", async () => {
  const discovery = docx.getDocxDiscovery(docx.parseDocxArguments(["schema"].map(value => new TextEncoder().encode(value))))!;
  expect("operations" in discovery.data && discovery.data.operations.find(operation => operation.id === "signatures.list")?.support).toBe("read");
  expect("operations" in discovery.data && discovery.data.operations.find(operation => operation.id === "signatures.remove")?.support).toBe("edit");
  expect((await execute(["signatures", "list", "/input", "--paragraph", "1"])).exitCode).toBe(2);
});
