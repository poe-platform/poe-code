import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const compiled = await compiledPublicRuntime;
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const shape of ["ignored-property", "processed-property", "fallback-property", "run-attribute"] as const)
for (const remaining of [0, 1, "default"] as const)
it(`comment anchor refuses relocated opaque ownership before allocation; runtime=${runtime}; strict=${strict}; kind=${kind}; shape=${shape}; remaining=${remaining}`, async () => {
  const api = runtime === "source" ? source : compiled;
  const properties = shape === "ignored-property" ? '<w:rPr><w:i/><o:leaf/></w:rPr>'
    : shape === "processed-property" ? '<w:rPr><o:carrier><w:i/></o:carrier></w:rPr>'
    : shape === "fallback-property" ? '<w:rPr><mc:AlternateContent><mc:Choice Requires="o"><o:leaf/></mc:Choice><mc:Fallback><w:i/></mc:Fallback></mc:AlternateContent></w:rPr>' : "";
  const input = await textFixture(`<w:p xmlns:o="urn:original:anchor-preflight" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="o" mc:ProcessContent="o:carrier"><w:r${shape === "run-attribute" ? ' o:stored="Retained海🌊"' : ""}>${properties}<w:t>Coastal anchor</w:t></w:r></w:p>`, {}, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/destination": "Retained destination" });
  const budget = new api.DocumentBudget();
  const document = await api.Document(new Uint8Array(memory.readFileSync("/input") as Buffer), { ...textContext, budget, timestamp: new Date("2026-03-04T05:06:07Z") });
  const run = document.paragraphs[0]!.runs[0]!;
  const before = document.part.package.parts.map(part => [String(part.partname), part.blob]);
  if (remaining !== "default") budget.charge("insertedNodes", budget.limits.insertedNodes - budget.usage.insertedNodes - remaining);
  expect(() => document.add_comment(run, "Unsafe opaque note", "")).toThrow(api.UnsupportedEditError);
  expect(document.part.package.parts.map(part => [String(part.partname), part.blob])).toEqual(before);
  expect(document.part.package.parts.filter(part => part.content_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml")).toHaveLength(0);
  const emitted: Uint8Array[] = [];
  await document.save({ async write(bytes) { emitted.push(bytes); } });
  expect(Buffer.concat(emitted)).toEqual(Buffer.from(input));
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  expect(memory.readFileSync("/destination", "utf8")).toBe("Retained destination");
});

for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`comment anchor preserves unrelated opaque properties; runtime=${runtime}; strict=${strict}; kind=${kind}`, async () => {
  const api = runtime === "source" ? source : compiled;
  const opaque = '<w:p xmlns:o="urn:original:anchor-preflight" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="o"><w:r><w:rPr><o:leaf o:stored="Retained海🌊"/></w:rPr><w:t>Unselected</w:t></w:r></w:p>';
  const input = await textFixture('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Coastal anchor</w:t></w:r></w:p>' + opaque, {}, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const document = await api.Document(input, { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z") });
  const comment = document.add_comment(document.paragraphs[0]!.runs[0]!, "Admitted note", "");
  expect(comment.comment_id).toBe(0);
  expect(comment.text).toBe("Admitted note");
  await document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  const output = await api.readArchive(new Uint8Array(memory.readFileSync("/output") as Buffer), textContext);
  expect(new TextDecoder().decode(output.members.find(member => member.name === "word/document.xml")!.bytes)).toContain(opaque);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
