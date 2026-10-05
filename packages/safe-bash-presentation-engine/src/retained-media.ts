import { PagedStorage } from "@poe-code/safe-fs/storage";
import { sha1 } from "@noble/hashes/legacy.js";
import { validateMediaOptions, type ReadMediaOptions } from "./media.js";
import type { ByteSource, Location } from "./contracts.js";
import type { RetainedPackageArchive, RetainedPackageContext } from "./retained-package.js";
import type { RetainedSelectionRecord } from "./retained-selection.js";
import type { RetainedRelationshipEdge } from "./retained-relationship-graph.js";
import { OfficeError } from "./errors.js";
import { SelectionError } from "./selectors.js";
import { resourceContext } from "./resource-limits.js";
import { openRetainedPresentationIndex } from "./retained-inspection.js";
import { openRetainedXmlDocument, type RetainedXmlNode } from "./retained-xml-document.js";
import { openRetainedCompatibility } from "./retained-compatibility.js";
import { equationOpaqueElements } from "./equations-compatibility.js";
import { dialects } from "./validation-schema.js";
import { RetainedValues, equal, literal } from "./retained-values.js";
import { RetainedOrder } from "./retained-order.js";
import { rawJson, streamJson, stageRetainedOutput, type StagedOutput } from "./retained-output.js";
import type { XmlRange } from "./retained-xml.js";
type Archive = Pick<RetainedPackageArchive, "parts" | "has" | "read" | "byteLength">;
const mediaNamespace = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const mediaRelationship = "http://schemas.microsoft.com/office/2007/relationships/media";
const tracksNamespace = "http://schemas.microsoft.com/office/powerpoint/2017/3/main";
async function* joined(...sources: ByteSource[]): ByteSource {
  for (const source of sources) yield* source;
}
async function relationshipKind(edge: RetainedRelationshipEdge) {
  for (const kind of ["audio", "video"] as const)
    for (const d of dialects) if (await equal(edge.type(), literal(d.r + "/" + kind))) return kind;
  return (await equal(edge.type(), literal(mediaRelationship))) ? "unknown" : null;
}
export class RetainedMediaSelectionError extends OfficeError {
  constructor(
    code: "missing-selection" | "ambiguous-selection",
    readonly candidates: () => AsyncIterable<Location>,
    readonly close: () => Promise<void>
  ) {
    super(code, new SelectionError(code).message, "select");
  }
}
/** Complete media admission into caller-owned records; the archive is borrowed. */
export async function openRetainedMedia(
  archive: Archive,
  fingerprint: string,
  input: ReadMediaOptions,
  settings: RetainedPackageContext
) {
  validateMediaOptions(input);
  const options = { ...input };
  const context = { ...resourceContext(settings), workingStorage: { ...settings.workingStorage } },
    signal = context.signal ?? new AbortController().signal;
  const index = await openRetainedPresentationIndex(archive, fingerprint, context);
  const storage = () =>
    new PagedStorage(
      { fs: context.workingStorage.fs, cwd: context.workingStorage.directory, env: {}, signal },
      (context.workingStorage.cacheBytes ?? 1024 * 1024) / 16384
    );
  const pages = storage(),
    outputPages = storage();
  let closed = false,
    closing: Promise<void> | undefined,
    head = 0,
    tail = 0,
    resourceHead = 0,
    resourceTail = 0,
    mediaHead = 0,
    mediaTail = 0,
    count = 0;
  const check = () => {
    if (closed) throw new OfficeError("invalid-handle", "Media inventory is closed.", "index");
    if (signal.aborted) throw new OfficeError("cancelled", "Operation cancelled.", "index");
  };
  const close = () => {
    closed = true;
    return (closing ??= (async () => {
      const results = await Promise.allSettled([index.close(), pages.close(), outputPages.close()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    })());
  };
  const failure = (error: unknown) =>
    error instanceof OfficeError
      ? error
      : new OfficeError(
          signal.aborted ? "cancelled" : "io-failure",
          "Media storage operation failed.",
          "index"
        );
  const values = new RetainedValues(pages, check, signal),
    output = new RetainedValues(outputPages, check, signal);
  const owners = new RetainedOrder(pages, values, check),
    mediaParts = new RetainedOrder(pages, values, check);
  async function text(range: XmlRange) {
    let value = "";
    const decoder = new TextDecoder();
    for await (const bytes of values.read(range)) value += decoder.decode(bytes, { stream: true });
    return value + decoder.decode();
  }
  async function write(pointer: number, row: number[]) {
    const bytes = new Uint8Array(row.length * 8),
      view = new DataView(bytes.buffer);
    row.forEach((n, i) => view.setFloat64(i * 8, n, true));
    await pages.write(pointer, bytes);
  }
  async function row(pointer: number, length: number) {
    check();
    const bytes = await pages.read(pointer, length * 8),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length }, (_, i) => view.getFloat64(i * 8, true));
  }
  async function mark(scope: string, key: ByteSource) {
    const stored = await values.store(key);
    return values.insert(scope, stored, stored);
  }
  async function part(source: () => ByteSource) {
    const stored = await values.find("parts", source);
    return stored
      ? (JSON.parse(await text(stored)) as {
          part: string;
          bytes: number;
          sha256: string;
          contentType: XmlRange | null;
        })
      : undefined;
  }
  const content = (info: { contentType: XmlRange | null }) =>
    info.contentType ? () => values.read(info.contentType!) : null;
  let selectedObjects = false;
  try {
    for await (const info of index.inventory.parts) {
      const type = info.contentType ? await values.store(info.contentType()) : null;
      const key = await values.store(literal(info.part)),
        value = await values.store(literal(JSON.stringify({ ...info, contentType: type })));
      await values.insert("parts", key, value);
    }
    if (options.select)
      for await (const record of index.records.select({ token: options.select })) {
        await mark("selectedPart", literal(record.part));
        await mark(
          record.kind === "object" ? "selectedObject" : "selectedWhole",
          literal(record.kind === "object" ? record.part + "\0" + record.id : record.part)
        );
        selectedObjects ||= record.kind === "object";
      }
    async function related(owner: string, type: string, visit: (part: string) => Promise<void>) {
      for await (const edge of index.graph.outgoing(owner))
        if (!edge.external && edge.targetPart) {
          let match = false;
          for (const d of dialects)
            if (await equal(edge.type(), literal(d.r + "/" + type))) match = true;
          if (match) {
            const info = await part(edge.targetPart);
            if (info) await visit(info.part);
          }
        }
    }
    for await (const slide of index.inventory.slides) {
      const key = await values.store(literal(slide.part));
      await values.insert("slideOrder", key, { start: slide.position, length: 0 });
      if (options.slide === slide.position) {
        for (const name of [slide.part, slide.layout, slide.master])
          if (name) await mark("allowedPart", literal(name));
        await related(slide.part, "notesSlide", async (notes) => {
          await mark("allowedPart", literal(notes));
          await related(notes, "notesMaster", async (master) => {
            await mark("allowedPart", literal(master));
          });
        });
      }
    }
    for await (const owner of index.records.records("part")) {
      if (owner.scope === "shared") continue;
      if (
        options.select
          ? !(await values.find("selectedPart", () => literal(owner.part)))
          : options.scope !== "shared" && owner.scope !== (options.scope ?? "slides")
      )
        continue;
      if (
        options.slide !== undefined &&
        !(await values.find("allowedPart", () => literal(owner.part)))
      )
        continue;
      await mark("owners", literal(owner.part));
      const order =
        (await values.find("slideOrder", () => literal(owner.part)))?.start ??
        Number.MAX_SAFE_INTEGER;
      const stored = await values.store(literal(JSON.stringify({ ...owner, name: undefined })));
      await owners.add(literal(String(order).padStart(16, "0") + owner.part), stored);
    }
    await owners.seal();
    if (options.shape !== undefined) {
      let matches = 0;
      for await (const record of index.records.records("object"))
        if (
          (await values.find("owners", () => literal(record.part))) &&
          (await equal(record.name(), literal(options.shape)))
        ) {
          matches++;
        }
      if (matches !== 1)
        throw new RetainedMediaSelectionError(
          matches ? "ambiguous-selection" : "missing-selection",
          async function* () {
            for await (const record of index.records.records("object"))
              if (
                (await values.find("owners", () => literal(record.part))) &&
                (await equal(record.name(), literal(options.shape!)))
              )
                yield record.location;
          },
          close
        );
    }
    async function addOccurrence(
      id: () => ByteSource,
      location: Location,
      sourcePart: string,
      shapeId: string | null,
      shapeName: (() => ByteSource) | null,
      kind: "audio" | "video" | "unknown",
      relationships: () => AsyncGenerator<Awaited<ReturnType<typeof reference>>>,
      posters: AsyncIterable<unknown>,
      playback: AsyncIterable<unknown>,
      captions: AsyncIterable<unknown>,
      timing: AsyncIterable<unknown>
    ) {
      const storedId = await values.store(id());
      let embedded = 0,
        linked = 0;
      for await (const ref of relationships()) {
        const resource = ref.mediaPart ? await part(ref.mediaPart) : undefined;
        const metadata = await values.store(
          literal(
            JSON.stringify({
              external: ref.external,
              part: resource?.part ?? null,
              contentType: resource?.contentType ?? null,
              bytes: ref.bytes,
              sha256: ref.sha256
            })
          )
        );
        const resourcePointer = pages.allocate(48);
        await write(resourcePointer, [
          0,
          count + 1,
          storedId.start,
          storedId.length,
          metadata.start,
          metadata.length
        ]);
        if (resourceTail) await write(resourceTail, [resourcePointer]);
        else resourceHead = resourcePointer;
        resourceTail = resourcePointer;
        if (ref.external) linked++;
        else embedded++;
        if (ref.mediaPart) {
          const info = await part(ref.mediaPart);
          if (!info) continue;
          const key = await values.store(literal(info.part));
          if (await values.insert("media", key, key)) await mediaParts.add(literal(info.part), key);
          // Each occurrence contributes at most once per part; insertion preserves occurrence order.
          if (await values.insert("occurrence:" + info.part, storedId, storedId)) {
            const prior = await values.find("ids:" + info.part, () => literal("list"));
            const pointer = pages.allocate(24);
            await write(pointer, [0, storedId.start, storedId.length]);
            if (prior) {
              const links = await row(prior.start, 2);
              await write(links[1]!, [pointer]);
              await write(prior.start + 8, [pointer]);
            } else {
              const links = pages.allocate(16);
              await write(links, [pointer, pointer]);
              const listKey = await values.store(literal("list"));
              await values.insert("ids:" + info.part, listKey, { start: links, length: 16 });
            }
          }
        }
      }
      const name = shapeName ? await values.store(shapeName()) : undefined;
      const json = await output.store(
        streamJson({
          id: () => values.read(storedId),
          location,
          sourcePart,
          shapeId,
          shapeName: name ? () => values.read(name) : null,
          kind,
          relationships: relationships(),
          posters,
          playback,
          captions,
          timing
        })
      );
      const summary = await values.store(
        literal(JSON.stringify({ location, sourcePart, shapeId, kind, name, embedded, linked }))
      );
      const pointer = pages.allocate(40);
      await write(pointer, [0, json.start, json.length, summary.start, summary.length]);
      if (tail) await write(tail, [pointer]);
      else head = pointer;
      tail = pointer;
      count++;
    }
    async function reference(owner: string, id: () => ByteSource) {
      const edge = await index.graph.get(owner, id);
      if (!edge) throw new OfficeError("missing-binding", "Media relationship is absent.", "index");
      const info = edge.targetPart ? await part(edge.targetPart) : undefined;
      if (!edge.external && !info)
        throw new OfficeError("missing-binding", "Media part is absent.", "index");
      return {
        relationshipId: edge.id,
        relationshipType: edge.type,
        target: edge.target,
        external: edge.external,
        mediaPart: edge.targetPart,
        contentType: info ? content(info) : null,
        bytes: info?.bytes ?? null,
        sha256: info?.sha256 ?? null
      };
    }
    for await (const stored of owners.entries()) {
      const owner = JSON.parse(await text(stored)) as Omit<RetainedSelectionRecord, "name">;
      const doc = await openRetainedXmlDocument(archive.read(owner.part), context);
      let view;
      try {
        view = await openRetainedCompatibility(
          doc,
          dialects.flatMap((d) => [d.p, d.a, d.r]),
          context,
          [
            ...equationOpaqueElements,
            ...dialects.flatMap((d) => [
              { namespace: d.p, localName: "ext" },
              { namespace: d.a, localName: "ext" },
              { namespace: d.a, localName: "graphicData" }
            ])
          ]
        );
        const local = (node: RetainedXmlNode, name: string) =>
          equal(doc.raw(node.localName), literal(name));
        async function named(
          node: RetainedXmlNode,
          names: readonly string[],
          kind: "p" | "a" | string
        ) {
          let namespace = false;
          for (const uri of kind === "p" || kind === "a" || kind === "r"
            ? dialects.map((d) => d[kind])
            : [kind])
            if (await equal(doc.namespace(node), literal(uri))) namespace = true;
          if (!namespace) return false;
          for (const name of names) if (await local(node, name)) return true;
          return false;
        }
        async function attr(node: RetainedXmlNode, name: string) {
          for await (const value of doc.attributes(node))
            if ((await local(value, name)) && (await equal(doc.namespace(value), literal(""))))
              return value;
        }
        async function* bindings(node: RetainedXmlNode) {
          for await (const value of doc.attributes(node))
            if (await named(value, ["embed", "link", "id"], "r")) yield value;
        }
        // Active document order uses caller-backed work links. Extension descendants
        // remain raw, matching media's opaque extension metadata semantics.
        const active = new RetainedOrder(pages, values, check);
        let serial = 0,
          top = pages.allocate(16);
        await write(top, [0, doc.reference(doc.root)]);
        async function admit(node: RetainedXmlNode) {
          const key = await values.store(literal(String(doc.reference(node))));
          await values.insert("active:" + owner.part, key, key);
          await active.add(literal(String(serial++).padStart(16, "0")), key);
        }
        while (top) {
          const task = await row(top, 2);
          top = task[0]!;
          const node = await doc.node(task[1]!);
          await admit(node);
          if ((await named(node, ["ext"], "p")) || (await named(node, ["ext"], "a"))) {
            for await (const nested of doc.elements(node))
              if (doc.reference(nested) !== doc.reference(node)) await admit(nested);
            continue;
          }
          let first = 0,
            last = 0;
          for await (const child of view.children(node)) {
            const task = pages.allocate(16);
            await write(task, [0, doc.reference(child)]);
            if (last) await write(last, [task]);
            else first = task;
            last = task;
          }
          if (last) {
            await write(last, [top]);
            top = first;
          }
        }
        await active.seal();
        async function* nodes(root?: RetainedXmlNode) {
          if (root) {
            for await (const node of doc.elements(root))
              if (
                await values.find("active:" + owner.part, () =>
                  literal(String(doc.reference(node)))
                )
              )
                yield node;
          } else
            for await (const key of active.entries()) yield await doc.node(Number(await text(key)));
        }
        let metadataId = 0;
        async function metadata(node: RetainedXmlNode) {
          const scope = "metadata:" + owner.part + ":" + ++metadataId;
          async function* refs() {
            for await (const nested of doc.elements(node))
              for await (const binding of bindings(nested))
                if (await mark(scope, doc.text(binding)))
                  yield await reference(owner.part, () => doc.text(binding));
          }
          return {
            namespace: () => doc.namespace(node),
            name: () => doc.raw(node.localName),
            xml: () => doc.markup(node, true),
            relationships: refs()
          };
        }
        for await (const record of index.records.records("object")) {
          if (
            record.part !== owner.part ||
            (options.shape !== undefined && !(await equal(record.name(), literal(options.shape))))
          )
            continue;
          if (
            options.select &&
            !(await values.find("selectedWhole", () => literal(owner.part))) &&
            !(await values.find("selectedObject", () => literal(owner.part + "\0" + record.id)))
          )
            continue;
          let shape: RetainedXmlNode | undefined;
          for await (const node of nodes()) {
            if (!(await named(node, ["pic", "sp", "graphicFrame"], "p"))) continue;
            let match = false;
            for await (const nv of doc.children(node))
              for await (const identity of doc.children(nv))
                if (identity.kind === "element" && (await named(identity, ["cNvPr"], "p"))) {
                  const id = await attr(identity, "id");
                  if (id && (await equal(doc.text(id), literal(record.id)))) match = true;
                }
            if (match) {
              shape = node;
              break;
            }
          }
          if (!shape) continue;
          const refs = new RetainedOrder(pages, values, check);
          let refsCount = 0,
            hasNodes = false,
            audio = false,
            video = false;
          for await (const node of nodes(shape)) {
            const isDrawing = await named(node, ["videoFile", "audioFile", "wavAudioFile"], "a"),
              isMedia = await named(node, ["media"], mediaNamespace);
            if (!isDrawing && !isMedia) continue;
            hasNodes = true;
            let bound = false;
            for await (const binding of bindings(node)) {
              bound = true;
              const ref = await reference(owner.part, () => doc.text(binding)),
                edge = (await index.graph.get(owner.part, () => doc.text(binding)))!;
              const expected = (await local(node, "videoFile"))
                ? "video"
                : (await local(node, "media"))
                  ? "unknown"
                  : "audio";
              const kind = await relationshipKind(edge);
              if (kind !== expected)
                throw new OfficeError(
                  "missing-binding",
                  "Media relationship has the wrong type.",
                  "index"
                );
              await mark("consumed:" + owner.part, edge.id());
              const id = await values.store(edge.id());
              if (await values.insert("refs:" + owner.part + ":" + record.id, id, id))
                await refs.add(literal(String(refsCount++).padStart(16, "0")), id);
              audio ||= kind === "audio";
              video ||= kind === "video";
              if (kind === "unknown" && ref.contentType) {
                let prefix = "";
                for await (const bytes of ref.contentType()) {
                  prefix += new TextDecoder().decode(bytes.subarray(0, 6 - prefix.length));
                  if (prefix.length >= 6) break;
                }
                audio ||= prefix.startsWith("audio/");
                video ||= prefix.startsWith("video/");
              }
            }
            if (!bound)
              throw new OfficeError(
                "missing-binding",
                "Media reference has no relationship binding.",
                "index"
              );
          }
          if (!hasNodes) continue;
          await refs.seal();
          async function* references() {
            for await (const id of refs.entries())
              yield await reference(owner.part, () => values.read(id));
          }
          async function* posters() {
            for await (const node of nodes(shape))
              if (await named(node, ["blip"], "a"))
                for await (const binding of bindings(node)) {
                  const ref = await reference(owner.part, () => doc.text(binding));
                  let image = false;
                  for (const d of dialects)
                    if (await equal(ref.relationshipType(), literal(d.r + "/image"))) image = true;
                  if (!image)
                    throw new OfficeError(
                      "missing-binding",
                      "Poster relationship has the wrong type.",
                      "index"
                    );
                  yield ref;
                }
          }
          async function* metadataNodes(kind: "playback" | "captions" | "timing") {
            for await (const node of nodes(kind === "timing" ? undefined : shape)) {
              if (
                (kind === "playback" && (await named(node, ["media"], mediaNamespace))) ||
                (kind === "captions" && (await named(node, ["tracksInfo"], tracksNamespace)))
              )
                yield await metadata(node);
              else if (
                kind === "timing" &&
                (await named(
                  node,
                  [
                    "audio",
                    "video",
                    "anim",
                    "animEffect",
                    "animMotion",
                    "animRot",
                    "animScale",
                    "cmd",
                    "set"
                  ],
                  "p"
                ))
              ) {
                let match = false;
                for await (const target of doc.elements(node))
                  if (await named(target, ["spTgt"], "p")) {
                    const id = await attr(target, "spid");
                    if (id && (await equal(doc.text(id), literal(record.id)))) match = true;
                  }
                if (match) yield await metadata(node);
              }
            }
          }
          await addOccurrence(
            () => literal(owner.part + "#media-" + record.id),
            record.location,
            owner.part,
            record.id,
            record.name,
            audio === video ? "unknown" : audio ? "audio" : "video",
            references,
            posters(),
            metadataNodes("playback"),
            metadataNodes("captions"),
            metadataNodes("timing")
          );
        }
        const unconsumed = new RetainedOrder(pages, values, check);
        if (options.shape === undefined && !selectedObjects)
          for await (const edge of index.graph.outgoing(owner.part)) {
            const id = await values.store(edge.id());
            await unconsumed.add(values.read(id), id);
          }
        await unconsumed.seal();
        for await (const id of unconsumed.entries()) {
          const edge = (await index.graph.get(owner.part, () => values.read(id)))!;
          const kind = await relationshipKind(edge);
          if (!kind || (await values.find("consumed:" + owner.part, edge.id))) continue;
          async function* references() {
            yield await reference(owner.part, edge.id);
          }
          async function* empty() {}
          await addOccurrence(
            () => joined(literal(owner.part + "#media-relationship-"), edge.id()),
            owner.location,
            owner.part,
            null,
            null,
            kind,
            references,
            empty(),
            empty(),
            empty(),
            empty()
          );
        }
      } finally {
        await Promise.all([view?.close(), doc.close()]);
      }
    }
    await mediaParts.seal();
    for await (const name of mediaParts.entries()) {
      const info = (await part(() => values.read(name)))!,
        hash = sha1.create();
      for await (const bytes of archive.read(info.part)) {
        check();
        hash.update(bytes);
      }
      async function* ids() {
        const list = (await values.find("ids:" + info.part, () => literal("list")))!;
        for (let pointer = (await row(list.start, 2))[0]!; pointer; ) {
          const data = await row(pointer, 3);
          pointer = data[0]!;
          const value = { start: data[1]!, length: data[2]! };
          yield () => values.read(value);
        }
      }
      const json = await output.store(
        streamJson({
          part: info.part,
          contentType: content(info),
          bytes: info.bytes,
          sha256: info.sha256,
          sha1: Array.from(hash.digest(), (b) => b.toString(16).padStart(2, "0")).join(""),
          occurrenceIds: ids()
        })
      );
      const pointer = pages.allocate(24);
      await write(pointer, [0, json.start, json.length]);
      if (mediaTail) await write(mediaTail, [pointer]);
      else mediaHead = pointer;
      mediaTail = pointer;
    }
    await index.close();
    check();
    return Object.freeze({
      close,
      count,
      async *occurrences() {
        try {
          check();
          for (let pointer = head; pointer; ) {
            const item = await row(pointer, 5);
            pointer = item[0]!;
            yield { [rawJson]: (): ByteSource => output.read({ start: item[1]!, length: item[2]! }) };
          }
        } catch (error) {
          throw failure(error);
        }
      },
      async *media() {
        try {
          check();
          for (let pointer = mediaHead; pointer; ) {
            const item = await row(pointer, 3);
            pointer = item[0]!;
            yield { [rawJson]: (): ByteSource => output.read({ start: item[1]!, length: item[2]! }) };
          }
        } catch (error) {
          throw failure(error);
        }
      },
      async *resources() {
        try {
          check();
          for (let pointer = resourceHead; pointer; ) {
            const item = await row(pointer, 6);
            pointer = item[0]!;
            const metadata = JSON.parse(await text({ start: item[4]!, length: item[5]! })) as {
              external: boolean;
              part: string | null;
              contentType: XmlRange | null;
              bytes: number | null;
              sha256: string | null;
            };
            yield {
              ...metadata,
              occurrence: item[1]!,
              occurrenceId: (): ByteSource => values.read({ start: item[2]!, length: item[3]! }),
              contentType: metadata.contentType ? (): ByteSource => values.read(metadata.contentType!) : null
            };
          }
          check();
        } catch (error) {
          throw failure(error);
        }
      },
      async *summaries() {
        try {
          check();
          for (let pointer = head; pointer; ) {
            const item = await row(pointer, 5);
            pointer = item[0]!;
            const summary = JSON.parse(await text({ start: item[3]!, length: item[4]! })) as {
              location: Location;
              sourcePart: string;
              shapeId: string | null;
              kind: "audio" | "video" | "unknown";
              name?: XmlRange;
              embedded: number;
              linked: number;
            };
            yield { ...summary, name: summary.name ? (): ByteSource => values.read(summary.name!) : null };
          }
        } catch (error) {
          throw failure(error);
        }
      }
    });
  } catch (error) {
    if (!(error instanceof RetainedMediaSelectionError)) await close().catch(() => {});
    throw failure(error);
  }
}

