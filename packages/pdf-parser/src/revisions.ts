import { SyntaxReader, PdfSyntaxError, resolvePdfReference } from "./syntax.js";
import type { PdfObject, PdfParseOptions } from "./syntax.js";
import { decodeStreamFilters } from "./filters.js";
import type { PdfDecodedStream, PdfFilterOptions } from "./filters.js";
import { interpretPdfTextOwned } from "./text.js";
import type { PdfTextOptions, PdfTextResult } from "./text.js";
import { inspectPageTree } from "./pages.js";
import type { PdfPage, PdfPageOptions, PdfPageTree } from "./pages.js";
import { layoutPdfTextOwned, validateLayout } from "./layout.js";
import type { PdfLayoutOptions, PdfLayoutResult } from "./layout.js";
export type PdfPageLayoutOptions = Pick<PdfLayoutOptions, "mode" | "lineTolerance" | "maxRuns" | "normalization" | "maxMappings">;
export interface PdfDocumentLayout {
  inventory: PdfPageTree;
  pages: PdfLayoutResult[];
}
export interface PdfDocumentOptions extends PdfParseOptions {
  recovery?: boolean;
}
export interface PdfIndirectObject {
  object: PdfObject;
  stream?: Uint8Array;
}
export interface PdfXrefEntry {
  type: 0 | 1 | 2;
  offset: number;
  generation: number;
}
interface LengthCheck {
  reference: PdfObject;
  length: number;
}
interface XrefSection {
  trailer: PdfObject;
  entries: Map<number, PdfXrefEntry>;
  lengths: LengthCheck[];
}
const ws = (b: number | undefined) =>
  b === 0 || b === 9 || b === 10 || b === 12 || b === 13 || b === 32;
