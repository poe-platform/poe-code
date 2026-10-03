import { PagedStorage } from '@poe-code/safe-fs/storage';
import { ZipDirectoryIndex } from '@poe-code/office-package/zip';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import { asciiKey, partName, packageUri } from './package-uri.js';
import { relationshipOwner } from './relationship-owner.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedRelationships } from './retained-relationships.js';
import { resolveRetainedPartReference } from './retained-package-uri.js';
import { RetainedValues, folded, literal } from './retained-values.js';
import type { XmlRange } from './retained-xml.js';
import { resourceContext } from './resource-limits.js';

export interface RetainedRelationshipEdge {
  readonly owner: string;
  readonly external: boolean;
  id(): ByteSource;
  type(): ByteSource;
  target(): ByteSource;
  readonly targetPart: (() => ByteSource) | null;
}
export interface RetainedRelationshipGraph {
  readonly partCount: number;
  readonly relationshipCount: number;
  parts(): AsyncGenerator<string>;
  outgoing(owner: string): AsyncGenerator<RetainedRelationshipEdge>;
  incoming(target: string): AsyncGenerator<RetainedRelationshipEdge>;
  dangling(): AsyncGenerator<RetainedRelationshipEdge>;
  get(owner: string, id: string): Promise<RetainedRelationshipEdge | undefined>;
  closure(roots: Iterable<string> | AsyncIterable<string>): AsyncGenerator<string>;
  close(): Promise<void>;
}
enum P { Next, Name, Length, Present, OutFirst, OutLast, InFirst, InLast, Set, Count }
enum E { Next, OutNext, InNext, Owner, Target, Id, IdLength, Type, TypeLength, Raw, RawLength, Resolved, ResolvedLength, Count }
function missing(): never { throw new OfficeError('missing-binding', 'Relationship owner is absent.', 'index'); }
function invalid(): never { throw new OfficeError('invalid-opc', 'Invalid package relationships.', 'index'); }
function bounded(count: number, limit: number) { if (!Number.isSafeInteger(count) || count > limit) throw new OfficeError('resource-limit', 'Relationship limit exceeded.', 'index'); }

/** Archive admission owns OPC filename/collision checks. This layer owns graph
 * indexes, resolved targets and traversal state, but never closes the archive. */
