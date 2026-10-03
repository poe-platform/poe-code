import {decodeRtfText} from "./rtf-text.js";
import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, type TextRange} from "./backed-text.js";
import {rtfError, type RtfToken} from "./rtf-syntax.js";
import {runControls, layoutControls} from "./rtf-profile.js";
import type {RetainedRtfSyntax} from "./retained-rtf-syntax.js";
import type {AdapterContext} from "./types.js";

type Word = Extract<RtfToken, {kind: "word"}>;
type FontState = {codepage: number; font?: number | undefined; defaultFont?: number | undefined};
const fontControls = new Set(["f", "fnil", "froman", "fswiss", "fmodern", "fscript", "fdecor", "ftech", "fbidi", "fcharset", "cpg", "fprq", "fttruetype"]);
const ignoredStyleControls = new Set(["snext", "sautoupd", "additive", "sqformat", "spriority", "sunhideused", "slink"]);

/** Definition indexes and font text live in the caller's store. Styles retain
 * syntax cursors, including their inherited control order, rather than arrays.
 * The semantic reader owns this store and the syntax tape for the same lifetime. */
export class RetainedRtfDefinitions {
  readonly text: BackedText;
  private readonly fonts: IntegerTable;
  private readonly colors: IntegerTable;
  private readonly styles: IntegerTable;
  private colorCount = 0;
  constructor(private readonly syntax: RetainedRtfSyntax, private readonly storage: PagedStorage, private readonly context: AdapterContext) {
    this.text = new BackedText(storage, units => context.cooperate(units));
    this.fonts = new IntegerTable(storage, 64); this.colors = new IntegerTable(storage, 64); this.styles = new IntegerTable(storage, 64);
  }
  private parameter(token: Word, min = 0, max = 2147483647): number {
    if (token.parameter === undefined || token.parameter < min || token.parameter > max) rtfError(this.context, `Invalid RTF ${token.name} parameter`, "E_PARSE", token.offset);
    return token.parameter;
  }
  private page(value: number, offset = 0): number {
    if (value !== 1252 && value !== 65001) rtfError(this.context, `Unsupported RTF code page ${value}; supported pages are 1252 and 65001`, "E_ENCODING", offset);
    return value;
  }
  private async fields(position: number, count: number): Promise<number[]> {
    const bytes = await this.storage.read(position, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({length: count}, (_, index) => view.getFloat64(index * 8, true));
  }
  private async record(values: readonly number[]): Promise<number> {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat64(index * 8, value, true));
    return this.storage.append(bytes);
  }
  async font(id: number): Promise<{name: TextRange; codepage: number | undefined} | undefined> {
    const position = Number(await this.fonts.get(BigInt(id)) ?? 0n);
    if (!position) return undefined;
    const [first, last, units, page] = await this.fields(position, 4);
    return {name: {first: first!, last: last!, units: units!}, codepage: Number.isNaN(page!) ? undefined : page!};
  }
  async color(id: number): Promise<string | undefined> {
    const value = await this.colors.get(BigInt(id));
    return value ? "#" + Number(value - 1n).toString(16).padStart(6, "0") : undefined;
  }
  private async *range(first: number, end = 0): AsyncGenerator<number> {
    for (let node = first; node && node !== end; node = await this.syntax.next(node)) {await this.context.cooperate(); yield node;}
  }
  async read(group: number, state: FontState): Promise<void> {
    const first = await this.syntax.first(group), token = first ? await this.syntax.token(first) : undefined;
    const header = token?.kind === "symbol" && token.name === "*" ? await this.syntax.next(first) : first;
    const destination = header ? await this.syntax.token(header) : undefined;
    if (destination?.kind !== "word") return;
    if (destination.name === "fonttbl") await this.fontTable(group, first, state);
    else if (destination.name === "colortbl") await this.colorTable(await this.syntax.next(first));
    else if (destination.name === "stylesheet") await this.styleTable(group);
  }
  private async fontTable(group: number, first: number, state: FontState): Promise<void> {
    let flat = false, grouped = false;
    for await (const node of this.syntax.children(group)) {
      const token = await this.syntax.token(node);
      if (token.kind === "group") grouped = true;
      if (token.kind === "word" && token.name === "f") flat = true;
    }
    if (flat && grouped) rtfError(this.context, "Mixed flat and grouped RTF font table", "E_CAPABILITY");
    if (flat) {
      let start = 0;
      for await (const node of this.range(await this.syntax.next(first))) {
        const token = await this.syntax.token(node);
        if (token.kind === "word" && token.name === "f") {
          if (start) await this.readFont(start, node, state);
          start = node;
        }
        if (!start) rtfError(this.context, "Malformed flat RTF font table");
      }
      if (start) await this.readFont(start, 0, state);
    } else for await (const node of this.syntax.children(group)) {
      if ((await this.syntax.token(node)).kind === "group") await this.readFont(await this.syntax.first(node), 0, state);
    }
  }
  private async readFont(first: number, end: number, state: FontState): Promise<void> {
    await this.context.cooperate(); this.context.charge("fonts", 1);
    let id: number | undefined, page: number | undefined;
    for await (const node of this.range(first, end)) {
      const token = await this.syntax.token(node);
      if (token.kind === "word") {
        if (!fontControls.has(token.name)) rtfError(this.context, `Unsupported RTF font control ${token.name}`, "E_CAPABILITY", token.offset);
        if (token.name === "f") id = this.parameter(token);
        if (token.name === "cpg") page = this.page(this.parameter(token), token.offset);
        if (token.name === "fcharset") {
          const charset = this.parameter(token);
          if (charset !== 0 && charset !== 1) rtfError(this.context, `Unsupported RTF font charset ${charset}; only default/ANSI charsets 0 and 1 are supported`, "E_ENCODING", token.offset);
        }
      } else if (token.kind === "group" || token.kind === "binary") rtfError(this.context, "Embedded fonts and nested font destinations are unsupported", "E_CAPABILITY", token.offset);
    }
    if (id === undefined || await this.fonts.get(BigInt(id)) !== undefined) rtfError(this.context, "Missing or duplicate RTF font id");
    const selected = state.font ?? state.defaultFont;
    const effective = selected === undefined ? page ?? state.codepage : (await this.font(selected))?.codepage ?? page ?? state.codepage;
    const name = await this.fontName(first, end, effective);
    await this.fonts.set(BigInt(id), BigInt(await this.record([name.first, name.last, name.units, page ?? NaN])));
  }
  /** Filter before decoding, just like the buffered literal reader: omitted font
   * controls do not split adjacent byte escapes; supported symbols do. */
  private async *fontText(first: number, end: number, page: number): AsyncGenerator<string> {
    const syntax = this.syntax;
    const nodes = this.range(first, end);
    const parts = (async function* () {
      for await (const node of nodes) {
        const token = await syntax.token(node);
        if (token.kind === "text") yield* syntax.chunks(node);
        else if (token.kind === "hex") yield Uint8Array.of(token.byte);
        else if (token.kind === "symbol" && ["\\", "{", "}", "~"].includes(token.name)) yield token.name === "~" ? "\u00a0" : token.name;
      }
    })();
    yield* decodeRtfText(parts, page, this.context);
  }
  private async fontName(first: number, end: number, page: number): Promise<TextRange> {
    const source = this.fontText(first, end, page);
    let terminated = false;
    const value = await this.text.from((async function* () {
      for await (const chunk of source) {
        if (terminated) continue; // Still validate every decoded byte after the terminator.
        const end = chunk.indexOf(";");
        const name = end < 0 ? chunk : chunk.slice(0, end);
        yield name.split("\t").join(" ");
        if (end >= 0) terminated = true;
      }
    })());
    if (!terminated) rtfError(this.context, "Unterminated RTF font name");
    let start = -1, stop = 0, offset = 0;
    for await (const chunk of this.text.chunks(value)) for (const char of chunk) {
      if (char.trim()) {if (start < 0) start = offset; stop = offset + char.length;}
      offset += char.length;
    }
    const chunks = this.text.chunks(value);
    return this.text.from((async function* () {
      let offset = 0;
      for await (const chunk of chunks) {
        const left = Math.max(0, start - offset), right = Math.min(chunk.length, stop - offset);
        if (right > left) yield chunk.slice(left, right);
        offset += chunk.length;
      }
    })());
  }
  private async colorTable(first: number): Promise<void> {
    const rgb = [0, 0, 0]; let defined = false;
    for await (const node of this.range(first)) {
      const token = await this.syntax.token(node);
      if (token.kind === "word") {
        const index = ["red", "green", "blue"].indexOf(token.name);
        if (index < 0) rtfError(this.context, "Unsupported RTF color definition", "E_CAPABILITY", token.offset);
        rgb[index] = this.parameter(token, 0, 255); defined = true;
      } else if (token.kind === "text") {
        for await (const chunk of this.syntax.chunks(node)) for (const byte of chunk) {
          this.context.checkpoint();
          if (byte === 59) {
            this.context.charge("references", 1);
            if (defined) await this.colors.set(BigInt(this.colorCount), BigInt(rgb[0]! * 65536 + rgb[1]! * 256 + rgb[2]! + 1));
            this.colorCount++; rgb.fill(0); defined = false;
          } else if (byte !== 32) rtfError(this.context, "Malformed RTF color table");
        }
      } else rtfError(this.context, "Unsupported RTF color table", "E_CAPABILITY");
    }
    if (defined) rtfError(this.context, "Unterminated RTF color definition");
  }
  private async styleTable(group: number): Promise<void> {
    for await (const node of this.syntax.children(group)) {
      if ((await this.syntax.token(node)).kind !== "group") continue;
      const first = await this.syntax.first(node), header = first ? await this.syntax.token(first) : undefined;
      if (header?.kind !== "word" || !["s", "cs"].includes(header.name)) rtfError(this.context, "Unsupported RTF style definition", "E_CAPABILITY");
      const id = this.parameter(header); let basedOn: number | undefined;
      for await (const child of this.range(await this.syntax.next(first))) {
        const token = await this.syntax.token(child);
        if (token.kind === "word") {
          if (token.name === "sbasedon") basedOn = this.parameter(token);
          else if (!ignoredStyleControls.has(token.name) && !runControls[token.name] && !layoutControls.has(token.name) && !["f", "fs", "cf", "ulnone", "nosupersub", "outlinelevel"].includes(token.name)) rtfError(this.context, `Unsupported RTF style control ${token.name}`, "E_CAPABILITY", token.offset);
        } else if (token.kind !== "text") rtfError(this.context, "Unsupported nested RTF style syntax", "E_CAPABILITY", token.offset);
      }
      this.context.charge("references", 1);
      if (await this.styles.get(BigInt(id)) !== undefined) rtfError(this.context, "Duplicate RTF style");
      await this.styles.set(BigInt(id), BigInt(await this.record([await this.syntax.next(first), basedOn ?? NaN])));
    }
  }
  async *controls(id: number): AsyncGenerator<Word> {
    const seen = new IntegerTable(this.storage, 64);
    let stack = 0, depth = 0;
    while (true) {
      await this.context.cooperate(); this.context.bound("depth", ++depth);
      if (await seen.get(BigInt(id)) !== undefined) rtfError(this.context, "Cyclic RTF stylesheet");
      const position = Number(await this.styles.get(BigInt(id)) ?? 0n);
      if (!position) {if (id === 0) break; rtfError(this.context, `Undefined RTF style ${id}`);}
      await seen.set(BigInt(id), 1n);
      const [first, basedOn] = await this.fields(position, 2);
      stack = await this.record([stack, first!]);
      if (Number.isNaN(basedOn!) || basedOn === id) break;
      id = basedOn!;
    }
    while (stack) {
      const [parent, first] = await this.fields(stack, 2); stack = parent!;
      for await (const node of this.range(first!)) {
        const token = await this.syntax.token(node);
        if (token.kind === "word" && token.name !== "sbasedon" && !ignoredStyleControls.has(token.name)) yield token;
      }
    }
  }
}
