/** OOXML ST_Xstring uses seven ASCII characters to represent one UTF-16 unit. */
function escapedUnit(value: string, offset: number): number | undefined {
  if (value[offset] !== "_" || value[offset + 1] !== "x" || value[offset + 6] !== "_") return undefined;
  let unit = 0;
  for (let index = offset + 2; index < offset + 6; index++) {
    const code = value.charCodeAt(index);
    const digit = code >= 48 && code <= 57 ? code - 48
      : code >= 65 && code <= 70 ? code - 55 : code >= 97 && code <= 102 ? code - 87 : -1;
    if (digit < 0) return undefined;
    unit = unit * 16 + digit;
  }
  return unit;
}

export function decodeXlsxString(value: string): string {
  let result = "";
  for (let index = 0; index < value.length;) {
    const unit = escapedUnit(value, index);
    if (unit === undefined) result += value[index++]!;
    else { result += String.fromCharCode(unit); index += 7; }
  }
  return result;
}

/** Apply string escapes before ordinary XML escaping, only to string content. */
export function encodeXlsxString(value: string): string {
  let result = "";
  for (let index = 0; index < value.length;) {
    if (escapedUnit(value, index) !== undefined) {
      // Protect each original leading underscore, including one shared with
      // the end of a previous token. Decoding never rescans the produced text.
      result += "_x005F_";
      index++;
      continue;
    }
    const code = value.codePointAt(index)!;
    const character = String.fromCodePoint(code);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13
      || code === 0xfffe || code === 0xffff || code >= 0xd800 && code <= 0xdfff)
      result += "_x" + code.toString(16).toUpperCase().padStart(4, "0") + "_";
    else result += character;
    index += character.length;
  }
  return result;
}
