import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { sheetObjects, type ObjectNode } from "../objects/index.js";
import { objectRectangle } from "../objects/layout.js";
import { gnumericNumber } from "../codecs/gnumeric-number.js";
import { formatA1, type CellRange, type Sheet, type ImportedValue, type UnsupportedRecord } from "../workbook.js";
import { decodePng } from "@poe-code/pdf";
import { encodeGraphImage } from "../rendering/images/index.js";

const imageTargets = new Set(["image/png", "image/jpeg", "image/bmp", "image/svg+xml", "image/x-wmf", "image/x-emf"]);

export function clipboardObjectRecords(sheet: Sheet, range: CellRange, context: CapabilityContext): readonly UnsupportedRecord[] {
  const copied = sheetObjects(sheet, context).filter(object => {
    const bounds = object.anchor.range;
    return bounds && bounds.startRow >= range.startRow && bounds.endRow <= range.endRow && bounds.startColumn >= range.startColumn && bounds.endColumn <= range.endColumn;
  }).reverse();
  let work = 0;
  const node = (value: ObjectNode, bound?: string): ImportedValue => {
    context.signal.throwIfAborted();
    if (++work > (context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32))
      throw new SsconvertError("resource-limit", "ssconvert clipboard object work limit exceeded");
    return { name: value.name, namespace: value.namespace, text: value.text,
      attributes: [...Object.entries(value.attributes).map(([name, value]) => ({ name, namespace: "", value })), ...value.qualifiedAttributes].map(attribute => ({ ...attribute,
        value: bound !== undefined && attribute.namespace === "" && attribute.name === "ObjectBound" ? bound : attribute.value })),
      children: value.children.map(child => node(child)) };
  };
  const children = copied.map(object => {
    const bound = object.anchor.range!;
    return node(object.payload, `${formatA1(bound.startRow - range.startRow, bound.startColumn - range.startColumn)}:${formatA1(bound.endRow - range.startRow, bound.endColumn - range.startColumn)}`);
  });
  return children.length ? [{ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: {
    name: "Objects", namespace: copied[0]!.payload.namespace, text: "", attributes: [], children
  } }] : [];
}

