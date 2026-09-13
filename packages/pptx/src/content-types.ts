import { SaxesParser } from "saxes";
import { OfficeError } from "./errors.js";
import { asciiKey, partName } from "./package-uri.js";

export interface ContentTypeLimits {
  readonly maxBytes: number;
  readonly maxEntries: number;
}

export type PresentationKind = "pptx" | "potx" | "ppsx";

export interface ContentTypeIndex {
  get(part: string): string;
  presentationKind(mainPart: string, expectedKind?: PresentationKind): PresentationKind;
}

const mainKinds: Readonly<Record<string, PresentationKind>> = Object.freeze({
  "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml": "pptx",
  "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml": "potx",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml": "ppsx"
});

function invalid(): never {
  throw new OfficeError("invalid-opc", "Invalid package content types.", "index");
}

function token(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    "!#$%&'*+-.^_`|~".includes(character)
  );
}

function mediaType(value: string): string {
  let position = 0;
  const readToken = () => {
    const start = position;
    while (position < value.length && token(value[position]!)) position++;
    if (position === start) invalid();
    return value.slice(start, position);
  };
  readToken();
  if (value[position++] !== "/") invalid();
  readToken();
  const essence = asciiKey(value.slice(0, position));
  const parameters = new Set<string>();
  while (position < value.length) {
    while (value[position] === " " || value[position] === "\t") position++;
    if (value[position++] !== ";") invalid();
    while (value[position] === " " || value[position] === "\t") position++;
    const name = asciiKey(readToken());
    if (parameters.has(name) || value[position++] !== "=") invalid();
    parameters.add(name);
    if (value[position] !== '"') {
      readToken();
    } else {
      position++;
      let closed = false;
      while (position < value.length) {
        let character = value[position++]!;
        if (character === '"') {
          closed = true;
          break;
        }
        if (character === "\\") {
          if (position === value.length) invalid();
          character = value[position++]!;
        }
        const code = character.charCodeAt(0);
        if ((code < 32 && code !== 9) || code === 127 || code > 255) invalid();
      }
      if (!closed) invalid();
    }
  }
  if (
    parameters.size &&
    (essence.startsWith("application/vnd.openxmlformats-package.") ||
      Object.hasOwn(mainKinds, essence))
  )
    invalid();
  return essence;
}

export function parseContentTypes(bytes: Uint8Array, limits: ContentTypeLimits): ContentTypeIndex {
  if (!(bytes instanceof Uint8Array))
    throw new OfficeError("invalid-type", "Expected content-type bytes.", "usage");
  if (
    !limits ||
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes < 1 ||
    !Number.isSafeInteger(limits.maxEntries) ||
    limits.maxEntries < 1
  ) {
    throw new OfficeError("invalid-value", "Explicit content-type limits are required.", "usage");
  }
  const maxEntries = limits.maxEntries;
  if (bytes.length > limits.maxBytes)
    throw new OfficeError("resource-limit", "Content-type byte limit exceeded.", "index");
  const overrides = new Map<string, string>();
  const defaults = new Map<string, string>();
  let encoding = "utf-8";
  if ((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 60 && bytes[1] === 0))
    encoding = "utf-16le";
  if ((bytes[0] === 254 && bytes[1] === 255) || (bytes[0] === 0 && bytes[1] === 60))
    encoding = "utf-16be";
  try {
    const xml = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    const parser = new SaxesParser({ xmlns: true });
    let depth = 0;
    let count = 0;
    parser.on("error", invalid);
    parser.on("doctype", invalid);
    parser.on("xmldecl", (declaration) => {
      if (declaration.version !== "1.0") invalid();
      if (
        declaration.encoding &&
        asciiKey(declaration.encoding) !== (encoding === "utf-8" ? "utf-8" : "utf-16")
      )
        invalid();
    });
    parser.on("text", (value) => {
      if ([...value].some((character) => !" \t\n\r".includes(character))) invalid();
    });
    parser.on("cdata", invalid);
    parser.on("opentag", (tag) => {
      depth++;
      if (tag.uri !== "http://schemas.openxmlformats.org/package/2006/content-types" || depth > 2)
        invalid();
      const attributes = Object.values(tag.attributes).filter(
        (attribute) => attribute.uri !== "http://www.w3.org/2000/xmlns/"
      );
      if (depth === 1) {
        if (tag.local !== "Types" || attributes.length) invalid();
        return;
      }
      if (++count > maxEntries)
        throw new OfficeError("resource-limit", "Content-type entry limit exceeded.", "index");
      const isDefault = tag.local === "Default";
      if (!isDefault && tag.local !== "Override") invalid();
      const nameAttribute = isDefault ? "Extension" : "PartName";
      if (
        attributes.length !== 2 ||
        attributes.some(
          (attribute) =>
            attribute.uri ||
            (attribute.local !== nameAttribute && attribute.local !== "ContentType")
        )
      )
        invalid();
      const name = attributes.find((attribute) => attribute.local === nameAttribute)?.value;
      const type = attributes.find((attribute) => attribute.local === "ContentType")?.value;
      if (!name || !type) invalid();
      mediaType(type);
      let key: string;
      if (isDefault) {
        for (let index = 0; index < name.length; index++) {
          const character = name[index]!;
          if (character === "%") {
            const hex = name.slice(index + 1, index + 3);
            if (
              hex.length !== 2 ||
              [...hex].some((digit) => !"0123456789abcdefABCDEF".includes(digit))
            )
              invalid();
            index += 2;
          } else {
            const code = character.charCodeAt(0);
            if (
              !(
                (code >= 48 && code <= 57) ||
                (code >= 65 && code <= 90) ||
                (code >= 97 && code <= 122) ||
                "!$&'()*+,:=@-_~".includes(character)
              )
            )
              invalid();
          }
        }
        key = asciiKey(name);
      } else {
        key = asciiKey(partName(name, false));
        if (key === "/[content_types].xml") invalid();
      }
      const entries = isDefault ? defaults : overrides;
      if (entries.has(key)) invalid();
      entries.set(key, type);
    });
    parser.on("closetag", () => {
      depth--;
    });
    parser.write(xml).close();
    if (!count) invalid();
  } catch (error) {
    if (error instanceof OfficeError) throw error;
    invalid();
  }
  const get = (part: string): string => {
    if (typeof part !== "string")
      throw new OfficeError("invalid-type", "Expected a part URI string.", "usage");
    const name = partName(part, false);
    const key = asciiKey(name);
    if (key === "/[content_types].xml") invalid();
    const filename = name.slice(name.lastIndexOf("/") + 1);
    const dot = filename.lastIndexOf(".");
    const type =
      overrides.get(key) ?? (dot < 0 ? undefined : defaults.get(asciiKey(filename.slice(dot + 1))));
    if (!type) throw new OfficeError("missing-binding", "Part content type is absent.", "index");
    return type;
  };
  return Object.freeze({
    get,
    presentationKind(mainPart: string, expectedKind?: PresentationKind) {
      const essence = mediaType(get(mainPart));
      const kind = Object.hasOwn(mainKinds, essence) ? mainKinds[essence] : undefined;
      if (!kind || (expectedKind !== undefined && expectedKind !== kind)) invalid();
      return kind;
    }
  });
}
