import { normalizeDocument, AstError } from "./ast.js";
import type { MetaValue } from "./ast-types.js";
import { formatCapabilities } from "./formats.js";
import type {
  AdapterContext,
  ConversionContext,
  ConversionOptions,
  ConversionResult,
  Diagnostic,
  DiagnosticCode,
  Document,
  Input,
  Limits,
  Operation,
  ReadOptions,
  SerializedDocument,
  WriteOptions
} from "./types.js";

export class PandocError extends Error implements Diagnostic {
  constructor(
    readonly code: DiagnosticCode,
    readonly operation: Operation,
    message: string,
    readonly format?: string,
    readonly location?: string
  ) {
    super(message);
    this.name = "PandocError";
  }
}
const ceilings: Limits = Object.freeze({
  inputBytes: 32 * 1024 * 1024,
  resourceBytes: 64 * 1024 * 1024,
  outputBytes: 64 * 1024 * 1024,
  nodes: 100_000,
  depth: 128,
  work: 1_000_000
});

class Session implements AdapterContext {
  readonly limits: Limits;
  readonly signal: AbortSignal | undefined;
  readonly resources: AdapterContext["resources"];
  private work = 0;
  private inputBytes = 0;
  private resourceBytes = 0;
  constructor(
    readonly operation: Operation,
    readonly context: ConversionContext
  ) {
    this.signal = context.signal;
    const limits = { ...ceilings };
    for (const [key, value] of Object.entries(context.limits ?? {})) {
      if (
        !Object.hasOwn(ceilings, key) ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > ceilings[key as keyof Limits]
      )
        this.fail("E_OPTION", `Invalid limit: ${key}`);
      limits[key as keyof Limits] = value;
    }
    this.limits = Object.freeze(limits);
    this.resources =
      context.resources === undefined
        ? undefined
        : {
            resolve: async (id, base) => {
              this.checkpoint();
              const bytes = await this.call(() =>
                context.resources!.resolve(id, base, this.signal)
              );
              this.resourceBytes += bytes.byteLength;
              this.bound("resourceBytes", this.resourceBytes);
              this.checkpoint(Math.ceil(bytes.byteLength / 4096));
              return new Uint8Array(bytes);
            }
          };
    this.checkpoint(0);
  }
  fail(code: DiagnosticCode, message: string): never {
    throw new PandocError(code, this.operation, message);
  }
  checkpoint(units = 1): void {
    if (this.signal?.aborted) this.fail("E_CANCELLED", "Conversion cancelled");
    if (!Number.isSafeInteger(units) || units < 0) this.fail("E_INTERNAL", "Invalid work charge");
    this.work += units;
    this.bound("work", this.work);
  }
  bound(key: keyof Limits, actual: number): void {
    if (actual > this.limits[key])
      this.fail("E_LIMIT", `${key}: ${actual} exceeds ${this.limits[key]}`);
  }
  options(options: ReadOptions | WriteOptions | ConversionOptions): void {
    const allowed =
      this.operation === "read" ? ["from"] : this.operation === "write" ? ["to"] : ["from", "to"];
    if (Object.keys(options).some((key) => !allowed.includes(key)))
      this.fail("E_OPTION", "Unknown or inapplicable option");
  }
  validate(format: string, direction: "read" | "write"): string {
    if (typeof format !== "string" || !format)
      this.fail("E_FORMAT_REQUIRED", "Select an explicit format");
    if (format.includes("+") || format.includes("-"))
      this.fail("E_EXTENSION", "Dialect switches are not implemented by this seam");
    const descriptor = formatCapabilities.find((item) => item.name === format);
    if (!descriptor?.[direction].allowed)
      this.fail("E_FORMAT", `Unsupported ${direction} format: ${format}`);
    const normalized = direction === "write" && format === "html" ? "html5" : format;
    const capability = direction === "read" ? this.context.reader : this.context.writer;
    if (capability?.format !== normalized)
      this.fail("E_CAPABILITY", `No ${direction} capability for ${normalized}`);
    return normalized;
  }
  input(input: Input): Input {
    this.inputBytes += input.bytes.byteLength;
    this.bound("inputBytes", this.inputBytes);
    this.checkpoint(Math.ceil(input.bytes.byteLength / 4096));
    return { ...input, bytes: new Uint8Array(input.bytes) };
  }
  document(document: Document): Document {
    this.checkpoint();
    let owned: Document;
    try {
      owned = normalizeDocument(document, {
        nodes: this.limits.nodes,
        depth: this.limits.depth,
        resourceBytes: this.limits.resourceBytes
      });
    } catch (error) {
      if (error instanceof AstError)
        throw new PandocError(error.code, this.operation, error.message, undefined, error.path);
      throw error;
    }
    let bytes = 0;
    for (const resource of document.resources) bytes += resource.bytes.byteLength;
    this.bound("resourceBytes", bytes);
    return owned;
  }

