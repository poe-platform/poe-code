import type { loadShared } from "./masters.js";
import {
  IndexError,
  InvalidHandleError,
  TypeError as ModelTypeError,
  ValueError
} from "./errors.js";
import { indexed } from "./indexed-collection.js";
import type { PackageReader } from "./package-reader.js";
import type { PartView } from "./package-view.js";
import { packageUri, resolvePartReference } from "./package-uri.js";
import { buildSelectionIndex, type SelectionContext } from "./selectors.js";
import { prepareSlideInsertion } from "./slides.js";
import type { XmlElementView } from "./xml-view.js";

function child(element: XmlElementView, localName: string): XmlElementView | undefined {
  const matches = element.children.filter(
    (node) => node.tag.namespace === element.tag.namespace && node.tag.localName === localName
  );
  if (matches.length > 1) throw new ValueError("Ambiguous layout structure.");
  return matches[0];
}
function related(part: PartView, id: string | null, type: string): PartView {
  const edges = part.rels.filter(
    (edge) => edge.id === id && edge.type.endsWith(`/${type}`) && edge.mode === "internal"
  );
  if (edges.length !== 1) throw new InvalidHandleError();
  const target = part.package.get_part(
    resolvePartReference(packageUri(part.partname).baseURI, edges[0]!.target)
  );
  if (!target) throw new InvalidHandleError();
  return target;
}
function relationshipId(node: XmlElementView): string | null {
  return (
    node.attrib.find(
      (attribute) =>
        attribute.name.localName === "id" &&
        [
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
          "http://purl.oclc.org/ooxml/officeDocument/relationships"
        ].includes(attribute.name.namespace)
    )?.value ?? null
  );
}

export class SlideLayout {
  readonly #setName: (value: string | null) => void;
  constructor(
    readonly part: PartView,
    setName: (value: string | null) => void
  ) {
    this.#setName = setName;
  }
  get element(): XmlElementView {
    return this.part.element;
  }
  get name(): string {
    return child(this.element, "cSld")?.get({ namespace: "", localName: "name" }) ?? "";
  }
  set name(value: string | null) {
    if (value !== null && typeof value !== "string")
      throw new ModelTypeError("Expected layout name text or null.");
    this.#setName(value);
  }
}

export class SlideLayouts implements Iterable<SlideLayout> {
  readonly [index: number]: SlideLayout;
  readonly #presentation: PartView;
  readonly #views = new Map<string, SlideLayout>();
  readonly #setName: (part: string, value: string | null) => void;
  constructor(presentation: PartView, setName: (part: string, value: string | null) => void) {
    this.#presentation = presentation;
    this.#setName = setName;
    return indexed(this);
  }
  #parts(): readonly PartView[] {
    const masterList = child(this.#presentation.element, "sldMasterIdLst");
    const masterId = masterList?.children.find(
      (node) =>
        node.tag.localName === "sldMasterId" && node.tag.namespace === masterList.tag.namespace
    );
    if (!masterId) throw new IndexError();
    const master = related(this.#presentation, relationshipId(masterId), "slideMaster");
    const layouts = child(master.element, "sldLayoutIdLst");
    return (
      layouts?.children
        .filter(
          (node) =>
            node.tag.namespace === layouts.tag.namespace && node.tag.localName === "sldLayoutId"
        )
        .map((node) => related(master, relationshipId(node), "slideLayout")) ?? []
    );
  }
  get length(): number {
    return this.#parts().length;
  }
  get(index: number): SlideLayout {
    const parts = this.#parts();
    if (!Number.isSafeInteger(index) || index < 0 || index >= parts.length) throw new IndexError();
    const part = parts[index]!;
    let layout = this.#views.get(part.partname);
    if (!layout) {
      layout = new SlideLayout(part, (value) => this.#setName(part.partname, value));
      this.#views.set(part.partname, layout);
    }
    return layout;
  }
  at(index: number): SlideLayout {
    if (!Number.isSafeInteger(index)) throw new IndexError();
    return this.get(index < 0 ? this.length + index : index);
  }
  get_by_name(name: string, default_value: SlideLayout | null = null): SlideLayout | null {
    if (
      typeof name !== "string" ||
      (default_value !== null && !(default_value instanceof SlideLayout))
    )
      throw new ModelTypeError("Expected a layout name and optional layout fallback.");
    return [...this].find((layout) => layout.name === name) ?? default_value;
  }
  index(slide_layout: SlideLayout): number {
    if (!(slide_layout instanceof SlideLayout))
      throw new ModelTypeError("Expected an owned slide layout.");
    const index = [...this].findIndex((layout) => layout.part === slide_layout.part);
    if (index < 0) throw new ValueError("Layout is not in this collection.");
    return index;
  }
  *[Symbol.iterator](): IterableIterator<SlideLayout> {
    for (let index = 0; index < this.length; index++) yield this.get(index);
  }
}

export function prepareLayoutInsertion(
  state: Awaited<ReturnType<typeof loadShared>>,
  presentation: PartView,
  layout: SlideLayout,
  context: SelectionContext,
  fingerprint: string
) {
  if (!(layout instanceof SlideLayout)) throw new ModelTypeError("Expected an owned slide layout.");
  if (layout.part.package !== presentation.package)
    throw new ValueError("Layout belongs to another presentation.");
  const parts = new Map(
    [...new Set([...state.reader.names, ...state.changes.keys()])]
      .filter((name) => !state.deleted.has(name))
      .map((name) => [name, state.changes.get(name) ?? state.reader.get(name)])
  );
  const reader: PackageReader = {
    get names() {
      return [...parts.keys()];
    },
    has: (name) => parts.has(name),
    get: (name) => {
      const bytes = parts.get(name);
      if (!bytes) throw new InvalidHandleError();
      return bytes;
    },
    relsXmlFor: (name) => {
      const slash = name.lastIndexOf("/");
      return (
        parts.get(
          name === "/"
            ? "/_rels/.rels"
            : `${name.slice(0, slash)}/_rels/${name.slice(slash + 1)}.rels`
        ) ?? null
      );
    }
  };
  const prepared = prepareSlideInsertion(reader, { layout: layout.part.partname }, context);
  for (const [name, bytes] of prepared.changes) parts.set(name, bytes);
  const index = buildSelectionIndex(reader, fingerprint, context);
  return { ...prepared, index };
}
