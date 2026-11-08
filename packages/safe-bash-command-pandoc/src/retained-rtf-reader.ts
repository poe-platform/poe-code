import type {RetainedAstUsage} from "./retained-ast-budgets.js";
import {PandocError} from "./errors.js";
import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedRtfAst, type RtfValue} from "./retained-rtf-ast.js";
import {RetainedRtfDefinitions} from "./retained-rtf-definitions.js";
import {RetainedRtfLists, type RtfListLevel} from "./retained-rtf-lists.js";
import {RetainedRtfFlow} from "./retained-rtf-flow.js";
import {retainedRtfHyperlink} from "./retained-rtf-field.js";
import {emptyText, type TextRange} from "./backed-text.js";
import {decodeRtfText} from "./rtf-text.js";
import {characters, metadataDestinations, forbiddenDestinations, unsupportedDestinations, runControls, layoutControls, initialRtfState, type RtfState, type RunTag} from "./rtf-profile.js";
import {hexDigit, rtfError, type RtfToken} from "./rtf-syntax.js";
import type {RetainedRtfSyntax} from "./retained-rtf-syntax.js";
import type {AdapterContext} from "./types.js";
type Word = Extract<RtfToken, {kind: "word"}>;
type Snapshot = Omit<RtfState, "tags"> & {tags: RunTag[]};
type Legacy = {cursor: number; start: number; style: RtfListLevel["style"]; before: TextRange; after: TextRange};
type Frame = {
  parent: number; kind: "group" | "shape" | "instruction" | "field" | "note" | "legacy" | "label";
  cursor: number; state: Snapshot;
  inlines?: number; literal?: boolean; inlineOnly?: boolean; result?: number;
  target?: TextRange; legacy?: Legacy; after?: boolean;
};

/** Invocation-owned semantic execution. Only one formatting state and the
 * current root/note flow are resident; group and field continuations are backed.
 * The caller owns storage and syntax until both document and resource consumers
 * finish. The output adapter preserves that ownership across filters. */
