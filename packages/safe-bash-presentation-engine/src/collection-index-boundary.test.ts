import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import {
  FreeformBuilder,
  IndexError,
  Shape,
  Slide,
  SlideShapes,
  Slides,
  parseXmlPart
} from "./index.js";

function collections() {
  const volume = Volume.fromJSON({});
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const shape = (id: number) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Item ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:prstGeom prst="circularArrow"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
  volume.writeFileSync(
    "/slide.xml",
    `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${[1, 2, 3, 4].map(shape).join("")}</p:spTree></p:cSld></p:sld>`
  );
  const owner = {
    read: () =>
      parseXmlPart(new Uint8Array(volume.readFileSync("/slide.xml") as Buffer), {
        maxBytes: 10000,
        maxNodes: 200,
        maxDepth: 20
      }),
    write: (xml: ReturnType<typeof parseXmlPart>) => {
      volume.writeFileSync("/slide.xml", xml.bytes());
    }
  };
  const shapes = new SlideShapes(owner);
  const builder = new FreeformBuilder((geometry) => geometry);
  builder.add_line_segments([
    [1, 2],
    [3, 4],
    [5, 6]
  ]);
  return {
    slides: new Slides([1, 2, 3, 4].map((id) => new Slide(id, owner))),
    shapes,
    adjustments: (shapes.get(0) as Shape).adjustments,
    builder
  };
}

it.each(["slides", "shapes", "adjustments", "builder"] as const)(
  "%s rejects fractional negative positions before normalization",
  (name) => {
    const collection = collections()[name];
    for (const position of [-1.0000000000000002, -0.9999999999999999, NaN, Infinity, -Infinity])
      expect(() => collection.at(position)).toThrow(IndexError);
    const last = collection.at(-1);
    const first = collection.at(-collection.length);
    if (name === "slides") {
      expect(last).toMatchObject({ slide_id: 4 });
      expect(first).toMatchObject({ slide_id: 1 });
    } else if (name === "shapes") {
      expect(last).toMatchObject({ shape_id: 4 });
      expect(first).toMatchObject({ shape_id: 1 });
    } else if (name === "adjustments") {
      expect(last).toBe(0.125);
      expect(first).toBe(0.125);
    } else {
      expect(last).toMatchObject({ type: "close" });
      expect(first).toMatchObject({ type: "line", x: { emu: 1 }, y: { emu: 2 } });
    }
    expect(() => collection.at(-collection.length - 1)).toThrow(IndexError);
  }
);

it.each(["slides", "shapes", "adjustments", "builder"] as const)(
  "%s rejects index objects without invoking coercion",
  (name) => {
    const valueOf = vi.fn(() => -1);
    expect(() => collections()[name].at({ valueOf } as unknown as number)).toThrow(IndexError);
    expect(valueOf).not.toHaveBeenCalled();
  }
);