export class PdfDocument {
  private readonly reader: SyntaxReader;
  private readonly entries = new Map<number, PdfXrefEntry>();
  private readonly loading = new Set<number>();
  readonly revisions: { offset: number; trailer: PdfObject }[] = [];
  readonly diagnostics: { code: "RECOVERY_SCAN"; offset: number }[] = [];
  constructor(input: Uint8Array | readonly Uint8Array[], options: PdfDocumentOptions = {}) {
    this.reader = new SyntaxReader(input, { ...options, duplicateKeys: "reject" });
    const r = this.reader;
    try {
      const data = r.data;
      if (
        !this.matches(0, "%PDF-") ||
        !(
          (data[5] === 49 && data[6] === 46 && data[7]! >= 48 && data[7]! <= 55) ||
          (data[5] === 50 && data[6] === 46 && data[7] === 48)
        ) ||
        (data[8] !== 10 && data[8] !== 13)
      )
        r.fail("SYNTAX", "invalid PDF header");
      let end = data.length;
      while (end && ws(data[end - 1])) {
        r.charge();
        end--;
      }
      if (!this.matches(end - 5, "%%EOF")) r.fail("SYNTAX", "missing EOF");
      let marker = end - 5;
      while (marker >= 0 && !this.matches(marker, "startxref")) {
        r.charge();
        marker--;
      }
      if (marker < 0) r.fail("SYNTAX", "missing startxref");
      r.seek(marker);
      this.expect(r, "startxref");
      const offset = this.integer(r.take().object);
      while (r.offset < end - 5) {
        r.charge();
        if (!ws(data[r.offset])) r.fail("SYNTAX", "invalid startxref suffix");
        r.seek(r.offset + 1);
      }
      this.sections(offset);
    } catch (error) {
      if (!options.recovery || !(error instanceof PdfSyntaxError) || error.code !== "SYNTAX")
        throw error;
      this.entries.clear();
      this.revisions.length = 0;
      this.recover();
    }
  }
  private named(object: PdfObject | undefined, name: string): boolean {
    if (object?.kind !== "name") return false;
    const bytes = object.bytes!;
    this.reader.charge();
    if (bytes.length !== name.length) return false;
    for (let i = 0; i < bytes.length; i++) {
      this.reader.charge();
      if (bytes[i] !== name.charCodeAt(i)) return false;
    }
    return true;
  }
  private field(object: PdfObject, key: string): PdfObject | undefined {
    for (const entry of object.entries ?? []) {
      this.reader.charge();
      if (this.named(entry.key, key)) return entry.value;
    }
    return undefined;
  }
  private matches(offset: number, word: string): boolean {
    this.reader.charge(word.length);
    if (offset < 0 || offset + word.length > this.reader.data.length) return false;
    for (let i = 0; i < word.length; i++)
      if (this.reader.data[offset + i] !== word.charCodeAt(i)) return false;
    return true;
  }
  private integer(obj: PdfObject | undefined, maximum = Number.MAX_SAFE_INTEGER): number {
    if (
      obj?.kind !== "number" ||
      !Number.isSafeInteger(obj.value) ||
      (obj.value as number) < 0 ||
      (obj.value as number) > maximum ||
      obj.raw?.includes(46)
    )
      this.reader.fail("SYNTAX", "invalid integer range");
    return obj.value as number;
  }
  private expect(r: SyntaxReader, word: string): void {
    if (r.take().type !== word) r.fail("SYNTAX", `expected ${word}`);
  }
  private add(number: number, entry: PdfXrefEntry, target: Map<number, PdfXrefEntry>): void {
    this.reader.charge();
    if (target.has(number)) this.reader.fail("SYNTAX", "duplicate xref entry");
    this.reader.countObject();
    this.reader.reserve(64);
    target.set(number, entry);
  }
  private sections(start: number): void {
    const visited = new Set<number>();
    const sections: XrefSection[] = [];
    let offset: number | undefined = start;
    while (offset !== undefined) {
      this.reader.charge();
      if (visited.has(offset)) this.reader.fail("SYNTAX", "revision cycle");
      visited.add(offset);
      this.reader.reserve(32);
      const section = this.section(offset);
      const hybrid = this.field(section.trailer, "XRefStm");
      if (hybrid) {
        const h = this.integer(hybrid);
        if (visited.has(h)) this.reader.fail("SYNTAX", "hybrid revision cycle");
        visited.add(h);
        this.reader.reserve(32);
        const supplement = this.section(h, true);
        section.lengths.push(...supplement.lengths);
        // Hybrid streams override table placeholders within this revision.
        for (const [n, entry] of supplement.entries) {
          this.reader.charge();
          section.entries.set(n, entry);
        }
      }
      for (const [n, entry] of section.entries) {
        this.reader.charge();
        if (!this.entries.has(n)) this.entries.set(n, entry);
      }
      this.revisions.push({ offset, trailer: section.trailer });
      this.reader.reserve(32);
      sections.push(section);
      const prev = this.field(section.trailer, "Prev");
      offset = prev ? this.integer(prev) : undefined;
    }
    // Validate bootstrap lengths against the index at that revision, not the
    // newest index: a subsequent update can replace or free the length object.
    const index = new Map<number, PdfXrefEntry>();
    for (let i = sections.length - 1; i >= 0; i--) {
      const section = sections[i]!;
      for (const [number, entry] of section.entries) {
        this.reader.charge();
        if (!index.has(number)) this.reader.reserve(64);
        index.set(number, entry);
      }
      for (const check of section.lengths) {
        const length = resolvePdfReference(
          check.reference,
          (ref) => this.readObject(ref.objectNumber!, ref.generation!, index).object,
          {
            maxReferences: this.reader.limits.objects,
            ...(this.reader.options.signal ? { signal: this.reader.options.signal } : {})
          }
        );
        if (this.integer(length) !== check.length)
          this.reader.fail("SYNTAX", "xref stream indirect length mismatch");
      }
    }
  }
  private section(offset: number, streamOnly = false): XrefSection {
    const r = this.reader;
    r.seek(offset);
    const entries = new Map<number, PdfXrefEntry>();
    if (r.peek().type === "xref" && !streamOnly) {
      r.take();
      while (r.peek().type !== "trailer") {
        const first = this.integer(r.take().object),
          count = this.integer(r.take().object, r.limits.objects);
        if (count > Number.MAX_SAFE_INTEGER - first) r.fail("SYNTAX", "xref range overflow");
        for (let i = 0; i < count; i++) {
          const position = this.integer(r.take().object),
            generation = this.integer(r.take().object, 65535),
            type = r.take().type;
          if (type !== "f" && type !== "n") r.fail("SYNTAX", "invalid xref entry");
          if (type === "n" && position >= r.data.length)
            r.fail("SYNTAX", "xref offset outside input");
          this.add(
            first + i,
            { type: type === "f" ? 0 : 1, offset: position, generation },
            entries
          );
        }
      }
      r.take();
      const trailer = r.object();
      if (trailer.kind !== "dictionary") r.fail("SYNTAX", "expected trailer dictionary");
      const size = this.integer(this.field(trailer, "Size"));
      for (const number of entries.keys()) {
        r.charge();
        if (number >= size) r.fail("SYNTAX", "xref entry exceeds trailer Size");
      }
      return { trailer, entries, lengths: [] };
    }
    const lengths: LengthCheck[] = [];
    const indirect = this.indirect(offset, undefined, undefined, lengths);
    const trailer = indirect.object;
    if (!this.named(this.field(trailer, "Type"), "XRef") || !indirect.stream)
      return r.fail("SYNTAX", "expected xref stream");
    this.requireUnfiltered(trailer);
    const { widths, ranges, row, length } = this.xrefLayout(trailer);
    if (length !== indirect.stream.length) r.fail("SYNTAX", "xref stream length mismatch");
    let cursor = 0;
    for (let i = 0; i < ranges.length; i += 2) {
      const first = ranges[i]!,
        count = ranges[i + 1]!;
      if (count > Math.floor((indirect.stream.length - cursor) / row))
        r.fail("SYNTAX", "invalid xref stream range or length");
      for (let j = 0; j < count; j++) {
        const values = widths.map((width, k) => {
          if (!width) return k === 0 ? 1 : 0;
          let value = 0;
          for (let n = 0; n < width; n++) {
            r.charge();
            const byte = indirect.stream![cursor++]!;
            if (value > Math.floor((Number.MAX_SAFE_INTEGER - byte) / 256))
              r.fail("SYNTAX", "xref field overflow");
            value = value * 256 + byte;
          }
          return value;
        });
        const [type, position, generation] = values as [number, number, number];
        if (
          type > 2 ||
          (type !== 2 && generation > 65535) ||
          (type === 1 && position >= r.data.length)
        )
          r.fail("SYNTAX", "invalid xref stream entry");
        this.add(first + j, { type: type as 0 | 1 | 2, offset: position, generation }, entries);
      }
    }
    if (cursor !== indirect.stream.length) r.fail("SYNTAX", "xref stream length mismatch");
    return { trailer, entries, lengths };
  }
  private xrefLayout(object: PdfObject): {
    widths: number[];
    ranges: number[];
    row: number;
    length: number;
  } {
    const r = this.reader;
    this.requireUnfiltered(object);
    const size = this.integer(this.field(object, "Size"));
    const w = this.field(object, "W");
    if (w?.kind !== "array" || w.items!.length !== 3)
      return r.fail("SYNTAX", "invalid xref widths");
    r.reserve(24);
    const widths = w.items!.map((width) => this.integer(width, 8));
    const row = widths.reduce((sum, width) => sum + width, 0);
    if (!row) r.fail("SYNTAX", "empty xref widths");
    const index = this.field(object, "Index");
    if (index && (index.kind !== "array" || index.items!.length % 2))
      r.fail("SYNTAX", "invalid xref Index");
    r.reserve(index ? index.items!.length * 8 : 16);
    const ranges = index ? index.items!.map((item) => this.integer(item)) : [0, size];
    let count = 0;
    for (let i = 0; i < ranges.length; i += 2) {
      r.charge();
      const first = ranges[i]!,
        n = ranges[i + 1]!;
      if (first > size || n > size - first || n > r.limits.objects - count)
        r.fail("SYNTAX", "invalid xref stream range or length");
      count += n;
    }
    if (count > Math.floor(r.data.length / row)) r.fail("SYNTAX", "truncated xref stream length");
    return { widths, ranges, row, length: count * row };
  }
  private indirect(
    offset: number,
    number?: number,
    generation?: number,
    lengths?: LengthCheck[],
    index = this.entries
  ): PdfIndirectObject {
    const r = this.reader;
    r.seek(offset);
    const n = this.integer(r.take().object),
      g = this.integer(r.take().object, 65535);
    this.expect(r, "obj");
    if ((number !== undefined && n !== number) || (generation !== undefined && g !== generation))
      r.fail("REFERENCE", "object header mismatch");
    const object = r.object();
    let stream: Uint8Array | undefined;
    if (r.peek().type === "stream") {
      if (object.kind !== "dictionary") r.fail("SYNTAX", "stream requires dictionary");
      const token = r.take();
      let start = token.end;
      if (r.data[start] === 13) {
        start++;
        if (r.data[start] === 10) start++;
      } else if (r.data[start] === 10) start++;
      else r.fail("SYNTAX", "stream requires EOL");
      let length = this.field(object, "Length");
      let count: number;
      if (
        length?.kind === "reference" &&
        lengths &&
        this.named(this.field(object, "Type"), "XRef")
      ) {
        count = this.xrefLayout(object).length;
        r.reserve(32);
        lengths.push({ reference: length, length: count });
      } else {
        if (length?.kind === "reference")
          length = resolvePdfReference(
            length,
            (ref) => this.readObject(ref.objectNumber!, ref.generation!, index).object,
            {
              maxReferences: r.limits.objects,
              ...(r.options.signal ? { signal: r.options.signal } : {})
            }
          );
        count = this.integer(length);
      }
      if (count > r.data.length - start) r.fail("SYNTAX", "truncated stream length");
      const end = start + count;
      r.charge(count);
      r.reserve(count);
      stream = r.data.slice(start, end);
      let terminator = end;
      if (r.data[terminator] === 13) {
        terminator++;
        if (r.data[terminator] === 10) terminator++;
      } else if (r.data[terminator] === 10) terminator++;
      if (!this.matches(terminator, "endstream"))
        r.fail("SYNTAX", "stream length does not align with endstream");
      r.seek(terminator);
      this.expect(r, "endstream");
    }
    this.expect(r, "endobj");
    return { object, ...(stream ? { stream } : {}) };
  }
  getObject(number: number, generation = 0): PdfIndirectObject {
    const r = this.reader;
    r.check();
    if (
      !Number.isSafeInteger(number) ||
      number < 0 ||
      !Number.isSafeInteger(generation) ||
      generation < 0 ||
      generation > 65535
    )
      r.fail("ARGUMENT", "invalid reference");
    return this.readObject(number, generation, this.entries);
  }
  private readObject(
    number: number,
    generation: number,
    index: Map<number, PdfXrefEntry>
  ): PdfIndirectObject {
    const r = this.reader;
    r.check();
    const entry = index.get(number);
    if (!entry) return r.fail("REFERENCE", "missing object");
    if (entry.type === 0) r.fail("REFERENCE", "free object");
    if ((entry.type === 2 ? 0 : entry.generation) !== generation)
      r.fail("REFERENCE", "generation mismatch");
    if (this.loading.has(number)) r.fail("REFERENCE", "reference cycle");
    if (this.loading.size >= r.limits.nesting) r.fail("LIMIT", "reference nesting limit");
    this.loading.add(number);
    try {
      if (entry.type === 1)
        return this.indirect(entry.offset, number, generation, undefined, index);
      const container = this.readObject(entry.offset, 0, index);
      if (!this.named(this.field(container.object, "Type"), "ObjStm") || !container.stream)
        return r.fail("SYNTAX", "expected object stream");
      this.requireUnfiltered(container.object);
      const count = this.integer(this.field(container.object, "N"), r.limits.objects),
        first = this.integer(this.field(container.object, "First"), container.stream.length);
      if (entry.generation >= count) r.fail("SYNTAX", "object stream index bounds");
      const child = r.fork(container.stream);
      const pairs: { number: number; offset: number }[] = [];
      const seen = new Set<number>();
      for (let i = 0; i < count; i++) {
        const n = this.integer(child.take().object),
          o = this.integer(child.take().object);
        if (
          !n ||
          seen.has(n) ||
          o >= container.stream.length - first ||
          (i && o <= pairs[i - 1]!.offset)
        )
          r.fail("SYNTAX", "invalid object stream header");
        r.reserve(64);
        seen.add(n);
        pairs.push({ number: n, offset: o });
      }
      if (child.offset > first) r.fail("SYNTAX", "object stream First overlaps header");
      for (let i = child.offset; i < first; i++) {
        r.charge();
        if (!ws(container.stream[i])) r.fail("SYNTAX", "invalid object stream header padding");
      }
      const pair = pairs[entry.generation]!;
      if (pair.number !== number) r.fail("REFERENCE", "object stream index mismatch");
      const begin = first + pair.offset,
        end =
          entry.generation + 1 < count
            ? first + pairs[entry.generation + 1]!.offset
            : container.stream.length;
      const bounded = child.fork(container.stream.subarray(begin, end));
      const objects = bounded.parse();
      if (objects.length !== 1 || objects[0]!.kind === "reference")
        r.fail("SYNTAX", "invalid compressed object");
      return { object: objects[0]! };
    } finally {
      this.loading.delete(number);
    }
  }
  resolve(number: number, generation = 0): PdfObject {
    return resolvePdfReference(
      this.getObject(number, generation).object,
      (ref) => this.getObject(ref.objectNumber!, ref.generation!).object,
      {
        maxReferences: this.reader.limits.objects,
        ...(this.reader.options.signal ? { signal: this.reader.options.signal } : {})
      }
    );
  }
  inspectPages(options: PdfPageOptions = {}): PdfPageTree {
    this.reader.check();
    if (this.diagnostics.length)
      this.reader.fail("UNSUPPORTED", "recovered page interpretation lacks revision context");
    for (const revision of this.revisions) {
      const encryption = this.field(revision.trailer, "Encrypt");
      if (encryption && encryption.kind !== "null")
        this.reader.fail("UNSUPPORTED", "encrypted page interpretation is not qualified");
    }
    return inspectPageTree(this, this.reader, options);
  }
  extractPageText(index: number, options: Pick<PdfTextOptions, "normalization" | "maxMappings"> = {}): PdfTextResult {
    const r=this.reader;r.check();
    if(!Number.isSafeInteger(index) || index<0) r.fail("ARGUMENT","invalid page index");
    const page=this.inspectPages().pages[index] ?? r.fail("ARGUMENT","page index out of bounds");
    return this.extractTextForPage(page, options);
  }
  private extractTextForPage(page: PdfPage, options: Pick<PdfTextOptions, "normalization" | "maxMappings">): PdfTextResult {
    const r = this.reader;
    let content=this.field(page.raw,"Contents");
    if(content?.kind==="reference") {
      const resolved=this.resolve(content.objectNumber!,content.generation!);
      if(resolved.kind==="array" || resolved.kind==="null") content=resolved;
    }
    const refs=content?.kind==="array"?content.items!:content && content.kind!=="null"?[content]:[];
    const chunks:Uint8Array[]=[];const segments:{reference:PdfObject;start:number;end:number}[]=[];let length=0;
    for(const ref of refs) {
      r.charge();if(ref.kind!=="reference") r.fail("SYNTAX","page content must be an indirect stream");
      const decoded=this.decodeStream(ref.objectNumber!,ref.generation!).bytes;
      if(decoded.length+1>r.limits.inputBytes-length) r.fail("LIMIT","page content byte limit");
      r.reserve(64);segments.push({reference:ref,start:length,end:length+decoded.length});chunks.push(decoded);length+=decoded.length+1;
    }
    r.reserve(length);r.charge(length);const data=new Uint8Array(length);let offset=0;
    for(const chunk of chunks) {r.check();data.set(chunk,offset);offset+=chunk.length;data[offset++]=10;}
    const result=interpretPdfTextOwned(r.fork(data,true),page.resources,{
      ...r.options,...options,
      lookup:ref=>this.resolve(ref.objectNumber!,ref.generation!),
      stream:ref=>{if(ref.kind!=="reference") r.fail("SYNTAX","expected indirect text resource stream");return this.decodeStream(ref.objectNumber!,ref.generation!).bytes;}
    });
    result.contentStreams=segments;
    let segment=0;
    for(const glyph of result.glyphs) {
      r.charge();if(glyph.source.formPath.length) continue;
      while(segment<segments.length && glyph.source.stringStart>=segments[segment]!.end) {r.charge();segment++;}
      const span=segments[segment];if(span) {glyph.source.contentStream=span.reference;glyph.source.streamStringStart=glyph.source.stringStart-span.start;}
    }
    return result;
  }
  extractPageLayout(index: number, options: PdfPageLayoutOptions = {}): PdfLayoutResult {
    validateLayout(this.reader, options);
    if (!Number.isSafeInteger(index) || index < 0) this.reader.fail("ARGUMENT", "invalid page index");
    const page = this.inspectPages().pages[index] ?? this.reader.fail("ARGUMENT", "page index out of bounds");
    const text = this.extractTextForPage(page, options);
    return layoutPdfTextOwned(text, this.reader, { ...options, box: page.cropBox, rotate: page.rotate });
  }
  extractLayout(options: PdfPageLayoutOptions = {}): PdfDocumentLayout {
    validateLayout(this.reader, options);
    const inventory = this.inspectPages();
    const pages: PdfLayoutResult[] = [];
    for (let index = 0; index < inventory.pages.length; index++) {
      this.reader.charge();
      this.reader.reserve(32);
      const page = inventory.pages[index]!;
      const text = this.extractTextForPage(page, options);
      pages.push(layoutPdfTextOwned(text, this.reader, { ...options, box: page.cropBox, rotate: page.rotate }));
    }
    this.reader.reserve(64);
    return { inventory, pages };
  }
  decodeStream(
    number: number,
    generation = 0,
    options: Pick<PdfFilterOptions, "imageMode"> = {}
  ): PdfDecodedStream {
    this.reader.check();
    if (this.diagnostics.length)
      this.reader.fail("UNSUPPORTED", "recovered stream decoding lacks revision security context");
    for (const revision of this.revisions) {
      const encryption = this.field(revision.trailer, "Encrypt");
      if (encryption && encryption.kind !== "null")
        this.reader.fail("UNSUPPORTED", "encrypted stream decoding is not qualified");
    }
    const indirect = this.getObject(number, generation);
    if (!indirect.stream) this.reader.fail("SYNTAX", "object has no stream");
    return decodeStreamFilters(indirect.stream, indirect.object, this.reader, {
      ...options,
      lookup: (ref) => this.getObject(ref.objectNumber!, ref.generation!).object
    });
  }
  private requireUnfiltered(object: PdfObject): void {
    const filter = this.field(object, "Filter") ?? this.field(object, "F");
    if (filter && filter.kind !== "null")
      this.reader.fail("UNSUPPORTED", "unsupported filter: decoding gate is not qualified");
  }
  private recover(): void {
    const r = this.reader;
    this.diagnostics.push({ code: "RECOVERY_SCAN", offset: 0 });
    for (let offset = 0; offset < r.data.length; offset++) {
      r.charge();
      if (r.data[offset]! < 48 || r.data[offset]! > 57 || (offset && !ws(r.data[offset - 1])))
        continue;
      try {
        r.seek(offset);
        const n = this.integer(r.take().object),
          g = this.integer(r.take().object, 65535);
        this.expect(r, "obj");
        this.indirect(offset, n, g);
        r.reserve(64);
        r.countObject();
        this.entries.set(n, { type: 1, offset, generation: g });
        offset = r.offset - 1;
      } catch (error) {
        if (!(error instanceof PdfSyntaxError) || error.code !== "SYNTAX") throw error;
      }
    }
    if (!this.entries.size) r.fail("SYNTAX", "recovery found no objects");
  }
}
export function openPdf(
  input: Uint8Array | readonly Uint8Array[],
  options: PdfDocumentOptions = {}
): PdfDocument {
  return new PdfDocument(input, options);
}
