import {SaxesParser} from "saxes";
import {createZipCodec, type ZipLimits, type ZipEntry} from "@poe-code/office-package/zip";
import {createCompressionCodec} from "@poe-code/compression";
import {PandocError} from "./errors.js";
import type {AdapterContext} from "./types.js";

export const odtNamespaces = Object.fromEntries(["office", "text", "style", "table", "draw", "manifest"].map(name => [name, `urn:oasis:names:tc:opendocument:xmlns:${name === "draw" ? "drawing" : name}:1.0`])) as Record<"office" | "text" | "style" | "table" | "draw" | "manifest", string>;
export const odtMime = "application/vnd.oasis.opendocument.text";
export const fo = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0";
export const xlink = "http://www.w3.org/1999/xlink";
export const svg = "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0";
export interface OdtElement {name: string; uri: string; attrs: {name: string; uri: string; value: string}[]; children: (OdtElement | string)[]}
export function odtAttribute(node: OdtElement, name: string, uri: string): string {
  return node.attrs.find(a => a.name === name && a.uri === uri)?.value ?? "";
}
export function odtChildren(node: OdtElement, name: string, uri: string): OdtElement[] {
  return node.children.filter((child): child is OdtElement => typeof child !== "string" && child.name === name && child.uri === uri);
}
export function odtFailure(ctx: AdapterContext, message: string, code: "E_PARSE" | "E_LIMIT" | "E_RESOURCE" | "E_UNSUPPORTED_FEATURE" = "E_PARSE"): never {
  throw new PandocError(code, ctx.operation ?? "read", message, "odt");
}
export async function parseOdtXml(bytes: Uint8Array, ctx: AdapterContext): Promise<OdtElement> {
  ctx.bound("binaryBytes", bytes.length);
  const text = await ctx.decodeUtf8([bytes]);
  const parser = new SaxesParser({xmlns: true});
  const stack: OdtElement[] = [];
  let root: OdtElement | undefined;
  parser.on("error", error => odtFailure(ctx, `Invalid ODT XML: ${error.message}`));
  parser.on("doctype", () => odtFailure(ctx, "ODT DTD and external entities are forbidden"));
  parser.on("opentag", tag => {
    ctx.checkpoint(); ctx.bound("xmlDepth", stack.length + 1); ctx.charge("xmlNodes", 1);
    ctx.charge("attributes", Object.keys(tag.attributes).length);
    ctx.charge("retainedBytes", 128 + Object.keys(tag.attributes).length * 64);
    const node: OdtElement = {name: tag.local, uri: tag.uri, attrs: Object.values(tag.attributes).map(a => ({name: a.local, uri: a.uri, value: a.value})), children: []};
    if (stack.length) stack.at(-1)!.children.push(node); else root = node;
    stack.push(node);
  });
  parser.on("closetag", () => {stack.pop();});
  const append = (value: string) => {ctx.charge("retainedBytes", value.length * 2); if (stack.length) stack.at(-1)!.children.push(value);};
  parser.on("text", append); parser.on("cdata", append);
  for (let i = 0; i < text.length; i += 4096) {parser.write(text.slice(i, i + 4096)); await ctx.cooperate(4096);}
  parser.close();
  return root ?? odtFailure(ctx, "Missing ODT XML root");
}
export function odtPackage(ctx: AdapterContext) {
  const signal = ctx.signal ?? new AbortController().signal;
  const limits: ZipLimits = {maxArchiveBytes: Math.max(ctx.limits.compressedBytes, ctx.limits.outputBytes), maxEntryBytes: ctx.limits.expandedBytes, maxTotalBytes: ctx.limits.expandedBytes, maxMembers: ctx.limits.parts, maxPathBytes: ctx.limits.text, maxDepth: ctx.limits.depth, maxPaxBytes: ctx.limits.binaryBytes, maxTextBytes: ctx.limits.text, chunkSize: 4096};
  const codec = createZipCodec({compression: createCompressionCodec(), yieldTurn: async () => ctx.cooperate(), fail: message => odtFailure(ctx, message, message.includes("limit") ? "E_LIMIT" : "E_PARSE")}, {rejectDuplicateNames: true, validatePayloads: true, allowStoredCompressionFlags: true});
  return {
    async read(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
      ctx.bound("compressedBytes", bytes.length);
      const archive = await codec.readZipArchive(bytes, {...limits, maxArchiveBytes: ctx.limits.compressedBytes}, signal);
      ctx.charge("parts", archive.entries.length);
      const parts = new Map<string, Uint8Array>();
      for (const entry of archive.entries) {
        if (entry.symlink || entry.name.includes("\\") || entry.name.includes(":")) odtFailure(ctx, "Unsafe ODT package member");
        const chunks: Uint8Array[] = []; let size = 0;
        for await (const chunk of codec.decodeZipEntry(entry, limits, signal)) {ctx.charge("expandedBytes", chunk.length); ctx.charge("retainedBytes", chunk.length * 2); chunks.push(chunk); size += chunk.length;}
        if (entry.directory) continue;
        const data = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) {data.set(chunk, offset); offset += chunk.length;}
        parts.set(entry.name, data);
      }
      if (new TextDecoder().decode(parts.get("mimetype")) !== odtMime) odtFailure(ctx, "Invalid or missing ODT mimetype");
      return parts;
    },
    async write(parts: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array> {
      const entries: ZipEntry[] = [];
      for (const [name, bytes] of parts) {
        ctx.charge("parts", 1); ctx.charge("expandedBytes", bytes.length); ctx.charge("retainedBytes", bytes.length);
        const entry = await codec.makeZipEntry(name, bytes, {modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store"}, limits, signal);
        if (name === "mimetype") {entry.localExtra = new Uint8Array(); entry.centralExtra = new Uint8Array();}
        entries.push(entry);
      }
      return codec.writeZipArchive({entries, comment: new Uint8Array()}, {...limits, maxArchiveBytes: ctx.limits.outputBytes}, signal);
    }
  };
}
