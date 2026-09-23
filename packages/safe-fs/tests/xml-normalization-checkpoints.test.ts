import { Volume } from "memfs";
import { expect, it } from "vitest";
import { parseXml, parseXmlSteps } from "../src/xml.js";

const cases = [
  { padding: 0, input: "\r", text: "\n", checkpoints: [8] },
  { padding: 0, input: "\r\n", text: "\n", checkpoints: [8] },
  { padding: 506, input: "🌊", text: "🌊", checkpoints: [512, 3] },
  { padding: 507, input: "🌊", text: "🌊", checkpoints: [512, 4] },
  { padding: 508, input: "🌊", text: "🌊", checkpoints: [512, 4] },
  { padding: 509, input: "🌊", text: "🌊", checkpoints: [512, 6] },
  { padding: 507, input: "\r\n", text: "\n", checkpoints: [512, 3] },
  { padding: 508, input: "\r\n", text: "\n", checkpoints: [512, 4] },
  { padding: 509, input: "\r\n", text: "\n", checkpoints: [512, 5] },
  { padding: 1019, input: "🌊", text: "🌊", checkpoints: [512, 512, 4] },
  { padding: 1020, input: "🌊", text: "🌊", checkpoints: [512, 512, 4] },
  { padding: 508, input: "\r🌊\r\n", text: "\n🌊\n", checkpoints: [512, 7] }
];

for (const bom of ["", "\ufeff"]) for (const retainContent of [false, true])
for (const item of cases)
it(`XML normalization preserves original cooperative boundaries; bom=${Boolean(bom)}; retained=${retainContent}; padding=${item.padding}; input=${JSON.stringify(item.input)}`, () => {
  const source = bom + "<r>" + "x".repeat(item.padding) + item.input + "</r>";
  const memory = Volume.fromJSON({ "/input": source });
  const parser = parseXmlSteps(memory.readFileSync("/input", "utf8") as string, { retainContent });
  for (const work of item.checkpoints) expect(parser.next()).toEqual({ done: false, value: work });
  let result = parser.next();
  while (!result.done) result = parser.next();
  expect(result.value.text).toBe("x".repeat(item.padding) + item.text);
  expect(result.value.content).toEqual(retainContent ? [{ kind: "text", text: "x".repeat(item.padding) + item.text }] : []);
  expect(memory.readFileSync("/input", "utf8")).toBe(source);
});

for (const padding of [0, 508, 509, 1020])
for (const character of ["\u0000", "\u0008", "\u000b", "\u000c", "\u001f", "\ud800", "\udfff", "\ufffe", "\uffff"])
it(`XML normalization still rejects prohibited characters; padding=${padding}; character=${JSON.stringify(character)}`, () => {
  // memfs bytes intentionally preserve lone UTF-16 surrogates as JSON escapes.
  const source = "<r>" + "x".repeat(padding) + character + "</r>";
  const memory = Volume.fromJSON({ "/input": JSON.stringify(source) });
  expect(() => parseXml(JSON.parse(memory.readFileSync("/input", "utf8") as string))).toThrow("invalid character");
  expect(memory.readFileSync("/input", "utf8")).toBe(JSON.stringify(source));
});

for (const bom of ["", "\ufeff"]) for (const retainContent of [false, true])
it(`XML normalization retains expanded names, scalar and attribute line endings; bom=${Boolean(bom)}; retained=${retainContent}`, () => {
  const source = bom + '<r xmlns:p="urn:p" p:a="x\r\ny\rz\tend">A\r\nB\rC\n🌊<![CDATA[D\r\nE]]><!--F\rG--><?go H\r\nI?><p:child/></r>';
  const memory = Volume.fromJSON({ "/input": source });
  const root = parseXml(memory.readFileSync("/input", "utf8") as string, { retainContent });
  expect(root.text).toBe("A\nB\nC\n🌊D\nE");
  expect(root.children[0]).toMatchObject({ name: "p:child", namespace: "urn:p", localName: "child" });
  expect(root.attributes).toEqual(retainContent ? [
    { name: "xmlns:p", namespace: "http://www.w3.org/2000/xmlns/", localName: "p", value: "urn:p" },
    { name: "p:a", namespace: "urn:p", localName: "a", value: "x y z end" }
  ] : []);
  if (retainContent) {
    expect(root.content[1]).toEqual({ kind: "cdata", text: "D\nE" });
    expect(root.content[2]).toEqual({ kind: "comment", text: "F\nG" });
    expect(root.content[3]).toEqual({ kind: "processing-instruction", target: "go", text: "H\nI" });
  }
  expect(memory.readFileSync("/input", "utf8")).toBe(source);
});

for (const lineEnding of ["\r", "\r\n", "\n"])
for (const count of [511, 512, 513, 1023, 1024, 1025, 16384])
for (const bom of ["", "\ufeff"]) for (const retainContent of [false, true])
it(`XML normalization keeps dense line endings and checkpoints; ending=${JSON.stringify(lineEnding)}; count=${count}; bom=${Boolean(bom)}; retained=${retainContent}`, () => {
  const source = bom + "<r>" + lineEnding.repeat(count) + "</r>";
  const memory = Volume.fromJSON({ "/input": source });
  const parser = parseXmlSteps(memory.readFileSync("/input", "utf8") as string, { retainContent });
  const normalizedLength = count + 7;
  for (let full = 0; full < Math.floor(normalizedLength / 512); full++)
    expect(parser.next()).toEqual({ done: false, value: 512 });
  if (normalizedLength % 512) expect(parser.next()).toEqual({ done: false, value: normalizedLength % 512 });
  let result = parser.next();
  while (!result.done) result = parser.next();
  expect(result.value.text).toBe("\n".repeat(count));
  expect(memory.readFileSync("/input", "utf8")).toBe(source);
});
