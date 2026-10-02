import { expect, it } from "vitest";
import { Volume } from "memfs";
import { setDocumentImageLayout } from "./image-layout.js";
import { layoutFixture, layoutContext } from "../tests/fixtures/image-layout.js";
import { readDocumentArchive } from "./admission.js";
import type { DocxOperationArguments } from "./operation-types.js";
async function set(input: Uint8Array, options: DocxOperationArguments<"images.set">) {
  const volume = Volume.fromJSON({ "/out": "" });
  const data = await setDocumentImageLayout(
    input,
    { operation: "images.set", options: { image: 1, output: "-", ...options } },
    {
      ...layoutContext,
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/out", bytes);
        }
      }
    }
  );
  const bytes = new Uint8Array(volume.readFileSync("/out") as Uint8Array),
    archive = await readDocumentArchive(bytes, layoutContext);
  return {
    data,
    bytes,
    archive,
    xml: new TextDecoder().decode(
      archive.members.find((member) => member.name === "word/document.xml")!.bytes
    )
  };
}
it("edits native axes, distances and stacking with exact media/relationship preservation", async () => {
  const input = await layoutFixture(),
    result = await set(input, {
      x: { value: -0.5, unit: "emu" },
      horizontalRelativeFrom: "page",
      verticalAlignment: "bottom",
      distanceLeft: { value: 2, unit: "pt" },
      zOrder: 9,
      allowOverlap: false,
      behindText: true
    });
  expect(result.xml).toContain("<wp:posOffset>-1</wp:posOffset>");
  expect(result.xml).toContain('relativeFrom="page"');
  expect(result.xml).toContain("<wp:align>bottom</wp:align>");
  expect(result.xml).toContain('distL="25400"');
  expect(result.xml).toContain('behindDoc="1"');
  expect(result.xml).toContain('allowOverlap="0"');
  const before = await readDocumentArchive(input, layoutContext);
  for (const member of before.members.filter((member) => member.name !== "word/document.xml"))
    expect(result.archive.members.find((after) => after.name === member.name)!.bytes).toEqual(
      member.bytes
    );
  expect(result.data.changes[0]?.kind).toBe("set");
});
it("uses stored unrotated extent ratio and preserves crop for one-axis resize", async () => {
  const result = await set(await layoutFixture(), { width: { value: 1, unit: "in" } });
  expect(result.xml).toContain('cx="914400" cy="457200"');
  expect(result.xml).toContain('<a:srcRect l="1000" r="2000" t="3000" b="4000"/>');
});
it("updates both aspect lock carriers without dropping unrelated locks", async () => {
  const result = await set(await layoutFixture(), {
    lockAspect: false,
    rotation: -0.000025,
    flipHorizontal: true
  });
  expect(result.xml).toContain('noChangeAspect="0" noMove="1"');
  expect(result.xml).toContain('noChangeAspect="0" noCrop="1"');
  expect(result.xml).toContain('rot="-2"');
  expect(result.xml).toContain('flipH="1"');
});
it("rejects anchor-only fields on inline pictures without publishing", async () => {
  let writes = 0;
  await expect(
    setDocumentImageLayout(
      await layoutFixture({ inline: true }),
      { operation: "images.set", options: { image: 1, x: { value: 0, unit: "emu" }, output: "-" } },
      {
        ...layoutContext,
        stdout: {
          async write() {
            writes++;
          }
        }
      }
    )
  ).rejects.toThrow();
  expect(writes).toBe(0);
});
it("adopts an explicit native polygon and retains it across tight/through wrap modes", async () => {
  const polygon = {
    start: { x: -10, y: 40 },
    lineTo: [
      { x: 21600, y: 0 },
      { x: 0, y: 21600 }
    ]
  };
  const result = await set(await layoutFixture(), {
    wrap: "tight",
    wrapText: "left",
    wrapPolygon: polygon
  });
  expect(result.xml).toContain('edited="1"');
  expect(result.xml).toContain('x="-10" y="40"');
  const next = await set(result.bytes, { wrap: "through" });
  expect(next.xml).toContain("wrapThrough");
  expect(next.xml).toContain('x="-10" y="40"');
});
it("rejects retained invalid crop, crop quantization exhaustion, simple positioning and wrap metadata loss", async () => {
  const encode = (s: string) => new TextEncoder().encode(s);
  for (const [find, replacement, options] of [
    ['r="2000"', 'r="90000"', { cropLeft: 0.2 }],
    ['l="1000" r="2000"', 'l="49999" r="49999"', { cropLeft: 0.500005 }],
    ['simplePos="0"', 'simplePos="1"', { x: { value: 0, unit: "emu" } }],
    [
      'distL="70"',
      'distL="70" distT="60"',
      {
        wrap: "tight",
        wrapText: "left",
        wrapPolygon: {
          start: { x: 0, y: 0 },
          lineTo: [
            { x: 1, y: 0 },
            { x: 0, y: 1 }
          ]
        }
      }
    ]
  ] as const) {
    const input = await layoutFixture({
      alter(files) {
        const xml = new TextDecoder().decode(files.get("word/document.xml"));
        files.set("word/document.xml", encode(xml.replace(find, replacement)));
      }
    });
    let writes = 0;
    await expect(
      setDocumentImageLayout(
        input,
        {
          operation: "images.set",
          options: { image: 1, output: "-", ...options } as DocxOperationArguments<"images.set">
        },
        {
          ...layoutContext,
          stdout: {
            async write() {
              writes++;
            }
          }
        }
      )
    ).rejects.toThrow();
    expect(writes).toBe(0);
  }
});
it("creates both absent aspect carriers and returns fresh remapped image Locations", async () => {
  const input = await layoutFixture({
    alter(files) {
      const xml = new TextDecoder().decode(files.get("word/document.xml"));
      files.set(
        "word/document.xml",
        new TextEncoder().encode(
          xml
            .replace(
              '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1" noMove="1"/></wp:cNvGraphicFramePr>',
              ""
            )
            .replace('<a:picLocks noChangeAspect="1" noCrop="1"/>', "")
        )
      );
    }
  });
  const result = await set(input, { lockAspect: true });
  expect(result.xml).toContain("graphicFrameLocks");
  expect(result.xml).toContain("picLocks");
  expect(result.data.changes[0]!.after.value.path).not.toEqual(
    result.data.changes[0]!.before.value.path
  );
  const { openDocumentLocations } = await import("./locations.js");
  const document = await openDocumentLocations(result.bytes, layoutContext);
  expect(document.list("image")[0]!.value.path).toEqual(result.data.changes[0]!.after.value.path);
});
it("preadmits a mixed all-target selection and never publishes on an unsupported second picture", async () => {
  const input = await layoutFixture({
    copies: 2,
    alter(files) {
      const xml = new TextDecoder().decode(files.get("word/document.xml")),
        start = xml.indexOf("<a:xfrm", xml.indexOf("<a:xfrm") + 1),
        end = xml.indexOf("</a:xfrm>", start) + 9;
      files.set(
        "word/document.xml",
        new TextEncoder().encode(xml.slice(0, start) + xml.slice(end))
      );
    }
  });
  let writes = 0;
  await expect(
    setDocumentImageLayout(
      input,
      { operation: "images.set", options: { all: true, rotation: 10, output: "-" } },
      {
        ...layoutContext,
        stdout: {
          async write() {
            writes++;
          }
        }
      }
    )
  ).rejects.toThrow();
  expect(writes).toBe(0);
});
it("preserves coherent alternate references on a narrow rotation edit", async () => {
  const input = await layoutFixture({
    alter(files) {
      const xml = new TextDecoder().decode(files.get("word/document.xml"));
      files.set(
        "word/document.xml",
        new TextEncoder().encode(
          xml.replace(
            '<a:blip r:embed="media"/>',
            '<a:blip r:embed="media"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><s:svgBlip xmlns:s="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="alternate"/></a:ext></a:extLst></a:blip>'
          )
        )
      );
      files.set(
        "word/media/alternate.svg",
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')
      );
      const types = new TextDecoder().decode(files.get("[Content_Types].xml"));
      files.set(
        "[Content_Types].xml",
        new TextEncoder().encode(
          types.replace(
            "</Types>",
            '<Override PartName="/word/media/alternate.svg" ContentType="image/svg+xml"/></Types>'
          )
        )
      );
      const rels = new TextDecoder().decode(files.get("word/_rels/document.xml.rels"));
      files.set(
        "word/_rels/document.xml.rels",
        new TextEncoder().encode(
          rels.replace(
            "</Relationships>",
            '<Relationship Id="alternate" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/alternate.svg"/></Relationships>'
          )
        )
      );
    }
  });
  const result = await set(input, { rotation: 10 });
  expect(result.xml).toContain('r:embed="alternate"');
  const before = await readDocumentArchive(input, layoutContext);
  for (const member of before.members.filter((member) => member.name !== "word/document.xml"))
    expect(result.archive.members.find((after) => after.name === member.name)!.bytes).toEqual(
      member.bytes
    );
});
it("retains exact bytes and reports no changes for typed no-op geometry and boolean values", async () => {
  const input = await layoutFixture({
    alter(files) {
      const xml = new TextDecoder().decode(files.get("word/document.xml"));
      files.set(
        "word/document.xml",
        new TextEncoder().encode(xml.replace('allowOverlap="1"', 'allowOverlap="true"'))
      );
    }
  });
  const result = await set(input, {
    allowOverlap: true,
    width: { value: 2, unit: "in" },
    rotation: 0.2
  });
  expect(result.data.changed).toBe(false);
  expect(result.data.changes).toEqual([]);
  expect(result.bytes).toEqual(input);
});
it("preserves native local wrap namespace declarations across wrapText writes", async () => {
  const input = await layoutFixture({
    alter(files) {
      const xml = new TextDecoder().decode(files.get("word/document.xml"));
      files.set(
        "word/document.xml",
        new TextEncoder().encode(
          xml.replace(
            "<wp:wrapSquare wrapText",
            '<wp:wrapSquare xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" wrapText'
          )
        )
      );
    }
  });
  const result = await set(input, { wrapText: "left" });
  expect(result.xml).toContain(
    '<wp:wrapSquare xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" wrapText="left"'
  );
});
it("preserves admitted numeric lexical variants for semantic no-op setter values", async () => {
  const input = await layoutFixture({
    alter(files) {
      const xml = new TextDecoder().decode(files.get("word/document.xml"));
      files.set(
        "word/document.xml",
        new TextEncoder().encode(
          xml
            .replace('relativeHeight="3"', 'relativeHeight="003"')
            .replace('l="1000"', 'l="001000"')
            .replace('rot="12000"', 'rot="012000"')
        )
      );
    }
  });
  const result = await set(input, { zOrder: 3, cropLeft: 0.01, rotation: 0.2 });
  expect(result.data.changed).toBe(false);
  expect(result.bytes).toEqual(input);
});
it("authors absent transform attributes while preserving inherited namespaces and existing children", async () => {
  const input = await layoutFixture({
    alter(files) {
      const xml = new TextDecoder().decode(files.get("word/document.xml"));
      files.set(
        "word/document.xml",
        new TextEncoder().encode(xml.replace(' rot="12000" flipH="0" flipV="0"', ""))
      );
    }
  });
  const result = await set(input, { rotation: 30, flipHorizontal: true, flipVertical: false });
  expect(result.xml).toContain('rot="1800000"');
  expect(result.xml).toContain('flipH="1"');
  expect(result.xml).toContain('<a:off x="0" y="0"/>');
});
it("reports distinct changed drawings in an explicit all-target write", async () => {
  const input = await layoutFixture({ copies: 2 }),
    volume = Volume.fromJSON({ "/out": "" });
  const data = await setDocumentImageLayout(
    input,
    { operation: "images.set", options: { all: true, rotation: 20, output: "-" } },
    {
      ...layoutContext,
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/out", bytes);
        }
      }
    }
  );
  expect(data.changes).toHaveLength(2);
  expect(new Set(data.changes.map((change) => change.after.token)).size).toBe(2);
  const { openDocumentLocations } = await import("./locations.js");
  expect(
    (
      await openDocumentLocations(
        new Uint8Array(volume.readFileSync("/out") as Uint8Array),
        layoutContext
      )
    ).list("image")
  ).toHaveLength(2);
});
it("refuses cancelled or lowered-budget work and synchronous publication admission failures without output", async () => {
  const input = await layoutFixture(),
    controller = new AbortController();
  controller.abort();
  let writes = 0;
  const stdout = {
    async write() {
      writes++;
    }
  };
  await expect(
    setDocumentImageLayout(
      input,
      { operation: "images.set", options: { image: 1, rotation: 20, output: "-" } },
      { ...layoutContext, signal: controller.signal, stdout }
    )
  ).rejects.toThrow();
  await expect(
    setDocumentImageLayout(
      input,
      {
        operation: "images.set",
        options: { image: 1, rotation: 20, output: "-", limit: [{ name: "work", value: 32 }] }
      },
      { ...layoutContext, stdout }
    )
  ).rejects.toThrow();
  await expect(
    setDocumentImageLayout(
      input,
      { operation: "images.set", options: { image: 1, rotation: 20, output: "-" } },
      {
        ...layoutContext,
        stdout,
        admitPublication() {
          expect(writes).toBe(0);
          throw new Error("admission blocked");
        }
      }
    )
  ).rejects.toThrow("admission blocked");
  expect(writes).toBe(0);
});
it("rejects closed identity accessors without invoking getters or publishing", async () => {
  let getters = 0,
    writes = 0;
  const stat = {
    get type() {
      getters++;
      return "file";
    },
    size: 1
  };
  await expect(
    setDocumentImageLayout(
      await layoutFixture(),
      {
        operation: "images.set",
        options: { image: 1, rotation: 20, output: "-" },
        input: { path: "/input.docx", stat: stat as never }
      },
      {
        ...layoutContext,
        stdout: {
          async write() {
            writes++;
          }
        }
      }
    )
  ).rejects.toThrow();
  expect(getters).toBe(0);
  expect(writes).toBe(0);
});
it("checks merged decorative metadata and admits an explicit empty-alt resolution", async () => {
  const input = await layoutFixture();
  await expect(set(input, { decorative: true })).rejects.toThrow("Decorative");
  const result = await set(input, { decorative: true, alt: "" });
  const { inspectDocumentImages } = await import("./images.js");
  expect(
    (
      await inspectDocumentImages(
        result.bytes,
        { operation: "images.get", image: 1 },
        layoutContext
      )
    ).item!.details
  ).toMatchObject({ alt: "", decorative: true });
  await expect(set(result.bytes, { alt: "Nonempty" })).rejects.toThrow("Decorative");
});
it.each(["contain", "cover", "stretch"] as const)(
  "keeps common extents coherent and replaces fit crop for %s",
  async (fit) => {
    const result = await set(await layoutFixture(), {
      width: { value: 1, unit: "in" },
      height: { value: 1, unit: "in" },
      fit
    });
    expect(result.xml).toContain(
      fit === "contain" ? 'cx="914400" cy="457200"' : 'cx="914400" cy="914400"'
    );
    expect(result.xml).toContain(
      fit === "cover" ? 'l="25000" r="25000" t="0" b="0"' : 'l="0" r="0" t="0" b="0"'
    );
  }
);
it.each(["none", "top-bottom"] as const)(
  "preserves explicit coherent distance when retiring an inapplicable wrap override (%s)",
  async (wrap) => {
    const result = await set(await layoutFixture(), {
      wrap,
      distanceLeft: { value: 70, unit: "emu" }
    });
    expect(result.xml).toContain('distL="70"');
    expect(result.xml).toContain(wrap === "none" ? "wp:wrapNone" : "wp:wrapTopAndBottom");
  }
);
it("refuses a physical header picture with multiple section appearances", async () => {
  const input = await layoutFixture({
    alter(files) {
      const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        a = "http://schemas.openxmlformats.org/drawingml/2006/main",
        wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        pic = "http://schemas.openxmlformats.org/drawingml/2006/picture";
      const xml = new TextDecoder().decode(files.get("word/document.xml")),
        start = xml.indexOf("<w:r><w:drawing>"),
        end = xml.indexOf("</w:r>", start) + 6,
        draw = xml.slice(start, end).replace('id="1"', 'id="2"');
      files.set(
        "word/header.xml",
        new TextEncoder().encode(
          `<w:hdr xmlns:w="${w}" xmlns:r="${r}" xmlns:a="${a}" xmlns:wp="${wp}" xmlns:pic="${pic}"><w:p>${draw}</w:p></w:hdr>`
        )
      );
      files.set("word/_rels/header.xml.rels", files.get("word/_rels/document.xml.rels")!);
      const ref = '<w:headerReference w:type="default" r:id="header"/>';
      files.set(
        "word/document.xml",
        new TextEncoder().encode(
          xml
            .replace(
              "<w:p><!--preserved-->",
              "<w:p><w:pPr><w:sectPr>" + ref + "</w:sectPr></w:pPr></w:p><w:p><!--preserved-->"
            )
            .replace("<w:sectPr/>", "<w:sectPr>" + ref + "</w:sectPr>")
        )
      );
      const rels = new TextDecoder().decode(files.get("word/_rels/document.xml.rels"));
      files.set(
        "word/_rels/document.xml.rels",
        new TextEncoder().encode(
          rels.replace(
            "</Relationships>",
            `<Relationship Id="header" Type="${r}/header" Target="header.xml"/></Relationships>`
          )
        )
      );
      const types = new TextDecoder().decode(files.get("[Content_Types].xml"));
      files.set(
        "[Content_Types].xml",
        new TextEncoder().encode(
          types.replace(
            "</Types>",
            '<Override PartName="/word/header.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
          )
        )
      );
    }
  });
  let writes = 0;
  await expect(
    setDocumentImageLayout(
      input,
      {
        operation: "images.set",
        options: { scope: "headers", image: 1, rotation: 10, output: "-" }
      },
      {
        ...layoutContext,
        stdout: {
          async write() {
            writes++;
          }
        }
      }
    )
  ).rejects.toMatchObject({ code: "ambiguous-selection" });
  expect(writes).toBe(0);
});
it("preserves opposite-axis choices on native frame-only edits and merges only requested crop sides", async () => {
  const result = await set(await layoutFixture(), {
    horizontalRelativeFrom: "rightMargin",
    cropLeft: 0.15
  });
  expect(result.xml).toContain(
    '<wp:positionV relativeFrom="paragraph"><wp:align>top</wp:align></wp:positionV>'
  );
  expect(result.xml).toContain("<wp:posOffset>-12</wp:posOffset>");
  expect(result.xml).toContain('l="15000" r="2000" t="3000" b="4000"');
});
it.each([
  ['relativeHeight="3"', 'relativeHeight="+003"', { zOrder: 3 }],
  ['allowOverlap="1"', 'allowOverlap=" true "', { allowOverlap: true }]
] as const)(
  "retains exact legal native lexical values on typed no-op %s",
  async (find, replacement, options) => {
    const input = await layoutFixture({
      alter(files) {
        const xml = new TextDecoder().decode(files.get("word/document.xml"));
        files.set("word/document.xml", new TextEncoder().encode(xml.replace(find, replacement)));
      }
    });
    const result = await set(input, options);
    expect(result.data.changed).toBe(false);
    expect(result.bytes).toEqual(input);
  }
);
it.each([
  ['allowOverlap="1"', 'allowOverlap="on"', { allowOverlap: true }],
  ['noChangeAspect="1" noMove="1"', 'noChangeAspect="off" noMove="1"', { lockAspect: false }],
  ['flipH="0"', 'flipH="off"', { flipHorizontal: false }]
] as const)(
  "refuses a dependent edit of invalid native boolean lexical data %s",
  async (find, replacement, options) => {
    const input = await layoutFixture({
      alter(files) {
        const xml = new TextDecoder().decode(files.get("word/document.xml"));
        files.set("word/document.xml", new TextEncoder().encode(xml.replace(find, replacement)));
      }
    });
    let writes = 0;
    await expect(
      setDocumentImageLayout(
        input,
        { operation: "images.set", options: { image: 1, output: "-", ...options } },
        {
          ...layoutContext,
          stdout: {
            async write() {
              writes++;
            }
          }
        }
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(writes).toBe(0);
  }
);
it("does not admit non-XML Unicode whitespace as native boolean whitespace", async () => {
  const input = await layoutFixture({
    alter(files) {
      const xml = new TextDecoder().decode(files.get("word/document.xml"));
      files.set(
        "word/document.xml",
        new TextEncoder().encode(xml.replace('allowOverlap="1"', 'allowOverlap="&#160;true&#160;"'))
      );
    }
  });
  await expect(set(input, { allowOverlap: true })).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});
it("preserves valid WML on/off toggle metadata outside native picture booleans", async () => {
  const input = await layoutFixture({
    alter(files) {
      const xml = new TextDecoder().decode(files.get("word/document.xml"));
      files.set(
        "word/document.xml",
        new TextEncoder().encode(
          xml.replace("<w:r><w:drawing>", '<w:r><w:rPr><w:b w:val="on"/></w:rPr><w:drawing>')
        )
      );
    }
  });
  const result = await set(input, { rotation: 10 });
  expect(result.xml).toContain('<w:b w:val="on"/>');
});
it.each([0.5, 0.75])("rounds a raw positive fractional EMU extent to a supported written integer (%s)", async value => {
  const result = await set(await layoutFixture(), {
    width: { value, unit: "emu" }, height: { value, unit: "emu" }
  });
  expect(result.xml).toContain('cx="1" cy="1"');
});
it("refuses positive fractional extent rounding to zero before publishing", async () => {
  let writes = 0;
  await expect(setDocumentImageLayout(await layoutFixture(), {
    operation: "images.set", options: {
      image: 1, width: { value: 0.49, unit: "emu" },
      height: { value: 0.49, unit: "emu" }, output: "-"
    }
  }, { ...layoutContext, stdout: { async write() { writes++; } } })).rejects.toThrow();
  expect(writes).toBe(0);
});
it("retains the exact original compressed ZIP representation for an unchanged typed write", async () => {
  const { writeArchive } = await import("./archive-write.js");
  const archive = await readDocumentArchive(await layoutFixture(), layoutContext);
  const volume = Volume.fromJSON({ "/input": "" });
  await writeArchive(archive, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "deflate" }, layoutContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Uint8Array);
  const result = await set(input, { rotation: 0.2 });
  expect(result.data.changed).toBe(false);
  expect(result.data.changes).toHaveLength(0);
  expect(result.bytes).toEqual(input);
});
it.each(["mutate", "cancel"])("refuses compressed no-op %s at publication admission without output", async action => {
  const { writeArchive } = await import("./archive-write.js");
  const archive = await readDocumentArchive(await layoutFixture(), layoutContext);
  const volume = Volume.fromJSON({ "/input": "" });
  await writeArchive(archive, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "deflate" }, layoutContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Uint8Array);
  const controller = new AbortController();
  let writes = 0;
  await expect(setDocumentImageLayout(input, {
    operation: "images.set", options: { image: 1, rotation: 0.2, output: "-" }
  }, {
    ...layoutContext, signal: controller.signal,
    stdout: { async write() { writes++; } },
    admitPublication(planned) {
      expect(planned.changed).toBe(false);
      expect(planned.changes).toHaveLength(0);
      if (action === "cancel") controller.abort();
      else input[0] = 0;
      return undefined;
    }
  })).rejects.toThrow();
  expect(writes).toBe(0);
});