function imageBytes(text: string, maximum: number, context: CapabilityContext): Uint8Array {
  if (text.length > Math.ceil(maximum / 3) * 4 + 4)
    throw new SsconvertError("resource-limit", "ssconvert clipboard image bytes limit exceeded");
  const encoded = text.split(" ").join("").split("\n").join("").split("\r").join("").split("\t").join("");
  if (Array.from(encoded).some(character => !"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".includes(character)))
    throw new SsconvertError("io", "Invalid clipboard image data.");
  const raw = atob(encoded);
  if (raw.length > maximum) throw new SsconvertError("resource-limit", "ssconvert clipboard image bytes limit exceeded");
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) {
    context.signal.throwIfAborted(); bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/** Object target selection follows the contained-anchor copy, not intersection. */
export async function serializeClipboardObject(sheet: Sheet, target: string, range: CellRange,
  context: CapabilityContext): Promise<Uint8Array | undefined> {
  if (!imageTargets.has(target) && target !== "application/x-goffice-graph") return undefined;
  context.signal.throwIfAborted();
  const graph = target === "application/x-goffice-graph";
  if (graph) await context.diagnostic?.({ code: "clipboard-info", severity: "warning", message: "Unknown info type" });
  const objects = sheetObjects(sheet, context).filter(object => {
    const bounds = object.anchor.range;
    return bounds && bounds.startRow >= range.startRow && bounds.endRow <= range.endRow &&
      bounds.startColumn >= range.startColumn && bounds.endColumn <= range.endColumn;
  }).reverse();
  if (!objects.length) {
    await context.diagnostic?.({ code: "clipboard-object", severity: "warning",
      message: `${graph ? "object_write" : "image_write"}: assertion 'cr->objects != NULL' failed` });
    return new Uint8Array();
  }
  const object = objects.find(candidate => graph ? candidate.kind === "graph" || candidate.kind === "component" : candidate.kind === "graph" || candidate.kind === "image" || candidate.kind === "component") ?? objects[0]!;
  if (target === "image/x-wmf" || target === "image/x-emf") {
    await context.diagnostic?.({ code: "clipboard-image-format", severity: "warning", message: `No image format for ${target}\n` });
    return new Uint8Array();
  }
  if (!graph && object.kind !== "graph" && object.kind !== "image" && object.kind !== "component") {
    await context.diagnostic?.({ code: "clipboard-object", severity: "warning",
      message: "sheet_object_write_image: assertion 'GNM_IS_SO_IMAGEABLE (so)' failed" });
    return new Uint8Array();
  }
  if (!graph && object.kind === "image") {
    const content = object.payload.children.find(child => child.name === "Content");
    const sourceType = content?.attributes["image-type"] ?? "png";
    if (content && target === `image/${sourceType}`) {
      const maximum = Math.min(context.limits.inputBytes, context.limits.outputBytes);
      return imageBytes(content.text, maximum, context);
    }
    if (target === "image/svg+xml") return new Uint8Array();
    if (content && sourceType === "png" && (target === "image/jpeg" || target === "image/bmp")) {
      const bytes = imageBytes(content.text, context.limits.inputBytes, context);
      if (bytes.length < 24) throw new SsconvertError("io", "Invalid clipboard image data.");
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const pixels = header.getUint32(16) * header.getUint32(20);
      const maximumWork = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
      if (!pixels || pixels > Math.floor(maximumWork / 16) || pixels > Math.floor(context.limits.outputBytes / 4))
        throw new SsconvertError("resource-limit", "ssconvert clipboard image raster work limit exceeded");
      let work = 0;
      const image = decodePng(bytes, amount => {
        context.signal.throwIfAborted();
        if (amount > maximumWork - work) throw new SsconvertError("resource-limit", "ssconvert clipboard image raster work limit exceeded");
        work += amount;
      });
      const rgba = new Uint8Array(pixels * 4);
      for (let index = 0; index < pixels; index++) {
        context.signal.throwIfAborted();
        rgba.set(image.rgb.subarray(index * 3, index * 3 + 3), index * 4);
        rgba[index * 4 + 3] = image.alpha?.[index] ?? 255;
      }
      return encodeGraphImage({ width: image.width, height: image.height, commands: [],
        raster: { width: image.width, height: image.height, rgba } }, target === "image/jpeg" ? "jpeg" : "bmp", context);
    }
  }
  if (graph && object.kind !== "graph" && object.kind !== "component") {
    await context.diagnostic?.({ code: "clipboard-object", severity: "warning",
      message: "sheet_object_write_object: assertion 'GNM_IS_SO_EXPORTABLE (so)' failed" });
    return new Uint8Array();
  }
  if (graph && object.kind === "graph" && object.graph?.type === "GogGraph" && !object.graph.children.length && !object.graph.data.length &&
    object.graph.properties.every(property => ["height-pts", "width-pts", "theme-name", "padding-pts", "anchor", "alignment"].includes(property.attributes.name ?? ""))) {
    let work = 0;
    const maximumWork = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
    const axis = (kind: "column" | "row", index: number) => {
      context.signal.throwIfAborted();
      const fallback = Number(sheet.view?.[kind === "column" ? "defaultColumnWidth" : "defaultRowHeight"] ?? (kind === "column" ? 48 : 12.75));
      let start = index * fallback, size = fallback;
      for (const entry of kind === "column" ? sheet.columns ?? [] : sheet.rows ?? []) {
        context.signal.throwIfAborted();
        if (++work > maximumWork) throw new SsconvertError("resource-limit", "ssconvert clipboard object work limit exceeded");
        const actual = entry.hidden ? 0 : entry.sizePoints ?? fallback;
        if (entry.index < index) start += actual - fallback;
        else if (entry.index === index) size = entry.sizePoints ?? fallback;
      }
      return { start, size };
    };
    const rectangle = objectRectangle({ ...object, anchor: { ...object.anchor,
      offsets: object.anchor.offsets.length ? object.anchor.offsets : [0, 0, 0, 0] } }, {
      column: index => axis("column", index), row: index => axis("row", index)
    }, context);
    const values: Readonly<Record<string, string>> = Object.fromEntries(object.graph.properties.map(property => [property.attributes.name!, property.text]));
    const escape = (value: string) => value.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split('"').join("&quot;");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<GogObject type="GogGraph">\n` +
      `  <property name="height-pts">${gnumericNumber(Math.abs(rectangle.height))}</property>\n` +
      `  <property name="width-pts">${gnumericNumber(Math.abs(rectangle.width))}</property>\n` +
      `  <property name="theme-name">${escape(values["theme-name"] ?? "Default")}</property>\n` +
      `  <property name="padding-pts">${escape(values["padding-pts"] ?? "7.086614173228346")}</property>\n` +
      `  <property name="style" type="GogStyle">\n    <outline auto-dash="1" auto-width="1" auto-color="1"/>\n    <fill type="none" auto-type="1" is-auto="1" auto-fore="1"/>\n  </property>\n` +
      `  <property name="anchor">${escape(values.anchor ?? "top-left")}</property>\n` +
      `  <property name="alignment">${escape(values.alignment ?? "fill")}</property>\n</GogObject>\n`;
    if (xml.length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert clipboard output bytes limit exceeded");
    const bytes = new TextEncoder().encode(xml);
    if (bytes.length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert clipboard output bytes limit exceeded");
    return bytes;
  }
  throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: clipboard object serialization ${target}`);
}
