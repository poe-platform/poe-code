import type { Workbook, CellRange, ImportedValue } from "./workbook.js";
import { SsconvertError, type CapabilityContext } from "./contracts.js";
import { objectKinds } from "./objects/registry.js";

/** Known retained object records can prove that no graph needs a renderer. */
export function hasGraphObjects(book: Workbook, context: CapabilityContext): boolean {
  context.signal.throwIfAborted();
  let work = 0;
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  const charge = () => {
    context.signal.throwIfAborted();
    if (++work > maximum) throw new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded");
  };
  for (const sheet of book.sheets) {
    charge();
    for (const record of sheet.unsupportedRecords ?? []) {
      charge();
      if (record.kind !== "Objects" || record.disposition !== "retained") continue;
      if (record.source !== "Gnumeric_XmlIO:sax" || record.data === undefined) return true;
      const value = record.data;
      if (value === null || typeof value !== "object" || Array.isArray(value)) return true;
      const node = value as { readonly [key: string]: ImportedValue };
      if (node.name !== "Objects" || !Array.isArray(node.children)) return true;
      // Native XML object callbacks recognize graph classes directly below
      // Objects. Text, comments and arbitrary nested metadata are not graphs.
      for (const child of node.children) {
        charge();
        if (child === null || typeof child !== "object" || Array.isArray(child)) continue;
        const object = child as { readonly [key: string]: ImportedValue };
        if (object.namespace === node.namespace && typeof object.name === "string" && Object.hasOwn(objectKinds, object.name) && objectKinds[object.name] === "graph") return true;
      }
    }
  }
  return false;
}
export interface GraphRequest {
  readonly template: string;
  readonly format?: string;
  readonly options?: readonly string[];
}
interface ArtifactIdentity {
  readonly uri: string;
  /** Workbook sheet ID. When present, the engine owns native template expansion. */
  readonly sheet?: string;
  readonly objectName?: string;
  readonly mediaType: string;
}
export type RenderedArtifact = ArtifactIdentity & (
  | { readonly bytes: Uint8Array; readonly render?: never }
  | { readonly bytes?: never; readonly render: () => Promise<Uint8Array> }
);
export interface RenderingCapability {
  exportGraphs(
    book: Workbook,
    request: GraphRequest & { readonly resolution: number;
      /** Engine-owned sheet continuation; consult before admitting sheet rendering. */
      readonly canVisitSheet?: (sheet: string) => boolean },
    context: CapabilityContext
  ): AsyncIterable<RenderedArtifact>;
}
export interface ClipboardCapability {
  serialize(
    book: Workbook,
    target: string,
    range: CellRange,
    context: CapabilityContext
  ): Promise<Uint8Array>;
}
