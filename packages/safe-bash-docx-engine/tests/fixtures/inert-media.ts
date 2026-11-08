import { DocumentXmlEditor } from "../../src/xml-write.js";
import { layoutFixture } from "./image-layout.js";

function technicalMetafile(bitmap = false) {
  const records = bitmap
    ? [
        [21, 12, 3],
        [
          81, 136, 0, 0, 100, 100, 0, 0, 0, 0, 2, 2, 80, 40, 120, 16, 0, 0x00cc0020, 100, 100, 40,
          2, 2, 0x00200001, 0, 16, 0, 0, 0, 0, 0xffdc2814, 0xffdc2814, 0xff1450dc, 0xff1450dc
        ],
        [14, 20, 0, 0, 20]
      ]
    : [
        [37, 12, 0x80000005],
        [37, 12, 0x80000007],
        [43, 24, 10, 10, 90, 90],
        [27, 16, 10, 10],
        [54, 16, 90, 90],
        [14, 20, 0, 0, 20]
      ];
  const bytes = new Uint8Array(88 + records.reduce((sum, record) => sum + record[1]!, 0));
  const view = new DataView(bytes.buffer);
  const header = [
    1,
    88,
    0,
    0,
    100,
    100,
    0,
    0,
    2646,
    2646,
    0x464d4520,
    0x10000,
    bytes.length,
    records.length + 1,
    1,
    0,
    0,
    0,
    1024,
    768,
    270,
    203
  ];
  header.forEach((value, index) => view.setUint32(index * 4, value, true));
  let offset = 88;
  for (const record of records) {
    record.forEach((value, index) => view.setUint32(offset + index * 4, value, true));
    offset += record[1]!;
  }
  return bytes;
}

/** Original vector/bitmap EMFs and signature-only opaque WDP input. */
export async function inertMediaFixture(format: "emf" | "emf-bitmap" | "wdp", inline = true) {
  const bytes =
    format === "wdp" ? Uint8Array.of(73, 73, 188, 1) : technicalMetafile(format === "emf-bitmap");
  return layoutFixture({
    inline,
    alter(files) {
      files.set("word/media/pixel.png", bytes);
      const xml = new DocumentXmlEditor(files.get("[Content_Types].xml")!);
      const type = xml.root.children.find((child) =>
        child.attributes.some(
          (attribute) =>
            attribute.localName === "PartName" && attribute.value === "/word/media/pixel.png"
        )
      )!;
      xml.setAttribute(type, "ContentType", format === "wdp" ? "image/vnd.ms-photo" : "image/emf");
      files.set("[Content_Types].xml", xml.serialize());
    }
  });
}
