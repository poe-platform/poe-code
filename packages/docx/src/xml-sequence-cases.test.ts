import { Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { DocumentXmlEditor, parseDocumentXml } from "./index.js";

const names = ["orchard", "river", "stone"];
function fixture(sequence: readonly number[]) {
  const fs = Volume.fromJSON({ "/part.xml": `<record xmlns="urn:original:sequence"><!--retain-->${sequence.map(index => `<${names[index]} flag='unchanged'/>`).join("")}<?receipt kept?></record>` });
  const bytes = new Uint8Array(fs.readFileSync("/part.xml") as Uint8Array);
  return { fs, bytes, editor: new DocumentXmlEditor(bytes) };
}
function publish(state: ReturnType<typeof fixture>): string[] {
  state.fs.writeFileSync("/result.xml", state.editor.serialize());
  const result = new Uint8Array(state.fs.readFileSync("/result.xml") as Uint8Array);
  expect(new TextDecoder().decode(result)).toContain("<!--retain-->");
  expect(new TextDecoder().decode(result)).toContain("<?receipt kept?>");
  return parseDocumentXml(result).root.children.map(child => child.localName);
}

describe("ordered XML child observations", () => {
  it.each([
    { label: "middle match", sequence: [0, 1, 2], sought: [1, 2], expected: 1 },
    { label: "last match", sequence: [0, 2], sought: [1, 2], expected: 2 },
    { label: "missing last", sequence: [0, 1], sought: [2], expected: null },
    { label: "missing alternatives", sequence: [0], sought: [1, 2], expected: null },
    { label: "first among all", sequence: [1, 2], sought: [0, 1, 2], expected: 1 },
    { label: "empty sequence", sequence: [], sought: [0, 1, 2], expected: null }
  ])("observes the first selected child for $label", ({ sequence, sought, expected }) => {
    const state = fixture(sequence);
    const child = state.editor.root.children.find(node => sought.some(index => names[index] === node.localName)) ?? null;
    expect(child?.localName ?? null).toBe(expected === null ? null : names[expected]);
    if (child) expect(child).toBe(state.editor.root.content.find(node => node.kind === "element" && node === child));
    expect(state.editor.serialize()).toEqual(state.bytes);
  });
  it.each([
    { label: "two successors", sequence: [1, 2], inserted: 0, successors: [1, 2], expected: [0, 1, 2] },
    { label: "last successor", sequence: [2], inserted: 0, successors: [1, 2], expected: [0, 2] },
    { label: "empty parent", sequence: [], inserted: 0, successors: [1, 2], expected: [0] },
    { label: "middle insertion", sequence: [0, 2], inserted: 1, successors: [2], expected: [0, 1, 2] },
    { label: "append", sequence: [0, 1], inserted: 2, successors: [], expected: [0, 1, 2] }
  ])("inserts an owned child for $label", ({ sequence, inserted, successors, expected }) => {
    const state = fixture(sequence);
    const before = state.editor.root.children.find(node => successors.some(index => names[index] === node.localName));
    state.editor.insertChildren(state.editor.root, `<${names[inserted]} flag='unchanged'/>`, before);
    expect(publish(state)).toEqual(expected.map(index => names[index]));
    expect(new TextDecoder().decode(state.editor.serialize())).toContain("flag='unchanged'");
    expect(new Uint8Array(state.fs.readFileSync("/part.xml") as Uint8Array)).toEqual(state.bytes);
  });
  it.each([
    { label: "retain middle and last", sequence: [0, 1, 2], removed: [0], expected: [1, 2] },
    { label: "remove all once", sequence: [0, 1, 2], removed: [0, 1, 2], expected: [] },
    { label: "retain last", sequence: [0, 1, 2], removed: [0, 1], expected: [2] },
    { label: "remove repeated middle", sequence: [0, 0, 1, 1, 2, 2], removed: [1], expected: [0, 0, 2, 2] },
    { label: "remove middle", sequence: [0, 1, 2], removed: [1], expected: [0, 2] },
    { label: "retain middle", sequence: [0, 1, 2], removed: [0, 2], expected: [1] },
    { label: "no names", sequence: [0, 0, 1, 1, 2, 2], removed: [], expected: [0, 0, 1, 1, 2, 2] },
    { label: "remove last", sequence: [0, 1, 2], removed: [2], expected: [0, 1] },
    { label: "remove reversed names", sequence: [0, 1, 2], removed: [2, 1], expected: [0] },
    { label: "retain repeated last", sequence: [0, 0, 1, 1, 2, 2], removed: [0, 1], expected: [2, 2] },
    { label: "absent name", sequence: [0, 2], removed: [1], expected: [0, 2] },
    { label: "empty children", sequence: [], removed: [2, 1], expected: [] }
  ])("removes selected children for $label", ({ sequence, removed, expected }) => {
    const state = fixture(sequence);
    for (const child of state.editor.root.children) {
      if (removed.some(index => names[index] === child.localName)) state.editor.replaceElement(child, "");
    }
    expect(publish(state)).toEqual(expected.map(index => names[index]));
    expect(new Uint8Array(state.fs.readFileSync("/part.xml") as Uint8Array)).toEqual(state.bytes);
    expect(state.editor.root.children.map(child => child.localName)).toEqual(sequence.map(index => names[index]));
  });
});
