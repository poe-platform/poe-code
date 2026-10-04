import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedRelationshipGraph, type RetainedRelationshipEdge } from './retained-relationship-graph.js';
import { openRetainedContentTypes } from './retained-content-types.js';
import { RetainedValues, literal, folded, equal, digest, characters } from './retained-values.js';
import { RetainedOrder } from './retained-order.js';
import type { XmlRange } from './retained-xml.js';
import { resourceContext } from './resource-limits.js';
import { dialects } from './validation-schema.js';

export interface RetainedPartInventory {
  readonly part: string;
  readonly contentType: (() => ByteSource) | null;
  readonly bytes: number;
  readonly sha256: string;
}
export interface RetainedPackageInventory {
  readonly counts: { readonly parts: number; readonly media: number; readonly masters: number; readonly layouts: number; readonly themes: number };
  parts(): AsyncGenerator<RetainedPartInventory>;
  media(): AsyncGenerator<RetainedPartInventory>;
  relationships(): AsyncGenerator<RetainedRelationshipEdge>;
  targets(kind: 'slideMaster' | 'slideLayout' | 'theme'): AsyncGenerator<ByteSource>;
  unsupported(): AsyncGenerator<{ readonly part: string; reason(): ByteSource }>;
  close(): Promise<void>;
}
enum P { Name, NameLength, Type, TypeLength, Bytes, Hash, HashLength, Media, Count }
enum E { Owner, OwnerLength, Id, IdLength, Type, TypeLength, Raw, RawLength, Target, TargetLength, External, Present, Count }
const targetKinds = ['slideMaster', 'slideLayout', 'theme'] as const;
async function* joined(...sources: ByteSource[]): ByteSource { for (const source of sources) yield* source; }

/** Package metadata only. Presentation/style and diagram semantic consumers must
 * still run before a caller claims to have a complete presentation inventory. */
