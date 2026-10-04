import { BackedJson, indexJsonObjects, parseBackedJson } from "@poe-code/json-ast";
import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosRef, dictGet, type PdfCosRef } from "../ast.js";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import type { PdfIndexStorage } from "./object-index.js";
import { PdfMutableObjectStore } from "./mutable-object-store.js";
import { QpdfJsonValues } from "./qpdf-json-values.js";
import { retainedCosObjects } from "./retained-objects.js";
import { retainedObjectOrder } from "./retained-object-order.js";
import { serializeRetainedCosDocumentChunks } from "./retained-writer.js";

export interface ApplyQpdfJsonOptions {
  /** The caller retains ownership of datafile handles. */
  readonly dataFile?: (path: string) => Promise<PdfFileSource | undefined>;
  readonly maxInputBytes?: number;
  readonly syntaxError?: (offset: number, message: string, tokenOffset?: number) => never;
}

/** A mutable JSON-import document backed only by the caller filesystem. Apply
 * updates sequentially and publish chunks only after all updates succeed.
 * A failed update may have applied earlier objects; discard the owner on error. */
export class QpdfJsonDocument {
  rootRef: PdfCosRef | undefined;
  infoRef: PdfCosRef | undefined;
  private readonly store: PdfMutableObjectStore;
  private readonly backing: PagedStorage;
  private readonly positions: IntegerTable;
  private readonly order: IntegerTable;
  private readonly catalogs: IntegerTable;
  private ordinal = 0;
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private pending: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;
  constructor(
    private readonly storage: PdfIndexStorage,
    options: { signal?: AbortSignal } = {}
  ) {
    this.signal = options.signal
      ? AbortSignal.any([options.signal, this.controller.signal])
      : this.controller.signal;
    this.store = new PdfMutableObjectStore(storage, { signal: this.signal });
    this.backing = new PagedStorage(
      { fs: storage.fs, cwd: storage.directory, env: {}, signal: this.signal },
      4
    );
    this.positions = new IntegerTable(this.backing, 64);
    this.order = new IntegerTable(this.backing, 64);
    this.catalogs = new IntegerTable(this.backing, 64);
  }
  private async remember(number: number): Promise<void> {
    if (!(await this.positions.get(BigInt(number)))) {
      const ordinal = ++this.ordinal;
      await this.positions.set(BigInt(number), BigInt(ordinal));
      await this.order.set(BigInt(ordinal), BigInt(number));
    }
  }
  static async fromDocument(
    document: PdfRetainedDocument,
    source: PdfFileSource,
    storage: PdfIndexStorage,
    options: { signal?: AbortSignal } = {}
  ): Promise<QpdfJsonDocument> {
    const owner = new QpdfJsonDocument(storage, options);
    try {
      owner.rootRef = document.crossReference.rootRef;
      owner.infoRef = document.crossReference.infoRef;
      for await (const object of retainedCosObjects(document, storage, { signal: owner.signal })) {
        await owner.store.set(object);
        const type =
          object.value.kind === "dict" && !object.stream
            ? dictGet(object.value, "Type")
            : undefined;
        await owner.catalogs.set(
          BigInt(object.objectNumber),
          type?.kind === "name" && type.decoded === "Catalog"
            ? BigInt(object.generationNumber + 1)
            : 0n
        );
      }
      for await (const number of retainedObjectOrder(document, source, storage, owner.signal))
        await owner.remember(number);
      return owner;
    } catch (error) {
      try {
        await owner.close();
      } catch {
        /* Preserve the import failure. */
      }
      throw error;
    }
  }
  apply(
    input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    options: ApplyQpdfJsonOptions = {}
  ): Promise<void> {
    const task = this.pending.then(() => this.update(input, options));
    this.pending = task.catch(() => {});
    return task;
  }
  private async update(
    input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    options: ApplyQpdfJsonOptions
  ): Promise<void> {
    this.signal.throwIfAborted();
    const maximum = options.maxInputBytes ?? Infinity;
    if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0))
      throw new RangeError("Invalid QPDF JSON input limit");
    const context = {
      fs: this.storage.fs,
      cwd: this.storage.directory,
      env: {},
      signal: this.signal
    };
    const tape = new PagedStorage(context, 4),
      scratch = new PagedStorage(context, 4);
    let values: QpdfJsonValues | undefined,
      failed = false,
      work = 0;
    const cooperate = async (units = 1) => {
      this.signal.throwIfAborted();
      work += units;
      if (work >= 4096) {
        work = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        this.signal.throwIfAborted();
      }
    };
    const tree = new BackedJson(tape, cooperate);
    async function* text() {
      const decoder = new TextDecoder();
      let total = 0;
      for await (const bytes of input) {
        if (bytes.length > maximum - total)
          throw new PdfError("E_LIMIT", "QPDF JSON input byte limit exceeded");
        total += bytes.length;
        for (let at = 0; at < bytes.length; at += 16384) {
          await cooperate(16384);
          yield decoder.decode(bytes.subarray(at, at + 16384), { stream: true });
        }
      }
      yield decoder.decode();
    }
    const isNull = async (position: number | undefined) =>
      position !== undefined &&
      (await tree.describe(position)).kind === "literal" &&
      (await tree.smallText(position, 4)) === "null";
    try {
      await parseBackedJson(
        text(),
        tree,
        scratch,
        cooperate,
        options.syntaxError ??
          ((offset, message) => {
            throw new SyntaxError(`${message} at offset ${offset}`);
          }),
        undefined,
        true
      );
      const order = await indexJsonObjects(tree, scratch, cooperate);
      const property = async (position: number | undefined, name: string) =>
        position !== undefined && (await tree.describe(position)).kind === "object"
          ? order.property(position, name)
          : undefined;
      const objectLike = async (position: number | undefined) =>
        position !== undefined &&
        ["object", "array"].includes((await tree.describe(position)).kind);
      const root = tree.rootPosition;
      if (!(await objectLike(root))) throw new Error("Invalid QPDF JSON root");
      let section: number | undefined;
      const qpdf = await property(root, "qpdf");
      let selected = false;
      if (qpdf !== undefined && (await tree.describe(qpdf)).kind === "array") {
        let index = 0;
        for await (const child of tree.children(qpdf)) {
          if (index++ === 1) {
            if ((await objectLike(child)) || (await isNull(child))) {
              section = child;
              selected = true;
            }
            break;
          }
        }
      }
      if (!selected) {
        const objects = await property(root, "objects");
        if (await objectLike(objects)) section = objects;
      }
      if (section === undefined || (await isNull(section)))
        throw new Error("Missing QPDF JSON objects section");
      values = await QpdfJsonValues.open(tree, this.storage, { signal: this.signal });
      let rootRef: PdfCosRef | undefined, infoRef: PdfCosRef | undefined;
      if ((await tree.describe(section)).kind === "object")
        for await (const { key, value: entry } of order.entries(section)) {
          await cooperate();
          if (!(await objectLike(entry))) continue;
          const value = await property(entry, "value");
          if ((await tree.smallText(key, 7)) === "trailer") {
            if (value !== undefined) {
              for await (const bytes of values.chunks(value)) void bytes;
              const root = await values.property(value, "Root"),
                info = await values.property(value, "Info");
              if (root !== undefined) rootRef = (await values.reference(root)) ?? rootRef;
              if (info !== undefined) infoRef = (await values.reference(info)) ?? infoRef;
            }
            continue;
          }
          const ref = await values.reference(key);
          if (!ref) continue;
          const stream = await property(entry, "stream");
          if (await objectLike(stream)) {
            const dict = await property(stream, "dict"),
              data = await property(stream, "data"),
              datafile = await property(stream, "datafile");
            if (dict !== undefined) await values.validate(dict);
            let staged: PdfFileSource | undefined;
            let streamFailed = false;
            try {
              let raw: { length: number; chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array> };
              if (data !== undefined && (await tree.describe(data)).kind === "string") {
                const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
                async function* decoded() {
                  let accumulator = 0,
                    bits = 0,
                    used = 0,
                    buffer = new Uint8Array(8192);
                  for await (const text of tree.scalarChunks(data!)) {
                    await cooperate(text.length);
                    for (const char of text) {
                      const code = alphabet.indexOf(char);
                      if (code < 0) continue;
                      accumulator = (accumulator << 6) | code;
                      bits += 6;
                      if (bits >= 8) {
                        bits -= 8;
                        buffer[used++] = (accumulator >>> bits) & 255;
                        accumulator &= (1 << bits) - 1;
                        if (used === buffer.length) {
                          yield buffer;
                          buffer = new Uint8Array(8192);
                          used = 0;
                        }
                      }
                    }
                  }
                  if (used) yield buffer.subarray(0, used);
                }
                staged = await PdfFileSource.fromStream(
                  this.storage.fs,
                  this.storage.directory,
                  decoded(),
                  { signal: this.signal }
                );
                raw = { length: staged.size, chunks: staged.stream(0, staged.size, this.signal) };
              } else if (
                datafile !== undefined &&
                (await tree.describe(datafile)).kind === "string"
              ) {
                let path = "";
                for await (const part of tree.scalarChunks(datafile)) {
                  await cooperate(part.length);
                  path += part;
                }
                const file = await options.dataFile?.(path);
                if (!file) throw new Error(`cannot open stream datafile ${path}`);
                raw = { length: file.size, chunks: file.stream(0, file.size, this.signal) };
              } else
                raw = (await this.store.getStream(ref.objectNumber)) ?? { length: 0, chunks: [] };
              const dictionary = (await isNull(dict)) ? undefined : dict;
              let length = 0;
              for await (const bytes of values.streamDictionary(dictionary, raw.length))
                length += bytes.length;
              await this.store.setSerializedValue({
                ...ref,
                body: { length, chunks: values.streamDictionary(dictionary, raw.length) },
                stream: raw
              });
              await this.remember(ref.objectNumber);
              await this.catalogs.set(BigInt(ref.objectNumber), 0n);
            } catch (error) {
              streamFailed = true;
              throw error;
            } finally {
              await staged?.close().catch((error) => {
                if (!streamFailed) throw error;
              });
            }
          } else if (value !== undefined) {
            if (await isNull(value)) {
              await this.store.delete(ref.objectNumber);
              await this.positions.set(BigInt(ref.objectNumber), 0n);
              await this.catalogs.set(BigInt(ref.objectNumber), 0n);
            } else {
              let length = 0;
              for await (const bytes of values.chunks(value)) length += bytes.length;
              await this.store.setSerializedValue({
                ...ref,
                body: { length, chunks: values.chunks(value) }
              });
              await this.remember(ref.objectNumber);
              const type = await values.property(value, "Type"),
                token = type === undefined ? undefined : await tree.smallText(type, 11);
              await this.catalogs.set(
                BigInt(ref.objectNumber),
                token === "/Catalog" || token === "n:/Catalog" || token === "n:Catalog"
                  ? BigInt(ref.generationNumber + 1)
                  : 0n
              );
            }
          }
        }
      if (!rootRef)
        for await (const [ordinal, number] of this.order.entries()) {
          await cooperate();
          if ((await this.positions.get(number)) !== ordinal) continue;
          const generation = await this.catalogs.get(number);
          if (generation) {
            rootRef = cosRef(Number(number), Number(generation) - 1);
            break;
          }
        }
      if (rootRef) this.rootRef = rootRef;
      if (infoRef) this.infoRef = infoRef;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const results = await Promise.allSettled([values?.close(), tape.close(), scratch.close()]);
      if (!failed)
        for (const result of results)
          if (result.status === "rejected") await Promise.reject(result.reason);
    }
  }
  async *chunks(
    options: { maxOutputBytes?: number; chunkBytes?: number } = {}
  ): AsyncGenerator<Uint8Array> {
    await this.pending;
    this.signal.throwIfAborted();
    if (!this.rootRef) throw new Error("missing trailer /Root");
    yield* serializeRetainedCosDocumentChunks(
      {
        ...options,
        objects: this.store.outputObjects(),
        rootRef: this.rootRef,
        infoRef: this.infoRef,
        signal: this.signal
      },
      this.storage
    );
  }
  close(): Promise<void> {
    this.controller.abort(new PdfError("E_CANCELLED", "QPDF JSON document closed"));
    return (this.closing ??= (async () => {
      await this.pending;
      const results = await Promise.allSettled([this.store.close(), this.backing.close()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    })());
  }
}
