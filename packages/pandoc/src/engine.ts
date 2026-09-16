import { normalizeDocumentCooperatively, AstError } from "./ast.js";
import type { MetaValue } from "./ast-types.js";
import { createFormatRegistry } from "./formats.js";
import { ExecutionContext } from "./execution.js";
import { PandocError } from "./errors.js";
export { PandocError } from "./errors.js";
import type {
  ConversionContext,
  ConversionOptions,
  ConversionResult,
  Document,
  Input,
  InputSource,
  ReadOptions,
  SerializedDocument,
  WriteOptions
} from "./types.js";

class Session extends ExecutionContext {
  lossy = false;
  standalone = false;
  rawContent: WriteOptions["rawContent"];
  metadata: WriteOptions["metadata"];
  options(options: ReadOptions | WriteOptions | ConversionOptions): void {
    const allowed =
      this.operation === "read" ? ["from"] : this.operation === "write" ? ["to", "lossy", "standalone", "metadata", "rawContent"] : ["from", "to", "lossy", "standalone", "metadata", "rawContent"];
    if (Object.keys(options).some((key) => !allowed.includes(key)))
      this.fail("E_OPTION", "Unknown or inapplicable option");
    if ("lossy" in options && typeof options.lossy !== "boolean") this.fail("E_OPTION", "lossy must be boolean");
    this.lossy = "lossy" in options && options.lossy === true;
    if ("to" in options) {
      this.registry.validateOptions(options.to, "write", Object.keys(options).filter(key => !["from", "to", "lossy"].includes(key)));
      if (options.standalone !== undefined && typeof options.standalone !== "boolean") this.fail("E_OPTION", "standalone must be boolean");
      if (options.rawContent !== undefined && !["reject", "escape", "retain"].includes(options.rawContent)) this.fail("E_OPTION", "Invalid rawContent policy");
      if (options.metadata !== undefined && (options.metadata === null || typeof options.metadata !== "object" || Array.isArray(options.metadata))) this.fail("E_OPTION", "metadata must be a map of MetaValue nodes");
      this.standalone = options.standalone === true;
      this.rawContent = options.rawContent;
      this.metadata = options.metadata;
    }
  }
  readonly registry = createFormatRegistry(undefined, this.context, this.operation);
  async input(input: InputSource, format: string): Promise<Input> {
    const { descriptor } = this.registry.parse(format, "read");
    const bytes = await this.acquire(
      "bytes" in input ? [input.bytes] : input.chunks,
      descriptor.inputBudget
    );
    const text = descriptor.inputEncoding === "utf8" ? await this.decodeUtf8([bytes]) : undefined;
    return {
      bytes,
      ...(input.base === undefined ? {} : { base: input.base }),
      ...(text === undefined ? {} : { text })
    };
  }
  async document(document: Document, aggregate = false): Promise<Document> {
    this.checkpoint(0);
    let owned: Document;
    try {
      owned = await normalizeDocumentCooperatively(
        document,
        {
          nodes: this.limits.nodes,
          depth: this.limits.depth,
          text: this.limits.text,
          attributes: this.limits.attributes,
          tableCells: this.limits.tableCells,
          references: this.limits.references,
          resourceBytes: this.limits.resourceBytes
        },
        (units) => this.cooperate(units),
        (key, units) => {
          if (!aggregate) this.charge(key, units);
          if (key === "text") this.charge("retainedBytes", units * 2);
          if (key === "resourceBytes") this.charge("retainedBytes", units);
          if (key === "resourceBytes" && !aggregate) this.charge("resources", 1);
        }
      );
    } catch (error) {
      if (error instanceof AstError)
        throw new PandocError(error.code, this.operation, error.message, undefined, error.path);
      throw error;
    }
    return owned;
  }

  async writable(document: Document, math?: "source"): Promise<Document> {
    if (this.metadata) document = await this.document({...document, metadata: {...document.metadata, ...this.metadata}});
    if (math !== "source") {
      const visit = async (value: unknown, path: string): Promise<void> => {
        await this.cooperate();
        if (value === null || typeof value !== "object" || value instanceof Uint8Array) return;
        if ("t" in value && value.t === "Math")
          throw new PandocError(
            "E_CAPABILITY",
            this.operation,
            "Writer must explicitly preserve typed math source",
            undefined,
            path
          );
        for (const [key, child] of Object.entries(value)) await visit(child, `${path}.${key}`);
      };
      await visit(document.blocks, "$.blocks");
      await visit(document.metadata, "$.metadata");
    }
    return document;
  }
  async finish(serialized: SerializedDocument): Promise<ConversionResult> {
    this.checkpoint(0);
    const diagnostics = this.snapshotDiagnostics();
    if (serialized.kind === "binary") this.bound("outputBytes", serialized.bytes.byteLength);
    this.charge(
      "retainedBytes",
      serialized.kind === "binary" ? serialized.bytes.byteLength : serialized.text.length * 2
    );
    const bytes =
      serialized.kind === "text"
        ? await this.encodeOutput(serialized.text)
        : new Uint8Array(serialized.bytes);
    this.bound("outputBytes", bytes.byteLength);
    const owned =
      serialized.kind === "text"
        ? { kind: "text" as const, text: serialized.text }
        : { kind: "binary" as const, bytes };
    if (this.context.output && "write" in this.context.output) {
      for (let offset = 0; offset < bytes.length; offset += 4096) {
        await this.emit(bytes.subarray(offset, offset + 4096));
        await this.cooperate(1);
      }
    } else await this.emit(bytes);
    await this.completeOutput();
    return { ...owned, diagnostics };
  }

