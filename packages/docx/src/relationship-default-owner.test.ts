import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

async function document() {
  const volume = Volume.fromJSON({ "/input": Buffer.from(await textFixture(paragraph("Channel survey") + "<w:sectPr/>")) });
  return api.Document(new Uint8Array(volume.readFileSync("/input") as Buffer), textContext);
}

it("rejects foreign, detached and untyped relationship defaults without mutation", async () => {
  const doc = await document(), rels = doc.styles.part.rels;
  const foreign = (await document()).styles.part.rels.add_relationship("urn:inert", "https://example.test/data", "rId99", true);
  const detached = rels.add_relationship("urn:inert", "https://example.test/data", "rId99", true);
  rels.delete("rId99");
  const before = rels.xml;
  for (const fallback of [foreign, detached, false, 0, "", {}]) {
    expect(() => rels.get("absent", fallback as api.RelationshipView)).toThrow();
    expect(() => rels.pop("absent", fallback as api.RelationshipView)).toThrow();
  }
  expect(rels.xml).toBe(before);
  expect(rels.get("absent")).toBeNull();
  expect(rels.get("absent", null)).toBeNull();
  expect(rels.pop("absent", null)).toBeNull();
  expect(() => rels.pop("absent")).toThrow(api.MissingKeyError);
  const owned = rels.add_relationship("urn:inert", "https://example.test/owned", "rId7", true);
  expect(rels.get("absent", owned)).toBe(owned);
  expect(rels.pop("absent", owned)).toBe(owned);
  expect(rels.has("rId7")).toBe(true);
});

it("reports a detached relationship default through the SDK-backed CLI without publication", async () => {
  const bytes = await textFixture(paragraph("Channel record"));
  const volume = Volume.fromJSON({ "/input": Buffer.from(bytes), "/stdout": "", "/stderr": "" });
  const ref = (resultHandle: string) => ({ resultHandle });
  const operations = [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.part.get", receiver: ref("styles"), arguments: {}, resultHandle: "part" },
    { operation: "model.opc.part.Part.rels.get", receiver: ref("part"), arguments: {}, resultHandle: "rels" },
    { operation: "model.opc.rel.Relationships.add_relationship.call", receiver: ref("rels"), arguments: { reltype: "urn:inert", target: "https://example.test/inert", rId: "rId99", isExternal: true }, resultHandle: "edge" },
    { operation: "model.opc.rel.Relationships.__delitem__.call", receiver: ref("rels"), arguments: { rId: "rId99" } },
    { operation: "model.opc.rel.Relationships.get.call", receiver: ref("rels"), arguments: { rId: "absent", defaultValue: ref("edge") } }
  ];
  const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input", "--ops-json", JSON.stringify({ version: 1, operations }), "--dry-run", "--json"].map(value => new TextEncoder().encode(value)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { volume.appendFileSync("/stdout", chunk); } },
    stderr: { async write(chunk) { volume.appendFileSync("/stderr", chunk); } }
  });
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(volume.readFileSync("/stdout", "utf8") as string)).toMatchObject({ version: 1, operation: "batch", ok: false, data: null, affected: 0, errors: [{ code: "stale-selection" }] });
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(bytes));
  expect(volume.readFileSync("/stderr", "utf8")).not.toContain("Channel record");
});
