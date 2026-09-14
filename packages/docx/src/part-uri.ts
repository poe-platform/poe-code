import { InputTypeError } from "./archive.js";
import { InvalidPackageError } from "./package-xml.js";

export function invalidPackage(): never {
  throw new InvalidPackageError("Invalid document OPC container.");
}

export function asciiKey(value: string): string {
  let result = "";
  for (const char of value) result += char >= "A" && char <= "Z" ? char.toLowerCase() : char;
  return result;
}

function unreserved(char: string): boolean {
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    "-._~".includes(char)
  );
}

function unicodeCharacter(char: string): boolean {
  const point = char.codePointAt(0)!;
  return (
    (point >= 0xa0 && point <= 0xd7ff) ||
    (point >= 0xf900 && point <= 0xfdcf) ||
    (point >= 0xfdf0 && point <= 0xffef) ||
    (point >= 0x10000 && point <= 0xefffd && (point & 0xffff) <= 0xfffd)
  );
}

function segmentName(segment: string, target: boolean): string {
  let result = "";
  for (let index = 0; index < segment.length; ) {
    const char = String.fromCodePoint(segment.codePointAt(index)!);
    if (char === "%") {
      let encoded = "";
      while (segment[index] === "%") {
        const digits = segment.slice(index + 1, index + 3);
        if (
          digits.length !== 2 ||
          [...digits].some((digit) => !"0123456789abcdefABCDEF".includes(digit))
        )
          invalidPackage();
        encoded += `%${digits}`;
        index += 3;
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(encoded);
      } catch {
        return invalidPackage();
      }
      for (const value of decoded) {
        const point = value.codePointAt(0)!;
        if (value === "/" || value === "\\" || point < 0x20 || point === 0x7f) invalidPackage();
        if (point >= 0x80) {
          if (!unicodeCharacter(value)) invalidPackage();
          result += value;
        } else if (unreserved(value)) {
          if (!target) invalidPackage();
          result += value;
        } else result += `%${point.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    } else {
      if (!unreserved(char) && !"!$&'()*+,;=:@".includes(char) && !unicodeCharacter(char))
        invalidPackage();
      result += char;
      index += char.length;
    }
  }
  if (!result || result.endsWith(".")) invalidPackage();
  return result;
}

export function normalizePartName(name: string): string {
  if (typeof name !== "string") throw new InputTypeError("Expected a part URI string.");
  if (!name.startsWith("/")) invalidPackage();
  return (
    "/" +
    name
      .slice(1)
      .split("/")
      .map((segment) => segmentName(segment, false))
      .join("/")
  );
}

export function resolvePartTarget(
  owner: string,
  target: string
): {
  partname: string;
  fragment: string | null;
} {
  if (typeof target !== "string")
    throw new InputTypeError("Expected a relationship target string.");
  const source = owner === "/" ? "/" : normalizePartName(owner);
  const hash = target.indexOf("#");
  const path = hash < 0 ? target : target.slice(0, hash);
  const fragment = hash < 0 ? null : target.slice(hash + 1);
  if (
    path.startsWith("//") ||
    path.includes("?") ||
    (!path.startsWith("/") && path.split("/")[0]!.includes(":"))
  )
    invalidPackage();
  if (fragment !== null) {
    // Fragments identify content, not another package part. Retain their spelling.
    try {
      if (
        [...decodeURIComponent(fragment)].some(
          (char) => char.codePointAt(0)! < 0x20 || char === "\x7f"
        )
      )
        invalidPackage();
    } catch {
      invalidPackage();
    }
    for (let index = 0; index < fragment.length; ) {
      const char = String.fromCodePoint(fragment.codePointAt(index)!);
      if (char === "%") {
        index += 3;
        continue;
      }
      if (!unreserved(char) && !"!$&'()*+,;=:@/?".includes(char) && !unicodeCharacter(char))
        invalidPackage();
      index += char.length;
    }
  }
  if (!path) {
    if (source === "/") invalidPackage();
    return { partname: source, fragment };
  }
  const segments = path.startsWith("/") ? [] : source.slice(1).split("/").slice(0, -1);
  for (const segment of (path.startsWith("/") ? path.slice(1) : path).split("/")) {
    if (segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segmentName(segment, true));
  }
  if (path.endsWith("/.") || path.endsWith("/..")) invalidPackage();
  return { partname: normalizePartName("/" + segments.join("/")), fragment };
}

export function relativePartTarget(owner: string, target: string): string {
  const source = owner === "/" ? [] : normalizePartName(owner).slice(1).split("/").slice(0, -1);
  const destination = normalizePartName(target).slice(1).split("/");
  let shared = 0;
  while (
    shared < source.length &&
    shared < destination.length - 1 &&
    asciiKey(source[shared]!) === asciiKey(destination[shared]!)
  )
    shared++;
  const relative = [...source.slice(shared).map(() => ".."), ...destination.slice(shared)].join(
    "/"
  );
  let encoded = "";
  for (const char of relative)
    encoded += char.codePointAt(0)! >= 0x80 ? encodeURIComponent(char) : char;
  return encoded.split("/")[0]!.includes(":") ? "./" + encoded : encoded;
}
