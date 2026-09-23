import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const route of ["source", "native"] as const) {
  const api = route === "source" ? source : native;
  const fixture = async () => {
    const controller = new AbortController(), budget = new api.DocumentBudget({}, controller.signal), context = { ...textContext, signal: controller.signal, budget };
    const body = '<w:p><w:r><w:t>Keep</w:t></w:r></w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:projection" mc:Ignorable="f"><mc:Choice Requires="f"><f:future>Future</f:future></mc:Choice><mc:Fallback><w:p><w:r><w:t>Fallback</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>';
    const parts = readPackage(await textFixture(body, {}, strict, { kind }), textContext.limits);
    if (codec !== "utf8") for (const [name, bytes] of parts) {
      const buffer = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
      if (codec === "utf16be") buffer.swap16();
      parts.set(name, new Uint8Array(buffer));
    }
    const memory = Volume.fromJSON({ "/input": "" });
    await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
    const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = input.slice(), archive = await api.readDocumentArchive(input, context);
    const parsed = api.parseDocumentXml(archive.members.find(member => member.name === "word/document.xml")!.bytes, {}, budget);
    expect(Object.isFrozen(parsed.root)).toBe(true);
    return { parsed, controller, budget, context, memory, input, before, parts };
  };

  it(`${route} preserves immutable compatibility profile, projection and exact node ownership; strict=${strict}; kind=${kind}; codec=${codec}`, async () => {
    const { parsed, budget, memory, input, before, parts } = await fixture(), body = parsed.root.children[0]!, alternate = body.children[1]!, future = alternate.children[0]!.children[0]!;
    const narrow = new api.MarkupCompatibility(parsed.root, api.documentCompatibilityProfile, budget), originalContent = narrow.content;
    expect(narrow.branches[0]!.selected).toBe(alternate.children[1]); expect(narrow.canEdit(future)).toBe(false); expect(narrow.canEdit(body.children[0]!)).toBe(true);
    const expandedProfile = { understoodNamespaces: [...api.documentCompatibilityProfile.understoodNamespaces, "urn:original:projection"] };
    const expanded = new api.MarkupCompatibility(parsed.root, expandedProfile, budget);
    expect(expanded.branches[0]!.selected).toBe(alternate.children[0]); expect(expanded.canEdit(future)).toBe(true);
    Reflect.set(narrow, "content", []); Reflect.set(narrow, "branches", []);
    const fresh = new api.MarkupCompatibility(parsed.root, api.documentCompatibilityProfile, budget);
    expect(fresh.content).toEqual(originalContent); expect(fresh.branches[0]!.selected).toBe(alternate.children[1]); expect(fresh.canEdit(future)).toBe(false);
    const foreign = api.parseDocumentXml(new TextEncoder().encode('<f:future xmlns:f="urn:original:projection">Future</f:future>')).root;
    expect(expanded.canEdit(foreign)).toBe(false); expect(fresh.canEdit(foreign)).toBe(false);
    expect(Object.isFrozen(fresh.content)).toBe(true); expect(Object.isFrozen(fresh.branches)).toBe(true);
    expect(input).toEqual(before); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(before);
    for (const [name, bytes] of readPackage(input, textContext.limits)) expect(bytes).toEqual(parts.get(name));
  });

  for (const resource of ["work", "retainedBytes"] as const)
  it(`${route} replays complete compatibility ${resource} reservations and cancellation; strict=${strict}; kind=${kind}; codec=${codec}`, async () => {
    const { parsed, controller, budget, memory, input, before } = await fixture(), initial = budget.usage;
    new api.MarkupCompatibility(parsed.root, api.documentCompatibilityProfile, budget);
    const first = budget.usage, cost = first[resource] - initial[resource]; expect(cost).toBeGreaterThan(0);
    new api.MarkupCompatibility(parsed.root, api.documentCompatibilityProfile, budget);
    const second = budget.usage; expect(second.work - first.work).toBe(first.work - initial.work); expect(second.retainedBytes - first.retainedBytes).toBe(first.retainedBytes - initial.retainedBytes);
    const lower = budget.lower({ [resource]: second[resource] + cost - 1 });
    expect(() => new api.MarkupCompatibility(parsed.root, api.documentCompatibilityProfile, lower)).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
    controller.abort(); expect(() => new api.MarkupCompatibility(parsed.root, api.documentCompatibilityProfile, budget)).toThrowError(expect.objectContaining({ code: "cancelled" }));
    expect(input).toEqual(before); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(before);
  });
}

for (const route of ["source", "native"] as const) for (const shallowFreeze of [false, true])
it(`${route} unadmitted mutable and caller-shallow-frozen roots recompute compatibility; shallowFreeze=${shallowFreeze}`, () => {
  const api = route === "source" ? source : native, word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main", foreign = "urn:original:caller-mutable", memory = Volume.fromJSON({ "/xml": `<w:document xmlns:w="${word}" xmlns:f="${foreign}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><w:p><w:r><w:t>Keep</w:t></w:r></w:p></w:body></w:document>` });
  const input = new Uint8Array(memory.readFileSync("/xml") as Buffer), before = input.slice(), root = api.parseDocumentXml(input).root, paragraph = root.children[0]!.children[0]!, budget = new api.DocumentBudget();
  expect(Object.isFrozen(paragraph)).toBe(false); if (shallowFreeze) Object.freeze(root);
  const first = new api.MarkupCompatibility(root, api.documentCompatibilityProfile, budget); expect(first.canEdit(paragraph)).toBe(true);
  expect(Reflect.set(paragraph, "namespace", foreign)).toBe(true);
  const second = new api.MarkupCompatibility(root, api.documentCompatibilityProfile, budget); expect(second.canEdit(paragraph)).toBe(false);
  expect(second.content).toMatchObject([{ content: [{ content: [] }] }]);
  expect(input).toEqual(before); expect(new Uint8Array(memory.readFileSync("/xml") as Buffer)).toEqual(before);
});
