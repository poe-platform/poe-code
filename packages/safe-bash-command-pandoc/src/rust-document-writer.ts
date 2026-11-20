import {convert} from "@poe-code/document-converter-rust";
import {PandocError} from "./errors.js";
import {htmlImageSources} from "./html.js";
import {renderedDocumentMetadata} from "./metadata.js";
import type {AdapterContext, DiagnosticCode, Document, Limits, WriterCapability} from "./types.js";

/** Apply explicit raw policy before the built-in writer acquires image resources. */
export async function prepareRustDocument(document: Document, ctx: AdapterContext): Promise<void> {
  if (ctx.rawContent !== "reject" && ctx.rawContent !== "escape") return;
  const visit = async (value: unknown): Promise<void> => {
    await ctx.cooperate();
    if (!value || typeof value !== "object") return;
    const node = value as {t?: string; c?: unknown};
    if (node.t === "Image") return;
    if (node.t === "RawInline" || node.t === "RawBlock") {
      const source = (node.c as readonly [string, string])[1];
      if (source && ctx.rawContent === "reject") throw new PandocError("E_CAPABILITY", ctx.operation ?? "write", "Raw content rejected by output policy");
      if (ctx.rawContent === "escape") {
        if (node.t === "RawBlock") {
          ctx.charge("references", 1); ctx.charge("retainedBytes", 64);
          node.t = "Para"; node.c = [{t: "Str", c: source}];
        } else {node.t = "Str"; node.c = source;}
      }
      return;
    }
    for (const child of Object.values(value)) await visit(child);
  };
  await visit(document.blocks);
  await visit(await renderedDocumentMetadata(document.metadata, ctx));
}

/** Preserve Session's host capabilities; all document layout/serialization runs in Rust. */
export async function writeRustDocument(document: Document, ctx: AdapterContext, format: "docx" | "pdf") {
  const resources = new Map(document.resources.map(resource => [resource.id, resource.bytes]));
  const images = new Set<string>();
  const image = async (source: string): Promise<void> => {
    ctx.charge("images", 1);
    if (images.has(source)) return;
    images.add(source);
    let bytes = resources.get(source) ?? await ctx.resources?.resolve(source, undefined, ctx.signal);
    if (!bytes && /^data:image\/(?:png|jpe?g|gif|bmp|x-ms-bmp|tiff?);base64,/i.test(source)) {
      let decoded: string;
      try {decoded = atob(source.slice(source.indexOf(",") + 1));}
      catch {throw new PandocError("E_RESOURCE", ctx.operation ?? "write", "Invalid base64 image resource", format);}
      ctx.charge("resources", 1);
      ctx.charge("retainedBytes", decoded.length * 2);
      bytes = new Uint8Array(decoded.length);
      for (let offset = 0; offset < decoded.length; offset++) {
        bytes[offset] = decoded.charCodeAt(offset);
        if (offset % 4096 === 0) await ctx.cooperate();
      }
    }
    if (!bytes) throw new PandocError(format === "pdf" ? "E_CAPABILITY" : "E_RESOURCE", ctx.operation ?? "write", `Missing image resource: ${source}`, format);
    ctx.charge("resourceBytes", bytes.length); ctx.charge("retainedBytes", bytes.length); resources.set(source, bytes);
  };
  const visit = async (value: unknown, descriptive = false): Promise<void> => {
    await ctx.cooperate();
    if (typeof value === "string") {ctx.charge("retainedBytes", value.length * 2); return;}
    if (Array.isArray(value)) {for (const child of value) await visit(child, descriptive); return;}
    if (!value || typeof value !== "object") return;
    const node = value as {t?: string; c?: unknown};
    if (node.t) {ctx.charge("references", 1); ctx.charge("retainedBytes", 64);}
    if (node.t === "Image" && !descriptive) {
      const source = (node.c as readonly [unknown, unknown, readonly [string, string]])[2][0];
      await image(source);
    }
    if ((node.t === "RawInline" || node.t === "RawBlock") && !descriptive) {
      const [language, source] = node.c as readonly [string, string];
      if (language === "html" || language === "html5") for (const target of await htmlImageSources(source, ctx)) await image(target.source);
    }
    for (const child of Object.values(value)) await visit(child, descriptive || node.t === "Image");
  };
  await visit(document.blocks);
  await visit(await renderedDocumentMetadata(document.metadata, ctx));
  if (format === "pdf") for (const key of ["subject", "keywords"]) await visit(document.metadata[key], true);
  // Force a scheduling checkpoint before starting cooperative Rust conversion.
  await ctx.cooperate(256);
  try {
    const result = await convert({mode: "pandoc", format,
      document: {blocks: document.blocks, metadata: document.metadata, ...(document.language === undefined ? {} : {language: document.language}), ...(document.direction === undefined ? {} : {direction: document.direction})},
      resources: [...images].map(id => ({id, bytes: resources.get(id)!})),
      options: {lossy: ctx.lossy, pdf: ctx.pdf, pdfPage: ctx.pdfPage, pdfFonts: ctx.pdfFonts},
      limits: Object.fromEntries(Object.entries(ctx.limits).filter(([,value]) => Number.isFinite(value)))
    }, {signal: ctx.signal, cooperate: () => ctx.cooperate(256)});
    const budgetMap: Record<string, keyof Limits> = {fontBytes: "binaryBytes", fonts: "fonts", glyphs: "glyphs", pages: "pages", objects: "objects", imageBytes: "binaryBytes", decodedImageBytes: "retainedBytes", layoutWork: "layoutWork"};
    for (const [key, amount] of Object.entries(result.usage)) {
      const mapped = budgetMap[key];
      if (mapped && !(key === "fontBytes" && ctx.pdfFonts !== undefined)) ctx.charge(mapped, amount);
      if (key === "fontBytes" || key === "imageBytes") ctx.charge("retainedBytes", amount);
    }
    await ctx.cooperate(256);
    ctx.bound("outputBytes", result.bytes.length); ctx.charge("retainedBytes", result.bytes.length);
    for (const diagnostic of result.diagnostics) ctx.report({...diagnostic, code: diagnostic.code as DiagnosticCode, operation: ctx.operation ?? "write", format});
    return {kind: "binary" as const, bytes: result.bytes};
  } catch (error) {
    if (error instanceof PandocError) throw error;
    const candidate = error as {code?: DiagnosticCode; message?: string};
    throw new PandocError(candidate.code ?? "E_PARSE", ctx.operation ?? "write", candidate.message ?? "Document conversion failed", format);
  }
}
export function rustDocumentWriter(format: "docx" | "pdf"): WriterCapability {
  return {format, ...(format === "pdf" ? {math: "source" as const} : {}), imageResources: "embed", write: (document,ctx) => writeRustDocument(document,ctx,format)};
}
