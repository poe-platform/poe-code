import { cosArray, cosNumber, dictGet, type PdfCosDict, type PdfCosNode, type PdfCosRef } from "../ast.js";
import { multiplyMatrices } from "../content/evaluator.js";
import { PdfOperandStack } from "../content/operand-stack.js";
import { parseContentRangeOperators } from "../content/range-operator-parser.js";
import { decodePdfStreamChunks } from "../cos/filter-stream.js";
import { PdfNameIndex } from "../cos/name-index.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument, PdfRetainedValue } from "../retained-document.js";
import { PdfFileSource } from "../source.js";

type Matrix = [number, number, number, number, number, number];
export interface PdfImageSelection { readonly firstPage?: number; readonly lastPage?: number }
/** A lazy occurrence. Consume its payload before advancing the image iterator.
 * Neither decoded pixels nor encoded image bytes are retained by the occurrence. */
export interface PdfRetainedImage {
  readonly pageNumber: number;
  readonly imageIndex: number;
  readonly dict: PdfCosDict;
  readonly resources: PdfCosDict;
  readonly matrix: Readonly<Matrix>;
  readonly reference?: PdfCosRef;
  readonly inline: boolean;
  readonly byteLength: number;
  contents(options?: { native?: boolean; raw?: boolean }): AsyncGenerator<Uint8Array, void, void>;
}

