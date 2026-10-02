import { validateXmlViewReplacement } from "./xml-view-validation.js";
import { parseContentTypes } from "./content-types.js";
import {
  InvalidHandleError,
  PropertyAccessError,
  OfficeError,
  TypeError as ModelTypeError
} from "./errors.js";
import { loadShared, relPart } from "./masters.js";
import type { PackageReader } from "./package-reader.js";
import { partName } from "./package-uri.js";
import { readRelationshipGraph } from "./relationships.js";
import type { SelectionContext } from "./selectors.js";
import { parseXmlPart, type XmlPart } from "./xml.js";
import { createXmlElementView, type XmlElementView, type XmlViewOwner } from "./xml-view.js";
import { validateXmlPartReplacement } from "./xml-parts.js";

export interface PartRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly mode: "internal" | "external";
}
export interface PartView {
  readonly element: XmlElementView;
  readonly partname: string;
  readonly content_type: string;
  get blob(): Uint8Array;
  set blob(value: Uint8Array);
  readonly rels: readonly PartRelationship[];
  readonly package: PackageView;
}
export interface PackageView {
  readonly parts: readonly PartView[];
  get_part(partname: string): PartView | null;
}

type State = Awaited<ReturnType<typeof loadShared>>;

export function createPackageView(
  state: State,
  context: SelectionContext,
  changed: () => void
): PackageView {
  const views = new Map<string, PartView>();
  const limits = {
    ...context.xmlLimits,
    ...context.relationshipLimits,
    maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes),
    maxEntries: context.archiveLimits.maxMembers
  };
  function current(): PackageReader {
    if (context.signal?.aborted)
      throw new OfficeError("cancelled", "Operation cancelled.", "select");
    const names = [...new Set([...state.reader.names, ...state.changes.keys()])].filter(
      (name) => !state.deleted.has(name)
    );
    const get = (name: string) => {
      if (!names.includes(name)) throw new InvalidHandleError();
      return new Uint8Array(state.changes.get(name) ?? state.reader.get(name));
    };
    return {
      names,
      has: (name) => names.includes(name),
      get,
      relsXmlFor: (name) => {
        const rels = name === "/" ? "/_rels/.rels" : relPart(name);
        return names.includes(rels) ? get(rels) : null;
      }
    };
  }
  function view(name: string): PartView {
    const existing = views.get(name);
    if (existing) return existing;
    const initialBytes = state.changes.get(name) ?? state.reader.get(name);
    let cachedBytes: Uint8Array | undefined;
    let cachedDocument: XmlPart | undefined;
    let root: XmlElementView | undefined;
    let rootDocument: XmlPart | undefined;
    const owner: XmlViewOwner = {
      read() {
        if (!current().has(name)) throw new InvalidHandleError();
        const bytes = state.changes.get(name) ?? initialBytes;
        if (bytes !== cachedBytes) {
          cachedDocument = parseXmlPart(bytes, context.xmlLimits);
          cachedBytes = bytes;
        }
        return cachedDocument!;
      },
      commit(expected, next) {
        if (owner.read() !== expected) throw new InvalidHandleError();
        part.blob = next.bytes();
        cachedBytes = state.changes.get(name)!;
        cachedDocument = next;
      }
    };
    const part: PartView = Object.freeze({
      get element() {
        const type = part.content_type.split(";", 1)[0]!.trim().toLowerCase();
        if (type !== "application/xml" && type !== "text/xml" && !type.endsWith("+xml"))
          throw new PropertyAccessError("The part does not contain XML.");
        const document = owner.read();
        if (!root || rootDocument !== document) {
          root = createXmlElementView(owner);
          rootDocument = document;
        }
        return root;
      },
      get partname() {
        current().get(name);
        return name;
      },
      get content_type() {
        const reader = current();
        reader.get(name);
        return parseContentTypes(reader.get("/[Content_Types].xml"), limits).get(name);
      },
      get blob() {
        return current().get(name);
      },
      set blob(value: Uint8Array) {
        if (!(value instanceof Uint8Array)) throw new ModelTypeError("Expected part bytes.");
        if (
          value.length >
          Math.min(context.limits.maxBytes, context.archiveLimits.maxEntryBytes, limits.maxBytes)
        )
          throw new OfficeError("resource-limit", "Part byte limit exceeded.", "validate-intent");
        const bytes = new Uint8Array(value);
        validateXmlViewReplacement(
          current(),
          name,
          bytes,
          {
            ...context,
            validationLimits: limits
          },
          validateXmlPartReplacement
        );
        state.changes.set(name, bytes);
        changed();
      },
      get rels() {
        return Object.freeze(
          readRelationshipGraph(current(), limits)
            .outgoing(name)
            .map((edge) =>
              Object.freeze({
                id: edge.id,
                type: edge.type,
                target: edge.target,
                mode: edge.external ? ("external" as const) : ("internal" as const)
              })
            )
        );
      },
      get package() {
        current().get(name);
        return result;
      }
    });
    views.set(name, part);
    return part;
  }
  const result: PackageView = Object.freeze({
    get parts() {
      return Object.freeze(readRelationshipGraph(current(), limits).parts.map(view));
    },
    get_part(name: string) {
      if (typeof name !== "string") throw new ModelTypeError("Expected a package part URI.");
      const canonical = partName(name, false);
      const parts = readRelationshipGraph(current(), limits).parts;
      return parts.includes(canonical) ? view(canonical) : null;
    }
  });
  return result;
}