class RetainedRtfReader {
  readonly ast: RetainedRtfAst;
  blocks!: RtfValue;
  private definitions: RetainedRtfDefinitions;
  private lists: RetainedRtfLists;
  private flow!: RetainedRtfFlow;
  private frames = 0;
  private fallback = 0;
  private inNote = false;
  private pictureCount = 0;
  private readonly pictures: IntegerTable;
  constructor(private readonly syntax: RetainedRtfSyntax, private readonly storage: PagedStorage, private readonly context: AdapterContext) {
    this.ast = new RetainedRtfAst(storage, units => context.cooperate(units));
    this.definitions = new RetainedRtfDefinitions(syntax, storage, context); this.lists = new RetainedRtfLists(syntax, storage, context);
    this.pictures = new IntegerTable(storage, 64);
  }
  private parameter(token: Word, min = 0, max = 2147483647): number {
    if (token.parameter === undefined || token.parameter < min || token.parameter > max) rtfError(this.context, `Invalid RTF ${token.name} parameter`, "E_PARSE", token.offset);
    return token.parameter;
  }
  private page(value: number, offset = 0): number {
    if (value !== 1252 && value !== 65001) rtfError(this.context, `Unsupported RTF code page ${value}; supported pages are 1252 and 65001`, "E_ENCODING", offset);
    return value;
  }
  private async save(frame: Frame): Promise<number> {
    // Frame JSON contains only fixed-schema numeric handles/flags and the seven
    // formatting tags. Document text, definitions and child lists are never here.
    const json = new TextEncoder().encode(JSON.stringify(frame));
    if (json.length > 4096) throw new Error("Invalid RTF continuation size");
    const bytes = new Uint8Array(4 + json.length); new DataView(bytes.buffer).setUint32(0, json.length, true); bytes.set(json, 4);
    return this.storage.append(bytes);
  }
  private async pop(): Promise<Frame> {
    const prefix = await this.storage.read(this.frames, 4), length = new DataView(prefix.buffer, prefix.byteOffset, 4).getUint32(0, true);
    const frame = JSON.parse(new TextDecoder().decode(await this.storage.read(this.frames + 4, length))) as Frame;
    this.frames = frame.parent; return frame;
  }
  private state(snapshot: Snapshot): RtfState {return {...snapshot, tags: new Set(snapshot.tags)};}
  private async destination(group: number): Promise<{name: string; ignorable: boolean; first: number}> {
    let first = await this.syntax.first(group), token = first ? await this.syntax.token(first) : undefined;
    const ignorable = token?.kind === "symbol" && token.name === "*";
    if (ignorable) {first = await this.syntax.next(first); token = first ? await this.syntax.token(first) : undefined;}
    return {name: token?.kind === "word" ? token.name : "", ignorable, first};
  }
  async read(): Promise<void> {
    const rootDefinitions = this.definitions, rootLists = this.lists;
    const rootFlow = this.flow = await RetainedRtfFlow.create(this.ast, this.definitions, this.lists, this.context);
    let cursor = await this.syntax.first(this.syntax.root), state = initialRtfState(), legacy: Legacy | undefined;
    const push = async (kind: Frame["kind"], extra: Partial<Frame> = {}) => {
      this.frames = await this.save({parent: this.frames, kind, cursor, state: {...state, tags: [...state.tags]}, ...extra});
    };
    const small = async (range: TextRange): Promise<string | undefined> => {
      if (range.units > 1) return undefined;
      let value = ""; for await (const part of this.ast.text.chunks(range)) value += part; return value;
    };
    while (cursor || this.frames || legacy) {
      await this.context.cooperate();
      if (legacy) {
        if (!legacy.cursor) {
          let delimiter: RtfListLevel["delimiter"] = "Period";
          if (legacy.style !== "bullet") {
            const before = await small(legacy.before), after = await small(legacy.after);
            if (before === "(" && after === ")") delimiter = "TwoParens";
            else if (before === "" && after === ")") delimiter = "OneParen";
            else if (before !== "" || after !== "" && after !== ".") rtfError(this.context, "Unsupported RTF legacy list label", "E_CAPABILITY");
          }
          const id = await this.lists.legacy({start: legacy.start, style: legacy.style, delimiter});
          const frame = await this.pop(); cursor = frame.cursor; state = this.state(frame.state); state.list = id; state.level = 0; legacy = undefined; this.fallback = 0; continue;
        }
        const node = legacy.cursor, token = await this.syntax.token(node); legacy.cursor = await this.syntax.next(node);
        if (token.kind === "symbol" && token.name === "*") continue;
        if (token.kind === "word") {
          const styles: Readonly<Record<string, RtfListLevel["style"]>> = {pndec: "Decimal", pnucrm: "UpperRoman", pnlcrm: "LowerRoman", pnucltr: "UpperAlpha", pnlcltr: "LowerAlpha", pnlvlblt: "bullet"};
          if (styles[token.name]) legacy.style = styles[token.name]!;
          else if (token.name === "pnstart") legacy.start = this.parameter(token, 1);
          else if (!["pn", "pnlvlbody", "pnf", "pnfs", "pnindent", "pnsp", "pnhang", "pncont", "pnb", "pni"].includes(token.name)) rtfError(this.context, `Unsupported RTF legacy list control ${token.name}`, "E_CAPABILITY", token.offset);
        } else if (token.kind === "group") {
          const name = (await this.destination(node)).name;
          if (name !== "pntxta" && name !== "pntxtb") rtfError(this.context, "Unsupported RTF legacy list label", "E_CAPABILITY", token.offset);
          await push("label", {legacy, after: name === "pntxta", inlines: this.flow.inlines.position, literal: this.flow.literal, inlineOnly: this.flow.inlineOnly});
          legacy = undefined; this.flow.inlines = await this.ast.array(); this.flow.literal = true; this.flow.inlineOnly = true;
          state = {...state, tags: new Set(state.tags)}; cursor = await this.syntax.next(await this.syntax.first(node));
        } else rtfError(this.context, "Unsupported RTF legacy list definition", "E_CAPABILITY", token.offset);
        continue;
      }
      if (!cursor) {
        const frame = await this.pop(); this.fallback = 0;
        if (frame.kind === "instruction") {
          const target = await retainedRtfHyperlink(this.ast.text, await this.flow.literalText(state), this.context);
          this.flow.inlines = await this.ast.array(); this.flow.literal = frame.literal!; this.flow.inlineOnly = true;
          this.frames = await this.save({...frame, parent: this.frames, kind: "field", target});
          state = this.state(frame.state); cursor = frame.result!; continue;
        }
        if (frame.kind === "field") {
          this.flow.noSurrogate(); await this.flow.flush(state); const content = this.flow.inlines;
          this.flow.inlines = {position: frame.inlines!}; this.flow.literal = frame.literal!; this.flow.inlineOnly = frame.inlineOnly!;
          await this.flow.append(await this.ast.tag("Link", await this.ast.value([["", [], []], content, [await this.ast.string(frame.target!), ""]])));
        } else if (frame.kind === "label") {
          const text = await this.flow.literalText(state);
          this.flow.inlines = {position: frame.inlines!}; this.flow.literal = frame.literal!; this.flow.inlineOnly = frame.inlineOnly!;
          legacy = frame.legacy!; if (frame.after) legacy.after = text; else legacy.before = text;
        } else if (frame.kind === "note") {
          await this.flow.finish(state, true); const blocks = this.flow.blocks;
          this.flow = rootFlow; this.definitions = rootDefinitions; this.lists = rootLists; this.inNote = false;
          await this.flow.append(await this.ast.tag("Note", blocks));
        } else if (frame.kind === "group") await this.flow.flush(state);
        state = this.state(frame.state); cursor = frame.cursor; continue;
      }
      const node = cursor, token = await this.syntax.token(node);
      if (token.kind === "text" || token.kind === "hex") {
        const selected = state.font ?? state.defaultFont;
        const page = selected === undefined ? state.codepage : (await this.definitions.font(selected))?.codepage ?? state.codepage;
        const parts = (async function* (this: RetainedRtfReader) {
          let first = true;
          while (cursor) {
            const token = await this.syntax.token(cursor);
            if (token.kind !== "text" && token.kind !== "hex") break;
            const chunks = token.kind === "hex" ? [Uint8Array.of(token.byte)] : this.syntax.chunks(cursor);
            for await (const chunk of chunks) {
              const skipped = Math.min(this.fallback, chunk.length); this.fallback -= skipped;
              if (chunk.length > skipped) {if (first) {this.flow.noSurrogate(); first = false;} yield chunk.subarray(skipped);}
            }
            cursor = await this.syntax.next(cursor);
          }
        }).call(this);
        for await (const part of decodeRtfText(parts, page, this.context)) await this.flow.emit(part);
        continue;
      }
      cursor = await this.syntax.next(node);
      if (token.kind === "group") {
        this.fallback = 0; await this.flow.flush(state);
        const dest = await this.destination(node);
        if (forbiddenDestinations.has(dest.name)) rtfError(this.context, `Embedded RTF ${dest.name} is unsupported and never executed`, "E_CAPABILITY", token.offset);
        if (unsupportedDestinations.has(dest.name)) rtfError(this.context, `Unsupported text-bearing RTF destination ${dest.name}`, "E_CAPABILITY", token.offset);
        if (metadataDestinations.has(dest.name)) {await this.definitions.read(node, state); await this.lists.read(node);}
        else if (dest.name === "pict") {this.flow.noSurrogate(); await this.picture(node);}
        else if (dest.name === "field") {
          this.flow.noSurrogate(); let instruction = 0, result = 0, instructions = 0, results = 0, first = true;
          for await (const child of this.syntax.children(node)) {
            if (first) {first = false; continue;}
            const value = await this.syntax.token(child), name = value.kind === "group" ? (await this.destination(child)).name : "";
            if (name === "fldinst") {instruction = child; instructions++;}
            else if (name === "fldrslt") {result = child; results++;}
            else if (value.kind !== "word" || !["flddirty", "fldlock", "fldedit", "fldpriv"].includes(value.name)) rtfError(this.context, "Unsupported extra RTF field content", "E_CAPABILITY", value.offset);
          }
          if (instructions !== 1 || results !== 1) rtfError(this.context, "Malformed RTF field");
          await push("instruction", {result: (await this.destination(result)).first, inlines: this.flow.inlines.position, literal: this.flow.literal, inlineOnly: this.flow.inlineOnly});
          this.flow.inlines = await this.ast.array(); this.flow.literal = true; this.flow.inlineOnly = true;
          state = {...state, tags: new Set(state.tags)}; cursor = (await this.destination(instruction)).first;
        } else if (dest.name === "footnote") {
          this.flow.noSurrogate();
          if (this.flow.literal || this.inNote) rtfError(this.context, "Nested footnote or note in RTF literal", "E_CAPABILITY", token.offset);
          await push("note"); this.definitions = await this.definitions.fork(); this.lists = await this.lists.fork();
          this.flow = await RetainedRtfFlow.create(this.ast, this.definitions, this.lists, this.context); this.inNote = true;
          state = {...state, tags: new Set(state.tags)}; cursor = await this.syntax.next(dest.first);
        } else if (dest.name === "pn") {
          await push("legacy"); legacy = {cursor: await this.syntax.first(node), start: 1, style: "Decimal", before: emptyText(), after: emptyText()};
        } else if (dest.name === "shppict") {
          await push("shape"); state = {...state, tags: new Set(state.tags)}; cursor = await this.syntax.next(dest.first);
        } else if (dest.name === "listtext" || dest.name === "pntext") {
          let pending = false;
          for (let next = cursor; next; next = await this.syntax.next(next)) if ((await this.syntax.token(next)).kind === "group" && (await this.destination(next)).name === "pn") {pending = true; break;}
          if (state.list === undefined && !pending) rtfError(this.context, "RTF list label without a supported list definition", "E_CAPABILITY", token.offset);
        } else if (!dest.ignorable) {
          await push("group"); state = {...state, tags: new Set(state.tags)}; cursor = await this.syntax.first(node);
        } else rtfError(this.context, `Unsupported ignorable RTF destination ${dest.name || "(missing control word)"}`, "E_CAPABILITY", token.offset);
        this.fallback = 0;
      } else if (this.fallback > 0) this.fallback--;
      else if (token.kind === "symbol") {
        const symbols: Readonly<Record<string, string>> = {"\\": "\\", "{": "{", "}": "}", "~": "\u00a0", "_": "\u2011", "-": "\u00ad", "\n": "\n", "\r": "\n"};
        if (!Object.hasOwn(symbols, token.name)) rtfError(this.context, `Unsupported RTF control symbol ${token.name}`, "E_CAPABILITY", token.offset);
        this.flow.noSurrogate(); this.context.charge("text", 1); await this.flow.emit(symbols[token.name]!);
      } else if (token.kind === "word") {
        if (token.name !== "u") await this.flow.flush(state);
        if (token.name === "chftn" && cursor && (await this.syntax.token(cursor)).kind === "group" && (await this.destination(cursor)).name === "footnote") continue;
        await this.control(token, state);
      } else rtfError(this.context, "Binary data outside an RTF picture/destination", "E_CAPABILITY", token.offset);
    }
    await this.flow.finish(state); this.blocks = rootFlow.blocks;
  }
  private async control(token: Word, state: RtfState): Promise<void> {
    const {name, parameter: n} = token;
    if (name === "rtf") return;
    if (this.flow.literal && ["fldinst", "fldrslt"].includes(name)) return;
    if (name === "fldrslt" && this.flow.inlineOnly) return;
    if (name === "ansi") state.codepage = 1252;
    else if (name === "mac" || name === "pc" || name === "pca") rtfError(this.context, `RTF ${name} encoding is outside the pinned 1252/65001 profile`, "E_ENCODING", token.offset);
    else if (name === "ansicpg") state.codepage = this.page(this.parameter(token), token.offset);
    else if (name === "deff") state.defaultFont = this.parameter(token);
    else if (name === "uc") state.uc = this.parameter(token, 0, 32767);
    else if (name === "u") {const code = this.parameter(token, -32768, 32767); await this.flow.unicode(code < 0 ? code + 65536 : code); this.fallback = state.uc;}
    else if (characters[name]) {this.flow.noSurrogate(); this.context.charge("text", 1); await this.flow.emit(characters[name]);}
    else if (name === "par") await this.flow.paragraph(state, true);
    else if (name === "line") {this.flow.noSurrogate(); await this.flow.flush(state); await this.flow.append(await this.ast.tag("LineBreak"));}
    else if (name === "tab") {this.flow.noSurrogate(); await this.flow.emit("\t");}
    else if (name === "plain") {state.tags.clear(); state.font = undefined; state.color = 0; state.size = undefined;}
    else if (name === "pard") {state.list = undefined; state.level = 0; state.alignment = undefined; state.left = undefined; state.right = undefined; state.indent = undefined; state.heading = undefined;}
    else if (["ql", "qc", "qr", "qj"].includes(name)) state.alignment = ({ql: "left", qc: "center", qr: "right", qj: "justify"} as Record<string, string>)[name];
    else if (name === "li") state.left = this.parameter(token, -2147483648);
    else if (name === "ri") state.right = this.parameter(token, -2147483648);
    else if (name === "fi") state.indent = this.parameter(token, -2147483648);
    else if (name === "outlinelevel") {const level = this.parameter(token, 0, 9); state.heading = level === 9 ? undefined : level + 1;}
    else if (name === "chftn" && this.inNote) return;
    else if (name === "f") {state.font = this.parameter(token); if (!await this.definitions.font(state.font)) rtfError(this.context, "Undefined RTF font");}
    else if (name === "cf") state.color = this.parameter(token);
    else if (name === "fs") state.size = this.parameter(token, 1, 32767);
    else if (runControls[name]) {
      if (n !== undefined && n !== 0 && n !== 1) rtfError(this.context, `Invalid RTF ${name} toggle`);
      if (name === "sub") state.tags.delete("Superscript");
      if (name === "super") state.tags.delete("Subscript");
      if (n === 0) state.tags.delete(runControls[name]); else state.tags.add(runControls[name]);
    } else if (name === "ulnone") state.tags.delete("Underline");
    else if (name === "nosupersub") {state.tags.delete("Superscript"); state.tags.delete("Subscript");}
    else if (name === "s" || name === "cs") for await (const control of this.definitions.controls(this.parameter(token))) await this.control(control, state);
    else if (name === "ls") state.list = this.parameter(token);
    else if (name === "ilvl") state.level = this.parameter(token, 0, 8);
    else if (name === "trowd") await this.flow.startRow();
    else if (name === "cellx") {
      if (!this.flow.inTable) rtfError(this.context, "RTF cell boundary outside row");
      this.flow.boundary(this.parameter(token, -2147483648));
    }
    else if (name === "intbl") this.flow.tableParagraph();
    else if (name === "cell") await this.flow.cell(state);
    else if (name === "row") await this.flow.row();
    else if (!layoutControls.has(name)) rtfError(this.context, `Unsupported RTF control ${name}`, "E_CAPABILITY", token.offset);
  }
  private async picture(group: number): Promise<void> {
    if (this.flow.literal) rtfError(this.context, "Picture in RTF literal", "E_CAPABILITY");
    this.context.charge("images", 1);
    let encoding: "png" | "jpeg" | undefined, width: number | undefined, height: number | undefined, nibble: number | undefined;
    const position = this.storage.allocate(0), buffer = new Uint8Array(16384), prefix = new Uint8Array(8);
    let length = 0, used = 0, first = true;
    const byte = async (value: number) => {
      if (length < prefix.length) prefix[length] = value;
      length++; buffer[used++] = value;
      if (used === buffer.length) {await this.storage.append(buffer); used = 0;}
    };
    for await (const node of this.syntax.children(group)) {
      if (first) {first = false; continue;}
      const token = await this.syntax.token(node);
      if (token.kind === "word") {
        if (token.name === "pngblip" || token.name === "jpegblip") {
          if (encoding) rtfError(this.context, "Multiple RTF picture encodings");
          encoding = token.name === "pngblip" ? "png" : "jpeg";
        } else if (token.name === "picw") width = this.parameter(token, 1, 100000);
        else if (token.name === "pich") height = this.parameter(token, 1, 100000);
        else if (["picwgoal", "pichgoal", "picscalex", "picscaley", "piccropl", "piccropr", "piccropt", "piccropb", "bliptag"].includes(token.name)) this.parameter(token, -2147483648);
        else rtfError(this.context, `Unsupported RTF picture control ${token.name}`, "E_CAPABILITY", token.offset);
      } else if (token.kind === "binary") {
        if (nibble !== undefined) rtfError(this.context, "Binary picture follows incomplete hex byte");
        this.context.bound("resourceBytes", length + token.length);
        this.context.charge("retainedBytes", token.length * 8);
        for await (const chunk of this.syntax.chunks(node)) for (const value of chunk) {await byte(value); this.context.checkpoint(); if (length % 256 === 0) await this.context.cooperate(0);}
      } else if (token.kind === "text") {
        for await (const chunk of this.syntax.chunks(node)) for (const value of chunk) {
          this.context.checkpoint();
          if ([9, 10, 13, 32].includes(value)) continue;
          const digit = hexDigit(value);
          if (digit < 0) rtfError(this.context, "Malformed RTF picture hex", "E_PARSE", token.offset);
          if (nibble === undefined) nibble = digit;
          else {this.context.charge("binaryBytes", 1); this.context.bound("resourceBytes", length + 1); this.context.charge("retainedBytes", 8); await byte(nibble * 16 + digit); nibble = undefined;}
          if (length % 256 === 0) await this.context.cooperate(0);
        }
      } else rtfError(this.context, "Unsupported RTF picture data", "E_CAPABILITY", token.offset);
    }
    if (!encoding) rtfError(this.context, "RTF picture encoding must be PNG or JPEG", "E_CAPABILITY");
    if (nibble !== undefined || !length) rtfError(this.context, "Incomplete RTF picture data");
    if (width !== undefined && height !== undefined) this.context.bound("layoutWork", width * height);
    const signature = encoding === "png" ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216];
    if (length < signature.length || !signature.every((value, index) => prefix[index] === value)) rtfError(this.context, "Invalid RTF picture signature");
    this.context.charge("retainedBytes", length);
    if (used) await this.storage.append(buffer.subarray(0, used));
    const record = new Uint8Array(24), view = new DataView(record.buffer);
    [position, length, Number(encoding === "jpeg")].forEach((value, index) => view.setFloat64(index * 8, value, true));
    const number = ++this.pictureCount; await this.pictures.set(BigInt(number), BigInt(await this.storage.append(record)));
    const id = `rtf-picture-${number}.${encoding === "jpeg" ? "jpg" : "png"}`;
    await this.flow.append(await this.ast.tag("Image", await this.ast.value([["", [], []], [], [id, ""]])));
  }
  /** Match document-normalization charges using backed lengths, without reading payloads. */
  async reserveResources(usage?: RetainedAstUsage, aggregate = false): Promise<void> {
    let total = 0, nodes = usage?.nodes, text = usage?.text;
    const node = (path: string, count = 1, reserve = true) => {
      if (nodes === undefined) return;
      if (nodes + count > this.context.limits.nodes) throw new PandocError("E_LIMIT", "convert", `${path}: AST budget exceeded`, undefined, path);
      if (reserve) {nodes += count; if (!aggregate) this.context.charge("nodes", count);}
    };
    const string = (path: string, length: number) => {
      if (text === undefined) return;
      text += length;
      if (text > this.context.limits.text) throw new PandocError("E_LIMIT", "convert", `${path}: AST budget exceeded`, undefined, path);
      if (!aggregate) this.context.charge("text", length);
      this.context.charge("retainedBytes", length * 2);
    };
    node("$.resources", this.pictureCount, false);
    for (let index = 1; index <= this.pictureCount; index++) {
      const path = `$.resources[${index - 1}]`;
      node(path); node(path); string(path, 2);
      node(path + ".id"); string(path + ".id", `rtf-picture-${index}.png`.length);
      node(path); string(path, 5); node(path + ".bytes");
      const record = Number(await this.pictures.get(BigInt(index))!);
      const bytes = await this.storage.read(record + 8, 8);
      const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getFloat64(0, true);
      total += length;
      if (!Number.isSafeInteger(total) || total > this.context.limits.resourceBytes) {
        const path = `$.resources[${index - 1}].bytes`;
        throw new PandocError("E_LIMIT", "convert", `${path}: AST budget exceeded`, undefined, path);
      }
      if (!aggregate) this.context.charge("resourceBytes", length);
      this.context.charge("retainedBytes", length);
      if (!aggregate) this.context.charge("resources", 1);
      await this.context.cooperate();
    }
  }
  get resourceCount(): number {return this.pictureCount;}
  async resource(id: string): Promise<{identity: number; chunks: () => AsyncGenerator<Uint8Array>} | undefined> {
    if (!id.startsWith("rtf-picture-") || id.length > 40) return undefined;
    const number = Number(id.slice(12, id.lastIndexOf(".")));
    if (!Number.isSafeInteger(number) || number < 1) return undefined;
    const record = Number(await this.pictures.get(BigInt(number)) ?? 0n); if (!record) return undefined;
    const bytes = await this.storage.read(record, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const position = view.getFloat64(0, true), length = view.getFloat64(8, true), jpeg = view.getFloat64(16, true);
    if (id !== `rtf-picture-${number}.${jpeg ? "jpg" : "png"}`) return undefined;
    const storage = this.storage, context = this.context;
    return {identity: number, chunks: async function* () {for (let offset = 0; offset < length; offset += 16384) {await context.cooperate(); yield await storage.read(position + offset, Math.min(16384, length - offset));}}};
  }
}

export async function readRetainedRtf(syntax: RetainedRtfSyntax, storage: PagedStorage, context: AdapterContext) {
  const reader = new RetainedRtfReader(syntax, storage, context);
  await reader.read(); return reader;
}
