import { normalizeDocumentCooperatively, AstError } from "./ast.js";
import type { MetaValue } from "./ast-types.js";
import { createFormatRegistry } from "./formats.js";
import { ExecutionContext } from "./execution.js";
import { ResourceSession } from "./resources.js";
import { PandocError } from "./errors.js";
import { mergeMetadata, mergeJsonMetadata, parseMetadataJson } from "./metadata.js";
import type { FormatSelection } from "./formats.js";
export { PandocError } from "./errors.js";
const defaultPdfLimits = Object.freeze({ fontBytes: Infinity, fonts: Infinity });
import type {
  ConversionContext,
  ConversionOptions,
  ConversionResult,
  Document,
  Input,
  InputSource,
  StreamingInput,
  ReadOptions,
  SerializedDocument,
  WriteOptions,
  Diagnostic,
  FilterRequest,
  ReaderCapability,
  WriterCapability
} from "./types.js";

import {streamRetainedDocument} from "./stream-retained.js";
import {readRetainedJson} from "./retained-json.js";
import {streamDelimited} from "./stream-delimited.js";
import type {OutputConversionContext, ConversionSummary} from "./types.js";
import {LocalTemplate} from "./templates.js";

class Session extends ExecutionContext {
  localTemplate: LocalTemplate | undefined;
  variables: WriteOptions["variables"];
  fileScope = false;
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
  embedResources = false;
  yes = false;
  rawContent: WriteOptions["rawContent"];
  metadata: WriteOptions["metadata"];
  pdfPage: WriteOptions["pdfPage"];
  pdf: WriteOptions["pdf"];
  epub: WriteOptions["epub"];
  pdfFonts: readonly import("safe-bash-pdf-engine").SuppliedFont[] | undefined;
  pdfFontInputs: WriteOptions["pdfFonts"];
  wrap: WriteOptions["wrap"];
  columns: number | undefined;
  numberSections = false;
  toc = false;
  ascii = false;
  stripComments = false;
  shiftHeadingLevelBy = 0;
  eol: WriteOptions["eol"];
  options(options: ReadOptions | WriteOptions | ConversionOptions): void {
    const allowed =
      this.operation === "read" ? ["from"] : this.operation === "write" ? ["to", "wrap", "lossy", "standalone", "metadata", "rawContent"] : ["from", "to", "wrap", "lossy", "standalone", "metadata", "rawContent"];
    if (this.operation === "convert") allowed.push("filters");
    if (this.operation !== "read") allowed.push("columns", "numberSections", "toc", "ascii", "stripComments", "shiftHeadingLevelBy", "eol", "yes", "failIfWarnings", "metadataJson", "metadataFiles", "resourcePath", "extractMedia", "pdfPage", "pdfFonts", "pdf", "epub", "template", "variables", "includeInHeader", "includeBeforeBody", "includeAfterBody", "fileScope", "sandbox", "embedResources");
    if (Object.keys(options).some((key) => !allowed.includes(key)))
      this.fail("E_OPTION", "Unknown or inapplicable option");
    if ("wrap" in options && !["none", "auto", "preserve"].includes(options.wrap!)) this.fail("E_OPTION", "Invalid wrap policy");
    if ("wrap" in options && options.wrap !== "none" && "to" in options && !["plain", "commonmark", "gfm"].includes(this.registry.resolve(options.to, "write").descriptor.name)) this.fail("E_OPTION", "This writer supports only wrap none");
    if ("lossy" in options && typeof options.lossy !== "boolean") this.fail("E_OPTION", "lossy must be boolean");
    this.lossy = "lossy" in options && options.lossy === true;
    if ("to" in options) {
      for (const key of ["fileScope", "sandbox"] as const) if (options[key] !== undefined && typeof options[key] !== "boolean") this.fail("E_OPTION", `${key} must be boolean`);
      this.fileScope = options.fileScope === true;
      for (const key of ["includeInHeader", "includeBeforeBody", "includeAfterBody"] as const) if (options[key] !== undefined && !Array.isArray(options[key])) this.fail("E_OPTION", `${key} must be an array`);
      if (options.variables !== undefined && (!options.variables || typeof options.variables !== "object" || Array.isArray(options.variables))) this.fail("E_OPTION", "variables must be a map");
      this.variables = options.variables;
      for (const input of [...(options.template ? [options.template] : []), ...(options.includeInHeader ?? []), ...(options.includeBeforeBody ?? []), ...(options.includeAfterBody ?? [])]) if (!input || typeof input !== "object" || (!("bytes" in input) && !("chunks" in input))) this.fail("E_OPTION", "Invalid local template/include input");
      const local = options.template || options.includeInHeader?.length || options.includeBeforeBody?.length || options.includeAfterBody?.length;
      if (local && !["html", "html5"].includes(this.registry.resolve(options.to, "write").descriptor.name)) this.fail("E_OPTION", "Local templates and includes currently require HTML output");
      if (local) this.localTemplate = new LocalTemplate(this, options);
      for (const key of ["numberSections", "toc", "ascii", "stripComments"] as const) {
        if (options[key] !== undefined && typeof options[key] !== "boolean") this.fail("E_OPTION", `${key} must be boolean`);
        this[key] = options[key] === true;
      }
      if (options.columns !== undefined && (!Number.isSafeInteger(options.columns) || options.columns < 1)) this.fail("E_OPTION", "columns must be a positive integer");
      if (options.shiftHeadingLevelBy !== undefined && (!Number.isInteger(options.shiftHeadingLevelBy) || Math.abs(options.shiftHeadingLevelBy) > 6)) this.fail("E_OPTION", "heading shift must be between -6 and 6");
      if (options.eol !== undefined && !["lf", "crlf", "native"].includes(options.eol)) this.fail("E_OPTION", "Invalid eol policy");
      this.wrap = options.wrap;
      this.columns = options.columns;
      this.shiftHeadingLevelBy = options.shiftHeadingLevelBy ?? 0;
      this.eol = options.eol;
      this.media.configure(options);
      this.registry.validateOptions(options.to, "write", Object.keys(options).filter(key => !["from", "to", "filters", "yes", "lossy", "stripComments", "shiftHeadingLevelBy", "eol", "failIfWarnings", "metadata", "metadataJson", "metadataFiles", "resourcePath", "extractMedia", "template", "variables", "includeInHeader", "includeBeforeBody", "includeAfterBody", "fileScope", "sandbox", "embedResources"].includes(key) && !(key === "standalone" && options.standalone === false)));
      if (options.yes !== undefined && typeof options.yes !== "boolean") this.fail("E_OPTION", "yes must be boolean");
      this.yes = options.yes === true;
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
      this.embedResources = Boolean((options as { embedResources?: boolean }).embedResources);
      this.standalone = options.template ? false : options.standalone === true || this.embedResources || Boolean(options.includeInHeader?.length || options.includeBeforeBody?.length || options.includeAfterBody?.length);
      this.rawContent = options.rawContent;
      this.metadata = options.metadata;
      if (options.pdf !== undefined) {
        const pdf = options.pdf;
        if (!pdf || typeof pdf !== "object" || Array.isArray(pdf) || Object.keys(pdf).some(key => !["pageSize", "orientation", "margin", "font", "fontSize", "lineHeight"].includes(key))) this.fail("E_OPTION", "Invalid PDF options");
        if (pdf.pageSize !== undefined && !["a4", "letter"].includes(pdf.pageSize) || pdf.orientation !== undefined && !["portrait", "landscape"].includes(pdf.orientation) || pdf.font !== undefined && !["serif", "sans", "mono"].includes(pdf.font)) this.fail("E_OPTION", "Invalid PDF named option");
        for (const [value, min, max] of [[pdf.margin, 0, 144], [pdf.fontSize, 6, 72], [pdf.lineHeight, 1, 3]] as const) if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) this.fail("E_OPTION", "Invalid PDF numeric option");
        if (pdf.font !== undefined && pdf.font !== "mono") this.fail("E_CAPABILITY", `Bundled PDF ${pdf.font} family is unavailable; supply an explicit font resource or select mono`);
        if (options.pdfPage !== undefined) this.fail("E_OPTION", "pdf and pdfPage geometry cannot be combined");
        const [width, height] = pdf.pageSize === "letter" ? [612, 792] : [595.28, 841.89];
        this.pdfPage = pdf.orientation === "landscape" ? {width: height!, height: width!, margin: pdf.margin ?? 54} : {width: width!, height: height!, margin: pdf.margin ?? 54};
        this.pdf = {...pdf};
      }
      if (options.epub !== undefined) {
        const epub = options.epub;
        if (!epub || typeof epub !== "object" || Array.isArray(epub) || Object.keys(epub).some(key => !["title", "language", "identifier", "chapterLevel"].includes(key))) this.fail("E_OPTION", "Invalid EPUB options");
        for (const value of [epub.title, epub.language, epub.identifier]) if (value !== undefined && (typeof value !== "string" || !value.trim() || [...value].some(char => char.charCodeAt(0) < 32))) this.fail("E_OPTION", "EPUB publication options must be nonempty text");
        if (epub.language !== undefined) {
          const parts = epub.language.split("-");
          if (parts[0]!.length < 2 || parts.some((part, index) => !part || part.length > 8 || [...part].some(char => !(char.toLowerCase() >= "a" && char.toLowerCase() <= "z") && !(index > 0 && char >= "0" && char <= "9")))) this.fail("E_OPTION", "Invalid EPUB language tag");
        }
        if (epub.chapterLevel !== undefined && (!Number.isInteger(epub.chapterLevel) || epub.chapterLevel < 1 || epub.chapterLevel > 6)) this.fail("E_OPTION", "EPUB chapter level must be 1 through 6");
        this.epub = {...epub};
      }
      if (options.pdfPage !== undefined) {
        const page = options.pdfPage;
        if (!page || typeof page !== "object" || Object.keys(page).some(key => !["width", "height", "margin"].includes(key)) || ![page.width, page.height, page.margin].every(Number.isFinite) || page.margin < 0 || page.width <= 2 * page.margin || page.height <= 2 * page.margin) this.fail("E_OPTION", "Invalid PDF page geometry");
        this.pdfPage = {...page};
      }
      if (options.pdfFonts !== undefined) {
        if (!Array.isArray(options.pdfFonts) || !options.pdfFonts.length) this.fail("E_OPTION", "pdfFonts requires nonempty ordered sources");
        this.bound("fonts", options.pdfFonts.length);
        if (options.pdfFonts.length > defaultPdfLimits.fonts) this.fail("E_LIMIT", "PDF font count exceeds engine limit");
        this.pdfFontInputs = options.pdfFonts;
      }
    }
  }
  readonly registry = createFormatRegistry(undefined, this.context, this.operation);
  async admitFilters(requests: ConversionOptions["filters"]): Promise<FilterRequest[]> {
    const filters: FilterRequest[] = [];
    if (requests !== undefined) {
      if (!Array.isArray(requests)) this.fail("E_OPTION", "filters must be an array");
      this.charge("references", requests.length);
      for (const request of requests) {
        this.checkpoint();
        if (!request || !["json", "lua", "citeproc"].includes(request.kind) ||
            (request.kind !== "citeproc" && (typeof request.path !== "string" || !request.path)))
          this.fail("E_OPTION", "Invalid filter request");
        if (request.kind !== "citeproc") this.charge("text", request.path.length);
        filters.push(Object.freeze(request.kind === "citeproc" ? {kind: request.kind} : {kind: request.kind, path: request.path}));
      }
      if (filters.length && (!this.context.filters || typeof this.context.filters.apply !== "function" ||
          (this.context.filters.supports !== undefined && typeof this.context.filters.supports !== "function")))
        this.fail("E_CAPABILITY", "Filters and citeproc require an explicitly supplied filter capability");
      if (this.context.filters?.supports) for (const request of filters) {
        if (await this.call(async () => this.context.filters!.supports!(request)) !== true)
          this.fail("E_CAPABILITY", `Filter capability does not support ${request.kind} processing`);
      }
    }
    return filters;
  }
  async preflightOptions(): Promise<void> {
    if (this.variables) await mergeJsonMetadata({}, this.variables, this);
    await this.localTemplate?.acquire();
    if (this.metadata) this.metadata = (await this.document({blocks: [], metadata: this.metadata, resources: []})).metadata;
    for (const layer of this.metadataJson ?? []) await mergeJsonMetadata({}, layer, this);
    if (this.pdfFontInputs) {
            const fonts: import("safe-bash-pdf-engine").SuppliedFont[] = [];
      let fontBytes = 0;
      for (let i = 0; i < this.pdfFontInputs.length; i++) {
        const input = this.pdfFontInputs[i]!;
        if (!input || typeof input !== "object" || !("bytes" in input || "chunks" in input)) this.fail("E_OPTION", "Invalid PDF font input");
        const chunks = (async function* (this: Session) {
          for await (const chunk of "bytes" in input ? [input.bytes] : input.chunks) {
            this.checkpoint(0);
            if (!(chunk instanceof Uint8Array)) this.fail("E_IO", "Font sources must yield bytes");
            fontBytes += chunk.byteLength;
            if (fontBytes > defaultPdfLimits.fontBytes) this.fail("E_LIMIT", "PDF font bytes exceed engine limit");
            yield chunk;
          }
        }).call(this);
        const bytes = await this.acquire(chunks, "binaryBytes");
        fonts.push({id: `supplied-${i}`, bytes});
      }
      this.pdfFonts = fonts;
    }
  }
  async readOwned(input: Input | StreamingInput, selection: FormatSelection & {reader: ReaderCapability | undefined}, locations: readonly {source: string; line: number; base?: string}[] = []): Promise<Document> {
    this.sourceLocations = locations;
    this.inputBase = input.base;
    try {
      const document = await this.document(await this.call(() => "chunks" in input ? selection.reader!.readStream!(input, this, selection) : selection.reader!.read(input, this, selection)));
      const originStack: unknown[] = [document.metadata, document.blocks];
      while (originStack.length > 0) {
        const p = this.cooperateFast();
        if (p) await p;
        const value = originStack.pop();
        if (!value || typeof value !== "object" || value instanceof Uint8Array) continue;
        if ("t" in value && value.t === "Image") {
          const target = (value as Extract<import("./ast-types.js").Inline, {t: "Image" | "Link"}>).c[2];
          if (!this.media.origins.has(target)) this.resourceTarget(target, 1);
        }
        if (Array.isArray(value)) {
          for (let i = value.length - 1; i >= 0; i--) {
            const child = value[i];
            if (child && typeof child === "object") originStack.push(child);
          }
        } else {
          const vals = Object.values(value);
          for (let i = vals.length - 1; i >= 0; i--) {
            const child = vals[i];
            if (child && typeof child === "object") originStack.push(child);
          }
        }
      }
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
  async input(input: InputSource, format: string): Promise<Input | StreamingInput> {
    const { descriptor, reader } = this.registry.resolve(format, "read");
    if (this.workingFiles && reader?.readStream && descriptor.inputEncoding === "bytes" && "chunks" in input) return input;
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
        (units) => this.cooperateFast(units),
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
    const transferOrig: unknown[] = [document];
    const transferCopy: unknown[] = [owned];
    while (transferOrig.length > 0) {
      const p = this.cooperateFast();
      if (p) await p;
      const original = transferOrig.pop();
      const copy = transferCopy.pop();
      if (!original || !copy || typeof original !== "object" || typeof copy !== "object" || original instanceof Uint8Array) continue;
      const origin = this.media.origins.get(original);
      if (origin) this.media.origins.set(copy, origin);
      if (Array.isArray(original) && Array.isArray(copy)) {
        for (let i = original.length - 1; i >= 0; i--) {
          const origChild = original[i];
          if (origChild && typeof origChild === "object") {
            transferOrig.push(origChild);
            transferCopy.push(copy[i]);
          }
        }
      } else {
        const keys = Object.keys(original);
        for (let i = keys.length - 1; i >= 0; i--) {
          const key = keys[i]!;
          const origChild = (original as Record<string, unknown>)[key];
          if (origChild && typeof origChild === "object") {
            transferOrig.push(origChild);
            transferCopy.push((copy as Record<string, unknown>)[key]);
          }
        }
      }
    }
    return owned;
  }

  async writable(document: Document, writer: WriterCapability, filters?: ConversionOptions["filters"], to?: string): Promise<Document> {
    let metadata = document.metadata;
    for (const file of this.metadataFiles ?? []) {
      const input = await this.input(file, "json");
      const parsed = await parseMetadataJson((input as Input).text!, this, file.source ?? file.base);
      metadata = await mergeJsonMetadata(metadata, parsed, this);
    }
    for (const layer of this.metadataJson ?? []) metadata = await mergeJsonMetadata(metadata, layer, this);
    if (this.metadata) metadata = await mergeMetadata(metadata, this.metadata, this);
    if (metadata !== document.metadata) document = await this.document({...document, metadata});
    for (const request of filters ?? []) {
      document = await this.document(await this.call(() => this.context.filters!.apply(document, {...request}, Object.assign(this, {to: to!}))));
    }
    if (writer.math !== "source") {
      const visit = async (value: unknown, path: string): Promise<void> => {
        { const p = this.cooperateFast(); if (p) await p; }
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
    if (this.shiftHeadingLevelBy || this.stripComments) {
      const visit = async (value: unknown): Promise<void> => {
        { const p = this.cooperateFast(); if (p) await p; }
        if (!value || typeof value !== "object" || value instanceof Uint8Array) return;
        const node = value as {t?: string; c?: unknown[]};
        if (node.t === "Header" && node.c) {
          const level = Number(node.c[0]) + this.shiftHeadingLevelBy;
          if (level < 1) {node.t = "Para"; node.c = node.c[2] as unknown[];}
          else node.c[0] = Math.min(level, 6);
        }
        if (this.stripComments && ["RawInline", "RawBlock"].includes(node.t ?? "") && node.c?.[0] === "html") {
          const source = String(node.c[1]); let text = ""; let offset = 0;
          while (offset < source.length) {
            this.checkpoint();
            const start = source.indexOf("<!--", offset);
            if (start < 0) {text += source.slice(offset); break;}
            text += source.slice(offset, start);
            const end = source.indexOf("-->", start + 4);
            offset = end < 0 ? source.length : end + 3;
          }
          this.charge("retainedBytes", text.length * 2); node.c[1] = text;
        }
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            await visit(value[i]);
            const child = value[i] as {t?: string; c?: unknown[]} | undefined;
            if (this.stripComments && child && ["RawInline", "RawBlock"].includes(child.t ?? "") && child.c?.[0] === "html" && child.c[1] === "") value.splice(i--, 1);
          }
        } else for (const child of Object.values(value)) await visit(child);
      };
      await visit(document.blocks);
    }
    return await this.media.prepare(document, this.lossy, writer.imageResources === "embed" || this.embedResources);
  }
  async finish(serialized: SerializedDocument): Promise<ConversionResult> {
    this.checkpoint(0);
    if (this.localTemplate) serialized = await this.localTemplate.render(serialized);
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
    if (serialized.kind === "text" && this.eol === "crlf") {
      const parts: string[] = []; let length = 0;
      for (const ch of serialized.text) {
        { const p = this.cooperateFast(); if (p) await p; }
        const part = ch === "\n" ? "\r\n" : ch;
        length += part.length; this.bound("outputBytes", length);
        this.charge("retainedBytes", part.length * 2); this.charge("references", 1); parts.push(part);
      }
      this.charge("retainedBytes", length * 2);
      serialized = {...serialized, text: parts.join("")};
    }
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
        await this.cooperateFast(1);
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
      if (++scanned % 256 === 0) await this.cooperateFast(0);
    }
    await this.cooperateFast(0);
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
      await this.cooperateFast(0);
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
    const owned = await session.writable(await session.document(document), writer.writer!);
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
    const filters = await session.admitFilters(options.filters);
    if (inputs.length > 1 && !reader.descriptor.operands) session.fail("E_OPTION", "This reader accepts only one input");
    await session.preflightOptions();
    // Account for every operand before invoking readers or writers.
    const ownedInputs: (Input | StreamingInput)[] = [];
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
    if (reader.descriptor.operands === "join" && !session.fileScope && ownedInputs.length) {
      const parts: string[] = [];
      let line = 1;
      for (const input of ownedInputs) {
        const text = (input as Input).text!;
        if (parts.length) {
          session.charge("retainedBytes", 2);
          line++;
        }
        joinedLocations.push({source: input.source ?? `input[${parts.length}]`, line, ...(input.base === undefined ? {} : {base: input.base})});
        session.charge("retainedBytes", text.length * 2 + 2);
        const part = text.endsWith("\n") ? text : text + "\n";
        parts.push(part);
        for (let offset = 0; offset < part.length; offset++) {
          session.checkpoint();
          if (part[offset] === "\n") line++;
          if (offset % 256 === 0) await session.cooperateFast(0);
        }
      }
      const text = parts.join("\n");
      session.charge("retainedBytes", text.length * 2);
      session.charge("retainedBytes", text.length * 3);
      const bytes = new TextEncoder().encode(text);
      readerInputs = [{text, bytes, ...(ownedInputs[0]!.base === undefined ? {} : {base: ownedInputs[0]!.base})}];
    }
    for (const [index, input] of readerInputs.entries()) {
      const locations = reader.descriptor.operands === "join" && !session.fileScope ? joinedLocations : input.source ? [{source: input.source, line: 1, ...(input.base === undefined ? {} : {base: input.base})}] : [];
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
        { const p = session.cooperateFast(); if (p) await p; }
      }
      for (const resource of document.resources) {
        resources.push(resource);
        { const p = session.cooperateFast(); if (p) await p; }
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
      writer.writer!, filters, options.to
    );
    return await session.finish(
      await session.call(() => writer.writer!.write(document, session, writer))
    );
  } finally {
    await session.close();
  }
}

