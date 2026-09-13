import { OfficeError, TypeError as ModelTypeError } from "./errors.js";
import { attr, child } from "./masters.js";
import { parseXmlPart, type XmlPart, type XmlElement } from "./xml.js";

export class ShapeIdAllocator {
  #turbo = false;
  #snapshot: XmlPart | undefined;
  #used = new Set<number>();
  #candidate = 1;

  constructor(private readonly read: () => XmlPart) {}

  get turbo_add_enabled(): boolean {
    return this.#turbo;
  }

  set turbo_add_enabled(value: boolean) {
    if (typeof value !== "boolean")
      throw new ModelTypeError("Turbo allocation requires a boolean.");
    this.#turbo = value;
    this.#snapshot = undefined;
  }

  append(parent: XmlElement, makeMarkup: (id: number) => string): { xml: XmlPart; id: number } {
    const source = this.read();
    const id = this.next();
    const markup = makeMarkup(id);
    const inserted = parseXmlPart(new TextEncoder().encode(markup), {
      maxBytes: 8388608,
      maxNodes: 100000,
      maxDepth: 128
    });
    const used = new Set<number>();
    const pending = [inserted.root];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.name.namespace === source.root.name.namespace && node.name.localName === "cNvPr") {
        const raw = attr(node, "id");
        const value = Number(raw);
        if (
          !raw ||
          [...raw].some((char) => char < "0" || char > "9") ||
          !Number.isInteger(value) ||
          value < 1 ||
          value > 4294967295 ||
          used.has(value) ||
          (this.#used.has(value) && value !== id)
        )
          throw new OfficeError("invalid-opc", "Inserted drawing identities collide.", "parse");
        used.add(value);
      }
      pending.push(...node.children);
    }
    if (!used.has(id))
      throw new OfficeError("invalid-opc", "Inserted drawing identity is missing.", "parse");
    const extension = child(parent, "extLst");
    const xml = source.spliceChildren(
      parent,
      extension ? parent.children.indexOf(extension) : parent.children.length,
      0,
      [markup]
    );
    if (this.#turbo) {
      for (const value of used) {
        this.#used.add(value);
        this.#candidate = Math.max(this.#candidate, value + 1);
      }
      this.#snapshot = xml;
    }
    return { xml, id };
  }

  next(): number {
    const doc = this.read();
    if (!this.#turbo || this.#snapshot !== doc) {
      const used = new Set<number>();
      let candidate = 1;
      const pending = [doc.root];
      while (pending.length) {
        const node = pending.pop()!;
        if (
          [
            "http://schemas.openxmlformats.org/presentationml/2006/main",
            "http://purl.oclc.org/ooxml/presentationml/main"
          ].includes(node.name.namespace) &&
          node.name.localName === "cNvPr"
        ) {
          const raw = attr(node, "id");
          const id = Number(raw);
          if (
            !raw ||
            [...raw].some((char) => char < "0" || char > "9") ||
            !Number.isInteger(id) ||
            id > 4294967295 ||
            used.has(id)
          )
            throw new OfficeError(
              "invalid-opc",
              "Drawing identities must be unique unsigned integers.",
              "parse"
            );
          used.add(id);
          candidate = Math.max(candidate, id + 1);
        }
        pending.push(...node.children);
      }
      this.#used = used;
      this.#candidate = candidate;
      this.#snapshot = doc;
    }
    if (this.#candidate > 4294967295) this.#candidate = 1;
    while (this.#used.has(this.#candidate)) this.#candidate++;
    if (this.#candidate > 4294967295)
      throw new OfficeError("invalid-value", "No available drawing identity.", "validate-intent");
    const id = this.#candidate;
    if (this.#turbo) {
      this.#used.add(id);
      this.#candidate++;
    }
    return id;
  }
}
