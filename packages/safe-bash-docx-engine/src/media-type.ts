import { InvalidPackageError } from "./package-xml.js";

/** Parse RFC 7231 media types without changing the retained OPC declaration. */
export function parseMediaType(value: string, mode: "essence" | "identity" = "essence"): string {
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
    return value.slice(start, at);
  };
  token(); if (value[at++] !== "/") invalid(); token();
  const essence = value.slice(0, at).toLowerCase();
  const parameters = at < value.length;
  const identity: [string, string][] = [];
  while (at < value.length) {
    while (value[at] === " " || value[at] === "\t") at++;
    if (value[at++] !== ";") invalid();
    while (value[at] === " " || value[at] === "\t") at++;
    const name = token().toLowerCase(); if (value[at++] !== "=") invalid();
    let parameter: string;
    if (value[at] !== '"') parameter = token();
    else {
      at++;
      parameter = "";
      let closed = false;
      while (at < value.length) {
        let char = value[at++]!;
        const code = char.charCodeAt(0);
        if (char === '"') { closed = true; break; }
        if (char === "\\") {
          const escaped = value.charCodeAt(at);
          if (!(escaped === 9 || escaped >= 32 && escaped <= 126 || escaped >= 160 && escaped <= 255)) invalid();
          char = value[at++]!;
        } else if (!(code === 9 || code === 32 || code === 33 || code >= 35 && code <= 91 || code >= 93 && code <= 126 || code >= 160 && code <= 255)) invalid();
        if (mode === "identity") parameter += char;
      }
      if (!closed) invalid();
    }
    // RFC 2045 §5.1 and RFC 7231 §3.1.1: unknown parameter values retain case.
    if (mode === "identity") identity.push([name, name === "charset" || essence === "message/external-body" && name === "access-type" ? parameter.toLowerCase() : parameter]);
  }
  if (parameters && ["core-properties+xml", "digital-signature-certificate", "digital-signature-origin", "digital-signature-xmlsignature+xml", "relationships+xml"].some(type => essence === "application/vnd.openxmlformats-package." + type))
    throw new InvalidPackageError("OPC-specific media types cannot have parameters.");
  return mode === "identity" ? JSON.stringify([essence, identity.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]) : essence;
}