export async function openRetainedRelationshipGraph(archive: Pick<RetainedPackageArchive, 'parts' | 'read' | 'byteLength'>, settings: RetainedPackageContext): Promise<RetainedRelationshipGraph> {
  const context = resourceContext(settings), working = { ...settings.workingStorage }, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || typeof working.directory !== 'string' || !working.directory.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError('invalid-value', 'Explicit graph working storage and a valid cache budget are required.', 'usage');
  const signal = context.signal ?? new AbortController().signal;
  const storageContext = { fs: working.fs, cwd: working.directory, env: {}, signal };
  const pages = new PagedStorage(storageContext, cacheBytes / 16384);
  let closed = false, closing: Promise<void> | undefined, firstPart = 0, lastPart = 0, firstEdge = 0, lastEdge = 0, partCount = 0, relationshipCount = 0;
  const check = () => {
    if (closed) throw new OfficeError('invalid-handle', 'Relationship graph is closed.', 'index');
    if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index');
  };
  const failure = (error: unknown): unknown => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Relationship graph storage operation failed.', 'index');
  const close = () => { closed = true; return closing ??= pages.close(); };
  const values = new RetainedValues(pages, check, signal);
  async function row(pointer: number, size: number): Promise<number[]> {
    check(); const bytes = await pages.read(pointer, size * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: size }, (_, n) => view.getFloat64(n * 8, true));
  }
  async function write(pointer: number, data: number[]) {
    check(); const bytes = new Uint8Array(data.length * 8), view = new DataView(bytes.buffer);
    data.forEach((value, n) => view.setFloat64(n * 8, value, true)); await pages.write(pointer, bytes);
  }
  async function link(pointer: number, field: number, target: number) { await write(pointer + field * 8, [target]); }
  const range = (data: number[], field: number): XmlRange => ({ start: data[field]!, length: data[field + 1]! });
  async function* read(value: XmlRange): ByteSource { try { yield* values.read(value); } catch (error) { throw failure(error); } }
  async function name(pointer: number): Promise<string> {
    const part = await row(pointer, P.Count); if (!part[P.Present]) missing();
    // Present names originate in admitted ZIP headers, whose length is bounded.
    const decoder = new TextDecoder(); let result = '';
    for await (const bytes of values.read(range(part, P.Name))) result += decoder.decode(bytes, { stream: true });
    return result + decoder.decode();
  }
  async function bucket(value: XmlRange, present: boolean): Promise<number> {
    const found = await values.find('part', () => folded(values.read(value)));
    if (found) { if (present) invalid(); return found.start; }
    const key = await values.store(folded(values.read(value))), pointer = pages.allocate(P.Count * 8), data = new Array<number>(P.Count).fill(0);
    data[P.Name] = value.start; data[P.Length] = value.length; data[P.Present] = Number(present); await write(pointer, data);
    await values.insert('part', key, { start: pointer, length: P.Count * 8 }); return pointer;
  }
  async function owner(input: string): Promise<number> {
    const key = input === '/' ? '/' : asciiKey(partName(input, false));
    const found = await values.find('part', () => literal(key)); if (!found || !(await row(found.start, P.Count))[P.Present]) missing(); return found.start;
  }
  async function edge(pointer: number): Promise<RetainedRelationshipEdge> {
    const data = await row(pointer, E.Count), target = data[E.Target] ? await row(data[E.Target]!, P.Count) : undefined;
    const resolved = target?.[P.Present] ? range(target, P.Name) : range(data, E.Resolved);
    return Object.freeze({ owner: await name(data[E.Owner]!), external: !target,
      id: () => read(range(data, E.Id)), type: () => read(range(data, E.Type)), target: () => read(range(data, E.Raw)),
      targetPart: target ? () => read(resolved) : null });
  }
  try {
    const root = await bucket(await values.store(literal('/')), true);
    for await (const input of archive.parts()) {
      check(); const normalized = partName(input, false);
      if (asciiKey(normalized) === '/[content_types].xml' || relationshipOwner(normalized) !== null) continue;
      bounded(++partCount, context.relationshipLimits.maxParts);
      const pointer = await bucket(await values.store(literal(normalized)), true);
      if (lastPart) await link(lastPart, P.Next, pointer); else firstPart = pointer; lastPart = pointer;
    }
    let bytesRead = 0, sets = 0;
    for await (const path of archive.parts()) {
      check(); const inputOwner = relationshipOwner(path); if (inputOwner === null) continue;
      bounded(++sets, context.relationshipLimits.maxParts + 1);
      bytesRead += await archive.byteLength(path); bounded(bytesRead, context.relationshipLimits.maxBytes);
      const ownerPointer = inputOwner === '/' ? root : await owner(inputOwner), ownerPart = await row(ownerPointer, P.Count);
      if (ownerPart[P.Set]) invalid(); await link(ownerPointer, P.Set, 1);
      const ownerName = await name(ownerPointer), base = packageUri(ownerName).baseURI;
      const relationships = await openRetainedRelationships(archive.read(path), { ...context, workingStorage: working });
      let failed = false;
      try {
        for await (const relationship of relationships.records()) {
          bounded(++relationshipCount, context.relationshipLimits.maxRelationships);
          const id = await values.store(relationship.id()), type = await values.store(relationship.type()), raw = await values.store(relationship.target());
          const resolved = relationship.external ? { start: 0, length: 0 } : await resolveRetainedPartReference(base, values.read(raw), pages, values);
          const target = relationship.external ? 0 : await bucket(resolved, false), pointer = pages.allocate(E.Count * 8), data = new Array<number>(E.Count).fill(0);
          const ownerData = await row(ownerPointer, P.Count);
          data[E.Owner] = ownerPointer; data[E.Target] = target;
          data[E.Id] = id.start; data[E.IdLength] = id.length; data[E.Type] = type.start; data[E.TypeLength] = type.length;
          data[E.Raw] = raw.start; data[E.RawLength] = raw.length; data[E.Resolved] = resolved.start; data[E.ResolvedLength] = resolved.length;
          await write(pointer, data);
          if (!await values.insert(`edge${ownerPointer}`, id, { start: pointer, length: E.Count * 8 })) invalid();
          if (lastEdge) await link(lastEdge, E.Next, pointer); else firstEdge = pointer; lastEdge = pointer;
          if (ownerData[P.OutLast]) await link(ownerData[P.OutLast]!, E.OutNext, pointer); else await link(ownerPointer, P.OutFirst, pointer);
          await link(ownerPointer, P.OutLast, pointer);
          if (target) {
            const targetData = await row(target, P.Count);
            if (targetData[P.InLast]) await link(targetData[P.InLast]!, E.InNext, pointer); else await link(target, P.InFirst, pointer);
            await link(target, P.InLast, pointer);
          }
        }
      } catch (error) { failed = true; throw error; }
      finally { try { await relationships.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
    }
    return Object.freeze({ partCount, relationshipCount, close,
      async *parts() { try { check(); for (let pointer = firstPart; pointer;) { yield await name(pointer); pointer = (await row(pointer, P.Count))[P.Next]!; } } catch (error) { throw failure(error); } },
      async *outgoing(input: string) {
        try { for (let pointer = (await row(await owner(input), P.Count))[P.OutFirst]!; pointer;) { yield await edge(pointer); pointer = (await row(pointer, E.Count))[E.OutNext]!; } }
        catch (error) { throw failure(error); }
      },
      async *incoming(input: string) {
        try {
          check(); const key = asciiKey(partName(input, false)), found = await values.find('part', () => literal(key));
          if (found) for (let pointer = (await row(found.start, P.Count))[P.InFirst]!; pointer;) { yield await edge(pointer); pointer = (await row(pointer, E.Count))[E.InNext]!; }
        } catch (error) { throw failure(error); }
      },
      async *dangling() {
        try { check(); for (let pointer = firstEdge; pointer;) { const data = await row(pointer, E.Count); if (data[E.Target] && !(await row(data[E.Target]!, P.Count))[P.Present]) yield await edge(pointer); pointer = data[E.Next]!; } }
        catch (error) { throw failure(error); }
      },
      async get(input: string, id: string) {
        try { const pointer = await owner(input), found = await values.find(`edge${pointer}`, () => literal(id)); return found ? await edge(found.start) : undefined; }
        catch (error) { throw failure(error); }
      },
      async *closure(roots: Iterable<string> | AsyncIterable<string>) {
        const scratch = new PagedStorage(storageContext, cacheBytes / 16384), visited = new ZipDirectoryIndex(scratch, { signal }); let failed = false;
        async function save(pointer: number, data: number[]) {
          check(); const bytes = new Uint8Array(data.length * 8), view = new DataView(bytes.buffer); data.forEach((value, n) => view.setFloat64(n * 8, value, true)); await scratch.write(pointer, bytes);
        }
        async function load(pointer: number) {
          check(); const bytes = await scratch.read(pointer, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return [view.getFloat64(0, true), view.getFloat64(8, true), view.getFloat64(16, true)];
        }
        try {
          check(); let first = 0, last = 0, count = 0;
          for await (const input of roots) {
            bounded(++count, context.relationshipLimits.maxParts); const part = await owner(input), pointer = scratch.allocate(24);
            await save(pointer, [0, part, 0]); if (last) await save(last, [pointer]); else first = pointer; last = pointer;
          }
          for (let rootPointer = first; rootPointer;) {
            const rootData = await load(rootPointer); let top = 0;
            const push = async (part: number) => {
              if (await visited.get(String(part))) return false;
              const data = await row(part, P.Count); if (!data[P.Present]) missing(); await visited.set(String(part), 1);
              const pointer = scratch.allocate(24); await save(pointer, [top, part, data[P.OutFirst]!]); top = pointer; return true;
            };
            if (await push(rootData[1]!) && rootData[1] !== root) yield await name(rootData[1]!);
            while (top) {
              const frame = await load(top);
              if (!frame[2]) { top = frame[0]!; continue; }
              const data = await row(frame[2]!, E.Count); await save(top, [frame[0]!, frame[1]!, data[E.OutNext]!]);
              if (data[E.Target] && await push(data[E.Target]!)) yield await name(data[E.Target]!);
            }
            rootPointer = rootData[0]!;
          }
        } catch (error) { failed = true; throw failure(error); }
        finally { try { await scratch.close(); } catch (error) { if (!failed) await Promise.reject(failure(error)); } }
      }
    });
  } catch (error) { await close().catch(() => {}); throw failure(error); }
}
