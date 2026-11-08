import { OfficeError } from "./errors.js";

function unsafeName(): never {
  throw new OfficeError("unsafe-path", "Invalid package part name.", "index");
}

function unreserved(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    "-._~".includes(String.fromCharCode(code))
  );
}

function international(code: number): boolean {
  return (
    (code >= 0xa0 && code <= 0xd7ff) ||
    (code >= 0xf900 && code <= 0xfdcf) ||
    (code >= 0xfdf0 && code <= 0xffef) ||
    (code >= 0x10000 &&
      code <= 0xefffd &&
      (code & 0xffff) <= 0xfffd &&
      (code < 0xe0000 || code >= 0xe1000))
  );
}

export function partName(value: string, zipName: boolean): string {
  if (typeof value !== "string" || !value || (!zipName && !value.startsWith("/"))) unsafeName();
  const source = zipName ? value : value.slice(1);
  if (source === "[Content_Types].xml") return `/${source}`;
  const segments = source.split("/");
  const mapped = segments.map((segment) => {
    if (!segment || segment.endsWith(".")) unsafeName();
    let result = "";
    for (let index = 0; index < segment.length; index++) {
      const code = segment.codePointAt(index)!;
      if (code === 37) {
        let encoded = "";
        do {
          const hex = segment.slice(index + 1, index + 3);
          if (
            hex.length !== 2 ||
            [...hex].some((digit) => !"0123456789abcdefABCDEF".includes(digit))
          )
            unsafeName();
          const byte = Number.parseInt(hex, 16);
          if (byte < 128) {
            if (encoded) {
              index--;
              break;
            }
            if (byte < 32 || byte === 127 || byte === 47 || byte === 92 || unreserved(byte))
              unsafeName();
            result += `%${hex.toUpperCase()}`;
            index += 2;
            break;
          }
          encoded += `%${hex}`;
          index += 3;
          if (segment[index] !== "%") {
            index--;
            break;
          }
        } while (index < segment.length);
        if (encoded) {
          if (!zipName) unsafeName();
          try {
            const decoded = decodeURIComponent(encoded);
            if ([...decoded].some((character) => !international(character.codePointAt(0)!)))
              unsafeName();
            result += decoded;
          } catch {
            unsafeName();
          }
        }
      } else {
        if (code < 128) {
          if (!unreserved(code) && !"!$&'()*+,;=:@".includes(segment[index]!)) unsafeName();
        } else if (zipName || !international(code)) {
          unsafeName();
        }
        result += String.fromCodePoint(code);
        if (code > 0xffff) index++;
      }
    }
    return result;
  });
  return `/${mapped.join("/")}`;
}

export function asciiKey(name: string): string {
  let result = "";
  for (const character of name) {
    const code = character.charCodeAt(0);
    result += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : character;
  }
  return result;
}

export function packageUri(value: string) {
  const name = value === "/" ? "/" : partName(value, false);
  const slash = name.lastIndexOf("/");
  const filename = name.slice(slash + 1);
  const dot = filename.lastIndexOf(".");
  const ext = dot < 0 ? "" : filename.slice(dot + 1);
  const stem = dot < 0 ? filename : filename.slice(0, dot);
  let start = stem.length;
  while (start > 0 && "0123456789".includes(stem[start - 1]!)) start--;
  const idx = start === stem.length ? null : Number(stem.slice(start));
  if (idx !== null && !Number.isSafeInteger(idx)) {
    throw new OfficeError("invalid-value", "Part index exceeds the safe integer range.", "index");
  }
  return Object.freeze({
    name,
    key: asciiKey(name),
    baseURI: name.slice(0, slash) || "/",
    filename,
    ext,
    idx,
    relsUri: `${name.slice(0, slash + 1)}_rels/${filename}.rels`
  });
}

export function resolvePartReference(baseURI: string, reference: string): string {
  const base = baseURI === "/" ? [] : partName(baseURI, false).slice(1).split("/");
  if (typeof reference !== "string" || !reference || reference.startsWith("//")) unsafeName();
  if (!reference.startsWith("/") && reference.split("/")[0]!.includes(":")) unsafeName();
  const segments = reference.startsWith("/") ? [] : base;
  const input = reference.startsWith("/") ? reference.slice(1) : reference;
  for (const segment of input.split("/")) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) unsafeName();
      segments.pop();
    } else {
      partName(`/${segment}`, false);
      segments.push(segment);
    }
  }
  if (input.endsWith("/.") || input.endsWith("/..") || input === "." || input === "..")
    unsafeName();
  return partName(`/${segments.join("/")}`, false);
}

export function relativePartReference(target: string, baseURI: string): string {
  const destination = partName(target, false).slice(1).split("/");
  const base = baseURI === "/" ? [] : partName(baseURI, false).slice(1).split("/");
  let shared = 0;
  while (
    shared < base.length &&
    shared < destination.length - 1 &&
    asciiKey(base[shared]!) === asciiKey(destination[shared]!)
  )
    shared++;
  const value = [...base.slice(shared).map(() => ".."), ...destination.slice(shared)].join("/");
  return value.split("/")[0]!.includes(":") ? `./${value}` : value;
}
