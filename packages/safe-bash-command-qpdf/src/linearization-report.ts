import { PdfError } from "@poe-code/pdf-ast";

type Report = Generator<string | { offset: number; length: number }, void, Uint8Array>;
type Bits = Generator<{ offset: number; length: number }, number, Uint8Array>;

/** Hint tables store columns of bit-packed values, with each column byte-aligned.
 * Independent cursors let us print rows without retaining a page-sized array. */
class HintBits {
  position: number;
  private bytes: Uint8Array = new Uint8Array(0);
  private start = 0;
  constructor(readonly size: number, offset = 0) { this.position = offset * 8; }
  *read(width: number): Bits {
    if (!Number.isInteger(width) || width < 0 || width > 32 || this.position + width > this.size * 8) throw new PdfError("E_PARSE", "Invalid linearization hint table");
    let value = 0;
    for (let bit = 0; bit < width; bit++, this.position++) {
      const offset = Math.floor(this.position / 8);
      if (offset < this.start || offset >= this.start + this.bytes.length) {
        this.start = offset;
        this.bytes = yield { offset, length: Math.min(4096, this.size - offset) };
        if (!this.bytes.length) throw new PdfError("E_PARSE", "Truncated linearization hint table");
      }
      value = value * 2 + ((this.bytes[offset - this.start]! >> (7 - this.position % 8)) & 1);
    }
    return value;
  }
  column(count: number, width: number): HintBits {
    const cursor = new HintBits(this.size, this.position / 8);
    const end = this.position + count * width;
    if (!Number.isSafeInteger(end) || end > this.size * 8) throw new PdfError("E_PARSE", "Truncated linearization hint table");
    this.position = Math.ceil(end / 8) * 8;
    return cursor;
  }
}

export function* linearizationReport(filename: string, values: Record<string, number>, size: number, sharedOffset: number, outlineOffset?: number): Report {
  const adjusted = (offset: number) => offset >= values.H_offset! ? offset + values.H_length! : offset;
  yield `${filename}: linearization data:\n\n`;
  for (const key of ["file_size", "first_page_object", "first_page_end", "npages", "xref_zero_offset", "first_page", "H_offset", "H_length"]) yield `${key}: ${values[key]}\n`;
  // Historical validation accepts dictionaries without a usable hint stream.
  if (!size) return;
  yield "\nPage Offsets Hint Table\n\n";
  const page = new HintBits(size), header: Record<string, number> = {};
  for (const [key, width] of [
    ["min_nobjects", 32], ["first_page_offset", 32], ["nbits_delta_nobjects", 16], ["min_page_length", 32],
    ["nbits_delta_page_length", 16], ["min_content_offset", 32], ["nbits_delta_content_offset", 16],
    ["min_content_length", 32], ["nbits_delta_content_length", 16], ["nbits_nshared_objects", 16],
    ["nbits_shared_identifier", 16], ["nbits_shared_numerator", 16], ["shared_denominator", 16],
  ] as const) {
    header[key] = yield* page.read(width);
    yield `${key}: ${key === "first_page_offset" ? adjusted(header[key]) : header[key]}\n`;
  }
  const n = values.npages!, objects = page.column(n, header.nbits_delta_nobjects!), lengths = page.column(n, header.nbits_delta_page_length!);
  const counts = page.column(n, header.nbits_nshared_objects!);
  const countScan = new HintBits(size, counts.position / 8);
  let total = 0;
  for (let i = 0; i < n; i++) total += yield* countScan.read(header.nbits_nshared_objects!);
  const identifiers = page.column(total, header.nbits_shared_identifier!), numerators = page.column(total, header.nbits_shared_numerator!);
  const contentOffsets = page.column(n, header.nbits_delta_content_offset!), contentLengths = page.column(n, header.nbits_delta_content_length!);
  for (let i = 0; i < n; i++) {
    yield `Page ${i}:\n  nobjects: ${header.min_nobjects! + (yield* objects.read(header.nbits_delta_nobjects!))}\n`;
    yield `  length: ${header.min_page_length! + (yield* lengths.read(header.nbits_delta_page_length!))}\n`;
    yield `  content_offset: ${header.min_content_offset! + (yield* contentOffsets.read(header.nbits_delta_content_offset!))}\n`;
    yield `  content_length: ${header.min_content_length! + (yield* contentLengths.read(header.nbits_delta_content_length!))}\n`;
    const count = yield* counts.read(header.nbits_nshared_objects!);
    yield `  nshared_objects: ${count}\n`;
    for (let j = 0; j < count; j++) yield `    identifier ${j}: ${yield* identifiers.read(header.nbits_shared_identifier!)}\n    numerator ${j}: ${yield* numerators.read(header.nbits_shared_numerator!)}\n`;
  }
  yield "\nShared Objects Hint Table\n\n";
  const shared = new HintBits(size, sharedOffset), fields: Record<string, number> = {};
  for (const [key, width] of [["first_shared_obj", 32], ["first_shared_offset", 32], ["nshared_first_page", 32], ["nshared_total", 32], ["nbits_nobjects", 16], ["min_group_length", 32], ["nbits_delta_group_length", 16]] as const) {
    fields[key] = yield* shared.read(width);
    yield `${key}: ${key === "first_shared_offset" ? adjusted(fields[key]) : fields[key]}\n`;
  }
  const groups = fields.nshared_total!, groupLengths = shared.column(groups, fields.nbits_delta_group_length!), signatures = shared.column(groups, 1);
  const signatureScan = new HintBits(size, signatures.position / 8);
  for (let i = 0; i < groups; i++) if (yield* signatureScan.read(1)) shared.column(4, 32);
  const groupCounts = shared.column(groups, fields.nbits_nobjects!);
  for (let i = 0; i < groups; i++) {
    yield `Shared Object ${i}:\n  group length: ${fields.min_group_length! + (yield* groupLengths.read(fields.nbits_delta_group_length!))}\n`;
    if (yield* signatures.read(1)) yield "  signature present\n";
    const count = yield* groupCounts.read(fields.nbits_nobjects!);
    if (count) yield `  nobjects: ${count + 1}\n`;
  }
  if (outlineOffset !== undefined) {
    const outline = new HintBits(size, outlineOffset);
    const first = yield* outline.read(32), offset = yield* outline.read(32), count = yield* outline.read(32), length = yield* outline.read(32);
    if (count) yield `\nOutlines Hint Table\n\nfirst_object: ${first}\nfirst_object_offset: ${adjusted(offset)}\nnobjects: ${count}\ngroup_length: ${length}\n`;
  }
}
