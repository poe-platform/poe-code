import { createZipCodec, type ZipLimits } from "../../../office-package/src/zip.js";

export const fixtureLimits: ZipLimits = {
  maxArchiveBytes: 32768,
  maxEntryBytes: 16384,
  maxTotalBytes: 30000,
  maxMembers: 24,
  maxPathBytes: 256,
  maxDepth: 16,
  maxPaxBytes: 1024,
  maxTextBytes: 16384,
  chunkSize: 4096
};
type Theme = "garden" | "observatory" | "museum" | "equipment";
type Variant =
  | "valid"
  | "strict"
  | "template"
  | "empty"
  | "missing-target"
  | "malformed-xml"
  | "invalid-grid"
  | "truncated-image";

export function technicalBitmap(variant: "valid" | "truncated" = "valid"): Uint8Array {
  const bytes = new Uint8Array(62);
  const view = new DataView(bytes.buffer);
  bytes.set([66, 77]);
  view.setUint32(2, 62, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 2, true);
  view.setInt32(22, 1, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, 8, true);
  view.setInt32(38, 3780, true);
  view.setInt32(42, 7560, true);
  bytes.set([19, 41, 73, 101, 137, 173, 0, 0], 54);
  return variant === "truncated" ? bytes.slice(0, 20) : bytes;
}

