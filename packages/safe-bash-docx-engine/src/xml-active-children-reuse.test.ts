import { expect, it, vi } from "vitest";
import { DocumentBudget, documentXmlCache } from "./budget.js";
import { documentCompatibilityProfile } from "./compatibility.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { DocumentXmlEditor } from "./xml-write.js";

const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const bytes = new TextEncoder().encode(`<w:document xmlns:w="${word}"><w:body><w:p><w:r><w:t>Retained</w:t></w:r></w:p></w:body></w:document>`);

function admittedBudget(signal?: AbortSignal): DocumentBudget {
  const budget = new DocumentBudget({}, signal);
  budget[documentXmlCache].entries = new Map();
  budget[documentXmlCache].admitted = new WeakSet([bytes]);
  return budget;
}

it("shares immutable child arrays across editors over one admitted projection", () => {
  const budget = admittedBudget();
  const first = new DocumentXmlEditor(bytes, {}, undefined, budget);
  const second = new DocumentXmlEditor(bytes, {}, undefined, budget);
  expect(second.root).toBe(first.root);
  const before = first.sourceXml(first.root);
  const left = activeXmlChildren(first, budget)(first.root);
  const right = activeXmlChildren(second, budget)(second.root);
  expect(right).toBe(left);
  expect(Object.isFrozen(right)).toBe(true);
  expect(() => (right as unknown[]).push(first.root)).toThrow(TypeError);
  expect(second.sourceXml(second.root)).toBe(before);
  expect(activeXmlChildren(first, budget)(second.root)).toEqual([first.root.children[0]]);
});

it("replays the same projection reservations and refuses insufficient capacity and cancellation", () => {
  const controller = new AbortController(), budget = admittedBudget(controller.signal);
  const editors = Array.from({ length: 4 }, () => new DocumentXmlEditor(bytes, {}, undefined, budget));
  for (const editor of editors) void editor.compatibility;
  const charge = vi.spyOn(DocumentBudget.prototype, "charge");
  try {
    const initial = budget.usage;
    activeXmlChildren(editors[0]!, budget);
    const first = budget.usage, firstCharges = charge.mock.calls.slice();
    charge.mockClear();
    activeXmlChildren(editors[1]!, budget);
    const second = budget.usage;
    expect(charge.mock.calls).toEqual(firstCharges);
    const cost = first.retainedBytes - initial.retainedBytes;
    expect(cost).toBeGreaterThan(0);
    expect(second.retainedBytes - first.retainedBytes).toBe(cost);
    expect(() => activeXmlChildren(editors[2]!, budget.lower({ retainedBytes: second.retainedBytes + cost - 1 })))
      .toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
    controller.abort();
    expect(() => activeXmlChildren(editors[3]!, budget)).toThrowError(expect.objectContaining({ code: "cancelled" }));
  } finally { charge.mockRestore(); }
});

it("keeps different compatibility profiles and unadmitted editors isolated", () => {
  const input = new TextEncoder().encode(`<w:document xmlns:w="${word}" xmlns:f="urn:future" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><mc:AlternateContent><mc:Choice Requires="f"><f:future/></mc:Choice><mc:Fallback><w:p/></mc:Fallback></mc:AlternateContent></w:body></w:document>`);
  const budget = admittedBudget();
  budget[documentXmlCache].admitted!.add(input);
  const narrow = new DocumentXmlEditor(input, {}, undefined, budget);
  const broad = new DocumentXmlEditor(input, {}, { understoodNamespaces: [...documentCompatibilityProfile.understoodNamespaces, "urn:future"] }, budget);
  expect(broad.root).toBe(narrow.root);
  const body = narrow.root.children[0]!;
  expect(activeXmlChildren(narrow, budget)(body).map(node => node.localName)).toEqual(["p"]);
  expect(activeXmlChildren(broad, budget)(body).map(node => node.localName)).toEqual(["future"]);
  const foreign = new DocumentXmlEditor(bytes), other = new DocumentXmlEditor(bytes);
  const left = activeXmlChildren(foreign, new DocumentBudget())(foreign.root);
  const right = activeXmlChildren(other, new DocumentBudget())(other.root);
  expect(right).not.toBe(left);
  expect(right[0]).toBe(other.root.children[0]);
  expect(right[0]).not.toBe(foreign.root.children[0]);
});

it("does not share caller-substituted compatibility content as admitted authority", () => {
  const budget = admittedBudget();
  const first = new DocumentXmlEditor(bytes, {}, undefined, budget);
  const second = new DocumentXmlEditor(bytes, {}, undefined, budget);
  const substituted = Object.freeze([...first.compatibility.content]);
  Reflect.set(first.compatibility, "content", substituted);
  Reflect.set(second.compatibility, "content", substituted);
  const left = activeXmlChildren(first, budget)(first.root);
  const right = activeXmlChildren(second, budget)(second.root);
  expect(right).toEqual(left);
  expect(right).not.toBe(left);
});
