import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import {rtfError, type RtfToken} from "./rtf-syntax.js";
import {runControls, layoutControls} from "./rtf-profile.js";
import type {RetainedRtfSyntax} from "./retained-rtf-syntax.js";
import type {AdapterContext} from "./types.js";
const styles = ["Decimal", "UpperRoman", "LowerRoman", "UpperAlpha", "LowerAlpha", "bullet"] as const;
const delimiters = ["Period", "OneParen", "TwoParens"] as const;
export type RtfListLevel = {start: number; style: typeof styles[number]; delimiter: typeof delimiters[number]};
type Word = Extract<RtfToken, {kind: "word"}>;

/** Definition count and legacy identities are backed. Each supported list has
 * at most nine levels; malformed extra levels are fully validated before the
 * existing count error, without growing a resident array. */
export class RetainedRtfLists {
  private readonly lists: IntegerTable;
  private readonly overrides: IntegerTable;
  private readonly legacyIds: IntegerTable;
  private legacyCount = 0;
  constructor(private readonly syntax: RetainedRtfSyntax, private readonly storage: PagedStorage, private readonly context: AdapterContext) {
    this.lists = new IntegerTable(storage, 64); this.overrides = new IntegerTable(storage, 64); this.legacyIds = new IntegerTable(storage, 64);
  }
  private parameter(token: Word, min = 0, max = 2147483647): number {
    if (token.parameter === undefined || token.parameter < min || token.parameter > max) rtfError(this.context, `Invalid RTF ${token.name} parameter`, "E_PARSE", token.offset);
    return token.parameter;
  }
  private key(id: number): bigint {return BigInt(id >= 0 ? id * 2 : -id * 2 - 1);}
  private async fields(position: number, count: number): Promise<number[]> {
    const bytes = await this.storage.read(position, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({length: count}, (_, index) => view.getFloat64(index * 8, true));
  }
  private async record(values: readonly number[]): Promise<number> {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat64(index * 8, value, true));
    return this.storage.append(bytes);
  }
  private encoded(level: Partial<RtfListLevel>): number[] {
    return [level.start ?? NaN, level.style === undefined ? NaN : styles.indexOf(level.style), level.delimiter === undefined ? NaN : delimiters.indexOf(level.delimiter)];
  }
  private async destination(group: number): Promise<string> {
    let first = await this.syntax.first(group);
    if (!first) return "";
    let token = await this.syntax.token(first);
    if (token.kind === "symbol" && token.name === "*") {first = await this.syntax.next(first); if (!first) return ""; token = await this.syntax.token(first);}
    return token.kind === "word" ? token.name : "";
  }
  async read(group: number): Promise<void> {
    const name = await this.destination(group);
    if (name === "listtable") await this.listTable(group);
    else if (name === "listoverridetable") await this.overrideTable(group);
  }
  async resolve(id: number, level: number): Promise<RtfListLevel | undefined> {
    const override = Number(await this.overrides.get(this.key(id)) ?? 0n);
    if (!override) return undefined;
    const [target, overrideCount] = await this.fields(override, 2);
    const list = Number(await this.lists.get(this.key(target!)) ?? 0n);
    if (!list) return undefined;
    const count = (await this.fields(list, 1))[0]!;
    if (level < 0 || level >= count) return undefined;
    const values = await this.fields(list + 8 + level * 24, 3);
    if (level < overrideCount!) {
      const replace = await this.fields(override + 16 + level * 24, 3);
      for (let index = 0; index < 3; index++) if (!Number.isNaN(replace[index]!)) values[index] = replace[index]!;
    }
    return {start: values[0]!, style: styles[values[1]!]!, delimiter: delimiters[values[2]!]!};
  }
  async legacy(level: RtfListLevel): Promise<number> {
    const key = BigInt((level.start * styles.length + styles.indexOf(level.style)) * delimiters.length + delimiters.indexOf(level.delimiter));
    const existing = await this.legacyIds.get(key);
    if (existing !== undefined) return -Number(existing);
    const id = -(++this.legacyCount);
    await this.legacyIds.set(key, BigInt(-id));
    await this.lists.set(this.key(id), BigInt(await this.record([1, ...this.encoded(level)])));
    await this.overrides.set(this.key(id), BigInt(await this.record([id, 0])));
    return id;
  }
  private async listTable(group: number): Promise<void> {
    for await (const list of this.syntax.children(group)) {
      if ((await this.syntax.token(list)).kind !== "group") continue;
      if (await this.destination(list) !== "list") rtfError(this.context, "Unsupported RTF list table", "E_CAPABILITY");
      let id: Word | undefined;
      for await (const node of this.syntax.children(list)) {
        const token = await this.syntax.token(node);
        if (token.kind === "word" && token.name === "listid") {id = token; break;}
      }
      if (!id) rtfError(this.context, "Missing RTF list id");
      const levels: number[] = []; let count = 0;
      for await (const node of this.syntax.children(list)) {
        const token = await this.syntax.token(node);
        const name = token.kind === "group" ? await this.destination(node) : "";
        if (name === "listlevel") {
          const level = await this.level(node);
          if (++count <= 9) levels.push(...this.encoded(level));
        } else if (name === "listname") continue;
        else if (token.kind !== "word" || !["list", "listid", "listtemplateid", "listsimple", "listhybrid", "listrestarthdn"].includes(token.name)) rtfError(this.context, "Unsupported RTF list definition", "E_CAPABILITY", token.offset);
      }
      if (!count || count > 9) rtfError(this.context, "Invalid RTF list levels");
      const number = this.parameter(id), key = this.key(number);
      if (await this.lists.get(key) !== undefined) rtfError(this.context, "Duplicate RTF list id");
      await this.lists.set(key, BigInt(await this.record([count, ...levels])));
    }
  }
  private async overrideTable(group: number): Promise<void> {
    for await (const override of this.syntax.children(group)) {
      if ((await this.syntax.token(override)).kind !== "group") continue;
      let id: number | undefined, index: number | undefined, count = 0, found = 0;
      const levels: number[] = [];
      for await (const node of this.syntax.children(override)) {
        const token = await this.syntax.token(node);
        if (token.kind === "word" && token.name === "listoverride") continue;
        if (token.kind === "word" && token.name === "listid") id = this.parameter(token);
        else if (token.kind === "word" && token.name === "ls") index = this.parameter(token);
        else if (token.kind === "word" && token.name === "listoverridecount") count = this.parameter(token, 0, 9);
        else if (token.kind === "group") {
          if (await this.destination(node) !== "lfolevel") rtfError(this.context, "Unsupported RTF list override group", "E_CAPABILITY", token.offset);
          const level: Partial<RtfListLevel> = {};
          for await (const child of this.syntax.children(node)) {
            const control = await this.syntax.token(child);
            if (control.kind === "word" && control.name === "levelstartat") level.start = this.parameter(control, 1);
            else if (control.kind === "group" && await this.destination(child) === "listlevel") Object.assign(level, await this.level(child));
            else if (control.kind !== "word" || !["lfolevel", "listoverrideformat", "listoverridestartat"].includes(control.name)) rtfError(this.context, "Unsupported RTF list override", "E_CAPABILITY", control.offset);
          }
          if (++found <= 9) levels.push(...this.encoded(level));
        } else rtfError(this.context, "Unsupported RTF list override syntax", "E_CAPABILITY", token.offset);
      }
      if (id === undefined || index === undefined || await this.overrides.get(this.key(index)) !== undefined || count !== found) rtfError(this.context, "Invalid RTF list override");
      await this.overrides.set(this.key(index), BigInt(await this.record([id, count, ...levels])));
    }
  }
  private async level(group: number): Promise<RtfListLevel> {
    let start = 1, style: RtfListLevel["style"] = "Decimal", label = 0;
    for await (const node of this.syntax.children(group)) {
      const token = await this.syntax.token(node);
      if (token.kind === "word") {
        if (!runControls[token.name] && !layoutControls.has(token.name) && !["listlevel", "levelnfc", "levelnfcn", "leveljc", "leveljcn", "levelstartat", "levelfollow", "levelspace", "levelindent", "levellegal", "levelold", "levelprev", "levelprevspace", "leveltemplateid", "levelnorestart", "f", "fs", "cf"].includes(token.name)) rtfError(this.context, `Unsupported RTF list level control ${token.name}`, "E_CAPABILITY", token.offset);
        if (token.name === "levelstartat") start = this.parameter(token, 1);
        if (token.name === "levelnfc" || token.name === "levelnfcn") {
          const nfc = this.parameter(token);
          if (nfc > 4 && nfc !== 23) rtfError(this.context, `Unsupported RTF list numbering ${nfc}`, "E_CAPABILITY", token.offset);
          style = styles[nfc === 23 ? 5 : nfc]!;
        }
      } else if (token.kind === "group") {
        const name = await this.destination(node);
        if (!["leveltext", "levelnumbers"].includes(name)) rtfError(this.context, "Unsupported RTF list level destination", "E_CAPABILITY", token.offset);
        if (name === "leveltext" && !label) label = node;
        let first = true;
        for await (const child of this.syntax.children(node)) {
          if (first) {first = false; continue;}
          const value = await this.syntax.token(child);
          if (value.kind === "hex" || value.kind === "text") continue;
          if (name === "leveltext" && value.kind === "word" && ["u", "uc"].includes(value.name)) continue;
          rtfError(this.context, "Unsupported RTF list label syntax", "E_CAPABILITY", value.offset);
        }
      } else rtfError(this.context, "Unsupported RTF list level syntax", "E_CAPABILITY", token.offset);
    }
    let delimiter: RtfListLevel["delimiter"] = "Period";
    if (label && style !== "bullet") {
      // A label's byte length is itself one byte. Preserve validation order on
      // arbitrarily long malformed input while retaining only that fixed bound.
      const values = new Uint8Array(257); let count = 0, first = true;
      for await (const node of this.syntax.children(label)) {
        if (first) {first = false; continue;}
        const token = await this.syntax.token(node);
        if (token.kind !== "hex" && token.kind !== "text") rtfError(this.context, "Unsupported RTF list label", "E_CAPABILITY", token.offset);
        const chunks = token.kind === "hex" ? [Uint8Array.of(token.byte)] : this.syntax.chunks(node);
        for await (const chunk of chunks) {
          if (count < values.length) values.set(chunk.subarray(0, values.length - count), count);
          count += chunk.length;
        }
      }
      const length = values[0]!;
      if (!count || count !== length + 2 || values[length + 1] !== 59) rtfError(this.context, "Malformed RTF list label");
      let pattern = "";
      for (let index = 1; index <= length; index++) pattern += values[index]! <= 8 ? "#" : String.fromCharCode(values[index]!);
      if (pattern === "#.") delimiter = "Period";
      else if (pattern === "#)") delimiter = "OneParen";
      else if (pattern === "(#)") delimiter = "TwoParens";
      else rtfError(this.context, `Unsupported RTF list label ${pattern}`, "E_CAPABILITY");
    }
    return {start, style, delimiter};
  }
}