export async function createDocumentFixture(theme: Theme, variant: Variant = "valid") {
  if ((variant === "invalid-grid" || variant === "truncated-image") && theme !== "museum") {
    throw new Error(`${variant} requires the museum theme`);
  }
  const strict = variant === "strict";
  const w = strict
    ? "http://purl.oclc.org/ooxml/wordprocessingml/main"
    : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict
    ? "http://purl.oclc.org/ooxml/officeDocument/relationships"
    : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const a = strict
    ? "http://purl.oclc.org/ooxml/drawingml/main"
    : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const wp = strict
    ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing"
    : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const pic = strict
    ? "http://purl.oclc.org/ooxml/drawingml/picture"
    : "http://schemas.openxmlformats.org/drawingml/2006/picture";
  const ct = "http://schemas.openxmlformats.org/package/2006/content-types";
  const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
  const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  const ns = `xmlns:w="${w}" xmlns:r="${r}" xmlns:a="${a}" xmlns:wp="${wp}" xmlns:pic="${pic}" xmlns:mc="${mc}" xmlns:x="urn:original:equipment" mc:Ignorable="x"`;
  const parts = new Map<string, Uint8Array>();
  const types = new Map<string, string>();
  const encoder = new TextEncoder();
  const add = (name: string, content: string | Uint8Array, type: string) => {
    parts.set(name, typeof content === "string" ? encoder.encode(content) : content);
    types.set(name, type);
  };
  const xml = (local: string, body: string) => `<w:${local} ${ns}>${body}</w:${local}>`;
  const run = (text: string, properties = "") =>
    `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
  const paragraph = (text: string) => `<w:p>${run(text)}</w:p>`;
  const cell = (body: string, properties = "") =>
    `<w:tc><w:tcPr>${properties}</w:tcPr>${body}</w:tc>`;
  const table = (rows: string, columns = 2) =>
    `<w:tbl><w:tblPr/><w:tblGrid>${'<w:gridCol w:w="1800"/>'.repeat(columns)}</w:tblGrid>${rows}</w:tbl>`;
  const relationship = (id: string, type: string, target: string, external = false) =>
    `<Relationship Id="${id}" Type="${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;
  const relationships = (body: string) => `<Relationships xmlns="${pr}">${body}</Relationships>`;
  const wordType = (name: string) =>
    `application/vnd.openxmlformats-officedocument.wordprocessingml.${name}+xml`;
  let rels = relationship("rStyles", `${r}/styles`, "styles.xml");
  const section =
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  let body = "";

  add(
    "word/styles.xml",
    xml(
      "styles",
      '<w:docDefaults/><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
    ),
    wordType("styles")
  );
  if (theme === "garden") {
    body =
      `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run("Community garden handbook")}</w:p>` +
      `<w:p><w:pPr><w:keepNext/><w:spacing w:after="120"/><w:ind w:left="0"/></w:pPr>${run("Water the ", "<w:b/>")}${run("seedlings", '<w:b w:val="0"/>')}${run(" at dawn.")}</w:p>` +
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr>${run("Return the trowel.")}</w:p>` +
      '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>3</w:t></w:r></w:fldSimple></w:p>' +
      section;
    add(
      "word/numbering.xml",
      xml(
        "numbering",
        '<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="1"><w:startOverride w:val="3"/></w:lvlOverride></w:num>'
      ),
      wordType("numbering")
    );
    rels += relationship("rNumbering", `${r}/numbering`, "numbering.xml");
  } else if (theme === "observatory") {
    body =
      `<w:p><w:commentRangeStart w:id="4"/>${run("Grease the dome rail.")}<w:commentRangeEnd w:id="4"/><w:r><w:commentReference w:id="4"/></w:r><w:r><w:footnoteReference w:id="2"/></w:r><w:r><w:endnoteReference w:id="2"/></w:r></w:p>` +
      '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rHeader"/><w:footerReference w:type="default" r:id="rFooter"/></w:sectPr></w:pPr></w:p>' +
      paragraph("Recheck the latch after cooling.") +
      '<w:p><w:bookmarkStart w:id="5" w:name="rail"/><w:r><w:t>Rail reference</w:t></w:r><w:bookmarkEnd w:id="5"/></w:p><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF rail </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Check rail</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      section;
    add("word/header1.xml", xml("hdr", paragraph("Dome inspection log")), wordType("header"));
    add("word/footer1.xml", xml("ftr", paragraph("Night team — check latch")), wordType("footer"));
    add(
      "word/comments.xml",
      xml(
        "comments",
        `<w:comment w:id="4" w:author="Mira" w:initials="M" w:date="2026-01-02T03:04:05Z">${paragraph("Rail is quiet.")}${table(`<w:tr>${cell(paragraph("Torque"))}${cell(paragraph("8 N·m"))}</w:tr>`)}<w:p/></w:comment>`
      ),
      wordType("comments")
    );
    for (const name of ["footnote", "endnote"] as const) {
      add(
        `word/${name}s.xml`,
        xml(
          `${name}s`,
          `<w:${name} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${name}><w:${name} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${name}><w:${name} w:id="2">${paragraph(name === "footnote" ? "Use the narrow grease nozzle." : "Inspection interval: six nights.")}</w:${name}>`
        ),
        wordType(`${name}s`)
      );
      rels += relationship(`r${name}`, `${r}/${name}s`, `${name}s.xml`);
    }
    rels +=
      relationship("rHeader", `${r}/header`, "header1.xml") +
      relationship("rFooter", `${r}/footer`, "footer1.xml") +
      relationship("rComments", `${r}/comments`, "comments.xml");
  } else if (theme === "museum") {
    const image = (id: number) =>
      `<w:r><w:drawing><wp:inline><wp:extent cx="19050" cy="9525"/><wp:docPr id="${id}" name="Density sample ${id}" descr="Two technical pixels"/><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Pixel sample"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="19050" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    body =
      paragraph("Museum handling catalog") +
      table(
        `<w:tr>${cell(paragraph("Clay lamp"), `<w:gridSpan w:val="${variant === "invalid-grid" ? 0 : 2}"/>`)}</w:tr>` +
          `<w:tr>${cell(paragraph("Shelf C"), '<w:vMerge w:val="restart"/>')}${cell(table(`<w:tr>${cell(paragraph("Linen pad"))}</w:tr>`, 1) + "<w:p/>")}</w:tr>` +
          `<w:tr>${cell("<w:p/>", "<w:vMerge/>")}${cell(paragraph("Handle by base"))}</w:tr>` +
          `<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>${cell(paragraph("No left slot"))}</w:tr>`
      ) +
      `<w:p>${image(1)}${image(2)}</w:p>` +
      section;
    add(
      "word/media/pixel.bmp",
      technicalBitmap(variant === "truncated-image" ? "truncated" : "valid"),
      "image/bmp"
    );
    add(
      "customXml/item1.xml",
      '<shelf xmlns="urn:original:museum" status="unverified"><!--opaque inventory-->shelf=west; humidity=stable</shelf>',
      "application/xml"
    );
    rels +=
      relationship("rImage", `${r}/image`, "media/pixel.bmp") +
      relationship("rShelf", `${r}/customXml`, "../customXml/item1.xml");
  } else {
    body =
      `<w:p x:calibration="0"><w:pPr><w:bidi/></w:pPr>${run("مفتاح — 望遠鏡 — cafe\u0301 — 🔧", '<w:rtl/><w:lang w:val="ar" w:eastAsia="ja-JP" w:bidi="ar"/>')}<w:r><w:tab/><w:br/><w:t>箱 2</w:t></w:r></w:p>` +
      '<!--retain equipment annotation--><?inventory stable?><mc:AlternateContent><mc:Choice Requires="x"><w:p><w:r><w:t>Extended calibration</w:t></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>Manual calibration</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>' +
      `<w:p><w:bookmarkStart w:id="3" w:name="equipment"/>${run("Spare keys")}<w:bookmarkEnd w:id="3"/><w:hyperlink r:id="rLink">${run("Inventory endpoint")}</w:hyperlink></w:p>` +
      `<w:p><w:del w:id="8" w:author="Ivo" w:date="2026-01-02T03:04:05Z"><w:r><w:delText>Worn strap</w:delText></w:r></w:del><w:ins w:id="9" w:author="Ivo" w:date="2026-01-02T03:04:05Z">${run("Fresh strap")}</w:ins></w:p>` +
      `<w:sdt><w:sdtPr><w:tag w:val="locker"/><w:id w:val="12"/><w:text/></w:sdtPr><w:sdtContent>${paragraph("Locker seven")}</w:sdtContent></w:sdt>` +
      section;
    rels += relationship("rLink", `${r}/hyperlink`, "https://equipment.invalid/catalog", true);
  }
  if (variant === "empty") body = "<w:p/>" + section;
  add(
    "word/document.xml",
    variant === "malformed-xml"
      ? `<w:document ${ns}><w:body>`
      : xml("document", `<w:body>${body}</w:body>`),
    wordType(variant === "template" ? "template.main" : "document.main")
  );
  add(
    "word/_rels/document.xml.rels",
    relationships(rels),
    "application/vnd.openxmlformats-package.relationships+xml"
  );
  add(
    "docProps/core.xml",
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Volunteer reference notes</dc:title><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-02T03:04:05Z</dcterms:created></cp:coreProperties>',
    "application/vnd.openxmlformats-package.core-properties+xml"
  );
  add(
    "_rels/.rels",
    relationships(
      relationship("rDocument", `${r}/officeDocument`, "word/document.xml") +
        relationship("rProperties", `${pr}/metadata/core-properties`, "docProps/core.xml")
    ),
    "application/vnd.openxmlformats-package.relationships+xml"
  );
  add(
    "[Content_Types].xml",
    `<Types xmlns="${ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${[
      ...types
    ]
      .filter(([name]) => !name.endsWith(".rels"))
      .map(([name, type]) => `<Override PartName="/${name}" ContentType="${type}"/>`)
      .join("")}</Types>`,
    "application/xml"
  );
  if (variant === "missing-target") parts.delete("word/styles.xml");
  const codec = createZipCodec(undefined, { utcDates: true });
  const signal = new AbortController().signal;
  const entries = [];
  for (const name of [...parts.keys()].sort()) {
    entries.push(
      await codec.makeZipEntry(
        name,
        parts.get(name)!,
        {
          modified: new Date("1980-01-01T00:00:00Z"),
          mode: 0o100644,
          directory: false,
          symlink: false
        },
        fixtureLimits,
        signal
      )
    );
  }
  const bytes = await codec.writeZipArchive(
    { entries, comment: new Uint8Array() },
    fixtureLimits,
    signal
  );
  return { bytes, parts };
}
