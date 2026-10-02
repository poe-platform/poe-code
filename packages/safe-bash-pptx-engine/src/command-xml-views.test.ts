import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { compileJsonSchema } from "toolcraft-schema";
import { createDeckFixture } from "../tests/fixtures/decks.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { opaqueContext } from "../tests/fixtures/opaque-deck.js";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { Presentation } from "./presentation-model.js";
import { readPackage } from "./package-reader.js";
import type { XmlElementView } from "./xml-view.js";
import { parseXmlPart } from "./xml.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const partname = "/ppt/slides/slide1.xml";
const context = {
  ...opaqueContext,
  validationLimits: {
    ...opaqueContext.xmlLimits,
    ...opaqueContext.relationshipLimits,
    maxEntries: 64
  }
};
const engine = createPptxCommandEngine({
  context,
  maxArgumentBytes: 65536,
  maxOutputBytes: 131072
});
function fixture() {
  const { volume, root } = createDeckFixture("seed-library");
  return storedArchive(
    Object.keys(volume.toJSON()).map((path) => ({
      name: path.slice(root.length + 1),
      bytes: new Uint8Array(volume.readFileSync(path) as Buffer)
    }))
  );
}
function find(root: XmlElementView, name: string): XmlElementView {
  const pending = [root];
  while (pending.length) {
    const node = pending.shift()!;
    if (node.tag.localName === name) return node;
    pending.push(...node.children);
  }
  throw new Error("Expected original fixture element.");
}
function invocation(source: Uint8Array, replacement: Uint8Array, flags: string[] = []) {
  const prior = encode("existing output stays intact");
  const volume = Volume.fromJSON({
    "/deck.pptx": Buffer.from(source),
    "/change.xml": Buffer.from(replacement),
    "/out.pptx": Buffer.from(prior)
  });
  const request = {
    args: [
      "xml",
      "set",
      "/deck.pptx",
      "--part",
      partname,
      "--scope",
      "slides",
      "--file",
      "/change.xml",
      "--json",
      ...flags
    ].map(encode),
    signal: new AbortController().signal,
    readInput: vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)),
    publishOutput: vi.fn(async (publication: PptxPublicationRequest) => {
      if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
    })
  };
  return { request, volume, prior };
}

