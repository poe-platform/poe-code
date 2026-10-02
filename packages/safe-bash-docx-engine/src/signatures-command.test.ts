import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

async function execute(args: string[]) {
  const input = await textFixture(paragraph("Coastal record"));
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
