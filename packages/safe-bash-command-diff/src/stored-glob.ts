import { PagedStorage, type PagedStorageCache } from "@poe-code/safe-fs/storage";
import { ToolError, type Budget } from "safe-bash-diff-engine/shared";

/** Byte-oriented glob syntax, with a bounded read window over caller storage. */
export class GlobText {
  private start = -1;
  private bytes: Uint8Array = new Uint8Array();
  constructor(readonly storage: PagedStorage, readonly offset: number, readonly length: number, private readonly budget: Budget) {}
  async at(index: number): Promise<string> {
    if (index < 0 || index >= this.length) return "";
    this.budget.step(); const pause = this.budget.checkpoint(); if (pause) await pause;
    if (index < this.start || index >= this.start + this.bytes.length) {
      this.start = Math.floor(index / 16384) * 16384;
      this.bytes = await this.storage.read(this.offset + this.start, Math.min(16384, this.length - this.start));
    }
    return String.fromCharCode(this.bytes[index - this.start]!);
  }
  async find(text: string, start: number): Promise<number> {
    for (let index = start; index + text.length <= this.length; index++) {
      let same = true;
      for (let part = 0; part < text.length; part++) if (await this.at(index + part) !== text[part]) { same = false; break; }
      if (same) return index;
    }
    return -1;
  }
}

class RegexWriter {
  private readonly bytes = new Uint8Array(4096);
  private used = 0;
  length = 0;
  constructor(readonly storage: PagedStorage) {}
  async add(text: string): Promise<void> {
    for (let index = 0; index < text.length; index++) {
      this.bytes[this.used++] = text.charCodeAt(index); this.length++;
      if (this.used === this.bytes.length) await this.flush();
    }
  }
  async flush(): Promise<void> {
    if (this.used) { await this.storage.append(this.bytes.subarray(0, this.used)); this.used = 0; }
  }
}

/** Preserve the established byte-glob translation, including its awk escapes. */
async function translate(source: GlobText, ignoreCase: boolean, output: RegexWriter): Promise<void> {
  const opposite = (ch: string) => !ignoreCase ? "" : ch >= "A" && ch <= "Z" ? ch.toLowerCase() : ch >= "a" && ch <= "z" ? ch.toUpperCase() : "";
  await output.add("^");
  for (let index = 0; index < source.length; index++) {
    const ch = await source.at(index);
    if (ch === "\\" && index + 1 < source.length) {
      const literal = await source.at(++index);
      await output.add(opposite(literal) ? `[${literal}${opposite(literal)}]` : `\\${literal}`);
    } else if (ch === "[") {
      let end = index + 1;
      const negated = "!^".includes(await source.at(end)) && end < source.length;
      if (negated) end++;
      if (await source.at(end) === "]") end++;
      while (end < source.length && await source.at(end) !== "]") {
        if (await source.at(end) === "\\" && end + 1 < source.length) end += 2;
        else if (await source.at(end) === "[" && await source.at(end + 1) === ":") {
          const closing = await source.find(":]", end + 2);
          if (closing < 0) break;
          end = closing + 2;
        } else end++;
      }
      if (await source.at(end) !== "]") { await output.add("\\["); continue; }
      const literal = (value: string) => "\\]^-".includes(value) ? `\\${value}` : value;
      const render = async (emit: (text: string) => Promise<void>) => {
        for (let scan = index + 1 + Number(negated); scan < end; scan++) {
          if (await source.at(scan) === "[" && await source.at(scan + 1) === ":") {
            const closing = await source.find(":]", scan + 2) + 1;
            for (; scan <= closing; scan++) await emit(await source.at(scan));
            scan--; continue;
          }
          if (await source.at(scan) === "\\" && scan + 1 < end) scan++;
          let first = await source.at(scan);
          if (ignoreCase && first >= "A" && first <= "Z") first = first.toLowerCase();
          if (await source.at(scan + 1) === "-" && scan + 2 < end) {
            let last = await source.at(scan + 2);
            if (ignoreCase && last >= "A" && last <= "Z") last = last.toLowerCase();
            for (let code = first.charCodeAt(0); code <= last.charCodeAt(0); code++) {
              const value = String.fromCharCode(code); await emit(literal(value) + opposite(value));
            }
            scan += 2;
          } else await emit(literal(first) + opposite(first));
        }
      };
      let size = 0;
      await render(async text => { size += text.length; });
      if (size) { await output.add(negated ? "[^" : "["); await render(text => output.add(text)); await output.add("]"); }
      else await output.add(negated ? "[\u0000-\u00ff]" : "[^\u0000-\u00ff]");
      index = end;
    } else if (ch === "*") await output.add(".*");
    else if (ch === "?") await output.add(".");
    else await output.add(opposite(ch) ? `[${ch}${opposite(ch)}]` : ".^$+(){}|]".includes(ch) ? `\\${ch}` : ch);
  }
  await output.add("$"); await output.flush();
}