export async function* walkRetainedImages(document: PdfRetainedDocument, storage: PdfIndexStorage, options: PdfImageSelection & {
  maxDepth: number; maxStagingBytes?: number; chunkBytes?: number; maxDecodedBytes?: number; signal?: AbortSignal;
}): AsyncGenerator<PdfRetainedImage, void, void> {
  const first = options.firstPage ?? 1; const last = options.lastPage ?? Infinity;
  if (!Number.isSafeInteger(first) || first < 1 || (last !== Infinity && (!Number.isSafeInteger(last) || last < first))) throw new RangeError("Invalid PDF image page range");
  const chunkBytes = Math.max(8, options.chunkBytes ?? 4096);
  const maximum = options.maxStagingBytes ?? Infinity;
  const decodeOptions = { chunkBytes, ...(options.maxDecodedBytes === undefined ? {} : { maxDecodedBytes: options.maxDecodedBytes }), ...(options.signal ? { signal: options.signal } : {}) };
  let imageIndex = 0; let stagedBytes = 0;
  async function dictionary(node: PdfCosNode | undefined) {
    const value = await document.lookup(node);
    return value?.value.kind === "dict" && !value.stream ? value.value : undefined;
  }
  async function number(node: PdfCosNode | undefined, fallback: number) {
    const value = (await document.lookup(node))?.value;
    return value?.kind === "number" ? value.value : fallback;
  }
  for await (const page of document.pages()) {
    if (page.index + 1 < first) continue;
    if (page.index + 1 > last) break;
    const resources = (await page.attributes()).resources;
    const seen = new PdfNameIndex(storage, () => maximum - stagedBytes, options.signal);
    let failed = false;
    async function* occurrence(dict: PdfCosDict, activeResources: PdfCosDict, matrix: Matrix, length: number,
      read: (native: boolean, raw: boolean) => AsyncIterable<Uint8Array>, reference?: PdfCosRef, inline = false): AsyncGenerator<PdfRetainedImage, void, void> {
      for (const key of ["SMask", "Mask"]) {
        const mask = dictGet(dict, key);
        if (mask?.kind === "ref") await seen.intern(`${mask.objectNumber}:${mask.generationNumber}`);
      }
      let alive = true;
      function check() { options.signal?.throwIfAborted(); if (!alive) throw new PdfError("E_CAPABILITY", "PDF image occurrence expired"); }
      try {
        yield { pageNumber: page.index + 1, imageIndex: imageIndex++, dict, resources: activeResources, matrix: [...matrix], byteLength: length, inline,
          ...(reference ? { reference } : {}),
          async *contents(selection = {}) {
            check();
            for await (const chunk of read(selection.native ?? false, selection.raw ?? false)) { check(); yield chunk; }
          },
        };
      } finally { alive = false; }
    }
    async function* image(value: PdfRetainedValue, activeResources: PdfCosDict, matrix: Matrix): AsyncGenerator<PdfRetainedImage, void, void> {
      if (value.value.kind !== "dict" || !value.stream || !value.reference) return;
      const ref = value.reference;
      yield* occurrence(value.value, activeResources, matrix, value.stream.end - value.stream.start,
        (native, raw) => document.objects.decodeStream(ref.objectNumber, ref.generationNumber, { stopBeforeImageCodec: native, raw }), ref);
    }
    async function* content(input: AsyncIterable<Uint8Array>, activeResources: PdfCosDict, initial: Matrix,
      active: Set<number>, depth: number): AsyncGenerator<PdfRetainedImage, void, void> {
      options.signal?.throwIfAborted();
      if (depth > options.maxDepth) throw new PdfError("E_LIMIT", "PDF image form depth limit exceeded");
      const source = await PdfFileSource.fromStream(storage.fs, storage.directory, input, {
        ...decodeOptions, cacheBytes: chunkBytes, maxInputBytes: Math.max(0, maximum - stagedBytes - seen.stagedBytes),
      });
      stagedBytes += source.size;
      const stack = new PdfOperandStack(storage, { chunkBytes, maxStagingBytes: maximum,
        maxNodes: 7, maxDepth: 2, maxTokenBytes: 256, ...(options.signal ? { signal: options.signal } : {}) });
      let matrix: Matrix = [...initial]; let failed = false;
      try {
        for await (const op of parseContentRangeOperators(source, storage, { ...decodeOptions, maxStagingBytes: maximum })) {
          if (op.operator === "q") await stack.push(cosArray(matrix.map(n => cosNumber(n))));
          else if (op.operator === "Q") {
            const saved = await stack.pop();
            if (saved?.kind === "array") matrix = saved.items.map(n => n.kind === "number" ? n.value : 0) as Matrix;
          } else if (op.operator === "cm" && op.operands.length >= 6) {
            const transform = op.operands.slice(0, 6).map(n => n.kind === "number" ? n.value : 0) as Matrix;
            matrix = multiplyMatrices(transform, matrix);
          } else if (op.inlineImage) {
            const { dict, start, end } = op.inlineImage;
            yield* occurrence(dict, activeResources, matrix, end - start,
              (native, raw) => decodePdfStreamChunks(dict, () => source.stream(start, end - start, options.signal), { ...decodeOptions, stopBeforeImageCodec: native, raw }), undefined, true);
          } else if (op.operator === "Do") {
            const name = op.operands[0]; if (name?.kind !== "name") continue;
            const objects = await dictionary(dictGet(activeResources, "XObject"));
            const target = await document.lookup(objects ? dictGet(objects, name.decoded) : undefined);
            if (target?.value.kind !== "dict" || !target.stream || !target.reference) continue;
            const subtype = (await document.lookup(dictGet(target.value, "Subtype")))?.value;
            if (subtype?.kind !== "name") continue;
            const ref = target.reference;
            if (subtype.decoded === "Image") {
              await seen.intern(`${ref.objectNumber}:${ref.generationNumber}`);
              yield* image(target, activeResources, matrix);
            } else if (subtype.decoded === "Form" && !active.has(ref.objectNumber)) {
              const formMatrix = (await document.lookup(dictGet(target.value, "Matrix")))?.value;
              let transform: Matrix = [...matrix];
              if (formMatrix?.kind === "array" && formMatrix.items.length >= 6) {
                const values: Matrix = [1, 0, 0, 1, 0, 0];
                for (let i = 0; i < 6; i++) values[i] = await number(formMatrix.items[i], values[i]!);
                transform = multiplyMatrices(values, matrix);
              }
              active.add(ref.objectNumber);
              try {
                yield* content(document.objects.decodeStream(ref.objectNumber, ref.generationNumber),
                  await dictionary(dictGet(target.value, "Resources")) ?? activeResources, transform, active, depth + 1);
              } finally { active.delete(ref.objectNumber); }
            }
          }
        }
      } catch (error) { failed = true; throw error; }
      finally {
        const results = await Promise.allSettled([stack.close(), source.close()]); stagedBytes -= source.size;
        if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
      }
    }
    const identity: Matrix = [1, 0, 0, 1, 0, 0];
    async function* auxiliary(node: PdfCosNode | undefined, inherited: PdfCosDict, depth = 0): AsyncGenerator<PdfRetainedImage, void, void> {
      if (depth > options.maxDepth) throw new PdfError("E_LIMIT", "PDF image appearance depth limit exceeded");
      const value = await document.lookup(node);
      if (value?.value.kind !== "dict") return;
      if (value.stream && value.reference) {
        yield* content(document.objects.decodeStream(value.reference.objectNumber, value.reference.generationNumber),
          await dictionary(dictGet(value.value, "Resources")) ?? inherited, identity, new Set([value.reference.objectNumber]), 0);
      } else for (const entry of value.value.entries) yield* auxiliary(entry.value, inherited, depth + 1);
    }
    try {
      yield* content(page.streamContents(), resources, identity, new Set(), 0);
      const patterns = await dictionary(dictGet(resources, "Pattern"));
      if (patterns) for (const entry of patterns.entries) yield* auxiliary(entry.value, resources);
      const fonts = await dictionary(dictGet(resources, "Font"));
      if (fonts) for (const entry of fonts.entries) {
        const font = await dictionary(entry.value); if (!font) continue;
        const subtype = (await document.lookup(dictGet(font, "Subtype")))?.value;
        if (subtype?.kind !== "name" || subtype.decoded !== "Type3") continue;
        const procedures = await dictionary(dictGet(font, "CharProcs"));
        const inherited = await dictionary(dictGet(font, "Resources")) ?? resources;
        if (procedures) for (const entry of procedures.entries) yield* auxiliary(entry.value, inherited);
      }
      const annotations = (await document.lookup(dictGet(page.dict, "Annots")))?.value;
      if (annotations?.kind === "array") for (const node of annotations.items) {
        const annotation = await dictionary(node);
        const appearance = annotation ? await dictionary(dictGet(annotation, "AP")) : undefined;
        if (appearance) yield* auxiliary(dictGet(appearance, "N"), resources);
      }
      const objects = await dictionary(dictGet(resources, "XObject"));
      if (objects) for (const entry of objects.entries) {
        const ref = entry.value;
        if (ref.kind === "ref" && !(await seen.intern(`${ref.objectNumber}:${ref.generationNumber}`)).added) continue;
        const target = await document.lookup(ref);
        if (target?.value.kind !== "dict" || !target.stream) continue;
        const subtype = (await document.lookup(dictGet(target.value, "Subtype")))?.value;
        if (subtype?.kind === "name" && subtype.decoded === "Image") yield* image(target, resources,
          [await number(dictGet(target.value, "Width") ?? dictGet(target.value, "W"), 1), 0, 0,
            await number(dictGet(target.value, "Height") ?? dictGet(target.value, "H"), 1), 0, 0]);
      }
    } catch (error) { failed = true; throw error; }
    finally { await seen.close().catch(error => { if (!failed) throw error; }); }
  }
}
