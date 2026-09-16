import {PDFArray, PDFDict, PDFNumber, PDFRef, PDFStream, type PDFContext, type PDFObject} from "pdf-lib";
import {PdfError} from "./errors.js";

interface SerializationBudget {
  readonly outputBytes: number;
  readonly objects: number;
  readonly reserveOutput?: (bytes: number) => void;
  readonly work?: () => void;
  readonly cooperate?: () => Promise<void>;
}
/** Classic xref, generation zero, contiguous identities; no object streams. */
export async function serializePdf(context: PDFContext, budget: SerializationBudget): Promise<Uint8Array> {
  const limit = (message: string): never => {throw new PdfError("E_LIMIT", message);};
  const invalid = (message: string): never => {throw new PdfError("E_CAPABILITY", message);};
  if (!Number.isSafeInteger(budget.outputBytes) || budget.outputBytes < 0 || budget.outputBytes > 0x7fffffff || !Number.isSafeInteger(budget.objects) || budget.objects < 0 || budget.objects > 1_000_000) limit("Invalid PDF serialization budget");
  // Check identity range before enumerating or building an xref table.
  if (context.largestObjectNumber > budget.objects) limit("PDF object count exceeded");
  const objects = context.enumerateIndirectObjects();
  if (objects.length !== context.largestObjectNumber) invalid("Sparse PDF object identities");
  const identities = new Set(objects.map(([ref]) => ref));
  const path = new Set<PDFObject>();
  let visited = 0;
  const validate = (object: PDFObject, depth = 0): void => {
    budget.work?.();
    if (++visited > 1_000_000 || depth > 64) limit("PDF object graph exhausted");
    if (object instanceof PDFNumber && !Number.isFinite(object.asNumber())) invalid("Nonfinite PDF number");
    if (object instanceof PDFRef) {if (!identities.has(object)) invalid("Dangling PDF reference"); return;}
    if (path.has(object)) invalid("Direct PDF object cycle");
    path.add(object);
    if (object instanceof PDFStream) validate(object.dict, depth + 1);
    else if (object instanceof PDFDict) for (const [, value] of object.entries()) validate(value, depth + 1);
    else if (object instanceof PDFArray) for (let i = 0; i < object.size(); i++) validate(object.get(i), depth + 1);
    path.delete(object);
  };
  if (!context.trailerInfo.Root) invalid("Missing PDF catalog reference");
  validate(context.trailerInfo.Root!);
  if (context.trailerInfo.Encrypt || context.trailerInfo.ID) invalid("Unsupported PDF trailer fields");
  if (context.trailerInfo.Info) validate(context.trailerInfo.Info);
  let total = 0;
  const add = (amount: number): void => {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > budget.outputBytes - total || total + amount > 9_999_999_999) limit("PDF output byte limit exceeded");
    total += amount;
  };
  const header = "%PDF-1.7\n%\x81\x81\x81\x81\n\n";
  add(header.length);
  const sizes: number[] = []; const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    const [ref, object] = objects[i]!;
    if (ref.objectNumber !== i + 1 || ref.generationNumber !== 0) invalid("Invalid PDF object identity");
    validate(object);
    offsets.push(total);
    add(`${ref.objectNumber} 0 obj\n`.length);
    const size = object.sizeInBytes(); add(size); sizes.push(size);
    add("\nendobj\n\n".length);
    if (i % 64 === 0) await budget.cooperate?.();
  }
  const xrefOffset = total;
  const xrefHeader = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  add(xrefHeader.length + objects.length * 20);
  const xref = xrefHeader + offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  const trailer = `trailer\n<<\n/Size ${objects.length + 1}\n/Root ${context.trailerInfo.Root}` + (context.trailerInfo.Info ? `\n/Info ${context.trailerInfo.Info}` : "") + `\n>>\n\nstartxref\n${xrefOffset}\n%%EOF`;
  add(trailer.length);
  budget.reserveOutput?.(total);
  const output = new Uint8Array(total); let cursor = 0;
  const write = (text: string): void => {for (let i = 0; i < text.length; i++) output[cursor++] = text.charCodeAt(i);};
  write(header);
  for (let i = 0; i < objects.length; i++) {
    const [ref, object] = objects[i]!;
    write(`${ref.objectNumber} 0 obj\n`);
    const size = sizes[i]!;
    // Restrict each primitive to its admitted region and check its byte count.
    const copied = object.copyBytesInto(output.subarray(cursor, cursor + size), 0);
    if (copied !== size) invalid("PDF object size changed during serialization");
    cursor += size; write("\nendobj\n\n");
    if (i % 64 === 0) await budget.cooperate?.();
  }
  write(xref); write(trailer);
  if (cursor !== total) invalid("PDF serialization offset mismatch");
  return output;
}