const word = (byte: number | undefined) => byte !== undefined && (byte >= 48 && byte <= 57 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122 || byte === 95);
const classes: Record<string, (byte: number) => boolean> = {
  alpha: byte => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122,
  alnum: byte => byte >= 48 && byte <= 57 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122,
  digit: byte => byte >= 48 && byte <= 57, lower: byte => byte >= 97 && byte <= 122, upper: byte => byte >= 65 && byte <= 90,
  xdigit: byte => byte >= 48 && byte <= 57 || byte >= 65 && byte <= 70 || byte >= 97 && byte <= 102,
  space: byte => " \t\n\r\v\f".includes(String.fromCharCode(byte)), blank: byte => byte === 32 || byte === 9,
  cntrl: byte => byte < 32 || byte === 127, graph: byte => byte >= 33 && byte <= 126, print: byte => byte >= 32 && byte <= 126,
  punct: byte => byte >= 33 && byte <= 47 || byte >= 58 && byte <= 64 || byte >= 91 && byte <= 96 || byte >= 123 && byte <= 126,
};
const shorthand = (reference: string, byte: number) => {
  const lower = reference.toLowerCase(), accepted = lower === "d" ? classes.digit!(byte) : lower === "s" ? classes.space!(byte) : word(byte);
  return reference === lower ? accepted : !accepted;
};

