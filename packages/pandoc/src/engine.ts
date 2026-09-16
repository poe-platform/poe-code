import { normalizeDocumentCooperatively, AstError } from "./ast.js";
import type { MetaValue } from "./ast-types.js";
import { createFormatRegistry } from "./formats.js";
import { ExecutionContext } from "./execution.js";
import { ResourceSession } from "./resources.js";
import { PandocError } from "./errors.js";
import { mergeMetadata, mergeJsonMetadata, parseMetadataJson } from "./metadata.js";
import type { FormatSelection } from "./formats.js";
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
  WriteOptions,
  Diagnostic,
  ReaderCapability
} from "./types.js";

class Session extends ExecutionContext {
  readonly media = new ResourceSession(this);
  sourceLocations: readonly {source: string; line: number; base?: string}[] = [];
  inputBase: string | undefined;
  resourceTarget(target: object, line: number, explicitOrigin?: {readonly base?: string; readonly source?: string}): void {
    if (explicitOrigin !== undefined) {this.media.origins.set(target, explicitOrigin); return;}
    let origin = this.sourceLocations[0];
    for (const entry of this.sourceLocations) {if (entry.line > line) break; origin = entry;}
    const base = origin ? origin.base : this.inputBase;
    this.media.origins.set(target, {...(origin?.source === undefined ? {} : {source: origin.source}), ...(base === undefined ? {} : {base})});
  }
  sourceLocation(location?: string): string | undefined {
    if (!this.sourceLocations.length) return location;
    const parts = location?.split(":") ?? [];
    if (parts.length > 2 && parts.slice(-2).every(part => part !== "" && Number.isSafeInteger(Number(part)) && Number(part) > 0)) return location;
    const line = Number(parts[0]);
    const numeric = parts.length === 2 && Number.isSafeInteger(line) && line > 0 && Number.isSafeInteger(Number(parts[1]));
    let source = this.sourceLocations[0]!;
    if (numeric) for (const entry of this.sourceLocations) {if (entry.line > line) break; source = entry;}
    return numeric ? `${source.source}:${line - source.line + 1}:${parts[1]}` : `${source.source}:${location ?? "1:1"}`;
  }
  override report(diagnostic: Diagnostic): void {
    super.report({...diagnostic, operation: this.operation, location: this.sourceLocation(diagnostic.location)});
  }
  failIfWarnings = false;
  metadataJson: WriteOptions["metadataJson"];
  metadataFiles: WriteOptions["metadataFiles"];
  lossy = false;
  standalone = false;
  rawContent: WriteOptions["rawContent"];
  metadata: WriteOptions["metadata"];
  options(options: ReadOptions | WriteOptions | ConversionOptions): void {
    const allowed =
      this.operation === "read" ? ["from"] : this.operation === "write" ? ["to", "wrap", "lossy", "standalone", "metadata", "rawContent"] : ["from", "to", "wrap", "lossy", "standalone", "metadata", "rawContent"];
    if (this.operation !== "read") allowed.push("failIfWarnings", "metadataJson", "metadataFiles", "resourcePath", "extractMedia");
    if (Object.keys(options).some((key) => !allowed.includes(key)))
      this.fail("E_OPTION", "Unknown or inapplicable option");
    if ("wrap" in options && options.wrap !== "none") this.fail("E_OPTION", "Only wrap none is supported");
    if ("lossy" in options && typeof options.lossy !== "boolean") this.fail("E_OPTION", "lossy must be boolean");
    this.lossy = "lossy" in options && options.lossy === true;
    if ("to" in options) {
      this.media.configure(options);
      this.registry.validateOptions(options.to, "write", Object.keys(options).filter(key => !["from", "to", "lossy", "failIfWarnings", "metadata", "metadataJson", "metadataFiles", "resourcePath", "extractMedia"].includes(key)));
      if (options.failIfWarnings !== undefined && typeof options.failIfWarnings !== "boolean") this.fail("E_OPTION", "failIfWarnings must be boolean");
      this.failIfWarnings = options.failIfWarnings === true;
      if (options.metadataJson !== undefined && !Array.isArray(options.metadataJson)) this.fail("E_OPTION", "metadataJson must be an array");
      if (options.metadataFiles !== undefined && !Array.isArray(options.metadataFiles)) this.fail("E_OPTION", "metadataFiles must be an array");
      for (const file of options.metadataFiles ?? []) {
        const path = file.source ?? file.base;
        if (path && !path.endsWith(".json")) this.fail("E_OPTION", "Metadata files must be JSON; YAML is unsupported");
      }
      this.metadataJson = options.metadataJson;
      this.metadataFiles = options.metadataFiles;
      if (options.standalone !== undefined && typeof options.standalone !== "boolean") this.fail("E_OPTION", "standalone must be boolean");
      if (options.rawContent !== undefined && !["reject", "escape", "retain"].includes(options.rawContent)) this.fail("E_OPTION", "Invalid rawContent policy");
      if (options.metadata !== undefined && (options.metadata === null || typeof options.metadata !== "object" || Array.isArray(options.metadata))) this.fail("E_OPTION", "metadata must be a map of MetaValue nodes");
      this.standalone = options.standalone === true;
      this.rawContent = options.rawContent;
      this.metadata = options.metadata;
    }
  }
  readonly registry = createFormatRegistry(undefined, this.context, this.operation);
  async preflightOptions(): Promise<void> {
    if (this.metadata) this.metadata = (await this.document({blocks: [], metadata: this.metadata, resources: []})).metadata;
    for (const layer of this.metadataJson ?? []) await mergeJsonMetadata({}, layer, this);
  }
  async readOwned(input: Input, selection: FormatSelection & {reader: ReaderCapability | undefined}, locations: readonly {source: string; line: number; base?: string}[] = []): Promise<Document> {
    this.sourceLocations = locations;
    this.inputBase = input.base;
    try {
      const document = await this.document(await this.call(() => selection.reader!.read(input, this, selection)));
      const origins = async (value: unknown): Promise<void> => {
        await this.cooperate();
        if (!value || typeof value !== "object" || value instanceof Uint8Array) return;
        if ("t" in value && value.t === "Image") {
          const target = (value as Extract<import("./ast-types.js").Inline, {t: "Image" | "Link"}>).c[2];
          if (!this.media.origins.has(target)) this.resourceTarget(target, 1);
        }
        for (const child of Object.values(value)) await origins(child);
      };
      await origins(document.blocks);
      await origins(document.metadata);
      return document;
    } catch (error) {
      if (error instanceof PandocError && locations.length && error.code !== "E_CANCELLED" && error.code !== "E_IO")
        throw new PandocError(error.code, this.operation, error.message, error.format, this.sourceLocation(error.location));
      if (error instanceof PandocError && input.base && error.code === "E_PARSE")
        throw new PandocError(error.code, this.operation, error.message, error.format, `${input.base}:${error.location ?? "1:1"}`);
      throw error;
    } finally {
      this.sourceLocations = [];
      this.inputBase = undefined;
    }
  }
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
      ...(input.source === undefined ? {} : {source: input.source}),
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
    const transfer = async (original: unknown, copy: unknown): Promise<void> => {
      await this.cooperate();
      if (!original || !copy || typeof original !== "object" || typeof copy !== "object" || original instanceof Uint8Array) return;
      const origin = this.media.origins.get(original);
      if (origin) this.media.origins.set(copy, origin);
      for (const key of Object.keys(original)) await transfer((original as Record<string, unknown>)[key], (copy as Record<string, unknown>)[key]);
    };
    await transfer(document, owned);
    return owned;
  }

  async writable(document: Document, math?: "source"): Promise<Document> {
    let metadata = document.metadata;
    for (const file of this.metadataFiles ?? []) {
      const input = await this.input(file, "json");
      const parsed = await parseMetadataJson(input.text!, this, file.source ?? file.base);
      metadata = await mergeJsonMetadata(metadata, parsed, this);
    }
    for (const layer of this.metadataJson ?? []) metadata = await mergeJsonMetadata(metadata, layer, this);
    if (this.metadata) metadata = await mergeMetadata(metadata, this.metadata, this);
    if (metadata !== document.metadata) document = await this.document({...document, metadata});
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
    return await this.media.prepare(document, this.lossy);
  }
  async finish(serialized: SerializedDocument): Promise<ConversionResult> {
    this.checkpoint(0);
    const diagnostics = this.snapshotDiagnostics();
    if (this.failIfWarnings && diagnostics.length) {
      const first = diagnostics[0]!;
      throw new PandocError("E_WARNINGS", this.operation, `Warnings rejected: ${first.code}: ${first.message}`, first.format, first.location);
    }
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
    await this.media.publish();
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
    return await session.readOwned(owned, reader, owned.source ? [{source: owned.source, line: 1, ...(owned.base === undefined ? {} : {base: owned.base})}] : []);
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
    await session.preflightOptions();
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
    if (inputs.length > 1 && !reader.descriptor.operands) session.fail("E_OPTION", "This reader accepts only one input");
    await session.preflightOptions();
    // Account for every operand before invoking readers or writers.
    const ownedInputs: Input[] = [];
    for (const input of inputs) {
      session.charge("references", 1);
      ownedInputs.push(await session.input(input, options.from));
    }
    const blocks: Document["blocks"][number][] = [];
    let metadata: Record<string, MetaValue> = {};
    const resources: Document["resources"][number][] = [];
    const settings: { language?: string; direction?: "ltr" | "rtl" | "auto" } = {};
    let readerInputs = ownedInputs;
    const joinedLocations: {source: string; line: number; base?: string}[] = [];
    if (reader.descriptor.operands === "join" && ownedInputs.length) {
      const parts: string[] = [];
      let line = 1;
      for (const input of ownedInputs) {
        const text = input.text!;
        joinedLocations.push({source: input.source ?? `input[${parts.length}]`, line, ...(input.base === undefined ? {} : {base: input.base})});
        session.charge("retainedBytes", text.length * 2 + 2);
        const part = text.endsWith("\n") ? text : text + "\n";
        parts.push(part);
        for (let offset = 0; offset < part.length; offset++) {
          session.checkpoint();
          if (part[offset] === "\n") line++;
          if (offset % 256 === 0) await session.cooperate(0);
        }
      }
      const text = parts.join("");
      session.charge("retainedBytes", text.length * 2);
      session.charge("retainedBytes", text.length * 3);
      const bytes = new TextEncoder().encode(text);
      readerInputs = [{text, bytes, ...(ownedInputs[0]!.base === undefined ? {} : {base: ownedInputs[0]!.base})}];
    }
    for (const [index, input] of readerInputs.entries()) {
      const locations = reader.descriptor.operands === "join" ? joinedLocations : input.source ? [{source: input.source, line: 1, ...(input.base === undefined ? {} : {base: input.base})}] : [];
      const document = await session.readOwned(input, reader, locations);
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
        metadata = await mergeMetadata(metadata, {[key]: value}, session);
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
