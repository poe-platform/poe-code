import { isJsonValue } from "toolcraft-schema";

function isLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}
function isAlphanumeric(code: number): boolean {
  return isLetter(code) || (code >= 0x30 && code <= 0x39);
}

export function isValidMetadataKey(key: string): boolean {
  const slash = key.indexOf("/");
  let name = key;
  if (slash !== -1) {
    if (key.indexOf("/", slash + 1) !== -1) return false;
    for (const label of key.slice(0, slash).split(".")) {
      if (label.length === 0 || !isLetter(label.charCodeAt(0)) || !isAlphanumeric(label.charCodeAt(label.length - 1))) return false;
      for (let index = 1; index < label.length - 1; index++) {
        if (!isAlphanumeric(label.charCodeAt(index)) && label[index] !== "-") return false;
      }
    }
    name = key.slice(slash + 1);
  }
  if (name.length === 0) return true;
  if (!isAlphanumeric(name.charCodeAt(0)) || !isAlphanumeric(name.charCodeAt(name.length - 1))) return false;
  for (let index = 1; index < name.length - 1; index++) {
    if (!isAlphanumeric(name.charCodeAt(index)) && name[index] !== "-" && name[index] !== "_" && name[index] !== ".") return false;
  }
  return true;
}

export function isValidMetadata(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && isJsonValue(value) && Object.keys(value).every(isValidMetadataKey);
}