  private async encodeOutput(text: string): Promise<Uint8Array> {
    let length = 0;
    let scanned = 0;
    for (let i = 0; i < text.length; i++) {
      this.checkpoint();
      const code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = text.charCodeAt(++i);
        if (!(low >= 0xdc00 && low <= 0xdfff)) this.fail("E_ENCODING", "Invalid output Unicode");
        length += 4;
      } else if (code >= 0xdc00 && code <= 0xdfff)
        this.fail("E_ENCODING", "Invalid output Unicode");
      else length += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
      this.bound("outputBytes", length);
      if (++scanned % 256 === 0) await this.cooperate(0);
    }
    await this.cooperate(0);
    this.charge("retainedBytes", length);
    const bytes = new Uint8Array(length);
    const encoder = new TextEncoder();
    let offset = 0;
    for (let i = 0; i < text.length; ) {
      let end = Math.min(i + 4096, text.length);
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
      this.checkpoint(end - i);
      this.charge("retainedBytes", (end - i) * 2);
      offset += encoder.encodeInto(text.slice(i, end), bytes.subarray(offset)).written;
      i = end;
      await this.cooperate(0);
    }
    return bytes;
  }
}

export async function readDocument(
  input: InputSource,
  options: ReadOptions,
  context: ConversionContext
): Promise<Document> {
  const session = new Session("read", context);
  try {
    session.options(options);
    const reader = session.registry.resolve(options.from, "read");
    const owned = await session.input(input, options.from);
    return await session.document(
      await session.call(() => reader.reader!.read(owned, session, reader))
    );
  } finally {
    await session.close();
  }
}
export async function writeDocument(
  document: Document,
  options: WriteOptions,
  context: ConversionContext
): Promise<ConversionResult> {
  const session = new Session("write", context);
  try {
    session.options(options);
    const writer = session.registry.resolve(options.to, "write");
    const owned = await session.writable(await session.document(document), writer.writer!.math);
    return await session.finish(
      await session.call(() => writer.writer!.write(owned, session, writer))
    );
  } finally {
    await session.close();
  }
}
export async function convert(
  inputs: readonly InputSource[],
  options: ConversionOptions,
  context: ConversionContext
): Promise<ConversionResult> {
  const session = new Session("convert", context);
  try {
    session.options(options);
    const reader = session.registry.resolve(options.from, "read");
    const writer = session.registry.resolve(options.to, "write");
    // Account for every input before callbacks, retaining independent reader boundaries.
    const ownedInputs: Input[] = [];
    for (const input of inputs) {
      session.charge("references", 1);
      ownedInputs.push(await session.input(input, options.from));
    }
    const blocks: Document["blocks"][number][] = [];
    const metadata: Record<string, MetaValue> = {};
    const resources: Document["resources"][number][] = [];
    const settings: { language?: string; direction?: "ltr" | "rtl" | "auto" } = {};
    for (const [index, input] of ownedInputs.entries()) {
      const document = await session.document(
        await session.call(() => reader.reader!.read(input, session, reader))
      );
      for (const key of ["language", "direction"] as const) {
        if (Object.hasOwn(document, key)) {
          if (Object.hasOwn(settings, key))
            session.report({
              code: "W_METADATA_CONFLICT",
              operation: "convert",
              message: `Later document replaces ${key}`,
              location: `input[${index}].${key}`
            });
          Object.defineProperty(settings, key, {
            value: document[key],
            enumerable: true,
            configurable: true,
            writable: true
          });
        }
      }
      session.charge("references", document.blocks.length + document.resources.length);
      for (const block of document.blocks) {
        blocks.push(block);
        await session.cooperate();
      }
      for (const resource of document.resources) {
        resources.push(resource);
        await session.cooperate();
      }
      for (const [key, value] of Object.entries(document.metadata)) {
        if (Object.hasOwn(metadata, key))
          session.report({
            code: "W_METADATA_CONFLICT",
            operation: "convert",
            message: `Later metadata replaces ${key}`,
            location: `input[${index}].metadata.${key}`
          });
        if (!Object.hasOwn(metadata, key)) session.charge("references", 1);
        Object.defineProperty(metadata, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
    }
    const document = await session.writable(
      await session.document({ blocks, metadata, resources, ...settings }, true),
      writer.writer!.math
    );
    return await session.finish(
      await session.call(() => writer.writer!.write(document, session, writer))
    );
  } finally {
    await session.close();
  }
}
