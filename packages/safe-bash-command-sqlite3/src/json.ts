// Convert SQLite's JSON5 text to JSON without losing duplicate keys or number spelling.
export function canonicalizeJson(text: string): string {
  let offset = 0;
  const fail = (): never => { throw new SyntaxError("stepping, malformed JSON"); };
  const space = (): void => {
    while (offset < text.length) {
      if (/\s/u.test(text[offset]!)) { offset++; continue; }
      if (text.startsWith("//", offset)) {
        offset += 2;
        while (offset < text.length && !"\r\n".includes(text[offset]!)) offset++;
      } else if (text.startsWith("/*", offset)) {
        const end = text.indexOf("*/", offset + 2);
        if (end < 0) fail();
        offset = end + 2;
      } else break;
    }
  };
  const string = (): string => {
    const quote = text[offset++];
    let value = '"';
    while (offset < text.length) {
      const char = text[offset++]!;
      if (char === quote) return value + '"';
      if (char.charCodeAt(0) < 32) fail();
      if (char !== "\\") { value += char === '"' ? '\\"' : char; continue; }
      const escape = text[offset++];
      if (escape === "\n" || escape === "\r") {
        if (escape === "\r" && text[offset] === "\n") offset++;
        continue;
      }
      if (escape === "u" || escape === "x") {
        const length = escape === "u" ? 4 : 2;
        const hex = text.slice(offset, offset + length);
        if (hex.length !== length || !/^[0-9a-f]+$/i.test(hex)) fail();
        value += escape === "u" ? `\\u${hex}` : `\\u00${hex}`;
        offset += length;
      } else if (escape === "'") value += "'";
      else if (escape === "v") value += "\\u0009";
      else if (escape === "0" && !/[0-9]/.test(text[offset] ?? "")) value += "\\u0000";
      else if (escape !== undefined && '\\"/bfnrt'.includes(escape)) value += "\\" + escape;
      else fail();
    }
    return fail();
  };
  const value = (depth: number): string => {
    space();
    const char = text[offset];
    if (char === '"' || char === "'") return string();
    if (char === "{" || char === "[") {
      if (depth >= 1000) fail();
      offset++;
      const close = char === "{" ? "}" : "]";
      const entries: string[] = [];
      space();
      while (text[offset] !== close) {
        let key = "";
        if (char === "{") {
          if (text[offset] === '"' || text[offset] === "'") key = string();
          else {
            const start = offset;
            while (offset < text.length) {
              if (text.startsWith("\\u", offset) && /^[0-9a-f]{4}$/i.test(text.slice(offset + 2, offset + 6))) offset += 6;
              else if (/[$\w\u0080-\uffff]/u.test(text[offset]!) && !/\s/u.test(text[offset]!)) offset++;
              else break;
            }
            const name = text.slice(start, offset);
            if (!name || /^[0-9]/.test(name)) fail();
            key = '"' + name + '"';
          }
          space();
          if (text[offset++] !== ":") fail();
          key += ":";
        }
        entries.push(key + value(depth + 1));
        space();
        if (text[offset] === close) break;
        if (text[offset++] !== ",") fail();
        space();
      }
      offset++;
      return char + entries.join(",") + close;
    }
    const rest = text.slice(offset);
    const literal = /^(true|false|null)/.exec(rest);
    if (literal) { offset += literal[0].length; return literal[0]; }
    const special = /^[+-]?(?:infinity|inf|qnan|snan|nan)/i.exec(rest);
    if (special) {
      offset += special[0].length;
      return special[0].toLowerCase().includes("nan") ? "null" : special[0][0] === "-" ? "-9e999" : "9e999";
    }
    const number = /^[+-]?(?:0[xX][0-9a-fA-F]+|(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?)/.exec(rest);
    if (!number) return fail();
    offset += number[0].length;
    let result = number[0];
    if (/^[+-]?0[xX]/.test(result)) {
      const negative = result[0] === "-";
      result = (BigInt(result.replace(/^[+-]/, "")) * (negative ? -1n : 1n)).toString();
    } else {
      result = result.replace(/^\+/, "").replace(/^(-?)\./, "$10.").replace(/\.(?=[eE]|$)/, ".0");
    }
    return result;
  };
  const result = value(0);
  space();
  if (offset !== text.length) fail();
  return result;
}

export function parseSqlJson(text: string): any {
  return JSON.parse(canonicalizeJson(text));
}