export async function openRetainedPackageInventory(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  settings: RetainedPackageContext
): Promise<RetainedPackageInventory> {
  const context = resourceContext(settings), working = { ...settings.workingStorage }, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || !working.directory?.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError('invalid-value', 'Explicit inventory storage and a valid cache budget are required.', 'usage');
  const signal = context.signal ?? new AbortController().signal;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  let closed = false, closing: Promise<void> | undefined;
  const check = () => {
    if (closed) throw new OfficeError('invalid-handle', 'Package inventory is closed.', 'index');
    if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index');
  };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Inventory storage operation failed.', 'index');
  const close = () => { closed = true; return closing ??= pages.close(); };
  const values = new RetainedValues(pages, check, signal), names = new RetainedOrder(pages, values, check), edges = new RetainedOrder(pages, values, check);
  const targets = targetKinds.map(() => new RetainedOrder(pages, values, check)), targetCounts = [0, 0, 0];
  let partCount = 0, mediaCount = 0;
  const range = (data: number[], field: number): XmlRange => ({ start: data[field]!, length: data[field + 1]! });
  async function row(pointer: number, count: number) {
    check(); const bytes = await pages.read(pointer, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: count }, (_, n) => view.getFloat64(n * 8, true));
  }
  async function write(pointer: number, data: number[]) {
    check(); const bytes = new Uint8Array(data.length * 8), view = new DataView(bytes.buffer);
    data.forEach((value, n) => view.setFloat64(n * 8, value, true)); await pages.write(pointer, bytes);
  }
  async function* read(value: XmlRange): ByteSource { try { yield* values.read(value); } catch (error) { throw failure(error); } }
  // Names originate in bounded ZIP headers; hashes always have 64 ASCII bytes.
  async function boundedText(value: XmlRange) {
    const decoder = new TextDecoder(); let result = '';
    for await (const bytes of read(value)) result += decoder.decode(bytes, { stream: true });
    return result + decoder.decode();
  }
  async function hasType(edge: RetainedRelationshipEdge, kind: string) {
    for (const d of dialects) if (await equal(edge.type(), literal(`${d.r}/${kind}`))) return true;
    return false;
  }
  let graph: Awaited<ReturnType<typeof openRetainedRelationshipGraph>> | undefined, content: Awaited<ReturnType<typeof openRetainedContentTypes>> | undefined;
  try {
    // Metadata SAX admission did not consume presentation XML node/depth budgets.
    const metadata = { ...context, workingStorage: working, xmlLimits: { maxBytes: context.relationshipLimits.maxBytes, maxNodes: Infinity, maxDepth: Infinity } };
    graph = await openRetainedRelationshipGraph(archive, metadata);
    if (await archive.has('/[Content_Types].xml')) content = await openRetainedContentTypes(archive.read('/[Content_Types].xml'), {
      ...metadata, xmlLimits: { ...metadata.xmlLimits, maxBytes: context.xmlLimits.maxBytes }
    }, { maxBytes: context.xmlLimits.maxBytes, maxEntries: context.relationshipLimits.maxParts });
    for await (const name of archive.parts()) {
      const key = await values.store(folded(literal(name))); await values.insert('present', key, key);
    }
    async function* owners() { yield '/'; yield* graph!.parts(); }
    for await (const owner of owners()) for await (const edge of graph.outgoing(owner)) {
      const ownerRange = await values.store(literal(owner)), id = await values.store(edge.id()), type = await values.store(edge.type()), raw = await values.store(edge.target());
      const target = edge.targetPart ? await values.store(edge.targetPart()) : { start: 0, length: 0 };
      const present = !!target.start && !!await values.find('present', () => folded(read(target)));
      const pointer = pages.allocate(E.Count * 8);
      await write(pointer, [ownerRange.start, ownerRange.length, id.start, id.length, type.start, type.length, raw.start, raw.length, target.start, target.length, Number(edge.external), Number(present)]);
      // Part names cannot contain NUL; this composite key orders by owner first,
      // then by ID, exactly like the buffered inventory's two stable sorts.
      await edges.add(joined(read(ownerRange), literal('\0'), read(id)), { start: pointer, length: E.Count * 8 });
      if (target.start) {
        for (const kind of ['image', 'audio', 'video', 'media']) if (await hasType(edge, kind)) { await values.insert('media', target, target); break; }
        if (present) for (const [i, kind] of targetKinds.entries()) if (await hasType(edge, kind) && await values.insert(`target:${kind}`, target, target)) {
          await targets[i]!.add(read(target), target); targetCounts[i]!++;
        }
      }
    }
    for await (const name of graph.parts()) {
      const key = await values.store(literal(name)); let type: XmlRange | undefined;
      if (content) try { type = await values.store(await content.get(name)); }
      catch (error) { if (!(error instanceof OfficeError) || error.code !== 'missing-binding') throw error; }
      let media = !!await values.find('media', () => literal(name));
      if (!media && type) {
        let prefix = '';
        for await (const character of characters(read(type))) { prefix += character.toLowerCase(); if (prefix.length >= 6 || character === '/') break; }
        media = ['image/', 'audio/', 'video/'].includes(prefix);
      }
      const hash = await values.store(literal(await digest(archive.read(name)))), size = await archive.byteLength(name), pointer = pages.allocate(P.Count * 8);
      await write(pointer, [key.start, key.length, type?.start ?? 0, type?.length ?? 0, size, hash.start, hash.length, Number(media)]);
      await names.add(read(key), { start: pointer, length: P.Count * 8 }); partCount++; if (media) mediaCount++;
    }
    await names.seal(); await edges.seal(); for (const target of targets) await target.seal();
    const retired = await Promise.allSettled([content?.close(), graph.close()]); content = undefined; graph = undefined;
    for (const result of retired) if (result.status === 'rejected') throw result.reason;
    check();
    async function* parts(mediaOnly = false): AsyncGenerator<RetainedPartInventory> {
      try { check(); for await (const entry of names.entries()) {
        const data = await row(entry.start, P.Count); if (mediaOnly && !data[P.Media]) continue;
        yield Object.freeze({ part: await boundedText(range(data, P.Name)), bytes: data[P.Bytes]!, sha256: await boundedText(range(data, P.Hash)), contentType: data[P.Type] ? () => read(range(data, P.Type)) : null });
      } } catch (error) { throw failure(error); }
    }
    return Object.freeze({ close, parts, media: () => parts(true), counts: Object.freeze({ parts: partCount, media: mediaCount, masters: targetCounts[0]!, layouts: targetCounts[1]!, themes: targetCounts[2]! }),
      async *relationships() {
        try { check(); for await (const entry of edges.entries()) {
          const data = await row(entry.start, E.Count);
          yield Object.freeze({ owner: await boundedText(range(data, E.Owner)), external: !!data[E.External], id: () => read(range(data, E.Id)), type: () => read(range(data, E.Type)), target: () => read(range(data, E.Raw)), targetPart: data[E.Target] ? () => read(range(data, E.Target)) : null });
        } } catch (error) { throw failure(error); }
      },
      async *targets(kind: (typeof targetKinds)[number]) {
        try { check(); const index = targetKinds.indexOf(kind); if (index < 0) throw new OfficeError('invalid-value', 'Unknown inventory target kind.', 'usage');
          for await (const target of targets[index]!.entries()) yield read(target);
        } catch (error) { throw failure(error); }
      },
      async *unsupported() {
        try {
          check(); for await (const entry of names.entries()) {
            const data = await row(entry.start, P.Count), part = await boundedText(range(data, P.Name));
            if (!data[P.Type]) yield Object.freeze({ part, reason: () => literal('content-type-unavailable') });
            yield Object.freeze({ part, reason: () => literal('semantic-content-not-inspected') });
          }
          for await (const entry of edges.entries()) {
            const data = await row(entry.start, E.Count), prefix = data[E.External] ? 'external-relationship:' : data[E.Target] && !data[E.Present] ? 'missing-relationship-target:' : null;
            if (prefix) yield Object.freeze({ part: await boundedText(range(data, E.Owner)), reason: () => joined(literal(prefix), read(range(data, E.Id))) });
          }
        } catch (error) { throw failure(error); }
      }
    });
  } catch (error) { await Promise.allSettled([content?.close(), graph?.close(), close()]); throw failure(error); }
}
