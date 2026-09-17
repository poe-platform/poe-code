import { InvalidPackageError } from "./package-xml.js";

/** Parse RFC 7231 media types without changing the retained OPC declaration. */
export function parseMediaType(value: string): string {
  let at = 0;
  const invalid = (): never => { throw new InvalidPackageError("Invalid OPC media type."); };
  const token = () => {
    const start = at;
    while (at < value.length) {
      const char = value[at]!;
      if (!(char >= "A" && char <= "Z" || char >= "a" && char <= "z" || char >= "0" && char <= "9" || "!#$%&'*+-.^_`|~".includes(char))) break;
      at++;
    }
    if (at === start) invalid();
  };
  token(); if (value[at++] !== "/") invalid(); token();
  const essence = value.slice(0, at).toLowerCase();
  const parameters = at < value.length;
  while (at < value.length) {
    while (value[at] === " " || value[at] === "\t") at++;
    if (value[at++] !== ";") invalid();
    while (value[at] === " " || value[at] === "\t") at++;
    token(); if (value[at++] !== "=") invalid();
    if (value[at] !== '"') { token(); continue; }
    at++;
    let closed = false;
    while (at < value.length) {
      const char = value[at++]!, code = char.charCodeAt(0);
      if (char === '"') { closed = true; break; }
      if (char === "\\") {
        const escaped = value.charCodeAt(at++);
        if (!(escaped === 9 || escaped >= 32 && escaped <= 126 || escaped >= 160 && escaped <= 255)) invalid();
      } else if (!(code === 9 || code === 32 || code === 33 || code >= 35 && code <= 91 || code >= 93 && code <= 126 || code >= 160 && code <= 255)) invalid();
    }
    if (!closed) invalid();
  }
  if (parameters && ["core-properties+xml", "digital-signature-certificate", "digital-signature-origin", "digital-signature-xmlsignature+xml", "relationships+xml"].some(type => essence === "application/vnd.openxmlformats-package." + type))
    throw new InvalidPackageError("OPC-specific media types cannot have parameters.");
  return essence;
}
