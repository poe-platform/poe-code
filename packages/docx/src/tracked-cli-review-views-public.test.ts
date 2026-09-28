import { SaxesParser } from "saxes";
import { Volume } from "memfs";
import { beforeAll, describe, expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { mainThreadFixture } from "../tests/main-thread.js";

const executeNative = mainThreadFixture(new URL("../tests/fixtures/tracked-cli-review-views-native.mjs", import.meta.url));

const generated = new Map<string, Uint8Array>();

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"]) for (const carrier of ["choice", "fallback", "process"]) for (const depth of [4096])
describe(`nested tracked carrier; strict=${strict}; kind=${kind}; route=${route}; carrier=${carrier}; depth=${depth}`, () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const selected = '<w:t>A Coast B</w:t>';
  const inactive = '<w:t>Inactive</w:t>';
  const retained = carrier === "choice" ? '<mc:Fallback>' + inactive + '</mc:Fallback>' : carrier === "fallback" ? '<mc:Choice Requires="f">' + inactive + '</mc:Choice>' : '<f:opaque>' + inactive + '</f:opaque>';
  const nested = carrier === "choice" ? '<mc:AlternateContent><mc:Choice Requires="w">'.repeat(depth) + selected + '</mc:Choice><mc:Fallback/></mc:AlternateContent>'.repeat(depth) : '<f:pass>'.repeat(depth) + selected + '</f:pass>'.repeat(depth);
  const wrapped = carrier === "choice" ? '<mc:AlternateContent><mc:Choice Requires="w">' + nested + '</mc:Choice>' + retained + '</mc:AlternateContent>' : carrier === "fallback" ? '<mc:AlternateContent>' + retained + '<mc:Fallback>' + nested + '</mc:Fallback></mc:AlternateContent>' : '<f:pass>' + nested + '</f:pass>' + retained;
  const content = '<w:p xmlns:f="urn:original:tracked-active-carrier" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">' + ('<w:r><w:rPr><w:b/></w:rPr>' + wrapped + '</w:r>') + '</w:p>';
  const original = "A Coast B", key = JSON.stringify([strict, kind, route, carrier, depth]);
  const limits = { ...textContext.limits, maxArchiveBytes: 67108864, maxEntryBytes: 33554432, maxTotalBytes: 134217728, maxRetainedBytes: 2 ** 31 };
  let fixture: { input: Uint8Array; memory: Volume; parts: Map<string, Uint8Array> };
  beforeAll(async () => {
    const memory = Volume.fromJSON({ "/input": "" });
    const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict, { kind }));
    parts.set("word/document.xml", new TextEncoder().encode('<w:document xmlns:w="' + word + '"><w:body>' + content + '</w:body></w:document>'));
    await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
    fixture = { input: new Uint8Array(memory.readFileSync("/input") as Buffer), memory, parts };
  });
  for (const phase of ["edit", "preservation", "baseline", "original", "final", "all", "decision-accept", "decision-reject"])
  it(`tracked partial replacement retains nested active native carriers; strict=${strict}; kind=${kind}; route=${route}; carrier=${carrier}; depth=${depth}; phase=${phase}`, async () => {
  const { memory } = fixture;
  if (phase === "preservation" || phase === "original" || phase === "final" || phase === "all" || phase.startsWith("decision-")) expect(generated.has(key), "The independently asserted edit must have produced its candidate.").toBe(true);
  const result = phase === "preservation" ? JSON.stringify({ ok: true, output: Buffer.from(generated.get(key)!).toString("base64") }) : await executeNative({
    input: Buffer.from(phase === "original" || phase === "final" || phase === "all" || phase.startsWith("decision-") ? generated.get(key)! : fixture.input).toString("base64"), limits, route, phase
  });
  const response = JSON.parse(result) as { ok: boolean; output: string; text: string; outputBytes: number; error?: string; stack?: string };
  expect(response, response.stack ?? response.error).toMatchObject({ ok: true });
  if (phase.startsWith("decision-")) {
    expect(response).toMatchObject({ decisionCode: "unsupported-edit", affected: 0, outputBytes: 0, retainedSourceDestination: true });
    expect(Buffer.compare(memory.readFileSync("/input") as Buffer, fixture.input)).toBe(0);
    return;
  }
  if (phase !== "edit" && phase !== "preservation") {
    expect(response).toMatchObject({ text: phase === "final" ? original.replace("Coast", "Shore") : phase === "all" ? original.replace("Coast", "CoastShore") : original, outputBytes: 0, actualCliView: phase === "baseline" ? "final" : phase });
    expect(Buffer.compare(memory.readFileSync("/input") as Buffer, fixture.input)).toBe(0);
    return;
  }
  if (phase === "edit") {
    generated.set(key, new Uint8Array(Buffer.from(response.output, "base64")));
    return;
  }
  const before = fixture.parts, after = readPackage(new Uint8Array(Buffer.from(response.output, "base64")), {
    maxArchiveBytes: limits.maxArchiveBytes, maxEntryBytes: limits.maxEntryBytes, maxTotalBytes: limits.maxTotalBytes
  });
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(Buffer.compare(after.get(name)!, bytes), name).toBe(0);
  expect(Buffer.compare(memory.readFileSync("/input") as Buffer, fixture.input)).toBe(0);
  const source = new TextDecoder().decode(after.get("word/document.xml"));
  expect(source).toContain(retained);
  const parser = new SaxesParser({ xmlns: true });
  const owners: { uri: string; local: string }[] = [];
  const revisions: { kind: string; id: string; author: string; date: string; text: string; bold: string | null; italic: string | null }[] = [];
  let current: typeof revisions[number] | undefined;
  let paragraphCount = 0;
  parser.on("opentag", tag => {
    if (tag.uri === word && tag.local === "p") paragraphCount++;
    if (tag.uri === word && (tag.local === "ins" || tag.local === "del")) {
      expect(owners.some(node => node.uri === word && node.local === "p")).toBe(true);
      const attr = (local: string) => Object.values(tag.attributes).find(value => value.uri === word && value.local === local)?.value ?? "";
      current = { kind: tag.local, id: attr("id"), author: attr("author"), date: attr("date"), text: "", bold: null, italic: null };
      revisions.push(current);
    }
    if (current && tag.uri === word && ["t", "delText"].includes(tag.local)) {
      expect([...owners].reverse().find(node => node.uri === word)).toEqual({ uri: word, local: "r" });
      expect(tag.local).toBe(current.kind === "del" ? "delText" : "t");
    }
    if (current && tag.uri === word && ["b", "i"].includes(tag.local)) {
      expect(owners.at(-1)).toEqual({ uri: word, local: "rPr" });
      const val = Object.values(tag.attributes).find(value => value.uri === word && value.local === "val")?.value ?? "1";
      if (tag.local === "b") current.bold = val; else current.italic = val;
    }
    owners.push({ uri: tag.uri, local: tag.local });
  });
  parser.on("text", value => { if (current && owners.at(-1)?.uri === word && ["t", "delText"].includes(owners.at(-1)!.local)) current.text += value; });
  parser.on("closetag", tag => { owners.pop(); if (tag.uri === word && ["ins", "del"].includes(tag.local)) current = undefined; });
  parser.write(source).close();
  expect(paragraphCount).toBe(1);
  expect(revisions).toEqual([
    { kind: "del", id: "1", author: "", date: "2026-01-02T03:04:06Z", text: "Coast", bold: "1", italic: null },
    { kind: "ins", id: "2", author: "", date: "2026-01-02T03:04:06Z", text: "Shore", bold: "0", italic: "1" }
  ]);
  });
});