  writable(document: Document): Document {
    if (this.context.writer?.math !== "source") {
      const visit = (value: unknown, path: string): void => {
        if (value === null || typeof value !== "object" || value instanceof Uint8Array) return;
        if ("t" in value && value.t === "Math")
          throw new PandocError(
            "E_CAPABILITY",
            this.operation,
            "Writer must explicitly preserve typed math source",
            undefined,
            path
          );
        for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
      };
      visit(document.blocks, "$.blocks");
      visit(document.metadata, "$.metadata");
    }
    return document;
  }
  async call<T>(callback: () => Promise<T>): Promise<T> {
    this.checkpoint();
    try {
      const result = await callback();
      this.checkpoint();
      return result;
    } catch (error) {
      if (error instanceof PandocError) throw error;
      this.fail("E_IO", "Capability failed");
    }
  }
  async finish(
    serialized: SerializedDocument,
    diagnostics: readonly Diagnostic[]
  ): Promise<ConversionResult> {
    this.checkpoint();
    const bytes =
      serialized.kind === "text" ? new TextEncoder().encode(serialized.text) : serialized.bytes;
    this.bound("outputBytes", bytes.byteLength);
    this.checkpoint(Math.ceil(bytes.byteLength / 4096));
    const owned =
      serialized.kind === "text"
        ? { kind: "text" as const, text: serialized.text }
        : { kind: "binary" as const, bytes: new Uint8Array(bytes) };
    if (this.context.output)
      await this.call(() => this.context.output!.publish(new Uint8Array(bytes), this.signal));
    return { ...owned, diagnostics: structuredClone(diagnostics) };
  }
}

export async function readDocument(
  input: Input,
  options: ReadOptions,
  context: ConversionContext
): Promise<Document> {
  const session = new Session("read", context);
  session.options(options);
  session.validate(options.from, "read");
  return session.document(
    await session.call(() => context.reader!.read(session.input(input), session))
  );
}
export async function writeDocument(
  document: Document,
  options: WriteOptions,
  context: ConversionContext
): Promise<ConversionResult> {
  const session = new Session("write", context);
  session.options(options);
  session.validate(options.to, "write");
  return session.finish(
    await session.call(() =>
      context.writer!.write(session.writable(session.document(document)), session)
    ),
    []
  );
}
export async function convert(
  inputs: readonly Input[],
  options: ConversionOptions,
  context: ConversionContext
): Promise<ConversionResult> {
  const session = new Session("convert", context);
  session.options(options);
  session.validate(options.from, "read");
  session.validate(options.to, "write");
  // Account for every input before callbacks, retaining independent reader boundaries.
  const ownedInputs = inputs.map((input) => session.input(input));
  const blocks: Document["blocks"][number][] = [];
  const metadata: Record<string, MetaValue> = {};
  const resources: Document["resources"][number][] = [];
  const diagnostics: Diagnostic[] = [];
  const settings: { language?: string; direction?: "ltr" | "rtl" | "auto" } = {};
  for (const [index, input] of ownedInputs.entries()) {
    const document = session.document(
      await session.call(() => context.reader!.read(input, session))
    );
    for (const key of ["language", "direction"] as const) {
      if (Object.hasOwn(document, key)) {
        if (Object.hasOwn(settings, key))
          diagnostics.push({
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
    blocks.push(...document.blocks);
    resources.push(...document.resources);
    for (const [key, value] of Object.entries(document.metadata)) {
      if (Object.hasOwn(metadata, key))
        diagnostics.push({
          code: "W_METADATA_CONFLICT",
          operation: "convert",
          message: `Later metadata replaces ${key}`,
          location: `input[${index}].metadata.${key}`
        });
      Object.defineProperty(metadata, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
  }
  const document = session.document({ blocks, metadata, resources, ...settings });
  return session.finish(
    await session.call(() => context.writer!.write(session.writable(document), session)),
    diagnostics
  );
}
