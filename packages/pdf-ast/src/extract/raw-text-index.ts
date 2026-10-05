import {PdfTextRecordOrder} from "./text-record-order.js";
import {logicalTextGlyphs} from "./logical-text-glyphs.js";
import {orderedTextGlyphs,type PdfOrderedTextGlyph} from "./ordered-text-glyphs.js";
import { glyphText, sameReplacement, type PdfTextGlyph } from "./stored-text-glyphs.js";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { PdfRect } from "../ast.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import { glyphDirection, mergeBBox } from "./text-glyphs.js";
import type { ExtractTextOptions } from "./text.js";

/** Retained extraction may borrow replacement text from caller-owned storage.
 * An explicit actualText string takes precedence. Keep storage alive until create completes. */
export type PdfRawTextGlyph = PdfTextGlyph;

export interface PdfRawTextIndexOptions extends Pick<ExtractTextOptions, "discardDiagonal" | "clipText" | "mode" | "colSpacing"> {
  /** Page-rounded high-water allocation, including records and UTF-16 text. */
  readonly maxStorageBytes?: number;
  /** Required page geometry for logical column classification. */
  readonly pageWidth?: number;
  /** Fixed scratch: 81920 bytes for string inputs, 131072 when decoding stored
   * replacements, 327680 for geometric order, 409600 for logical column order (three caches and normalization). Caller-owned glyph strings are not included. */
  readonly maxWorkingBytes?: number;
  readonly maxWords?: number;
  readonly maxLines?: number;
  readonly maxBlocks?: number;
  readonly signal?: AbortSignal;
}
export interface PdfStoredTextWord {
  readonly bbox: PdfRect;
  readonly fontSize: number;
  text(): AsyncGenerator<string, void, void>;
}
export interface PdfStoredTextLine {
  readonly bbox: PdfRect;
  readonly baselineY: number;
  words(): AsyncGenerator<PdfStoredTextWord, void, void>;
}
export interface PdfStoredTextBlock {
  readonly bbox: PdfRect;
  readonly kind: "paragraph" | "heading" | "list-item";
  lines(): AsyncGenerator<PdfStoredTextLine, void, void>;
}
function maximum(value: number | undefined): number {
  if (value === undefined || value === Infinity) return Infinity;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Invalid PDF text index limit");
  return value;
}
function bounds(record: readonly number[]): [number, number, number, number] { return [record[3]!, record[4]!, record[5]!, record[6]!]; }

/** A raw-order text hierarchy whose records and strings live on caller storage.
 * Iterators borrow the index lifetime; close after their final consumption. */