/** Convert to an owned output sink without requiring a returned whole payload.
 * The backed table path is incremental; other adapters retain their documented
 * buffering until their streaming implementations are available. */
export async function convertToOutput(inputs: readonly InputSource[], options: ConversionOptions, context: OutputConversionContext): Promise<ConversionSummary> {
  if (!context.output || typeof context.output.write !== "function" || typeof context.output.close !== "function" || typeof context.output.abort !== "function")
    throw new PandocError("E_CAPABILITY", "convert", "An output sink with write, close and abort is required");
  const registry = createFormatRegistry(undefined, context);
  const reader = registry.resolve(options.from, "read"), writer = registry.resolve(options.to, "write");
  const streamedFilters = options.filters === undefined || Array.isArray(options.filters) && options.filters.every(request =>
    request?.kind === "json" && typeof context.filters?.applyJsonStream === "function");
  const backedJson = context.workingFiles && !context.reader && !context.writer && inputs.length === 1
    && reader.descriptor.name === "json" && ["json", "plain", "html5"].includes(writer.descriptor.name) && streamedFilters
    && Object.keys(options).every(key => ["from", "to", "filters", "ascii", "eol", "lossy", "yes", "rawContent", "wrap", "columns", "standalone", "numberSections", "toc", "stripComments", "shiftHeadingLevelBy", "fileScope", "sandbox", "failIfWarnings"].includes(key))
    && Object.entries(context.limits ?? {}).every(([key, value]) => ["inputBytes", "outputBytes"].includes(key) || value === Infinity);
  if (backedJson) {
    const session = new Session("convert", context);
    try {
      session.options(options);
      const filters = await session.admitFilters(options.filters);
      await session.call(() => streamRetainedDocument(() => readRetainedJson(inputs[0]!, session, context.workingFiles!), session, context.workingFiles!, {...options, filters}, writer.descriptor.name as "json" | "plain" | "html5"));
      return {kind: "output", diagnostics: session.snapshotDiagnostics()};
    } finally {await session.close();}
  }
  const incremental = context.workingFiles && !context.reader && !context.writer
    && (reader.descriptor.name === "csv" || reader.descriptor.name === "tsv") && ["html5", "json", "plain"].includes(writer.descriptor.name) && streamedFilters
    && Object.keys(options).every(key => ["from", "to", "filters", "ascii", "eol", "lossy", "yes", "rawContent", "wrap", "columns", "standalone", "numberSections", "toc", "stripComments", "shiftHeadingLevelBy", "fileScope", "sandbox", "failIfWarnings"].includes(key))
    && Object.entries(context.limits ?? {}).every(([key, value]) => (["inputBytes", "outputBytes"].includes(key) || !options.filters?.length && ["tableRows", "tableColumns", "tableCells", "tableFieldText"].includes(key)) || value === Infinity);
  if (!incremental) {
    const result = await convert(inputs, options, context);
    return {kind: "output", diagnostics: result.diagnostics};
  }
  const session = new Session("convert", context);
  try {
    session.options(options);
    const filters = await session.admitFilters(options.filters);
    await session.call(() => streamDelimited(inputs, reader.descriptor.name as "csv" | "tsv", writer.descriptor.name as "html5" | "json" | "plain", session, context.workingFiles!, {...options, filters}));
    return {kind: "output", diagnostics: session.snapshotDiagnostics()};
  } finally {await session.close();}
}

/** Synchronous shortcut probe. The adapter contract requires promises, so decline
 * before invoking any reader; the caller can then await convert exactly once.
 * Keep the published probe signature for existing Shell/SDK callers.
 */
export function convertSync(
  ignoredInputs: readonly Input[],
  ignoredOptions: ConversionOptions,
  ignoredContext: ConversionContext = {}
): SerializedDocument | undefined {
  return undefined;
}