export async function stageRetainedMedia(
  archive: Archive,
  fingerprint: string,
  options: ReadMediaOptions,
  settings: RetainedPackageContext,
  format: {
    readonly operation: "media.list" | "media.get";
    readonly json: boolean;
    readonly maxOutputBytes: number;
  }
) {
  const output = { ...format };
  let reader: Awaited<ReturnType<typeof openRetainedMedia>> | undefined,
    staged: StagedOutput | undefined;
  try {
    reader = await openRetainedMedia(archive, fingerprint, options, settings);
    const inventory = reader;
    async function* locations() {
      for await (const item of inventory.summaries()) yield item.location;
    }
    if (output.operation === "media.get" && reader.count !== 1)
      throw new RetainedMediaSelectionError(
        reader.count ? "ambiguous-selection" : "missing-selection",
        locations,
        reader.close
      );
    async function* render() {
      if (output.json) {
        yield* streamJson({
          version: 1,
          operation: output.operation,
          ok: true,
          data: {
            occurrences: inventory.occurrences(),
            media: inventory.media(),
            playbackVerified: false
          },
          warnings: [],
          errors: [],
          affected: 0,
          locations: locations()
        });
        yield* literal("\n");
      } else {
        yield* literal("Media occurrences: " + inventory.count + "\n");
        for await (const item of inventory.summaries()) {
          yield* literal(item.kind + " ");
          yield* streamJson(item.name ?? ((): ByteSource => literal(item.sourcePart)));
          yield* literal(": " + item.embedded + " embedded, " + item.linked + " linked\n");
        }
        yield* literal(
          "External targets remain inert. Metadata parsing does not prove playback.\n"
        );
      }
    }
    staged = await stageRetainedOutput(render(), settings, output.maxOutputBytes);
    await reader.close();
    return { output: staged, ok: true };
  } catch (error) {
    if (error instanceof RetainedMediaSelectionError) {
      return { output: await stageRetainedMediaSelectionError(error, settings, output), ok: false };
    }
    await Promise.allSettled([reader?.close(), staged?.close()]);
    throw error;
  }
}

export async function stageRetainedMediaSelectionError(
  selection: RetainedMediaSelectionError,
  settings: RetainedPackageContext,
  format: { readonly operation: string; readonly json: boolean; readonly maxOutputBytes: number }
): Promise<StagedOutput> {
  const output = { ...format };
  let staged: StagedOutput | undefined;
  async function* render() {
    if (output.json) {
      yield* streamJson({
        version: 1,
        operation: output.operation,
        ok: false,
        data: null,
        warnings: [],
        errors: [
          {
            code: selection.code,
            message: selection.message,
            context: { phase: "select", candidates: selection.candidates() }
          }
        ],
        affected: 0,
        locations: []
      });
      yield* literal("\n");
    } else yield* literal("pptx: " + selection.code + ": " + selection.message + "\n");
  }
  try {
    staged = await stageRetainedOutput(render(), settings, output.maxOutputBytes);
    await selection.close();
    return staged;
  } catch (error) {
    await Promise.allSettled([selection.close(), staged?.close()]);
    throw error;
  }
}
