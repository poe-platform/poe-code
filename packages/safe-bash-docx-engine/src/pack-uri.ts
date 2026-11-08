import { InputTypeError, InvalidValueError } from "./archive.js";
import { invalidPackage, normalizePartName, relativePartTarget, resolvePartTarget } from "./part-uri.js";

function directoryOwner(baseURI: string): string {
  if (typeof baseURI !== "string") throw new InputTypeError("Expected a package directory URI.");
  return baseURI === "/" ? "/" : normalizePartName(baseURI) + "/uri";
}

export class PackURI {
  readonly #value: string;

  constructor(pack_uri_str: string) {
    if (typeof pack_uri_str !== "string") throw new InputTypeError("Expected a package URI string.");
    this.#value = pack_uri_str === "/" ? "/" : normalizePartName(pack_uri_str);
    Object.freeze(this);
  }

  static from_rel_ref(baseURI: string, relative_ref: string): PackURI {
    const owner = directoryOwner(baseURI);
    if (typeof relative_ref !== "string") throw new InputTypeError("Expected a relationship reference string.");
    if (relative_ref === "") return new PackURI(baseURI);
    const resolved = resolvePartTarget(owner, relative_ref);
    if (resolved.fragment !== null) invalidPackage();
    return new PackURI(resolved.partname);
  }

  get baseURI(): string {
    return this.#value.slice(0, this.#value.lastIndexOf("/")) || "/";
  }

  get ext(): string {
    const filename = this.filename;
    const dot = filename.lastIndexOf(".");
    return dot < 0 ? "" : filename.slice(dot + 1);
  }

  get filename(): string {
    return this.#value.slice(this.#value.lastIndexOf("/") + 1);
  }

  get idx(): number | null {
    const filename = this.filename;
    const dot = filename.lastIndexOf(".");
    const stem = dot < 0 ? filename : filename.slice(0, dot);
    let start = stem.length;
    while (start > 0 && stem[start - 1]! >= "0" && stem[start - 1]! <= "9") start--;
    if (start === stem.length) return null;
    const index = Number(stem.slice(start));
    if (!Number.isSafeInteger(index)) throw new InvalidValueError("Package filename number exceeds the safe integer range.");
    return index;
  }

  get membername(): string {
    return this.#value.slice(1);
  }

  relative_ref(baseURI: string): string {
    if (this.#value === "/") {
      directoryOwner(baseURI);
      throw new InvalidValueError("The package root is not a part target.");
    }
    return relativePartTarget(directoryOwner(baseURI), this.#value);
  }

  get rels_uri(): PackURI {
    return new PackURI((this.baseURI === "/" ? "" : this.baseURI) + "/_rels/" + this.filename + ".rels");
  }

  toString(): string {
    return this.#value;
  }

  toJSON(): string {
    return this.#value;
  }
}
