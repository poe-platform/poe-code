import { OfficeError } from "./errors.js";
import type { SelectionContext } from "./selectors.js";
import { writePackageArchive, type ArchiveMember } from "./package-writer.js";
import { parseXmlPart } from "./xml.js";

export interface PresentationTextShape {
  readonly name?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
}
export interface PresentationSlideInput {
  readonly name?: string;
  readonly shapes?: readonly PresentationTextShape[];
}
export interface PresentationProperties {
  readonly category?: string;
  readonly content_status?: string;
  readonly identifier?: string;
  readonly language?: string;
  readonly version?: string;
  readonly title?: string;
  readonly subject?: string;
  readonly author?: string;
  readonly keywords?: string;
  readonly comments?: string;
  readonly last_modified_by?: string;
  readonly revision?: number;
  readonly created?: Date;
  readonly modified?: Date;
  readonly last_printed?: Date;
}
export interface CreatePresentationOptions {
  readonly kind?: "pptx" | "potx" | "ppsx";
  readonly dialect?: "transitional" | "strict";
  readonly width?: number;
  readonly height?: number;
  readonly slides?: readonly PresentationSlideInput[];
  readonly properties?: PresentationProperties;
  readonly author?: string;
  readonly timestamp?: Date;
}
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ct = "application/vnd.openxmlformats-officedocument.presentationml.";
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function fields(value: unknown, allowed: readonly string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid("Expected a structured creation object.");
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid("Unknown creation field.");
}
function boundText(value: string, maximum: number): number {
  if (value.length > maximum)
    throw new OfficeError("resource-limit", "Authored XML exceeds byte limits.", "serialize");
  let size = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    size += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    if (size > maximum)
      throw new OfficeError("resource-limit", "Authored XML exceeds byte limits.", "serialize");
  }
  return size;
}
function boundedJoin(values: Iterable<string>, maximum: number): string {
  const chunks: string[] = [];
  let size = 0;
  for (const value of values) {
    size += boundText(value, maximum - size);
    chunks.push(value);
  }
  return chunks.join("");
}
function escaped(value: unknown, maximum: number): string {
  if (typeof value !== "string") invalid("Expected text.");
  boundText(value, maximum);
  let result = "";
  let size = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      invalid("Text contains an invalid XML character.");
    const encoded =
      (
        {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "\r": "&#13;",
          "\n": "&#10;",
          "\t": "&#9;"
        } as Record<string, string>
      )[ch] ?? ch;
    size += boundText(encoded, maximum - size);
    result += encoded;
  }
  return result;
}
function dimension(value: number, slide = false): number {
  if (
    !Number.isSafeInteger(value) ||
    value < (slide ? 914400 : 1) ||
    value > (slide ? 51206400 : 27273042316900)
  )
    invalid("Invalid EMU dimension.");
  return value;
}
function date(value: Date): string {
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime()) ||
    value.getUTCFullYear() < 1 ||
    value.getUTCFullYear() > 9999
  )
    invalid("Expected a valid UTC date.");
  return value.toISOString().slice(0, 19) + "Z";
}
function xml(root: string, body: string, attributes = ""): string {
  return `<p:${root} xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"${attributes}>${body}</p:${root}>`;
}
function relationships(entries: readonly (readonly [string, string, string])[]): string {
  return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("")}</Relationships>`;
}
function shapeTree(content: string, name: string | undefined, maximum: number): string {
  return `<p:cSld name="${escaped(name === undefined ? "" : name, maximum)}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${content}</p:spTree></p:cSld>`;
}
function textShape(shape: PresentationTextShape, index: number, maximum: number): string {
  fields(shape, ["name", "x", "y", "width", "height", "text"]);
  for (const value of [shape.x, shape.y])
    if (!Number.isSafeInteger(value) || Math.abs(value) > 27273042316900)
      invalid("Invalid shape position.");
  if (typeof shape.text !== "string") invalid("Expected shape text.");
  boundText(shape.text, maximum);
  const paragraphs = boundedJoin(
    (function* () {
      for (const paragraph of shape.text.split("\n")) {
        yield "<a:p>";
        let first = true;
        for (const run of paragraph.split("\v")) {
          if (!first) yield "<a:br/>";
          first = false;
          yield `<a:r><a:t>${escaped(run, maximum)}</a:t></a:r>`;
        }
        yield "<a:endParaRPr/></a:p>";
      }
    })(),
    maximum
  );
  return `<p:sp><p:nvSpPr><p:cNvPr id="${index + 2}" name="${escaped(shape.name === undefined ? "" : shape.name, maximum)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${shape.x}" y="${shape.y}"/><a:ext cx="${dimension(shape.width)}" cy="${dimension(shape.height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

export async function createPresentation(
  options: CreatePresentationOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  fields(options, [
    "kind",
    "dialect",
    "width",
    "height",
    "slides",
    "properties",
    "author",
    "timestamp"
  ]);
  if (context?.signal?.aborted) throw new OfficeError("cancelled", "Operation cancelled.", "admit");
  if (
    !context?.xmlLimits ||
    !context.archiveLimits ||
    !context.limits ||
    !context.relationshipLimits
  )
    invalid("Explicit creation limits are required.");
  if (options.dialect === "strict")
    throw new OfficeError("unsupported-profile", "Strict creation is not supported.", "usage");
  if (options.dialect !== undefined && options.dialect !== "transitional")
    invalid("Invalid dialect.");
  const kind = options.kind === undefined ? "pptx" : options.kind;
  if (!["pptx", "potx", "ppsx"].includes(kind)) invalid("Invalid presentation kind.");
  const width = dimension(options.width === undefined ? 12192000 : options.width, true);
  const height = dimension(options.height === undefined ? 6858000 : options.height, true);
  const slides = options.slides === undefined ? [] : options.slides;
  if (!Array.isArray(slides)) invalid("Expected a slide array.");
  if (
    slides.length * 2 + 11 > context.archiveLimits.maxMembers ||
    slides.length + 6 > context.relationshipLimits.maxParts ||
    slides.length * 2 + 8 > context.relationshipLimits.maxRelationships
  )
    throw new OfficeError("resource-limit", "Creation graph exceeds resource limits.", "usage");
  const maximum = Math.min(
    context.xmlLimits.maxBytes,
    context.archiveLimits.maxEntryBytes,
    context.archiveLimits.maxTotalBytes
  );
  const members: ArchiveMember[] = [];
  const overrides: string[] = [];
  let total = 0;
  let nodes = 0;
  const add = (name: string, content: string, type?: string) => {
    boundText(content, Math.min(maximum, context.archiveLimits.maxTotalBytes - total));
    const bytes = new TextEncoder().encode(content);
    total += bytes.length;
    if (total > context.archiveLimits.maxTotalBytes)
      throw new OfficeError("resource-limit", "Creation exceeds byte limits.", "serialize");
    nodes += parseXmlPart(bytes, {
      ...context.xmlLimits,
      maxNodes: context.xmlLimits.maxNodes - nodes
    }).nodeCount;
    members.push({ name, bytes });
    if (type) overrides.push(`<Override PartName="/${name}" ContentType="${type}"/>`);
  };
  add(
    "_rels/.rels",
    relationships([
      ["rId1", `${r}/officeDocument`, "ppt/presentation.xml"],
      [
        "rId2",
        "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        "docProps/core.xml"
      ],
      ["rId3", `${r}/extended-properties`, "docProps/app.xml"]
    ])
  );
  const presentationRels: [string, string, string][] = [
    ["rId1", `${r}/slideMaster`, "slideMasters/slideMaster1.xml"]
  ];
  for (let index = 0; index < slides.length; index++) {
    const slide = slides[index]!;
    fields(slide, ["name", "shapes"]);
    const shapes = slide.shapes === undefined ? [] : slide.shapes;
    if (!Array.isArray(shapes)) invalid("Expected a shape array.");
    if (shapes.length > context.xmlLimits.maxNodes)
      throw new OfficeError("resource-limit", "Too many shapes.", "usage");
    add(
      `ppt/slides/slide${index + 1}.xml`,
      xml(
        "sld",
        shapeTree(
          boundedJoin(
            (function* () {
              for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++)
                yield textShape(shapes[shapeIndex]!, shapeIndex, maximum);
            })(),
            maximum
          ),
          slide.name,
          maximum
        ) + "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>"
      ),
      `${ct}slide+xml`
    );
    add(
      `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      relationships([["rId1", `${r}/slideLayout`, "../slideLayouts/slideLayout1.xml"]])
    );
    presentationRels.push([`rId${index + 2}`, `${r}/slide`, `slides/slide${index + 1}.xml`]);
  }
  add(
    "ppt/presentation.xml",
    xml(
      "presentation",
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${slides.length ? `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst>` : ""}<p:sldSz cx="${width}" cy="${height}"/><p:notesSz cx="6858000" cy="9144000"/>`
    ),
    `${ct}${{ pptx: "presentation", potx: "template", ppsx: "slideshow" }[kind]}.main+xml`
  );
  add("ppt/_rels/presentation.xml.rels", relationships(presentationRels));
  add(
    "ppt/slideMasters/slideMaster1.xml",
    xml(
      "sldMaster",
      shapeTree("", "Original master", maximum) +
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>'
    ),
    `${ct}slideMaster+xml`
  );
  add(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    relationships([
      ["rId1", `${r}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
      ["rId2", `${r}/theme`, "../theme/theme1.xml"]
    ])
  );
  add(
    "ppt/slideLayouts/slideLayout1.xml",
    xml(
      "sldLayout",
      shapeTree("", "Blank", maximum) + "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>",
      ' type="blank" preserve="1"'
    ),
    `${ct}slideLayout+xml`
  );
  add(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    relationships([["rId1", `${r}/slideMaster`, "../slideMasters/slideMaster1.xml"]])
  );
  const colors = {
    dk1: "17212B",
    lt1: "FFFFFF",
    dk2: "34495E",
    lt2: "F0F4F5",
    accent1: "176B87",
    accent2: "B86E33",
    accent3: "5E8062",
    accent4: "8665A2",
    accent5: "B54C64",
    accent6: "4D8E95",
    hlink: "165DCC",
    folHlink: "7043A3"
  };
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const fonts = '<a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/>';
  add(
    "ppt/theme/theme1.xml",
    `<a:theme xmlns:a="${a}" name="Original"><a:themeElements><a:clrScheme name="Original">${Object.entries(
      colors
    )
      .map(([key, value]) => `<a:${key}><a:srgbClr val="${value}"/></a:${key}>`)
      .join(
        ""
      )}</a:clrScheme><a:fontScheme name="Original"><a:majorFont>${fonts}</a:majorFont><a:minorFont>${fonts}</a:minorFont></a:fontScheme><a:fmtScheme name="Original"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[12700, 25400, 38100].map((w) => `<a:ln w="${w}">${fill}<a:prstDash val="solid"/></a:ln>`).join("")}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
    "application/vnd.openxmlformats-officedocument.theme+xml"
  );
  const properties = options.properties === undefined ? {} : options.properties;
  const strings = {
    category: "cp:category",
    content_status: "cp:contentStatus",
    identifier: "dc:identifier",
    language: "dc:language",
    version: "cp:version",
    title: "dc:title",
    subject: "dc:subject",
    author: "dc:creator",
    keywords: "cp:keywords",
    comments: "dc:description",
    last_modified_by: "cp:lastModifiedBy"
  };
  fields(properties, [...Object.keys(strings), "revision", "created", "modified", "last_printed"]);
  if (options.author !== undefined && properties.author !== undefined)
    invalid("Author is supplied twice.");
  if (
    options.timestamp !== undefined &&
    (properties.created !== undefined || properties.modified !== undefined)
  )
    invalid("Timestamp is supplied twice.");
  const values = {
    ...properties,
    ...(options.author === undefined ? {} : { author: options.author }),
    ...(options.timestamp === undefined
      ? {}
      : { created: options.timestamp, modified: options.timestamp })
  };
  let core = "";
  for (const [key, tag] of Object.entries(strings)) {
    const value = values[key as keyof typeof strings];
    if (value !== undefined) {
      const content = escaped(value, maximum);
      if ([...value].length > 255) invalid("Core text exceeds 255 Unicode code points.");
      core += `<${tag}>${content}</${tag}>`;
    }
  }
  if (values.revision !== undefined) {
    if (!Number.isSafeInteger(values.revision) || values.revision < 0) invalid("Invalid revision.");
    core += `<cp:revision>${values.revision}</cp:revision>`;
  }
  for (const key of ["created", "modified", "last_printed"] as const)
    if (values[key] !== undefined) {
      const tag = key === "last_printed" ? "cp:lastPrinted" : `dcterms:${key}`;
      core += `<${tag}${key === "last_printed" ? "" : ' xsi:type="dcterms:W3CDTF"'}>${date(values[key])}</${tag}>`;
    }
  add(
    "docProps/core.xml",
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${core}</cp:coreProperties>`,
    "application/vnd.openxmlformats-package.core-properties+xml"
  );
  add(
    "docProps/app.xml",
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>${slides.length}</Slides></Properties>`,
    "application/vnd.openxmlformats-officedocument.extended-properties+xml"
  );
  add(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${overrides.join("")}</Types>`
  );
  return writePackageArchive(members, context, { compression: "auto" });
}