export class PdfRawTextIndex {
  private readonly backing: PagedStorage;
  private readonly signal: AbortSignal;
  private readonly textBuffer = new Uint8Array(4096);
  private allocated = 8;
  private orderStorage = 0;
  private firstBlock = 0;
  private blockCount = 0;
  private closed = false;
  private closing: Promise<void> | undefined;
  private constructor(private readonly storage: PdfIndexStorage, private readonly options: PdfRawTextIndexOptions) {
    this.signal = options.signal ?? new AbortController().signal;
    this.backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal: this.signal }, 4);
  }
  static async create(glyphs: AsyncIterable<PdfRawTextGlyph> | Iterable<PdfRawTextGlyph>, storage: PdfIndexStorage,
    options: PdfRawTextIndexOptions = {}): Promise<PdfRawTextIndex> {
    for (const value of [options.maxStorageBytes, options.maxWorkingBytes, options.maxWords, options.maxLines, options.maxBlocks]) maximum(value);
    if (maximum(options.maxWorkingBytes) < (options.mode !== undefined && options.mode !== "raw" ? (options.mode === "logical" ? 409600 : 327680) : 81920)) throw new PdfError("E_LIMIT", "PDF text index working byte limit exceeded");
    options.signal?.throwIfAborted();
    const table = new PdfRawTextIndex(storage, options);
    try { await table.build(glyphs); return table; }
    catch (error) { await table.close().catch(() => {}); throw error; }
  }
  private assertOpen() { this.signal.throwIfAborted(); if (this.closed) throw new PdfError("E_CAPABILITY", "PDF text index is closed"); }
  private allocate(length: number) {
    this.assertOpen();
    const end = this.allocated + length;
    if (!Number.isSafeInteger(end) || Math.ceil(end / 16384) * 16384 + this.orderStorage > maximum(this.options.maxStorageBytes)) throw new PdfError("E_LIMIT", "PDF text index storage byte limit exceeded");
    const position = this.backing.allocate(length); this.allocated = end; return position;
  }
  private async writeRecord(position: number, values: readonly number[]) {
    const bytes = new Uint8Array(64), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat64(index * 8, value)); await this.backing.write(position, bytes);
  }
  private async link(position: number, next: number) {
    if (!position) return;
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, next); await this.backing.write(position, bytes);
  }
  private async appendText(text: string) {
    const view = new DataView(this.textBuffer.buffer);
    for (let at = 0, chunks = 0; at < text.length;) {
      if (++chunks % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.assertOpen(); const count = Math.min(2048, text.length - at);
      const position = this.allocate(count * 2);
      for (let i = 0; i < count; i++) view.setUint16(i * 2, text.charCodeAt(at + i));
      await this.backing.write(position, this.textBuffer.subarray(0, count * 2)); at += count;
    }
  }
  private async build(source: AsyncIterable<PdfRawTextGlyph> | Iterable<PdfRawTextGlyph>) {
    const ordered=this.options.mode!==undefined&&this.options.mode!=="raw";
    const backing={allocate:(length:number)=>this.allocate(length),read:this.backing.read.bind(this.backing),write:this.backing.write.bind(this.backing)};
    const orderOptions={...this.options,accountStorage:(delta:number)=>{
      const total=this.orderStorage+delta;
      if(total+Math.ceil(this.allocated/16384)*16384>maximum(this.options.maxStorageBytes))throw new PdfError("E_LIMIT","PDF text index storage byte limit exceeded");
      this.orderStorage=total;
    }};
    const sorted=ordered?orderedTextGlyphs(source,backing,this.storage,orderOptions):undefined;
    const input=sorted?(this.options.mode === "logical"?logicalTextGlyphs(sorted,backing,this.storage,this.options.pageWidth??0,orderOptions):sorted):source;
    type Box = [number, number, number, number];
    type Line = { direction: ReturnType<typeof glyphDirection>; referenceSize: number; baseline: number; firstWord: number; lastWord: number; count: number; bbox?: Box; fontSize: number; prefix: string; prefixStarted: boolean };
    type Block = { kind: number; firstLine: number; count: number; bbox: Box };
    let line: Line | undefined, block: Block | undefined, previousLine: { bbox: Box; baseline: number; fontSize: number } | undefined;
    let word: { position: number; start: number; units: number; bbox: Box; fontSize: number } | undefined;
    let previousGlyph: { along: number; advance: number; fontSize: number } | undefined;
    let wordCount = 0, lineCount = 0, lastLine = 0, lastBlock = 0, work = 0;
    const flushWord = async () => {
      if (!word || !line) return;
      await this.writeRecord(word.position, [0, word.start, word.units, ...word.bbox, word.fontSize]);
      await this.link(line.lastWord, word.position); line.firstWord ||= word.position; line.lastWord = word.position;
      if (!line.count++) line.fontSize = word.fontSize;
      line.bbox = line.bbox ? mergeBBox(line.bbox, word.bbox) : word.bbox; word = undefined; previousGlyph = undefined;
    };
    const flushBlock = async () => {
      if (!block) return;
      if (this.blockCount >= maximum(this.options.maxBlocks)) throw new PdfError("E_LIMIT", "PDF text block limit exceeded");
      const position = this.allocate(64); await this.writeRecord(position, [0, block.firstLine, block.count, ...block.bbox, block.kind]);
      await this.link(lastBlock, position); this.firstBlock ||= position; lastBlock = position; this.blockCount++; block = undefined;
    };
    const flushLine = async () => {
      await flushWord(); if (!line?.count) { line = undefined; return; }
      if (lineCount >= maximum(this.options.maxLines)) throw new PdfError("E_LIMIT", "PDF text line limit exceeded");
      const position = this.allocate(64); await this.writeRecord(position, [0, line.firstWord, line.count, ...line.bbox!, line.baseline]);
      await this.link(lastLine, position); lastLine = position; lineCount++;
      const prefix = line.prefix, kind = line.fontSize >= 15 ? 1 : prefix.startsWith("•") || ((prefix.startsWith("-") || prefix.startsWith("*")) && (prefix[1] === " " || prefix[1] === "\t")) ? 2 : 0;
      const gap = previousLine ? previousLine.baseline - line.baseline : 0;
      const sameBlock = block?.kind === 0 && kind === 0 && previousLine && gap > 0 && gap <= previousLine.fontSize * 1.9 && Math.abs(line.bbox![0] - previousLine.bbox[0]) < previousLine.fontSize * 5;
      if (!sameBlock) { await flushBlock(); block = { kind, firstLine: position, count: 1, bbox: line.bbox! }; }
      else { block!.count++; block!.bbox = mergeBBox(block!.bbox, line.bbox!); }
      previousLine = { bbox: line.bbox!, baseline: line.baseline, fontSize: line.fontSize }; line = undefined;
    };
    const accept = async (glyph: PdfRawTextGlyph) => {
      this.assertOpen();
      if (this.options.discardDiagonal) {
        const direction = glyphDirection(glyph);
        if (Math.abs(direction.ux) > 0.1 && Math.abs(direction.uy) > 0.1) return;
      }
      if (this.options.clipText && glyph.clipRect) {
        const x = (glyph.bbox[0] + glyph.bbox[2]) / 2, y = (glyph.bbox[1] + glyph.bbox[3]) / 2;
        if (x < glyph.clipRect[0] || x > glyph.clipRect[2] || y < glyph.clipRect[1] || y > glyph.clipRect[3]) return;
      }
      const text = glyphText(glyph, this.signal);
      try {
        let part = await text.next(); if (part.done) return;
        const possibleSpace = part.value === " " || part.value === "\t";
        const next = possibleSpace ? await text.next() : undefined;
        const direction = glyphDirection(glyph);
        if (line && (ordered ? (glyph as PdfOrderedTextGlyph).lineStart : !(line.direction.ux * direction.ux + line.direction.uy * direction.uy > 0.85 && Math.abs(direction.normal - line.direction.normal) <= Math.max(line.referenceSize, glyph.fontSize) * 0.45))) await flushLine();
        line ??= { direction, referenceSize: glyph.fontSize, baseline: glyph.baselineY, firstWord: 0, lastWord: 0, count: 0, fontSize: 12, prefix: "", prefixStarted: false };
        if (possibleSpace && next?.done) { await flushWord(); return; }
        if (previousGlyph && direction.along - (previousGlyph.along + previousGlyph.advance) > Math.max(previousGlyph.fontSize, glyph.fontSize) * 0.22) await flushWord();
        const observe = (text: string) => {
          if (line!.prefix.length >= 2) return; const part = line!.prefixStarted ? text : text.trimStart();
          if (part.length) { line!.prefixStarted = true; line!.prefix += part.slice(0, 2 - line!.prefix.length); }
        };
        if (!word) {
          if (wordCount >= maximum(this.options.maxWords)) throw new PdfError("E_LIMIT", "PDF text word limit exceeded");
          const position = this.allocate(64); word = { position, start: position + 64, units: 0, bbox: [...glyph.bbox], fontSize: glyph.fontSize }; wordCount++;
          if (line.count) observe(" ");
        }
        let lookahead = next;
        while (!part.done) {
          observe(part.value); await this.appendText(part.value); word.units += part.value.length;
          part = lookahead ?? await text.next(); lookahead = undefined;
        }
        word.bbox = mergeBBox(word.bbox, glyph.bbox);
        previousGlyph = { along: direction.along, advance: glyph.advanceWidth, fontSize: glyph.fontSize };
      } finally { await text.return(); }
    };
    let pending: PdfRawTextGlyph | undefined;
    const iterator = Symbol.asyncIterator in input ? input[Symbol.asyncIterator]() : input[Symbol.iterator]();
    let complete = false, failed = false;
    try {
      while (true) {
        this.assertOpen(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); this.signal.throwIfAborted();
        const next = await iterator.next(); if (next.done) { complete = true; break; }
        const glyph = next.value;
        if(ordered){await accept(glyph);continue;}
        if (glyph.actualText === undefined && glyph.storedActualText && maximum(this.options.maxWorkingBytes) < 131072) throw new PdfError("E_LIMIT", "PDF text index working byte limit exceeded");
        // Paint captures/outlines are irrelevant to text grouping. Do not retain
        // them with ActualText's one pending normalized glyph.
        const projected: PdfRawTextGlyph = { charCode: glyph.charCode, unicode: glyph.unicode, bbox: [...glyph.bbox], baselineY: glyph.baselineY,
          advanceWidth: glyph.advanceWidth, matrix: [...glyph.matrix], fontSize: glyph.fontSize, fontName: "", color: { r: 0, g: 0, b: 0 },
          ...(glyph.actualText !== undefined ? { actualText: glyph.actualText } : {}), ...(glyph.storedActualText ? { storedActualText: { ...glyph.storedActualText } } : {}), ...(glyph.mcid !== undefined ? { mcid: glyph.mcid } : {}),
          ...(glyph.clipRect ? { clipRect: [...glyph.clipRect] } : {}) };
        if (pending && pending.mcid === projected.mcid && await sameReplacement(pending, projected, this.signal)) {
          pending = { ...pending, bbox: mergeBBox(pending.bbox, projected.bbox), advanceWidth: pending.advanceWidth + projected.advanceWidth };
        } else {
          if (pending) await accept(pending);
          pending = undefined;
          if (projected.actualText !== undefined || projected.storedActualText) pending = projected;
          else await accept(projected);
        }
      }
      if (pending) await accept(pending);
      await flushLine(); await flushBlock();
    } catch (error) { failed = true; throw error; }
    finally { if (!complete) try { await iterator.return?.(); } catch (error) { if (!failed) await Promise.reject(error); } }
  }
  private async *records(position: number, count: number): AsyncGenerator<number[], void, void> {
    for (let i = 0; i < count; i++) {
      if ((i + 1) % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.assertOpen(); const bytes = await this.backing.read(position, 64), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const values = Array.from({ length: 8 }, (_, index) => view.getFloat64(index * 8)); position = values[0]!; yield values;
    }
  }
  private async *text(position: number, units: number): AsyncGenerator<string, void, void> {
    let high = "";
    for (let offset = 0, chunks = 0; offset < units;) {
      if (++chunks % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.assertOpen(); const count = Math.min(2048, units - offset), bytes = await this.backing.read(position + offset * 2, count * 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), codes = new Uint16Array(count);
      for (let i = 0; i < count; i++) codes[i] = view.getUint16(i * 2);
      let value = high + String.fromCharCode(...codes); high = ""; offset += count;
      const last = value.charCodeAt(value.length - 1);
      if (last >= 0xd800 && last <= 0xdbff && offset < units) { high = value.at(-1)!; value = value.slice(0, -1); }
      if (value) yield value;
    }
    if (high) yield high;
  }
  private async *words(position: number, count: number): AsyncGenerator<PdfStoredTextWord, void, void> {
    for await (const word of this.records(position, count)) yield { bbox: bounds(word), fontSize: word[7]!, text: () => this.text(word[1]!, word[2]!) };
  }
  private async *lines(position: number, count: number): AsyncGenerator<PdfStoredTextLine, void, void> {
    for await (const line of this.records(position, count)) yield { bbox: bounds(line), baselineY: line[7]!, words: () => this.words(line[1]!, line[2]!) };
  }
  async *blocks(): AsyncGenerator<PdfStoredTextBlock, void, void> {
    this.assertOpen();
    for await (const block of this.records(this.firstBlock, this.blockCount)) yield {
      kind: block[7] === 1 ? "heading" : block[7] === 2 ? "list-item" : "paragraph", bbox: bounds(block),
      lines: () => this.lines(block[1]!, block[2]!),
    };
  }
  /** Stream physical rows; sorting and merge arrays stay in caller backing.
   * Replaying a row twice trims an arbitrarily long whitespace suffix without
   * retaining it, while preserving all interior whitespace and fixed spacing. */
  async *layoutText(options: Pick<ExtractTextOptions,"fixedPitch"|"lineSpacing"> & {readonly crop?:PdfRect} = {}): AsyncGenerator<string,void,void> {
    this.assertOpen();
    if(maximum(this.options.maxWorkingBytes)<409600)throw new PdfError("E_LIMIT","PDF layout working byte limit exceeded");
    const crop=options.crop,{backing,storage,firstBlock,blockCount}=this;
    const assertOpen=this.assertOpen.bind(this),records=this.records.bind(this),allocate=this.allocate.bind(this),writeRecord=this.writeRecord.bind(this),text=this.text.bind(this);
    const selected=(box:PdfRect)=>!crop||((box[0]+box[2])/2>=crop[0]&&(box[0]+box[2])/2<=crop[2]&&(box[1]+box[3])/2>=crop[1]&&(box[1]+box[3])/2<=crop[3]);
    const read=async(position:number)=>{assertOpen();const bytes=await backing.read(position,64),view=new DataView(bytes.buffer,bytes.byteOffset,64);return Array.from({length:8},(_,i)=>view.getFloat64(i*8));};
    async function* positions(position:number,count:number){for(let i=0;i<count;i++){assertOpen();if(i&&i%64===0)await new Promise<void>(resolve=>setTimeout(resolve,0));yield position;position=(await read(position))[0]!;}}
    const sortOptions={...this.options,accountStorage:(delta:number)=>{const total=this.orderStorage+delta;if(total+Math.ceil(this.allocated/16384)*16384>maximum(this.options.maxStorageBytes))throw new PdfError("E_LIMIT","PDF text index storage byte limit exceeded");this.orderStorage=total;}};
    let leftMargin=Infinity;
    async function* lines(){for await(const block of records(firstBlock,blockCount))for await(const position of positions(block[1]!,block[2]!)){
      const line=await read(position);let box:PdfRect|undefined;
      for await(const word of records(line[1]!,line[2]!))if(selected(bounds(word)))box=box?mergeBBox(box,bounds(word)):bounds(word);
      if(!box)continue;leftMargin=Math.min(leftMargin,box[0]);
      if(!crop)yield position;else{const at=allocate(64);await writeRecord(at,[0,line[1]!,line[2]!,...box,line[7]!]);yield at;}
    }}
    const order=await PdfTextRecordOrder.create(lines(),async(a,b)=>{const x=await read(a),y=await read(b),dy=y[7]!-x[7]!;return Math.abs(dy)>4?dy:x[3]!-y[3]!;},this.storage,sortOptions);
    const cursor=order.values();let failed=false,previousY:number|undefined;
    try{
      let next=await cursor.next(),pending=next.done?undefined:{position:next.value,record:await read(next.value)};
      while(pending){const reference=pending.record[7]!;
        async function* group(){while(pending&&Math.abs(reference-pending.record[7]!)<=4){yield pending.position;next=await cursor.next();pending=next.done?undefined:{position:next.value,record:await read(next.value)};}}
        const row=await PdfTextRecordOrder.create(group(),async(a,b)=>(await read(a))[3]!-(await read(b))[3]!,this.storage,sortOptions);let rowFailed=false;
        try{
          let baseline=reference;for await(const position of row.values()){baseline=(await read(position))[7]!;break;}
          if(previousY!==undefined){let blanks=0;if(options.lineSpacing!==undefined&&options.lineSpacing>0)blanks=Math.max(0,Math.min(40,Math.round((previousY-baseline)/options.lineSpacing)-1));yield "\n".repeat(1+blanks);}previousY=baseline;
          const fixed=options.fixedPitch!==undefined&&options.fixedPitch>0,pitch=fixed?options.fixedPitch!:6;
          async function* words(){for await(const linePosition of row.values()){const line=await read(linePosition);for await(const wordPosition of positions(line[1]!,line[2]!)){if(selected(bounds(await read(wordPosition))))yield wordPosition;}}}
          const wordOrder=fixed?await PdfTextRecordOrder.create(words(),async(a,b)=>(await read(a))[3]!-(await read(b))[3]!,storage,sortOptions):undefined;
          let wordsFailed=false;
          try{
            async function* content(){let length=0,currentX=leftMargin;
              if(wordOrder){for await(const position of wordOrder.values()){const word=await read(position),spaces=Math.min(80,Math.max(length>0?1:0,Math.round((word[3]!-currentX)/pitch)));if(spaces){length+=spaces;yield " ".repeat(spaces);}for await(const part of text(word[1]!,word[2]!)){length+=part.length;yield part;}currentX=word[5]!;}}
              else for await(const position of row.values()){const line=await read(position),spaces=Math.min(40,Math.max(length>0?2:0,Math.round((line[3]!-currentX)/pitch)));if(spaces){length+=spaces;yield " ".repeat(spaces);}let seen=false;for await(const word of records(line[1]!,line[2]!)){if(!selected(bounds(word)))continue;if(seen){length++;yield " ";}seen=true;for await(const part of text(word[1]!,word[2]!)){length+=part.length;yield part;}}currentX=line[5]!;}
            }
            let length=0,end=0;for await(const part of content()){const kept=part.trimEnd().length;if(kept)end=length+kept;length+=part.length;}
            let emitted=0;for await(const part of content()){assertOpen();const count=Math.min(part.length,end-emitted);if(count>0)yield part.slice(0,count);emitted+=count;if(emitted>=end)break;}
          }catch(error){wordsFailed=true;throw error;}finally{await wordOrder?.close().catch(error=>{if(!wordsFailed)throw error;});}
        }catch(error){rowFailed=true;throw error;}finally{await row.close().catch(error=>{if(!rowFailed)throw error;});}
      }
    }catch(error){failed=true;throw error;}finally{const results=await Promise.allSettled([cursor.return(),order.close()]);if(!failed)for(const result of results)if(result.status==='rejected')await Promise.reject(result.reason);}
  }
  close(): Promise<void> { this.closed = true; return this.closing ??= this.backing.close(); }
}
