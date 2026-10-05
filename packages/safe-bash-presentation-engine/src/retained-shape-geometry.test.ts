import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { openRetainedXmlDocument } from "./retained-xml-document.js";
import { literal } from "./retained-values.js";
import { streamJson } from "./retained-output.js";
import { parseXmlPart } from "./xml.js";
import { readShapeGeometry } from "./shape-transforms.js";
import { openRetainedShapeGeometry } from "./retained-shape-geometry.js";
import { readRetainedXmlScalar } from "./retained-xml-scalars.js";
import { readXmlCoordinate, readXmlInteger, readXmlPercentage } from "./xml-scalars.js";

for (const value of [
  "0",
  "-0",
  " +0005\t",
  "1.5pt",
  "-.5in",
  "1.mm",
  "1e3",
  "1 pt",
  "1.2",
  "-1.5%",
  "9007199254740992",
  "\u00a01",
  "1..2pt",
  "in",
  "+",
  "1pi",
  "1cm",
  "1pc",
  "1mm",
  "1in"
])
  for (const kind of ["integer", "coordinate", "percentage"] as const)
    it(`matches ${kind} scalar admission for ${JSON.stringify(value)}`, async () => {
      const buffered = {
        integer: readXmlInteger,
        coordinate: readXmlCoordinate,
        percentage: readXmlPercentage
      }[kind];
      let expected: number | undefined, error: unknown;
      try {
        expected = buffered(value);
      } catch (e) {
        error = e;
      }
      const result = readRetainedXmlScalar(kind, literal(value), () => {});
      if (error)
        await expect(result).rejects.toMatchObject({ code: (error as { code: string }).code });
      else expect(await result).toBe(expected);
    });

const p = "http://schemas.openxmlformats.org/presentationml/2006/main",
  a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const transform = (group = false, rotation = "5400000", width = "40") =>
  `<a:xfrm rot="${rotation}" flipH="1"><a:off x="-10" y="20"/><a:ext cx="${width}" cy="20"/>${group ? '<a:chOff x="1" y="2"/><a:chExt cx="100" cy="100"/>' : ""}</a:xfrm>`;
for (const strict of [false, true])
  for (const depth of [0, 1, 3])
    for (const variant of ["valid", "fraction", "missing", "singular", "invalid", "duplicate"])
      it(`projects retained geometry ${strict}/${depth}/${variant}`, async () => {
        let own = transform(
          false,
          variant === "invalid" ? "oops" : "5400000",
          variant === "fraction" ? "00040" : "40"
        );
        if (variant === "missing") own = "";
        if (variant === "duplicate") own += own;
        let content = `<p:pic><p:spPr>${own}</p:spPr></p:pic>`;
        for (let i = 0; i < depth; i++)
          content = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${i}"/></p:nvGrpSpPr><p:grpSpPr>${transform(true, "10800000", variant === "singular" ? "0" : "300")}</p:grpSpPr>${content}</p:grpSp>`;
        const source = `<p:root xmlns:p="${strict ? "http://purl.oclc.org/ooxml/presentationml/main" : p}" xmlns:a="${strict ? "http://purl.oclc.org/ooxml/drawingml/main" : a}">${content}</p:root>`;
        const buffered = parseXmlPart(new TextEncoder().encode(source), {
          maxBytes: 100000,
          maxNodes: 1000,
          maxDepth: 64
        });
        let node = buffered.root.children[0]!;
        while (node.name.localName === "grpSp") node = node.children[2]!;
        let expected, error;
        try {
          expected = readShapeGeometry(buffered.root, node);
        } catch (e) {
          error = e;
        }
        const fs = createMemoryFileSystem(),
          context = { workingStorage: { fs, directory: "/", cacheBytes: 16384 } };
        const doc = await openRetainedXmlDocument(literal(source), context);
        try {
          let target = doc.root;
          for await (const current of doc.elements(doc.root))
            if ((await text(doc.raw(current.localName))) === "pic") target = current;
          const promise = openRetainedShapeGeometry(doc, target, context);
          if (error)
            await expect(promise).rejects.toMatchObject({
              code: (error as { code: string }).code,
              message: (error as Error).message
            });
          else {
            const result = await promise;
            try {
              expect(JSON.parse(await text(streamJson(result.value)))).toEqual(expected);
            } finally {
              await result.close();
            }
          }
        } finally {
          await doc.close();
        }
        expect(await fs.readdir("/")).toEqual([]);
      });
async function text(source: AsyncIterable<Uint8Array>) {
  let s = "";
  const decoder = new TextDecoder();
  for await (const b of source) s += decoder.decode(b, { stream: true });
  return s + decoder.decode();
}

it("parses generated numeric padding and precision with reused chunks", async () => {
  let retired = false;
  const source = (async function* () {
    const reuse = new Uint8Array(4096).fill(48);
    try {
      yield* literal(" -");
      for (let i = 0; i < 40; i++) yield reuse;
      yield* literal("1.");
      for (let i = 0; i < 40; i++) yield reuse;
      yield* literal("5pt\t");
    } finally {
      retired = true;
    }
  })();
  expect(await readRetainedXmlScalar("coordinate", source, () => {})).toBe(-12700);
  expect(retired).toBe(true);
});
it("retires a numeric source when cancelled", async () => {
  const controller = new AbortController();
  let retired = false;
  const source = (async function* () {
    try {
      yield* literal("1");
      controller.abort();
      yield* literal("23");
    } finally {
      retired = true;
    }
  })();
  await expect(
    readRetainedXmlScalar("integer", source, () => controller.signal.throwIfAborted())
  ).rejects.toThrow();
  expect(retired).toBe(true);
});
it("streams long group identities and rejects use after close", async () => {
  const id = "α".repeat(12000),
    source = `<p:root xmlns:p="${p}" xmlns:a="${a}"><p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}"/></p:nvGrpSpPr><p:grpSpPr>${transform(true)}</p:grpSpPr><p:pic><p:spPr>${transform()}</p:spPr></p:pic></p:grpSp></p:root>`;
  const fs = createMemoryFileSystem(),
    context = { workingStorage: { fs, directory: "/", cacheBytes: 16384 } };
  const doc = await openRetainedXmlDocument(literal(source), context);
  try {
    let node = doc.root;
    for await (const n of doc.elements(doc.root))
      if ((await text(doc.raw(n.localName))) === "pic") node = n;
    const result = await openRetainedShapeGeometry(doc, node, context);
    expect(JSON.parse(await text(streamJson(result.value))).groupPath).toEqual([id]);
    await result.close();
    await result.close();
    const again = await openRetainedShapeGeometry(doc, node, context);
    await again.close();
    await expect(text(streamJson(again.value))).rejects.toMatchObject({ code: "invalid-handle" });
  } finally {
    await doc.close();
  }
  expect(await fs.readdir("/")).toEqual([]);
});
