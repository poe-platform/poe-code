import { CurlError } from "./types.js";

export function validatePartHeader(header: string): string {
  const colon = header.indexOf(":");
  if (colon <= 0) throw new CurlError(2, "Invalid multipart part header");
  for (const character of header.slice(0, colon)) {
    const code = character.charCodeAt(0);
    if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) || "!#$%&'*+-.^_`|~".includes(character)))
      throw new CurlError(2, "Invalid multipart part header");
  }
  for (const character of header) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9) || code === 127)
      throw new CurlError(2, "Invalid multipart part header");
  }
  return header;
}

export function filePartHeaders(bytes: Uint8Array): string[] {
  const headers: string[] = [];
  for (let line of Buffer.from(bytes).toString("utf8").split("\n")) {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line || line.startsWith("#")) continue;
    if ((line.startsWith(" ") || line.startsWith("\t")) && headers.length) {
      headers[headers.length - 1] += " " + line.trim();
      validatePartHeader(headers[headers.length - 1]!);
    } else headers.push(validatePartHeader(line));
  }
  return headers;
}