/** The generated expression is a sequence of byte sets, dot-stars and assertions. */
export async function compileGlob(source: GlobText, ignoreCase: boolean, tokens: PagedStorage, budget: Budget, cache: PagedStorageCache): Promise<number> {
  const translated = new PagedStorage(budget.context, 16, cache), writer = new RegexWriter(translated);
  try {
    await translate(source, ignoreCase, writer);
    const text = new GlobText(translated, 8, writer.length, budget);
    let position = 0, count = 0;
    const escaped = async (): Promise<number> => {
      const ch = await text.at(position++);
      if (!ch) throw new ToolError("trailing backslash in regular expression");
      const octal = "01234567".includes(ch);
      if (octal || ch === "x") {
        let digits = octal ? ch : "";
        const alphabet = octal ? "01234567" : "0123456789abcdefABCDEF";
        while (digits.length < (octal ? 3 : 2) && position < text.length && alphabet.includes(await text.at(position))) digits += await text.at(position++);
        return digits ? parseInt(digits, octal ? 8 : 16) & 255 : ch.charCodeAt(0);
      }
      return ({ n: 10, t: 9, r: 13, f: 12, v: 11, a: 7, b: 8 } as Record<string, number>)[ch] ?? ch.charCodeAt(0);
    };
    while (position < text.length) {
      const cell = new Uint8Array(40), set = (byte: number) => { cell[8 + (byte >>> 3)]! |= 1 << (byte & 7); };
      const ch = await text.at(position++);
      if (ch === "^") cell[0] = 2;
      else if (ch === "$") cell[0] = 3;
      else if (ch === ".") {
        for (let byte = 0; byte < 256; byte++) if (byte !== 10) set(byte);
        if (await text.at(position) === "*") { cell[0] = 1; position++; }
      } else if (ch === "[") {
        const negate = await text.at(position) === "^";
        if (negate) position++;
        let first = true;
        while (position < text.length && (await text.at(position) !== "]" || first)) {
          first = false;
          if (await text.at(position) === "[" && await text.at(position + 1) === ":") {
            position += 2; let name = "";
            while (position < text.length && !(await text.at(position) === ":" && await text.at(position + 1) === "]")) {
              const ch = await text.at(position++);
              // Public diagnostics retain only their first 1,000 code units.
              if (name.length < 1001) name += ch;
            }
            if (!classes[name]) throw new ToolError(`unsupported character class '${name}'`);
            for (let byte = 0; byte < 256; byte++) if (classes[name]!(byte)) set(byte);
            position += 2; continue;
          }
          if (await text.at(position) === "[" && [".", "="].includes(await text.at(position + 1))) throw new ToolError("collating and equivalence classes are not supported");
          if (await text.at(position) === "\\" && "dDsSwW".includes(await text.at(position + 1)) && position + 1 < text.length) {
            const reference = await text.at(position + 1); position += 2;
            for (let byte = 0; byte < 256; byte++) if (shorthand(reference, byte)) set(byte);
            if (await text.at(position) === "-" && await text.at(position + 1) !== "]") throw new ToolError("character class cannot be a range endpoint");
            continue;
          }
          const readChar = async () => await text.at(position++) === "\\" ? escaped() : (await text.at(position - 1)).charCodeAt(0);
          const start = await readChar();
          if (await text.at(position) === "-" && position + 1 < text.length && await text.at(position + 1) !== "]") {
            position++; const end = await readChar();
            if (start > end) throw new ToolError("reversed character range");
            for (let byte = start; byte <= end; byte++) set(byte);
          } else set(start);
        }
        if (await text.at(position++) !== "]") throw new ToolError("unterminated bracket expression");
        if (negate) for (let index = 8; index < 40; index++) cell[index]! ^= 255;
      } else if (ch === "\\") {
        const reference = await text.at(position);
        if (["B", "y", "Y", "<", ">"].includes(reference)) {
          cell[0] = reference === "y" ? 4 : reference === "B" || reference === "Y" ? 5 : reference === "<" ? 6 : 7; position++;
        } else if ("dDsSwW".includes(reference) && reference) {
          position++; for (let byte = 0; byte < 256; byte++) if (shorthand(reference, byte)) set(byte);
        } else set(await escaped());
      } else set(ch.charCodeAt(0));
      await tokens.append(cell); count++;
    }
    return count;
  } finally { await translated.close(); }
}

export async function matchesGlob(tokens: PagedStorage, start: number, count: number, name: Uint8Array, budget: Budget): Promise<boolean> {
  let token = 0, position = 0, star = -1, retry = 0;
  while (token < count) {
    budget.step(); const pause = budget.checkpoint(); if (pause) await pause;
    const cell = await tokens.read(start + token * 40, 40), kind = cell[0];
    if (kind === 1) { star = token++; retry = position; continue; }
    const before = word(name[position - 1]), after = word(name[position]);
    const accepted = kind === 2 ? position === 0 : kind === 3 ? position === name.length
      : kind === 4 ? before !== after : kind === 5 ? before === after : kind === 6 ? !before && after : kind === 7 ? before && !after
      : position < name.length && !!(cell[8 + (name[position]! >>> 3)]! & 1 << (name[position]! & 7));
    if (accepted) { if (kind === 0) position++; token++; }
    else if (star >= 0 && retry < name.length && name[retry] !== 10) { position = ++retry; token = star + 1; }
    else return false;
  }
  return true;
}