describe("owned XML views and command publication", () => {
  it("retains repeated opaque run occurrences in model and command writes", async () => {
    const reader = await readPackage(fixture(), context);
    let document = parseXmlPart(reader.get(partname), context.validationLimits);
    const paragraphAt = () =>
      document.root.children[0]!.children[0]!.children[2]!.children.find(
        (node) => node.name.localName === "txBody"
      )!.children.find((node) => node.name.localName === "p")!;
    const retainedRun =
      '<a:r xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:x="urn:retained-data" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" x:marker="keep"><a:t>Retained note</a:t></a:r>';
    document = document.spliceChildren(paragraphAt(), 0, 1, [retainedRun, retainedRun]);
    const source = storedArchive(
      reader.names.map((name) => ({
        name: name.slice(1),
        bytes: name === partname ? document.bytes() : reader.get(name)
      }))
    );
    const replacement = document.spliceChildren(paragraphAt(), 1, 1, []).bytes();
    const deck = await Presentation(source, context);
    const paragraph = find(deck.part.package.get_part(partname)!.element, "p");
    expect(() => paragraph.remove(paragraph.children[1]!)).toThrowError(
      expect.objectContaining({ code: "unsupported-edit" })
    );
    const { request, volume, prior } = invocation(source, replacement, [
      "--output",
      "/out.pptx",
      "--force"
    ]);
    expect((await engine.execute(request)).exitCode).toBe(1);
    expect(request.publishOutput).not.toHaveBeenCalled();
    expect(new Uint8Array(volume.readFileSync("/out.pptx") as Buffer)).toEqual(prior);
  });

  it.each([
    ["append", ["nvGrpSpPr", "grpSpPr", "grpSp", "pic", "graphicFrame", "sp"]],
    ["insert", ["nvGrpSpPr", "grpSpPr", "pic", "sp", "grpSp", "graphicFrame"]],
    ["remove", ["nvGrpSpPr", "grpSpPr", "grpSp", "pic", "graphicFrame"]],
    ["replace", ["nvGrpSpPr", "grpSpPr", "pic", "grpSp", "graphicFrame"]]
  ] as const)(
    "publishes the same validated %s through the model and xml.set",
    async (operation, expected) => {
      const source = fixture();
      const deck = await Presentation(source, context);
      const part = deck.part.package.get_part(partname)!;
      const tree = find(part.element, "spTree");
      const title = tree.children[2]!;
      const picture = tree.children[4]!;
      if (operation === "append") tree.append(title);
      else if (operation === "insert") tree.insert(2, picture);
      else if (operation === "remove") tree.remove(title);
      else tree.replace(title, picture);
      expect(tree.children.map((child) => child.tag.localName)).toEqual(expected);
      const replacement = part.blob;
      const saved = await deck.save();
      const reopened = await Presentation(saved, context);
      expect(
        find(reopened.part.package.get_part(partname)!.element, "spTree").children.map(
          (child) => child.tag.localName
        )
      ).toEqual(expected);
      const { request, volume } = invocation(source, replacement, [
        "--output",
        "/out.pptx",
        "--force"
      ]);
      const result = await engine.execute(request);
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(decode(result.stdout));
      expect(json).toMatchObject({
        version: 1,
        operation: "xml.set",
        ok: true,
        affected: 1,
        errors: [],
        data: { part: partname }
      });
      expect(request.publishOutput).toHaveBeenCalledTimes(1);
      const output = await readPackage(
        new Uint8Array(volume.readFileSync("/out.pptx") as Buffer),
        context
      );
      const original = await readPackage(source, context);
      expect(output.get(partname)).toEqual(replacement);
      expect([...output.names].sort()).toEqual([...original.names].sort());
      for (const name of original.names)
        if (name !== partname) expect(output.get(name)).toEqual(original.get(name));
      expect(new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer)).toEqual(source);
    }
  );

  it("publishes paragraph run removal while preserving required paragraph and end formatting", async () => {
    const source = fixture();
    const deck = await Presentation(source, context);
    const part = deck.part.package.get_part(partname)!;
    const paragraph = find(part.element, "p");
    paragraph.remove(paragraph.children.find((child) => child.tag.localName === "r")!);
    expect(paragraph.children.map((child) => child.tag.localName)).toEqual(["endParaRPr"]);
    const { request, volume } = invocation(source, part.blob, ["--output", "/out.pptx", "--force"]);
    expect((await engine.execute(request)).exitCode).toBe(0);
    const reopened = await Presentation(
      new Uint8Array(volume.readFileSync("/out.pptx") as Buffer),
      context
    );
    expect(
      find(reopened.part.package.get_part(partname)!.element, "p").children.map(
        (child) => child.tag.localName
      )
    ).toEqual(["endParaRPr"]);
  });

  it("validates structural dry-run without publication and advertises matching result schemas", async () => {
    const source = fixture();
    const deck = await Presentation(source, context);
    const part = deck.part.package.get_part(partname)!;
    const tree = find(part.element, "spTree");
    tree.append(tree.children[2]!);
    const { request, volume, prior } = invocation(source, part.blob, ["--dry-run"]);
    const result = await engine.execute(request);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(decode(result.stdout));
    expect(json).toMatchObject({
      operation: "xml.set",
      ok: true,
      affected: 1,
      data: { dryRun: true }
    });
    expect(request.publishOutput).not.toHaveBeenCalled();
    expect(new Uint8Array(volume.readFileSync("/out.pptx") as Buffer)).toEqual(prior);
    const schema = await engine.execute({
      ...request,
      args: ["schema", "xml", "set", "--json"].map(encode)
    });
    expect(schema.exitCode).toBe(0);
    const contract = JSON.parse(decode(schema.stdout)).data.operations["xml.set"];
    expect(compileJsonSchema(contract.result).validate(json).ok).toBe(true);
    expect(
      compileJsonSchema(contract.options).validate({ part: partname, unexpected: true }).ok
    ).toBe(false);
    const capabilities = await engine.execute({
      ...request,
      args: ["capabilities", "--json"].map(encode)
    });
    expect(capabilities.exitCode).toBe(0);
    expect(JSON.parse(decode(capabilities.stdout))).toMatchObject({
      operation: "capabilities",
      ok: true,
      affected: 0,
      data: { features: { xml: { level: "edit" } } }
    });
  });

  it.each(["malformed", "dangling", "required-header"])(
    "rejects %s writes without changing memfs destinations",
    async (kind) => {
      const source = fixture();
      const deck = await Presentation(source, context);
      const part = deck.part.package.get_part(partname)!;
      const original = part.blob;
      const document = parseXmlPart(original, context.validationLimits);
      let replacement: Uint8Array = encode("<broken>");
      if (kind === "required-header") {
        const tree = document.root.children[0]!.children.find(
          (child) => child.name.localName === "spTree"
        )!;
        replacement = document.spliceChildren(tree, 0, 1, []).bytes();
      } else if (kind === "dangling") {
        const pending = [document.root];
        while (pending.length) {
          const node = pending.pop()!;
          if (node.name.localName === "blip") {
            replacement = document
              .merge(node, {
                attributes: [
                  {
                    namespace:
                      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
                    localName: "embed",
                    value: "absent"
                  }
                ]
              })
              .bytes();
            break;
          }
          pending.push(...node.children);
        }
      }
      expect(() => {
        part.blob = replacement;
      }).toThrow();
      expect(part.blob).toEqual(original);
      const { request, volume, prior } = invocation(source, replacement, [
        "--output",
        "/out.pptx",
        "--force"
      ]);
      const result = await engine.execute(request);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(decode(result.stdout))).toMatchObject({
        version: 1,
        operation: "xml.set",
        ok: false,
        affected: 0,
        data: null
      });
      expect(request.publishOutput).not.toHaveBeenCalled();
      expect(new Uint8Array(volume.readFileSync("/out.pptx") as Buffer)).toEqual(prior);
      expect(new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer)).toEqual(source);
    }
  );
});
