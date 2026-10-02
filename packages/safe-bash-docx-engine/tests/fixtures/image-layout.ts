import { Volume } from "memfs";
import { writeArchive } from "../../src/archive-write.js";
import { replacementPng } from "./image-replacement.js";
export const layoutContext = {
  signal: new AbortController().signal,
  limits: {
    maxArchiveBytes: 131072,
    maxEntryBytes: 65536,
    maxTotalBytes: 131072,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 32,
    maxExtraBytes: 0,
    maxCommentBytes: 32,
    maxRetainedBytes: 33554432,
    chunkSize: 1024
  },
  encoding: { order: "input" as const, compression: "store" as const }
};
export const layoutNamespaces = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture"
};
export async function layoutFixture(
  options: {
    inline?: boolean;
    copies?: number;
    alter?: (files: Map<string, Uint8Array>) => void;
  } = {}
) {
  const { w, r, a, wp, pic } = layoutNamespaces;
  const draw = (id: number) =>
    `<w:r><w:drawing><wp:${options.inline ? "inline" : "anchor"} distT="10" distB="20" distL="30" distR="40"${options.inline ? "" : ' relativeHeight="3" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" simplePos="0"'}>${options.inline ? "" : '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>-12</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:align>top</wp:align></wp:positionV>'}<wp:extent cx="1828800" cy="914400"/>${options.inline ? "" : '<wp:wrapSquare wrapText="bothSides" distL="70"/>'}<wp:docPr id="${id}" name="Figure ${id}" descr="Stored alt"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1" noMove="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Stored picture"/><pic:cNvPicPr><a:picLocks noChangeAspect="1" noCrop="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="media"/><a:srcRect l="1000" r="2000" t="3000" b="4000"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm rot="12000" flipH="0" flipV="0"><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:${options.inline ? "inline" : "anchor"}></w:drawing></w:r>`;
  const encode = (xml: string) => new TextEncoder().encode(xml),
    files = new Map<string, Uint8Array>([
      [
        "[Content_Types].xml",
        encode(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/media/pixel.png" ContentType="image/png"/></Types>'
        )
      ],
      [
        "_rels/.rels",
        encode(
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`
        )
      ],
      [
        "word/document.xml",
        encode(
          `<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:a="${a}" xmlns:wp="${wp}" xmlns:pic="${pic}"><w:body><w:p><!--preserved-->${Array.from({ length: options.copies ?? 1 }, (_, index) => draw(index + 1)).join("")}</w:p><w:sectPr/></w:body></w:document>`
        )
      ],
      [
        "word/_rels/document.xml.rels",
        encode(
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="media" Type="${r}/image" Target="media/pixel.png"/></Relationships>`
        )
      ],
      ["word/media/pixel.png", replacementPng()]
    ]);
  options.alter?.(files);
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive(
    {
      comment: new Uint8Array(),
      members: [...files].map(([name, bytes]) => ({
        name,
        bytes,
        directory: false,
        modified: new Date("2025-01-02T03:04:06Z")
      }))
    },
    {
      async write(bytes) {
        volume.appendFileSync("/out", bytes);
      }
    },
    layoutContext.encoding,
    layoutContext
  );
  return new Uint8Array(volume.readFileSync("/out") as Uint8Array);
}
