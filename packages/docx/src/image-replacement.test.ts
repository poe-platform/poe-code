import { expect, it } from "vitest";
import { Volume } from "memfs";
import { replaceDocumentImage } from "./image-replacement.js";
import {
  replacementFixture,
  replacementPng,
  replacementBinary,
  replacementContext,
  textContext
} from "../tests/fixtures/image-replacement.js";
import { readDocumentArchive } from "./admission.js";
import { openDocumentLocations } from "./locations.js";
import { DocumentPackage } from "./package.js";
it.each([false, true])(
  "rebinds only the chosen occurrence unless shared intent is explicit (%s)",
  async (shared) => {
    const input = await replacementFixture(),
      volume = Volume.fromJSON({ "/out": "" });
    const data = await replaceDocumentImage(
      input,
      {
        operation: "images.replace",
        options: { image: 1, file: replacementBinary(), shared, output: "-" }
      },
      {
        ...replacementContext,
        stdout: {
          async write(bytes) {
            volume.appendFileSync("/out", bytes);
          }
        }
      }
    );
    const bytes = new Uint8Array(volume.readFileSync("/out") as Uint8Array),
      archive = await readDocumentArchive(bytes, textContext),
      graph = new DocumentPackage(archive, textContext.limits),
      document = await openDocumentLocations(bytes, textContext);
    const xml = new TextDecoder().decode(
      archive.members.find((item) => item.name === "word/document.xml")!.bytes
    );
    expect(xml).toContain('cx="1828800" cy="914400"');
    expect(xml).toContain('descr="Preserved description"');
    const edges = graph
      .relationships("/word/document.xml")
      .filter((edge) => edge.reltype.endsWith("/image"));
    expect(edges).toHaveLength(shared ? 1 : 2);
    expect(
      edges.some(
        (edge) =>
          !edge.is_external &&
          edge.target_part.bytes.every((byte, index) => byte === replacementPng(89)[index])
      )
    ).toBe(true);
    if (!shared)
      expect(
        edges.some(
          (edge) =>
            !edge.is_external &&
            edge.target_part.bytes.every((byte, index) => byte === replacementPng()[index])
        )
      ).toBe(true);
    expect(data.changes).toHaveLength(shared ? 2 : 1);
    expect(document.list("image")).toHaveLength(2);
  }
);
it("refuses fallback before opening replacement input", async () => {
  let reads = 0;
  await expect(
    replaceDocumentImage(
      await replacementFixture(),
      {
        operation: "images.replace",
        options: {
          image: 1,
          file: { kind: "vfs", path: "/pixel.png", capability: "test" },
          fallback: replacementBinary(),
          dryRun: true
        }
      },
      {
        ...replacementContext,
        binaryResolver: {
          capability: "test",
          async *open() {
            reads++;
            yield replacementPng();
          }
        }
      }
    )
  ).rejects.toThrow();
  expect(reads).toBe(0);
});
it("validates nested input descriptors without invoking getters or replacement sources", async () => {
  let getters = 0,
    reads = 0;
  const stat = {
    get type() {
      getters++;
      return "file";
    },
    size: 1
  };
  await expect(
    replaceDocumentImage(
      await replacementFixture(1),
      {
        operation: "images.replace",
        options: {
          image: 1,
          file: { kind: "vfs", path: "/pixel.png", capability: "test" },
          dryRun: true
        },
        input: { path: "/input.docx", stat: stat as never }
      },
      {
        ...replacementContext,
        binaryResolver: {
          capability: "test",
          async *open() {
            reads++;
            yield replacementPng();
          }
        }
      }
    )
  ).rejects.toThrow();
  expect(getters).toBe(0);
  expect(reads).toBe(0);
});
it("rejects replacement inside an admitted tracked insertion before source acquisition", async () => {
  const { rewriteReplacementFixture } = await import("../tests/fixtures/image-replacement.js");
  const input = await rewriteReplacementFixture(await replacementFixture(1), (files) => {
    const xml = new TextDecoder().decode(files.get("word/document.xml"));
    const start = xml.indexOf("<wi:r "),
      end = xml.indexOf("</wi:r>", start) + 7;
    files.set(
      "word/document.xml",
      new TextEncoder().encode(
        xml.slice(0, start) +
          '<w:ins w:id="4" w:author="Editor">' +
          xml.slice(start, end) +
          "</w:ins>" +
          xml.slice(end)
      )
    );
  });
  let reads = 0;
  await expect(
    replaceDocumentImage(
      input,
      {
        operation: "images.replace",
        options: {
          image: 1,
          file: { kind: "vfs", path: "/pixel.png", capability: "test" },
          dryRun: true
        }
      },
      {
        ...replacementContext,
        binaryResolver: {
          capability: "test",
          async *open() {
            reads++;
            yield replacementPng();
          }
        }
      }
    )
  ).rejects.toThrow();
  expect(reads).toBe(0);
});
it("retires a sole source relationship and part while preserving exact replacement bytes", async () => {
  const input = await replacementFixture(1),
    volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentImage(
    input,
    { operation: "images.replace", options: { image: 1, file: replacementBinary(), output: "-" } },
    {
      ...replacementContext,
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/out", bytes);
        }
      }
    }
  );
  const archive = await readDocumentArchive(
    new Uint8Array(volume.readFileSync("/out") as Uint8Array),
    textContext
  );
  const media = archive.members.filter((member) => member.name.includes("/media/"));
  expect(media).toHaveLength(1);
  expect(media[0]!.bytes).toEqual(replacementPng(89));
  expect(media[0]!.name).not.toBe("word/media/image-1.png");
});
it.each([false, true])(
  "preserves dormant package incoming references during replacement (%s)",
  async (shared) => {
    const { rewriteReplacementFixture } = await import("../tests/fixtures/image-replacement.js");
    const encode = (xml: string) => new TextEncoder().encode(xml);
    const input = await rewriteReplacementFixture(await replacementFixture(1), (files) => {
      files.set("word/dormant.xml", encode("<root/>"));
      files.set(
        "word/_rels/dormant.xml.rels",
        encode(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="retained" Type="urn:inert-reference" Target="media/image-1.png"/></Relationships>'
        )
      );
      const xml = new TextDecoder().decode(files.get("[Content_Types].xml"));
      files.set(
        "[Content_Types].xml",
        encode(
          xml.replace(
            "</Types>",
            '<Override PartName="/word/dormant.xml" ContentType="application/xml"/></Types>'
          )
        )
      );
    });
    const volume = Volume.fromJSON({ "/out": "" });
    await replaceDocumentImage(
      input,
      {
        operation: "images.replace",
        options: { image: 1, shared, file: replacementBinary(), output: "-" }
      },
      {
        ...replacementContext,
        stdout: {
          async write(bytes) {
            volume.appendFileSync("/out", bytes);
          }
        }
      }
    );
    const archive = await readDocumentArchive(
        new Uint8Array(volume.readFileSync("/out") as Uint8Array),
        textContext
      ),
      graph = new DocumentPackage(archive, textContext.limits),
      edge = graph.relationships("/word/dormant.xml")[0]!;
    expect(edge.target_part.bytes).toEqual(shared ? replacementPng(89) : replacementPng());
    expect(edge.reltype).toBe("urn:inert-reference");
  }
);
it("updates shared image owners across body and header stories", async () => {
  const { rewriteReplacementFixture } = await import("../tests/fixtures/image-replacement.js");
  const encode = (xml: string) => new TextEncoder().encode(xml),
    r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const input = await rewriteReplacementFixture(await replacementFixture(1), (files) => {
    const body = new TextDecoder().decode(files.get("word/document.xml")),
      start = body.indexOf("<wi:r "),
      end = body.indexOf("</wi:r>", start) + 7;
    files.set(
      "word/header.xml",
      encode(
        `<w:hdr xmlns:w="${w}"><w:p>${body.slice(start, end).replace('id="1"', 'id="2"')}</w:p></w:hdr>`
      )
    );
    files.set(
      "word/_rels/header.xml.rels",
      encode(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${r}/image" Target="media/image-1.png"/></Relationships>`
      )
    );
    files.set(
      "word/document.xml",
      encode(
        body
          .replace("<w:sectPr", "<w:sectPr")
          .replace(
            "</w:sectPr>",
            `<w:headerReference w:type="default" r:id="header" xmlns:r="${r}"/></w:sectPr>`
          )
      )
    );
    const rels = new TextDecoder().decode(files.get("word/_rels/document.xml.rels"));
    files.set(
      "word/_rels/document.xml.rels",
      encode(
        rels.replace(
          "</Relationships>",
          `<Relationship Id="header" Type="${r}/header" Target="header.xml"/></Relationships>`
        )
      )
    );
    const types = new TextDecoder().decode(files.get("[Content_Types].xml"));
    files.set(
      "[Content_Types].xml",
      encode(
        types.replace(
          "</Types>",
          '<Override PartName="/word/header.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
        )
      )
    );
  });
  const volume = Volume.fromJSON({ "/out": "" }),
    data = await replaceDocumentImage(
      input,
      {
        operation: "images.replace",
        options: { image: 1, shared: true, file: replacementBinary(), output: "-" }
      },
      {
        ...replacementContext,
        stdout: {
          async write(bytes) {
            volume.appendFileSync("/out", bytes);
          }
        }
      }
    );
  expect(data.changes.map((change) => change.before.value.part).sort()).toEqual([
    "/word/document.xml",
    "/word/header.xml"
  ]);
  const archive = await readDocumentArchive(
      new Uint8Array(volume.readFileSync("/out") as Uint8Array),
      textContext
    ),
    graph = new DocumentPackage(archive, textContext.limits);
  expect(graph.relationships("/word/header.xml")[0]!.target_part.bytes).toEqual(replacementPng(89));
});
it("refuses opaque extension carriers before replacement acquisition", async () => {
  const { rewriteReplacementFixture } = await import("../tests/fixtures/image-replacement.js");
  const input = await rewriteReplacementFixture(await replacementFixture(1), (files) => {
    const xml = new TextDecoder().decode(files.get("word/document.xml"));
    files.set(
      "word/document.xml",
      new TextEncoder().encode(
        xml.replace(
          '<di:blip ri:embed="rId2"/>',
          '<di:blip ri:embed="rId2"><di:extLst><di:ext uri="urn:opaque"><o:svgBlip xmlns:o="urn:opaque"/></di:ext></di:extLst></di:blip>'
        )
      )
    );
  });
  let reads = 0;
  await expect(
    replaceDocumentImage(
      input,
      {
        operation: "images.replace",
        options: {
          image: 1,
          file: { kind: "vfs", path: "/pixel.png", capability: "test" },
          dryRun: true
        }
      },
      {
        ...replacementContext,
        binaryResolver: {
          capability: "test",
          async *open() {
            reads++;
            yield replacementPng();
          }
        }
      }
    )
  ).rejects.toThrow();
  expect(reads).toBe(0);
});
it("retains fragments on dormant shared incoming relationships", async () => {
  const { rewriteReplacementFixture } = await import("../tests/fixtures/image-replacement.js");
  const input = await rewriteReplacementFixture(await replacementFixture(1), (files) => {
    files.set("word/dormant.xml", new TextEncoder().encode("<root/>"));
    files.set(
      "word/_rels/dormant.xml.rels",
      new TextEncoder().encode(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="retained" Type="urn:inert" Target="media/image-1.png#section"/></Relationships>'
      )
    );
    const types = new TextDecoder().decode(files.get("[Content_Types].xml"));
    files.set(
      "[Content_Types].xml",
      new TextEncoder().encode(
        types.replace(
          "</Types>",
          '<Override PartName="/word/dormant.xml" ContentType="application/xml"/></Types>'
        )
      )
    );
  });
  const volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentImage(
    input,
    {
      operation: "images.replace",
      options: { image: 1, shared: true, file: replacementBinary(), output: "-" }
    },
    {
      ...replacementContext,
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/out", bytes);
        }
      }
    }
  );
  const graph = new DocumentPackage(
    await readDocumentArchive(
      new Uint8Array(volume.readFileSync("/out") as Uint8Array),
      textContext
    ),
    textContext.limits
  );
  expect(graph.relationships("/word/dormant.xml")[0]!.fragment).toBe("section");
});
it.each(["png", "jpeg", "gif", "bmp", "tiff"] as const)(
  "writes coherent exact replacement bytes and canonical format declarations for %s",
  async (format) => {
    const raster = await import("../tests/fixtures/raster.js"),
      source = {
        png: raster.rasterPng,
        jpeg: raster.rasterJpeg,
        gif: raster.rasterGif,
        bmp: raster.rasterBmp,
        tiff: raster.rasterTiff
      }[format](),
      volume = Volume.fromJSON({ "/out": "" });
    await replaceDocumentImage(
      await replacementFixture(1),
      {
        operation: "images.replace",
        options: { image: 1, file: replacementBinary(source), output: "-" }
      },
      {
        ...replacementContext,
        stdout: {
          async write(bytes) {
            volume.appendFileSync("/out", bytes);
          }
        }
      }
    );
    const archive = await readDocumentArchive(
        new Uint8Array(volume.readFileSync("/out") as Uint8Array),
        textContext
      ),
      graph = new DocumentPackage(archive, textContext.limits),
      part = graph
        .relationships("/word/document.xml")
        .find((edge) => edge.reltype.endsWith("/image"))!.target_part;
    expect(part.bytes).toEqual(source);
    expect(part.content_type).toBe("image/" + format);
    expect(part.partname.endsWith("." + (format === "jpeg" ? "jpg" : format))).toBe(true);
  }
);
it.each(["contain", "cover", "stretch"] as const)(
  "changes only declared extents and fit crop for %s",
  async (fit) => {
    const volume = Volume.fromJSON({ "/out": "" });
    await replaceDocumentImage(
      await replacementFixture(1),
      {
        operation: "images.replace",
        options: {
          image: 1,
          file: replacementBinary(),
          output: "-",
          width: { value: 2, unit: "in" },
          height: { value: 1, unit: "in" },
          fit
        }
      },
      {
        ...replacementContext,
        stdout: {
          async write(bytes) {
            volume.appendFileSync("/out", bytes);
          }
        }
      }
    );
    const archive = await readDocumentArchive(
        new Uint8Array(volume.readFileSync("/out") as Uint8Array),
        textContext
      ),
      xml = new TextDecoder().decode(
        archive.members.find((member) => member.name === "word/document.xml")!.bytes
      );
    expect(xml).toContain(
      fit === "contain" ? 'cx="914400" cy="914400"' : 'cx="1828800" cy="914400"'
    );
    expect(xml).toContain(fit === "cover" ? 't="25000" b="25000"' : 't="0" b="0"');
    expect(xml).toContain('descr="Preserved description"');
  }
);
it("targets owner relationships when different resource types have equal basenames", async () => {
  const { rewriteReplacementFixture } = await import("../tests/fixtures/image-replacement.js"),
    { rasterJpeg } = await import("../tests/fixtures/raster.js");
  const input = await rewriteReplacementFixture(await replacementFixture(), (files) => {
    const xml = new TextDecoder().decode(files.get("word/document.xml")),
      first = xml.indexOf('ri:embed="rId2"'),
      second = xml.indexOf('ri:embed="rId2"', first + 1);
    files.set(
      "word/document.xml",
      new TextEncoder().encode(
        xml.slice(0, second) + xml.slice(second).replace('ri:embed="rId2"', 'ri:embed="second"')
      )
    );
    files.set("word/other/image-1.png", rasterJpeg());
    const rels = new TextDecoder().decode(files.get("word/_rels/document.xml.rels"));
    files.set(
      "word/_rels/document.xml.rels",
      new TextEncoder().encode(
        rels.replace(
          "</Relationships>",
          '<Relationship Id="second" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="other/image-1.png"/></Relationships>'
        )
      )
    );
    const types = new TextDecoder().decode(files.get("[Content_Types].xml"));
    files.set(
      "[Content_Types].xml",
      new TextEncoder().encode(
        types.replace(
          "</Types>",
          '<Override PartName="/word/other/image-1.png" ContentType="image/jpeg"/></Types>'
        )
      )
    );
  });
  const volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentImage(
    input,
    { operation: "images.replace", options: { image: 2, file: replacementBinary(), output: "-" } },
    {
      ...replacementContext,
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/out", bytes);
        }
      }
    }
  );
  const archive = await readDocumentArchive(
    new Uint8Array(volume.readFileSync("/out") as Uint8Array),
    textContext
  );
  expect(archive.members.find((member) => member.name === "word/media/image-1.png")!.bytes).toEqual(
    replacementPng()
  );
  expect(archive.members.some((member) => member.name === "word/other/image-1.png")).toBe(false);
});
it("preserves exact existing anchor, crop, wrap and alternative text on default replacement", async () => {
  const { rewriteReplacementFixture } = await import("../tests/fixtures/image-replacement.js");
  const input = await rewriteReplacementFixture(await replacementFixture(1), (files) => {
    const xml = new TextDecoder().decode(files.get("word/document.xml"));
    files.set(
      "word/document.xml",
      new TextEncoder().encode(
        xml
          .replace(
            'wp:inline distT="0" distB="0" distL="0" distR="0"',
            'wp:anchor distT="2" distB="3" distL="4" distR="5" relativeHeight="9" simplePos="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"'
          )
          .replace("</wp:inline>", "</wp:anchor>")
          .replace(
            "<wp:extent",
            '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>111</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>222</wp:posOffset></wp:positionV><wp:extent'
          )
          .replace("<wp:docPr", '<wp:wrapSquare wrapText="bothSides"/><wp:docPr')
          .replace("<di:stretch>", '<di:srcRect l="123" r="456" t="789" b="12"/><di:stretch>')
      )
    );
  });
  const volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentImage(
    input,
    { operation: "images.replace", options: { image: 1, file: replacementBinary(), output: "-" } },
    {
      ...replacementContext,
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/out", bytes);
        }
      }
    }
  );
  const before = await readDocumentArchive(input, textContext),
    after = await readDocumentArchive(
      new Uint8Array(volume.readFileSync("/out") as Uint8Array),
      textContext
    ),
    decode = (archive: typeof before) =>
      new TextDecoder().decode(
        archive.members.find((member) => member.name === "word/document.xml")!.bytes
      );
  expect(decode(after).replace('ri:embed="rId3"', 'ri:embed="rId2"')).toBe(decode(before));
});
it.each(["linked", "alternate"] as const)(
  "refuses %s carrier before replacement source acquisition",
  async (mode) => {
    const { rewriteReplacementFixture } = await import("../tests/fixtures/image-replacement.js");
    const input = await rewriteReplacementFixture(await replacementFixture(1), (files) => {
      const xml = new TextDecoder().decode(files.get("word/document.xml"));
      files.set(
        "word/document.xml",
        new TextEncoder().encode(
          xml.replace(
            '<di:blip ri:embed="rId2"/>',
            mode === "linked"
              ? '<di:blip ri:embed="rId2" ri:link="linked"/>'
              : '<di:blip ri:embed="rId2"><di:extLst><di:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><s:svgBlip xmlns:s="http://schemas.microsoft.com/office/drawing/2016/SVG/main" ri:embed="rId2"/></di:ext></di:extLst></di:blip>'
          )
        )
      );
      if (mode === "linked") {
        const rels = new TextDecoder().decode(files.get("word/_rels/document.xml.rels"));
        files.set(
          "word/_rels/document.xml.rels",
          new TextEncoder().encode(
            rels.replace(
              "</Relationships>",
              '<Relationship Id="linked" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://invalid.example/image" TargetMode="External"/></Relationships>'
            )
          )
        );
      }
    });
    let reads = 0;
    await expect(
      replaceDocumentImage(
        input,
        {
          operation: "images.replace",
          options: {
            image: 1,
            file: { kind: "vfs", path: "/pixel.png", capability: "test" },
            dryRun: true
          }
        },
        {
          ...replacementContext,
          binaryResolver: {
            capability: "test",
            async *open() {
              reads++;
              yield replacementPng();
            }
          }
        }
      )
    ).rejects.toThrow();
    expect(reads).toBe(0);
  }
);
it("uses independent physical DPI ratio for one declared dimension", async () => {
  const { rasterJpeg } = await import("../tests/fixtures/raster.js"),
    volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentImage(
    await replacementFixture(1),
    {
      operation: "images.replace",
      options: {
        image: 1,
        file: replacementBinary(rasterJpeg(1, 1, [1, 73, 79])),
        width: { value: 1, unit: "in" },
        output: "-"
      }
    },
    {
      ...replacementContext,
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/out", bytes);
        }
      }
    }
  );
  const archive = await readDocumentArchive(
      new Uint8Array(volume.readFileSync("/out") as Uint8Array),
      textContext
    ),
    xml = new TextDecoder().decode(
      archive.members.find((member) => member.name === "word/document.xml")!.bytes
    );
  expect(xml).toContain('cx="914400" cy="844952"');
});
it("owns producer reused stream chunks and registers cleanup before source open", async () => {
  const input = await replacementFixture(1),
    source = replacementPng(89),
    fragment = new Uint8Array(Math.ceil(source.length / 2)),
    split = fragment.length,
    volume = Volume.fromJSON({ "/out": "" });
  let cleanup = false,
    admitted = false;
  await replaceDocumentImage(
    input,
    {
      operation: "images.replace",
      options: {
        image: 1,
        file: { kind: "vfs", path: "/pixel.png", capability: "test" },
        output: "-"
      }
    },
    {
      ...replacementContext,
      registerCleanup() {
        cleanup = true;
      },
      binaryResolver: {
        capability: "test",
        async *open() {
          expect(cleanup).toBe(true);
          fragment.set(source.subarray(0, split));
          yield fragment;
          fragment.fill(0);
          fragment.set(source.subarray(split));
          yield fragment.subarray(0, source.length - split);
          fragment.fill(0);
        }
      },
      admitPublication() {
        expect(volume.readFileSync("/out").length).toBe(0);
        admitted = true;
        return undefined;
      },
      stdout: {
        async write(bytes) {
          expect(admitted).toBe(true);
          volume.appendFileSync("/out", bytes);
        }
      }
    }
  );
  const archive = await readDocumentArchive(
    new Uint8Array(volume.readFileSync("/out") as Uint8Array),
    textContext
  );
  expect(archive.members.find((member) => member.name.includes("/media/"))!.bytes).toEqual(source);
});
it("rejects a known replacement suffix mismatch and cancelled input without publication", async () => {
  const input = await replacementFixture(1);
  let writes = 0;
  await expect(
    replaceDocumentImage(
      input,
      {
        operation: "images.replace",
        options: {
          image: 1,
          file: { kind: "vfs", path: "/pixel.jpeg", capability: "test" },
          output: "-"
        }
      },
      {
        ...replacementContext,
        binaryResolver: {
          capability: "test",
          async *open() {
            yield replacementPng();
          }
        },
        stdout: {
          async write() {
            writes++;
          }
        }
      }
    )
  ).rejects.toThrow("suffix");
  const controller = new AbortController();
  controller.abort();
  await expect(
    replaceDocumentImage(
      input,
      {
        operation: "images.replace",
        options: { image: 1, file: replacementBinary(), output: "-" }
      },
      {
        ...replacementContext,
        signal: controller.signal,
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
it("retains inactive raw XML uses of the old owner relationship", async () => {
  const { rewriteReplacementFixture } = await import("../tests/fixtures/image-replacement.js");
  const input = await rewriteReplacementFixture(await replacementFixture(1), (files) => {
    const xml = new TextDecoder().decode(files.get("word/document.xml"));
    files.set(
      "word/document.xml",
      new TextEncoder().encode(
        xml.replace(
          "</w:body>",
          '<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:imagedata xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId2"/></v:shape></w:pict></w:r></w:p></w:body>'
        )
      )
    );
  });
  const volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentImage(
    input,
    { operation: "images.replace", options: { image: 1, file: replacementBinary(), output: "-" } },
    {
      ...replacementContext,
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/out", bytes);
        }
      }
    }
  );
  const graph = new DocumentPackage(
    await readDocumentArchive(
      new Uint8Array(volume.readFileSync("/out") as Uint8Array),
      textContext
    ),
    textContext.limits
  );
  expect(
    graph.relationships("/word/document.xml").find((edge) => edge.rId === "rId2")!.target_part.bytes
  ).toEqual(replacementPng());
});
it("retains zero-incoming media whose outgoing relationship metadata must remain coherent", async () => {
  const { rewriteReplacementFixture } = await import("../tests/fixtures/image-replacement.js");
  const input = await rewriteReplacementFixture(await replacementFixture(1), (files) => {
    files.set(
      "word/media/_rels/image-1.png.rels",
      new TextEncoder().encode(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="inert" Type="urn:inert" Target="https://invalid.example/retained" TargetMode="External"/></Relationships>'
      )
    );
  });
  const volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentImage(
    input,
    { operation: "images.replace", options: { image: 1, file: replacementBinary(), output: "-" } },
    {
      ...replacementContext,
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/out", bytes);
        }
      }
    }
  );
  const archive = await readDocumentArchive(
    new Uint8Array(volume.readFileSync("/out") as Uint8Array),
    textContext
  );
  expect(archive.members.find((member) => member.name === "word/media/image-1.png")!.bytes).toEqual(
    replacementPng()
  );
  expect(
    archive.members.some((member) => member.name === "word/media/_rels/image-1.png.rels")
  ).toBe(true);
});
it("escapes admitted package folder characters in new content type declarations", async () => {
  const { rewriteReplacementFixture } = await import("../tests/fixtures/image-replacement.js");
  const input = await rewriteReplacementFixture(await replacementFixture(1), (files) => {
    for (const [name, bytes] of [...files])
      if (name.startsWith("word/")) {
        files.delete(name);
        files.set("folder&/" + name.slice(5), bytes);
      }
    files.set(
      "[Content_Types].xml",
      new TextEncoder().encode(
        new TextDecoder()
          .decode(files.get("[Content_Types].xml"))
          .split("/word/")
          .join("/folder&amp;/")
      )
    );
    files.set(
      "_rels/.rels",
      new TextEncoder().encode(
        new TextDecoder()
          .decode(files.get("_rels/.rels"))
          .split("word/document.xml")
          .join("folder&amp;/document.xml")
      )
    );
  });
  await expect(
    replaceDocumentImage(
      input,
      {
        operation: "images.replace",
        options: { image: 1, file: replacementBinary(), dryRun: true }
      },
      replacementContext
    )
  ).resolves.toMatchObject({ changed: true });
});
it("does not assert media type from a no-dot filename that matches an extension word", async () => {
  const { rasterGif } = await import("../tests/fixtures/raster.js");
  await expect(
    replaceDocumentImage(
      await replacementFixture(1),
      {
        operation: "images.replace",
        options: {
          image: 1,
          file: { kind: "vfs", path: "/input/png", capability: "test" },
          dryRun: true
        }
      },
      {
        ...replacementContext,
        binaryResolver: {
          capability: "test",
          async *open() {
            yield rasterGif();
          }
        }
      }
    )
  ).resolves.toMatchObject({ changed: true });
});
it("treats a leading-dot filename as a recognized final suffix assertion", async () => {
  const { rasterGif } = await import("../tests/fixtures/raster.js"),
    input = await replacementFixture(1);
  const request = {
    operation: "images.replace" as const,
    options: {
      image: 1,
      file: { kind: "vfs" as const, path: "/input/.PNG", capability: "test" },
      dryRun: true
    }
  };
  await expect(
    replaceDocumentImage(input, request, {
      ...replacementContext,
      binaryResolver: {
        capability: "test",
        async *open() {
          yield rasterGif();
        }
      }
    })
  ).rejects.toThrow("suffix");
  await expect(
    replaceDocumentImage(input, request, {
      ...replacementContext,
      binaryResolver: {
        capability: "test",
        async *open() {
          yield replacementPng();
        }
      }
    })
  ).resolves.toMatchObject({ changed: true });
});
