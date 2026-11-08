import { cosArray, cosDict, cosName, cosNumber, cosRef, cosStream, dictGet, type PdfCosDict, type PdfCosNode } from "../ast.js";
import { PdfError } from "../errors.js";
import { concatByteArrays, serializeCosNodeBytes, serializeCosNodeChunks, type SerializeCosStreamOptions } from "./writer.js";

export interface LinearizationObject { value: PdfCosNode; streamLength?: number; generationNumber?: number }
type Request = { object: number } | { stream: number };
type Work<T> = Generator<Uint8Array | Request | void, T, LinearizationObject>;

/** Shared layout for buffered and retained writers. Requests read one dictionary
 * at a time; stream payloads are never needed to calculate offsets. */
export function* linearizedOutput(ids: readonly number[], options: Omit<SerializeCosStreamOptions, "objects">): Work<void> {
  const encoder = new TextEncoder(), chunkBytes = options.chunkBytes ?? 65536;
  const inherited = new Map<number, PdfCosDict>(), pages: number[] = [], excluded = new Set<number>();
  const identities = new Set(ids);
  const read = function* (id: number): Work<LinearizationObject> { return yield { object: id }; };
  const resolve = function* (node: PdfCosNode | undefined): Work<PdfCosNode | undefined> {
    const seen = new Set<number>();
    while (node?.kind === "ref") {
      if (seen.has(node.objectNumber)) return undefined;
      seen.add(node.objectNumber); node = (yield* read(node.objectNumber)).value;
    }
    return node;
  };
  const root = (yield* read(options.rootRef.objectNumber)).value;
  if (root.kind !== "dict") throw new PdfError("E_PARSE", "Invalid linearization catalog");
  const visited = new Set<number>();
  function* pageTree(node: PdfCosNode | undefined, attrs: PdfCosDict): Work<void> {
    const id = node?.kind === "ref" ? node.objectNumber : undefined;
    if (id !== undefined) { if (visited.has(id)) return; visited.add(id); }
    node = yield* resolve(node);
    if (node?.kind !== "dict") return;
    const entries = attrs.entries.slice();
    for (const key of ["Resources", "MediaBox", "CropBox", "Rotate"]) {
      const value = dictGet(node, key);
      if (value) { const index = entries.findIndex(entry => entry.key.decoded === key); if (index >= 0) entries.splice(index, 1); entries.push({ key: cosName(key), value }); }
    }
    const type = dictGet(node, "Type");
    if (type?.kind === "name" && type.decoded === "Page" && id !== undefined) {
      pages.push(id); inherited.set(id, { ...node, entries: [...node.entries.filter(entry => !entries.some(attr => attr.key.decoded === entry.key.decoded)), ...entries] }); return;
    }
    const kids = yield* resolve(dictGet(node, "Kids"));
    if (kids?.kind === "array") for (const kid of kids.items) yield* pageTree(kid, { kind: "dict", entries });
  }
  yield* pageTree(dictGet(root, "Pages"), cosDict({}));
  for (const id of ids) {
    const object = yield* read(id), node = object.value;
    if (node.kind !== "dict") continue;
    const type = dictGet(node, "Type");
    if (dictGet(node, "Linearized") || (object.streamLength !== undefined && type?.kind === "name" && ["Hint", "XRef", "ObjStm"].includes(type.decoded))) excluded.add(id);
  }
  if (!pages.length) throw new PdfError("E_CAPABILITY", "Cannot linearize a PDF with no pages");
  function* reachable(start: PdfCosNode, page?: number): Work<Set<number>> {
    const found = new Set<number>(), pending: { node: PdfCosNode; top: boolean }[] = [{ node: start, top: true }];
    while (pending.length) {
      yield;
      const current = pending.pop()!; let node = current.node;
      if (node.kind === "ref") {
        const id = node.objectNumber;
        if (found.has(id) || excluded.has(id) || !identities.has(id)) continue;
        node = inherited.get(id) ?? (yield* read(id)).value;
        const type = node.kind === "dict" ? dictGet(node, "Type") : undefined;
        if (type?.kind === "name" && ((type.decoded === "Page" && !current.top) || (type.decoded === "Pages" && page !== undefined))) continue;
        found.add(id);
      }
      if (node.kind === "array") for (const item of node.items) pending.push({ node: item, top: false });
      if (node.kind === "dict") {
        const type = dictGet(node, "Type"), isPage = type?.kind === "name" && type.decoded === "Page";
        for (const entry of node.entries) if (!(isPage && ["Parent", "Thumb"].includes(entry.key.decoded))) pending.push({ node: entry.value, top: false });
      }
    }
    return found;
  }
  const open = new Set<number>([options.rootRef.objectNumber]);
  for (const key of ["ViewerPreferences", "Threads", "OpenAction", "AcroForm"]) {
    const node = dictGet(root, key); if (node) for (const id of yield* reachable(node)) open.add(id);
  }
  const uses = new Map<number, number[]>(), dependencies: Set<number>[] = [];
  for (const [index, page] of pages.entries()) {
    const found = yield* reachable(cosRef(page), index); dependencies.push(found);
    for (const id of found) if (!open.has(id)) { const owners = uses.get(id) ?? []; owners.push(index); uses.set(id, owners); }
  }
  const groups = pages.map(page => [page]), otherShared: number[] = [];
  for (const id of ids) {
    const owners = uses.get(id);
    if (!owners?.length || id === pages[owners[0]!]) continue;
    if (owners[0] === 0 || owners.length === 1) groups[owners[0]!]!.push(id);
    else otherShared.push(id);
  }
  const outlines = dictGet(root, "Outlines"), mode = dictGet(root, "PageMode");
  const outlineGroup = outlines ? [...(yield* reachable(outlines))].filter(id => !open.has(id) && !uses.has(id)) : [];
  if (mode?.kind === "name" && mode.decoded === "UseOutlines") groups[0]!.push(...outlineGroup);
  const placed = new Set([...open, ...groups.flat(), ...otherShared, ...outlineGroup]);
  const rest = [...outlineGroup.filter(id => !groups[0]!.includes(id)), ...ids.filter(id => !placed.has(id) && !excluded.has(id))];
  // Reserve 1 and 2 for the linearization dictionary and hint stream. This
  // numbering remains stable when an encryption dictionary is appended later.
  const order = [...open, ...groups.flat(), ...otherShared, ...rest];
  const numbers = new Map(order.map((id, index) => [id, index + 3]));
  // Keep page sections and their hints unchanged. Objects in the remaining
  // section can be packed without delaying access to any page. One object per
  // stream bounds retained-writer memory to the object currently being read.
  const packed = new Map<number, number>();
  let size = order.length + 3;
  if (options.objectStreams === "generate" && !options.encryptRef && !options.normalizeContent) {
    for (const id of rest) {
      if (outlineGroup.includes(id)) continue;
      const object = yield* read(id);
      if (object.streamLength === undefined) packed.set(id, size++);
    }
  }
  let frontXrefNumber = 0, mainXrefNumber = 0;
  if (packed.size) {
    let number = 3;
    for (const id of order) if (!packed.has(id)) numbers.set(id, number++);
    for (const id of packed.keys()) packed.set(id, number++);
    frontXrefNumber = number++; mainXrefNumber = number++;
    for (const id of packed.keys()) numbers.set(id, number++);
    size = number;
  }
  if (size - 1 > (options.maxObjects ?? Infinity)) throw new PdfError("E_LIMIT", "PDF largest object number exceeds limit");
  function remap(node: PdfCosNode, depth = 0): PdfCosNode {
    if (depth > (options.maxRecursionDepth ?? Infinity)) throw new PdfError("E_LIMIT", "PDF object graph nesting depth exceeded");
    if (node.kind === "ref") return numbers.has(node.objectNumber) ? cosRef(numbers.get(node.objectNumber)!) : { kind: "null" };
    if (node.kind === "array") return { ...node, items: node.items.map(item => remap(item, depth + 1)) };
    if (node.kind === "dict") {
      const type = dictGet(node, "Type"), isTree = type?.kind === "name" && type.decoded === "Pages";
      return { ...node, entries: node.entries.filter(entry => !(isTree && ["Resources", "MediaBox", "CropBox", "Rotate"].includes(entry.key.decoded))).map(entry => ({ ...entry, value: remap(entry.value, depth + 1) })) };
    }
    return node;
  }
  const shared = [...groups[0]!, ...otherShared], sharedIndex = new Map(shared.map((id, index) => [id, index]));
  const sharedRefs = dependencies.map((set, index) => index === 0 ? [] : [...set].filter(id => (uses.get(id)?.length ?? 0) > 1 && sharedIndex.has(id)).map(id => sharedIndex.get(id)!));
  const lengths = new Map<number, number>(), offsets = new Map<number, number>();
  const nodeBytes = (node: PdfCosNode) => serializeCosNodeBytes(node, 0, options.maxRecursionDepth);
  const prefix = (number: number) => encoder.encode(`${number} 0 obj\n`);
  const suffix = encoder.encode("\nendobj\n\n");
  function packedValue(id: number, value: PdfCosNode): PdfCosNode {
    const head = encoder.encode(`${numbers.get(id)!} 0\n`);
    return cosStream(concatByteArrays([head, nodeBytes(value)]), {
      dict: cosDict({ Type: cosName("ObjStm"), N: cosNumber(1), First: cosNumber(head.length) }), compress: false,
    });
  }
  for (const id of order) {
    const object = yield* read(id);
    let value = remap(inherited.get(id) ?? object.value);
    if (packed.has(id)) value = packedValue(id, value);
    let length = prefix(packed.get(id) ?? numbers.get(id)!).length + suffix.length;
    for (const bytes of serializeCosNodeChunks(value, { chunkBytes, maxRecursionDepth: options.maxRecursionDepth ?? Infinity })) length += bytes.length;
    if (object.streamLength !== undefined) length += 8 + object.streamLength + 10;
    lengths.set(id, length);
  }
  const fixed = (value: number) => ({ ...cosNumber(value), raw: String(value).padStart(10, "0") });
  let total = 0, hintOffset = 0, hintLength = 0, firstEnd = 0, mainXref = 0;
  const linear = () => cosDict({ Linearized: cosNumber(1), L: fixed(total), H: cosArray([fixed(hintOffset), fixed(hintLength)]), O: cosNumber(numbers.get(pages[0]!)!), E: fixed(firstEnd), N: cosNumber(pages.length), T: fixed(packed.size ? mainXref : mainXref + encoder.encode(`xref\n0 ${size}\n`).length - 1) });
  const trailer = (front: boolean) => cosDict({ Size: cosNumber(size), Root: remap(options.rootRef), Info: options.infoRef ? remap(options.infoRef) : undefined, Encrypt: options.encryptRef ? remap(options.encryptRef) : undefined, ID: options.idArray, Prev: front ? fixed(mainXref) : undefined });
  const version = options.version ?? "1.7";
  const header = encoder.encode(`%PDF-${packed.size && Number.parseFloat(version) < 1.5 ? "1.5" : version}\n%\x81\x81\x81\x81\n\n`);
  const frontXref = header.length + prefix(1).length + nodeBytes(linear()).length + suffix.length;
  function xref(front: boolean) {
    if (packed.size) {
      const data = new Uint8Array(size * 7), view = new DataView(data.buffer);
      const entry = (id: number, type: number, offset: number, index = 0) => {
        data[id * 7] = type; view.setUint32(id * 7 + 1, offset); view.setUint16(id * 7 + 5, index);
      };
      entry(0, 0, 0, 65535); entry(1, 1, header.length); entry(2, 1, hintOffset);
      for (const id of order) {
        const container = packed.get(id);
        entry(numbers.get(id)!, container ? 2 : 1, container ?? offsets.get(id) ?? 0);
        if (container) entry(container, 1, offsets.get(id) ?? 0);
      }
      entry(frontXrefNumber, 1, frontXref); entry(mainXrefNumber, 1, mainXref);
      const dict = trailer(front);
      dict.entries.push({ key: cosName("Type"), value: cosName("XRef") }, { key: cosName("W"), value: cosArray([cosNumber(1), cosNumber(4), cosNumber(2)]) });
      return concatByteArrays([prefix(front ? frontXrefNumber : mainXrefNumber), nodeBytes(cosStream(data, { dict, compress: false })), suffix, encoder.encode(`\nstartxref\n${front ? 0 : frontXref}\n%%EOF\n`)]);
    }
    let text = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let number = 1; number < size; number++) text += `${String(number === 1 ? header.length : number === 2 ? hintOffset : offsets.get(order[number - 3]!) ?? 0).padStart(10, "0")} 00000 n \n`;
    return concatByteArrays([encoder.encode(text + "trailer\n"), nodeBytes(trailer(front)), encoder.encode(`\n\nstartxref\n${front ? 0 : frontXref}\n%%EOF\n`)]);
  }
  // Fixed 32-bit columns avoid a size/offset feedback loop. Each column is
  // byte-aligned as required by Annex F; shared signatures are absent.
  const pageHintSize = 36 + pages.length * 16 + sharedRefs.reduce((n, refs) => n + refs.length * 4, 0);
  const outlineOffset = pageHintSize + 24 + shared.length * 4 + Math.ceil(shared.length / 8);
  const hintSize = outlineOffset + (outlineGroup.length ? 16 : 0);
  const hintDict = cosDict({ Type: cosName("Hint"), Length: cosNumber(hintSize), S: cosNumber(pageHintSize), ...(outlineGroup.length ? { O: cosNumber(outlineOffset) } : {}), ...(options.encryptRef ? { Filter: cosName("Crypt"), DecodeParms: cosDict({ Type: cosName("CryptFilterDecodeParms"), Name: cosName("Identity") }) } : {}) });
  hintLength = prefix(2).length + nodeBytes(hintDict).length + 8 + hintSize + 10 + suffix.length;
  let offset = frontXref + xref(true).length;
  for (const id of open) { offsets.set(id, offset); offset += lengths.get(id)!; }
  hintOffset = offset; offset += hintLength;
  for (const id of order) if (!open.has(id)) { offsets.set(id, offset); offset += lengths.get(id)!; if (id === groups[0]!.at(-1)) firstEnd = offset; }
  mainXref = offset; total = offset + xref(false).length;
  if (total > (options.maxOutputBytes ?? Infinity)) throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
  const hints = new Uint8Array(hintSize), view = new DataView(hints.buffer); let at = 0;
  const u32 = (n: number) => { if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new PdfError("E_LIMIT", "PDF linearization hint exceeds 32-bit range"); view.setUint32(at, n); at += 4; }, u16 = (n: number) => { view.setUint16(at, n); at += 2; };
  const adjusted = (n: number) => n >= hintOffset ? n - hintLength : n;
  const pageLengths = groups.map(group => group.reduce((n, id) => n + lengths.get(id)!, 0));
  const minObjects = groups.reduce((n, group) => Math.min(n, group.length), Infinity);
  const minLength = pageLengths.reduce((n, length) => Math.min(n, length), Infinity);
  const minSharedLength = shared.reduce((n, id) => Math.min(n, lengths.get(id)!), Infinity);
  u32(minObjects); u32(adjusted(offsets.get(pages[0]!)!)); u16(32); u32(minLength); u16(32); u32(0); u16(0); u32(minLength); u16(32); u16(32); u16(32); u16(0); u16(1);
  for (const group of groups) u32(group.length - minObjects);
  for (const length of pageLengths) u32(length - minLength);
  for (const refs of sharedRefs) u32(refs.length);
  for (const refs of sharedRefs) for (const id of refs) u32(id);
  // Content length uses the same page section lengths (Acrobat convention).
  for (const length of pageLengths) u32(length - minLength);
  at = pageHintSize;
  u32(otherShared.length ? numbers.get(otherShared[0]!)! : 0); u32(otherShared.length ? adjusted(offsets.get(otherShared[0]!)!) : 0);
  u32(groups[0]!.length); u32(shared.length); u16(0); u32(minSharedLength); u16(32);
  for (const id of shared) u32(lengths.get(id)! - minSharedLength);
  if (outlineGroup.length) {
    at = outlineOffset;
    u32(numbers.get(outlineGroup[0]!)!); u32(adjusted(offsets.get(outlineGroup[0]!)!));
    u32(outlineGroup.length); u32(outlineGroup.reduce((n, id) => n + lengths.get(id)!, 0));
  }
  function* bytes(data: Uint8Array): Work<void> { for (let at = 0; at < data.length; at += chunkBytes) yield data.slice(at, at + chunkBytes); }
  function* object(id: number): Work<void> {
    const value = yield* read(id);
    yield* bytes(prefix(packed.get(id) ?? numbers.get(id)!));
    const node = remap(inherited.get(id) ?? value.value);
    for (const chunk of serializeCosNodeChunks(packed.has(id) ? packedValue(id, node) : node, { chunkBytes, maxRecursionDepth: options.maxRecursionDepth ?? Infinity })) yield chunk;
    if (value.streamLength !== undefined) { yield* bytes(encoder.encode("\nstream\n")); yield { stream: id }; yield* bytes(encoder.encode("\nendstream")); }
    yield* bytes(suffix);
  }
  yield* bytes(header); yield* bytes(prefix(1)); yield* bytes(nodeBytes(linear())); yield* bytes(suffix); yield* bytes(xref(true));
  for (const id of open) yield* object(id);
  yield* bytes(prefix(2)); yield* bytes(nodeBytes(hintDict)); yield* bytes(encoder.encode("\nstream\n")); yield* bytes(hints); yield* bytes(encoder.encode("\nendstream")); yield* bytes(suffix);
  for (const id of order) if (!open.has(id)) yield* object(id);
  yield* bytes(xref(false));
}
