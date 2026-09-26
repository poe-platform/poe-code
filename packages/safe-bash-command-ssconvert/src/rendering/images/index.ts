import { SsconvertError, type CapabilityContext } from "../../contracts.js";
import type { AxisMetadata, Sheet, Workbook } from "../../workbook.js";
import { sheetObjects, type SheetObject } from "../../objects/index.js";
import { objectRectangle, type ObjectMetrics, type ObjectRectangle } from "../../objects/layout.js";
import type { RenderingCapability } from "../../rendering.js";
import { encodeGraphImage, type ImageSurface } from "./codecs.js";
import { profileImageTargets, ImageExportError } from "./formats.js";
import { graphBackground } from "./scene.js";
export { imageFormats, profileImageTargets, ImageExportError } from "./formats.js";
export { encodeGraphImage } from "./codecs.js";
export type { ImageSurface, ImageCommand, ImagePathCommand } from "./codecs.js";
export interface GraphSceneRequest {
  readonly book: Workbook;
  readonly sheet: Sheet;
  readonly object: SheetObject;
  readonly rectangle: ObjectRectangle;
  readonly width: number;
  readonly height: number;
  readonly resolution: number;
  readonly format: string;
}
export interface ImageRenderingOptions {
  /** A JavaScript scene producer, never a native process or fallback. */
  readonly renderGraph?: (request: GraphSceneRequest, context: CapabilityContext) => Promise<ImageSurface>;
  readonly metrics?: (sheet: Sheet, context: CapabilityContext) => ObjectMetrics;
}
/** Captured C/UTC profile defaults. Explicit persisted metrics override these. */
function sheetMetrics(sheet: Sheet, context: CapabilityContext): ObjectMetrics {
  let work = 0;
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  const axis = (entries: readonly AxisMetadata[] | undefined, fallback: number) => {
    const sorted = [...(entries ?? [])].sort((a, b) => a.index - b.index);
    const indices: number[] = [], adjustments: number[] = [], sizes = new Map<number, number>();
    let adjustment = 0;
    for (const entry of sorted) {
      context.signal.throwIfAborted();
      if (++work > maximum) throw new SsconvertError("resource-limit", "ssconvert image metrics work limit exceeded");
      const size = entry.sizePoints ?? fallback;
      // Anchor fractions use nominal size even when traversal hides the cell.
      sizes.set(entry.index, size); adjustment += (entry.hidden ? 0 : size) - fallback;
      indices.push(entry.index); adjustments.push(adjustment);
    }
    return (index: number) => {
      context.signal.throwIfAborted();
      let left = 0, right = indices.length;
      while (left < right) {
        if (++work > maximum) throw new SsconvertError("resource-limit", "ssconvert image metrics work limit exceeded");
        const middle = Math.floor((left + right) / 2);
        if (indices[middle]! < index) left = middle + 1; else right = middle;
      }
      return { start: index * fallback + (left ? adjustments[left - 1]! : 0), size: sizes.get(index) ?? fallback };
    };
  };
  const columnDefault = sheet.view?.defaultColumnWidth, rowDefault = sheet.view?.defaultRowHeight;
  return { column: axis(sheet.columns, typeof columnDefault === "number" ? columnDefault : 48),
    row: axis(sheet.rows, typeof rowDefault === "number" ? rowDefault : 12.75) };
}
/** Owns graph filtering and native stable anchor order, not publication or filenames. */
export function createImageRendering(options: ImageRenderingOptions = {}): RenderingCapability {
  const producer = options.renderGraph, metrics = options.metrics;
  return { async *exportGraphs(book, request, context) {
    let work = 0;
    const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
    const charge = () => { context.signal.throwIfAborted(); if (++work > maximum) throw new SsconvertError("resource-limit", "ssconvert graph work limit exceeded"); };
    for (const sheet of book.sheets) {
      context.signal.throwIfAborted();
      if (request.canVisitSheet && !request.canVisitSheet(sheet.id)) {
        context.signal.throwIfAborted();
        return;
      }
      charge();
      const positions = metrics?.(sheet, context) ?? sheetMetrics(sheet, context);
      charge();
      // Objects are prepended to the native sheet list. Stable GSList sorting
      // preserves that reverse insertion order for anchors that compare equal.
      const graphs = sheetObjects(sheet, context).filter(object => object.kind === "graph").reverse().map(object => {
        charge();
        const anchored = { ...object, anchor: { ...object.anchor,
          range: object.anchor.range ?? { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
          offsets: object.anchor.offsets.length ? object.anchor.offsets : [0, 0, 0, 0] } };
        const rectangle = objectRectangle(anchored, positions, context);
        return { object, rectangle, endpoints: [rectangle.y, rectangle.x, rectangle.y + rectangle.height, rectangle.x + rectangle.width] };
      });
      graphs.sort((a, b) => {
        charge();
        for (let index = 0; index < 4; index++) {
          const difference = a.endpoints[index]! - b.endpoints[index]!;
          if (difference !== 0) return difference < 0 ? -1 : 1;
        }
        return 0;
      });
      for (const { object, rectangle } of graphs) {
        charge();
        const format = request.format ?? "svg";
        const descriptor = profileImageTargets.find(candidate => candidate.id === format);
        yield { uri: request.template, sheet: sheet.id, objectName: object.name,
          mediaType: descriptor?.mediaType ?? "application/octet-stream",
          async render() {
            charge();
            if (!descriptor) {
              if (format !== "unknown") {
                await context.diagnostic?.({ code: "graph-image-format", severity: "warning",
                  message: `[GOImage::get_format_from_name] Unknown format name (${format})` });
                charge();
              }
              throw new ImageExportError("Unknown image format");
            }
            if (!descriptor.graphRenderable) {
              await context.diagnostic?.({ code: "graph-image-format", severity: "warning",
                message: "[GogRendererCairo:export_image] unsupported format" });
              charge();
              throw new ImageExportError("Unknown failure while saving image");
            }
            const background = producer ? undefined : graphBackground(object.graph);
            const width = Math.max(1, Math.min(Math.abs(rectangle.width), 32767 * 72 / request.resolution));
            const height = Math.max(1, Math.min(Math.abs(rectangle.height), 32767 * 72 / request.resolution));
            let pixelWidth = Math.trunc(width * request.resolution / 72), pixelHeight = Math.trunc(height * request.resolution / 72);
            // GOffice returns a 1x1 pixbuf when either Cairo dimension is zero.
            // Preserve the coupled fallback rather than clamping each axis.
            if (pixelWidth <= 0 || pixelHeight <= 0) pixelWidth = pixelHeight = 1;
            const rasterBytes = pixelWidth * pixelHeight * 4;
            const rasterTarget = ["png", "jpeg", "bmp", "ico", "tiff"].includes(format);
            if (rasterTarget && (!Number.isSafeInteger(rasterBytes) || rasterBytes > maximum))
              throw new SsconvertError("resource-limit", "ssconvert image raster work limit exceeded");
            let surface: ImageSurface;
            if (producer) surface = await producer({ book, sheet, object, rectangle, width, height, resolution: request.resolution, format }, context);
            else {
              const rgba = rasterTarget ? new Uint8Array(rasterBytes) : undefined;
              if (rgba && background) {
                const channels = [1, 3, 5].map(offset => Number.parseInt(background.slice(offset, offset + 2), 16));
                for (let offset = 0; offset < rgba.length; offset += 4) {
                  if (offset % (pixelWidth * 4) === 0) charge();
                  rgba[offset] = channels[0]!; rgba[offset + 1] = channels[1]!;
                  rgba[offset + 2] = channels[2]!; rgba[offset + 3] = 255;
                }
              }
              surface = { width, height,
                commands: background ? [{ kind: "rectangle", x: 0, y: 0, width, height, fill: background }] : [],
                ...(rgba ? { raster: { width: pixelWidth, height: pixelHeight, rgba } } : {}) };
            }
            charge();
            return encodeGraphImage(surface, format, context);
          }
        };
      }
    }
  } };
}
