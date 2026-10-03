import {PandocError} from "./errors.js";
import {PagedStorage} from "safe-bash-io-engine/storage";
import { createZipCodec, ZipDirectoryIndex, type ZipLimits, type ZipSource, type ZipEntry, type ZipStreamEntry } from "@poe-code/office-package/zip";
import { createCompressionCodec } from "@poe-code/compression";
import { attribute as a, children, epubFailure, namespaces as ns, parseEpubXml, xhtmlTree, xmlText, type XmlElement } from "./epub-xml.js";
import { htmlTreeDocument } from "./html.js";
import type { Attr, Block, Inline, MetaValue } from "./ast-types.js";
import type { AdapterContext, Document, Input, StreamingInput, ReaderCapability, Resource } from "./types.js";

interface ManifestItem {
  id: string;
  part: string;
  media: string;
  properties: string[];
  fallback: string;
  overlay: string;
}
interface Chapter {item: ManifestItem; linear: string; xml: XmlElement; blocks: readonly Block[]; language: string}
const tokens = (s: string) => s.split(" ").filter(Boolean);
const uriPart = (part: string) => part.split("/").map(encodeURIComponent).join("/");
const identity = (part: string, fragment = "") => uriPart(part) + (fragment ? `#${encodeURIComponent(fragment)}` : "");

/** Decode each URI component once, preserving literal archive member identity. */
function resolve(target: string, base: string, ctx: AdapterContext): {part: string; fragment: string} {
  ctx.charge("references", 1);
  if (target.includes(":") || target.startsWith("/") || target.includes("\\") || target.includes("?")) epubFailure(ctx, base, "Only internal EPUB resource URIs are admitted");
  const split = target.indexOf("#");
  const path = split < 0 ? target : target.slice(0, split);
  let fragment = "";
  const decode = (s: string): string => {
    try {return decodeURIComponent(s);} catch {return epubFailure(ctx, base, "Invalid EPUB URI escape");}
  };
  if (split >= 0) fragment = decode(target.slice(split + 1));
  if (!path) return {part: base, fragment};
  const parts = base.split("/").slice(0, -1);
  for (const raw of path.split("/")) {
    ctx.checkpoint();
    const p = decode(raw);
    if (p.includes("/") || p.includes("\\") || p.includes(":") || [...p].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) epubFailure(ctx, base, "Unsafe EPUB URI component");
    if (!p || p === ".") continue;
    if (p === "..") {if (!parts.length) epubFailure(ctx, base, "EPUB URI traversal"); parts.pop();}
    else parts.push(p);
  }
  return {part: parts.join("/"), fragment};
}

export const epubReader: ReaderCapability = {
  format: "epub",
  read: readEpub,
  readStream: readEpub
};

async function readEpub(input: Input | StreamingInput, ctx: AdapterContext): Promise<Document> {
    const fail: (part: string, message: string) => never = (part, message) => epubFailure(ctx, part, message);
    const warn = (part: string, message: string, code: "W_RAW_CONTENT" | "W_RESOURCE_MISSING" = "W_RAW_CONTENT") => ctx.report({code, operation: ctx.operation ?? "read", format: "epub", location: part, message});
    const signal = ctx.signal ?? new AbortController().signal;
    const limits: ZipLimits = {maxArchiveBytes: ctx.limits.compressedBytes, maxEntryBytes: ctx.limits.expandedBytes, maxTotalBytes: ctx.limits.expandedBytes, maxMembers: ctx.limits.parts, maxPathBytes: ctx.limits.text, maxDepth: ctx.limits.depth, maxPaxBytes: ctx.limits.binaryBytes, maxTextBytes: ctx.limits.text, chunkSize: 4096};
    const codec = createZipCodec({compression: createCompressionCodec(), yieldTurn: async () => ctx.cooperate(1), fail: message => {
      return epubFailure(ctx, input.source ?? "archive", message, message.includes("limit") ? "E_LIMIT" : "E_PARSE");
    }}, {rejectDuplicateNames: true});
    const working = ctx.workingFiles;
    const cacheBytes = working?.cacheBytes ?? 1024 * 1024;
    if (working && (!Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384 !== 0 || !working.directory.startsWith("/")))
      {throw new PandocError("E_OPTION", ctx.operation ?? "read", "Invalid working storage configuration");}
    const storage = working ? new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal}, cacheBytes / 16384) : undefined;
    const release = storage && ctx.onClose?.(() => storage.close());
    let failure: {reason: unknown} | undefined;
    try {
    let source: ZipSource | undefined;
    if (storage) {
      ctx.charge("retainedBytes", cacheBytes);
      const position = storage.allocate(0);
      let size = 0;
      const chunks = "chunks" in input ? input.chunks : [input.bytes];
      const iterator = Symbol.asyncIterator in chunks ? chunks[Symbol.asyncIterator]() : chunks[Symbol.iterator]();
      let done = false;
      const cleanup = async () => {if (!done) {done = true; await iterator.return?.();}};
      const unregister = ctx.onClose?.(cleanup);
      let inputFailure: {reason: unknown} | undefined;
      try {
      while (!done) {
        ctx.checkpoint();
        const next = await iterator.next();
        if (next.done) {done = true; break;}
        const bytes = next.value;
        if (!(bytes instanceof Uint8Array)) throw new PandocError("E_IO", ctx.operation ?? "read", "Producer must yield bytes");
        ctx.checkpoint();
        if ("chunks" in input) {ctx.charge("inputBytes", bytes.length); ctx.charge("compressedBytes", bytes.length);}
        for (let offset = 0; offset < bytes.length; offset += 4096) {
          await storage.append(bytes.subarray(offset, offset + 4096));
          await ctx.cooperate();
        }
        size += bytes.length;
      }
      } catch (reason) {inputFailure = {reason}; throw reason;}
      finally {try {await cleanup().catch(reason => {if (!inputFailure) throw reason;});} finally {unregister?.();}}
      source = {size, read: (offset, length) => storage.read(position + offset, length)};
    } else {
      if (!("bytes" in input)) return fail("archive", "Streaming EPUB requires caller working storage");
      ctx.charge("retainedBytes", input.bytes.length);
    }
    const parts = new Map<string, Uint8Array>();
    const partIndex = storage ? new ZipDirectoryIndex(storage) : undefined;
    const hasPart = async (name: string) => partIndex ? await partIndex.get(name) !== undefined : parts.has(name);
    const partRecord = async (name: string): Promise<Uint8Array | {position: number; length: number} | undefined> => {
      if (!partIndex) return parts.get(name);
      const pointer = await partIndex.get(name);
      if (pointer === undefined) return undefined;
      const record = await storage!.read(pointer, 16);
      const header = new DataView(record.buffer, record.byteOffset, 16);
      return {position: header.getFloat64(0, true), length: header.getFloat64(8, true)};
    };
    const partChunks = async function* (part: {position: number; length: number}) {
      for (let offset = 0; offset < part.length; offset += 4096) {
        yield await storage!.read(part.position + offset, Math.min(4096, part.length - offset));
        await ctx.cooperate();
      }
    };
    const getPart = async (name: string): Promise<Uint8Array | undefined> => {
      const part = await partRecord(name);
      if (part === undefined || part instanceof Uint8Array) return part;
      ctx.charge("retainedBytes", part.length);
      const bytes = new Uint8Array(part.length);
      let offset = 0;
      for await (const chunk of partChunks(part)) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    };
    // Validate every member, including unused resources, before reading the book.
    const processEntry = async (entry: ZipEntry | ZipStreamEntry) => {
      ctx.charge("parts", 1);
      if (entry.symlink || entry.name.includes("\\") || entry.name.includes(":")) fail(entry.name, "Unsafe EPUB ZIP member");
      const chunks: Uint8Array[] = [];
      const position = storage?.allocate(0);
      let length = 0;
      for await (const chunk of codec.decodeZipEntry(entry, limits, signal)) {
        ctx.charge("expandedBytes", chunk.length, !storage);
        length += chunk.length;
        if (storage) await storage.append(chunk);
        else chunks.push(chunk);
      }
      if (entry.directory) return;
      if (storage) {
        const record = new DataView(new ArrayBuffer(16));
        record.setFloat64(0, position!, true); record.setFloat64(8, length, true);
        const pointer = await storage.append(new Uint8Array(record.buffer));
        await partIndex!.set(entry.name, pointer);
      }
      else {
        ctx.charge("retainedBytes", length);
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
        parts.set(entry.name, bytes);
      }
    };
    if (storage) await codec.readZipArchive(source!, limits, signal, {storage, onEntry: processEntry});
    else {
      const archive = await codec.readZipArchive((input as Input).bytes, limits, signal);
      for (const entry of archive.entries) await processEntry(entry);
    }
    if (new TextDecoder().decode(await getPart("mimetype")) !== "application/epub+zip") fail("mimetype", "Invalid or missing EPUB mimetype");
    if (await hasPart("META-INF/encryption.xml")) fail("META-INF/encryption.xml", "Unsupported EPUB encryption/DRM or font obfuscation");
    const xmlCache = new Map<string, XmlElement>();
    const xml = async (part: string) => {
      if (xmlCache.has(part)) return xmlCache.get(part)!;
      const record = await partRecord(part);
      if (!record) return fail(part, "Missing required EPUB part");
      const node = await parseEpubXml(record instanceof Uint8Array ? record : partChunks(record), part, ctx);
      xmlCache.set(part, node);
      return node;
    };
    const container = await xml("META-INF/container.xml");
    if (container.name !== "container" || container.uri !== ns.container) fail("META-INF/container.xml", "Invalid EPUB container namespace");
    const rootfiles = children(container, "rootfiles").flatMap(n => children(n, "rootfile")).filter(n => a(n, "media-type") === "application/oebps-package+xml");
    if (!rootfiles.length) fail("META-INF/container.xml", "No supported EPUB rootfile");
    if (rootfiles.length > 1) warn("META-INF/container.xml", "Multiple EPUB rootfiles: selected first supported rendition");
    const packagePart = resolve(a(rootfiles[0]!, "full-path"), "", ctx).part;
    const opf = await xml(packagePart);
    if (opf.name !== "package" || opf.uri !== ns.opf || !["2.0", "3.0"].includes(a(opf, "version"))) fail(packagePart, "Unsupported EPUB package/version");
    const metadata: Record<string, MetaValue> = {};
    const meta = children(opf, "metadata")[0];
    if (!meta) fail(packagePart, "Missing EPUB metadata");
    for (const node of meta.children) {
      if (typeof node === "string") continue;
      if (node.uri === ns.dc) {
        const key = node.name === "creator" ? "author" : node.name;
        const value: MetaValue = {t: "MetaString", c: xmlText(node)};
        const previous = metadata[key];
        metadata[key] = previous ? {t: "MetaList", c: previous.t === "MetaList" ? [...previous.c, value] : [previous, value]} : value;
      }
      if (node.uri === ns.opf && node.name === "meta" && a(node, "property") === "rendition:layout" && xmlText(node).trim() === "pre-paginated") fail(packagePart, "Fixed-layout EPUB cannot be faithfully converted to reflow");
      if (node.uri === ns.opf && node.name === "meta" && a(node, "name") === "fixed-layout" && a(node, "content") === "true") fail(packagePart, "Fixed-layout EPUB2 cannot be faithfully converted to reflow");
      if (node.uri === ns.opf && node.name === "meta" && a(node, "property").startsWith("rendition:") && a(node, "property") !== "rendition:layout") warn(packagePart, `Unsupported EPUB layout metadata: ${a(node, "property")}`);
    }
    const manifest = new Map<string, ManifestItem>();
    const admitted = new Map<string, ManifestItem>();
    for (const n of children(opf, "manifest").flatMap(m => children(m, "item"))) {
      const id = a(n, "id");
      const href = a(n, "href");
      if (!id || !href || manifest.has(id)) fail(packagePart, "Invalid or duplicate EPUB manifest ID");
      const target = resolve(href, packagePart, ctx);
      if (target.fragment || admitted.has(target.part)) fail(packagePart, "Ambiguous EPUB manifest part identity");
      const item: ManifestItem = {id, part: target.part, media: a(n, "media-type"), properties: tokens(a(n, "properties")), fallback: a(n, "fallback"), overlay: a(n, "media-overlay")};
      if (item.properties.includes("rendition:layout-pre-paginated")) fail(item.part, "Fixed-layout EPUB spine is unsupported");
      if (item.media === "text/css") warn(item.part, "Unsupported EPUB CSS styling/layout loss");
      if (item.overlay || item.media === "application/smil+xml") warn(item.part, "Unsupported EPUB media overlay synchronization loss");
      manifest.set(id, item); admitted.set(item.part, item);
    }
    // Validate the declarative fallback graph once; no recursive loader.
    for (const item of manifest.values()) {
      const seen = new Set<string>();
      let current: ManifestItem | undefined = item;
      while (current?.fallback) {
        ctx.checkpoint(); ctx.bound("depth", seen.size + 1);
        if (seen.has(current.id)) fail(current.part, "Recursive EPUB fallback dependency");
        seen.add(current.id);
        const next: ManifestItem | undefined = manifest.get(current.fallback);
        if (!next) fail(current.part, "Missing EPUB fallback item");
        current = next;
      }
    }
    const spine = children(opf, "spine");
    if (spine.length !== 1) fail(packagePart, "Missing or ambiguous EPUB spine");
    const bookLanguage = children(meta, "language", ns.dc)[0];
    const bookDirection = a(spine[0]!, "page-progression-direction");
    if (bookDirection && !["ltr", "rtl", "default"].includes(bookDirection)) fail(packagePart, "Invalid EPUB reading direction");
    const chapters: Chapter[] = [];
    const chapterParts = new Set<string>();
    for (const ref of children(spine[0]!, "itemref")) {
      const item = manifest.get(a(ref, "idref"));
      if (!item || !await hasPart(item.part)) fail(packagePart, "Missing EPUB spine item");
      if (a(ref, "properties").includes("rendition:layout-pre-paginated")) fail(item.part, "Fixed-layout EPUB spine is unsupported");
      if (item.media !== "application/xhtml+xml") fail(item.part, "Unsupported EPUB spine media type");
      if (chapterParts.has(item.part)) fail(item.part, "Duplicate EPUB spine chapter");
      const node = await xml(item.part);
      const document = await htmlTreeDocument(xhtmlTree(node, ctx, item.part), ctx);
      const linear = a(ref, "linear") || "yes";
      if (!["yes", "no"].includes(linear)) fail(item.part, "Invalid EPUB spine linear value");
      chapters.push({item, xml: node, blocks: document.blocks, language: document.language ?? (bookLanguage ? xmlText(bookLanguage) : ""), linear});
      chapterParts.add(item.part);
    }
    if (!chapters.length) fail(packagePart, "Empty EPUB spine");
    const ids = new Set<string>();
    const notes = new Set<string>();
    const noteRefs = new Set<string>();
    const scan = (node: XmlElement, part: string): void => {
      ctx.checkpoint();
      // The XHTML mapper drops foreign subtrees; they cannot define AST anchors
      // or introduce note dependencies in the assembled document.
      if (node.uri !== ns.xhtml) return;
      const id = a(node, "id");
      if (id) {
        const key = identity(part, id);
        if (ids.has(key)) fail(part, "Duplicate XHTML fragment identity");
        ids.add(key);
        if (tokens(a(node, "type", ns.epub)).some(t => t === "footnote" || t === "endnote")) notes.add(key);
      }
      if (tokens(a(node, "type", ns.epub)).includes("noteref")) {
        const target = resolve(a(node, "href"), part, ctx);
        noteRefs.add(identity(target.part, target.fragment));
      }
      if (node.name === "style" || a(node, "style") || (node.name === "link" && tokens(a(node, "rel")).includes("stylesheet"))) warn(part, "Unsupported EPUB CSS styling/layout loss");
      if (["audio", "video", "object", "embed", "svg", "math"].includes(node.name)) warn(part, `Unsupported EPUB media loss: ${node.name}`);
      if (node.name === "script" || a(node, "onload") || a(node, "onclick")) warn(part, "EPUB script content ignored");
      if (a(node, "base", "http://www.w3.org/XML/1998/namespace")) fail(part, "Unsupported XHTML xml:base resource identity");
      for (const child of node.children) if (typeof child !== "string") scan(child, part);
    };
    for (const chapter of chapters) scan(chapter.xml, chapter.item.part);
    const noteDocuments = new Map<string, readonly Block[]>();
    const loadedParts = new Set(chapterParts);
    // Set iteration visits newly discovered dependencies, each part only once.
    for (const key of noteRefs) {
      const part = decodeURIComponent(key.split("#")[0]!);
      if (loadedParts.has(part)) continue;
      const item = admitted.get(part);
      if (!item || item.media !== "application/xhtml+xml") fail(part, "Unadmitted EPUB note document");
      ctx.charge("includes", 1);
      loadedParts.add(part);
      const root = await xml(part);
      scan(root, part);
      noteDocuments.set(part, (await htmlTreeDocument(xhtmlTree(root, ctx, part), ctx)).blocks);
    }
    const bag = new Map<string, Resource>();
    const media = async (part: string): Promise<boolean> => {
      if (bag.has(part)) return true;
      const item = admitted.get(part);
      if (!item || !await hasPart(part)) {warn(part, "Missing admitted EPUB media resource", "W_RESOURCE_MISSING"); return false;}
      if (!["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(item.media)) {warn(part, `Unsupported EPUB media type: ${item.media}`); return false;}
      if (item.media === "image/svg+xml") {warn(part, "Unsupported EPUB SVG media rendering loss"); return false;}
      return true;
    };
    const loadMedia = async (part: string): Promise<boolean> => {
      if (!await media(part)) return false;
      if (!bag.has(part)) {
        ctx.bound("resources", bag.size + 1);
        bag.set(part, {id: part, bytes: (await getPart(part))!});
      }
      return true;
    };
    const legacyCover = children(meta, "meta").find(n => a(n, "name") === "cover");
    const coverItems = [...manifest.values()].filter(i => i.properties.includes("cover-image"));
    if (coverItems.length > 1) fail(packagePart, "Ambiguous EPUB cover image");
    const cover = coverItems[0] ?? manifest.get(legacyCover ? a(legacyCover, "content") : "");
    if (legacyCover && !cover) warn(packagePart, "Missing legacy EPUB cover manifest item", "W_RESOURCE_MISSING");
    if (cover && await loadMedia(cover.part)) metadata["cover-image"] = {t: "MetaString", c: cover.part};
    for (const ref of children(opf, "guide").flatMap(g => children(g, "reference"))) if (tokens(a(ref, "type")).includes("cover")) {
      const target = resolve(a(ref, "href"), packagePart, ctx);
      if (!admitted.has(target.part) || !await hasPart(target.part)) fail(packagePart, "Missing EPUB guide cover page");
      metadata["epub-cover-page"] = {t: "MetaString", c: target.part};
    }
    for (const item of manifest.values()) if (item.media.startsWith("image/")) await loadMedia(item.part);
    const noteBlocks = new Map<string, readonly Block[]>();
    // Rewrite all AST identities first so notes can be resolved across chapters.
    const rewrite = async (value: unknown, part: string): Promise<void> => {
      ctx.checkpoint();
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        if (value.length === 3 && typeof value[0] === "string" && Array.isArray(value[1]) && Array.isArray(value[2])) {
          if (value[0]) value[0] = identity(part, value[0]);
          value[2] = value[2].flatMap(([key, text]: [string, string]) => {
            if (key === "epub:type") return [["data-epub-type", text]];
            if (key === "xml:lang") return [["lang", text]];
            if (["title", "lang", "dir", "role"].includes(key) || key.startsWith("data-") || key.startsWith("aria-")) return [[key, text]];
            warn(part, `Unsupported EPUB XHTML attribute loss: ${key}`);
            return [];
          });
        }
      } else if ("t" in value && (value.t === "Image" || value.t === "Link")) {
        const node = value as Extract<Inline, {t: "Image" | "Link"}>;
        const target = node.c[2][0];
        if (value.t === "Image") {
          if (target.includes(":") || target.startsWith("//")) {
            warn(part, "Unsupported remote EPUB image ignored");
            Object.assign(node, {t: "Span", c: [node.c[0], node.c[1]]});
            for (const child of Object.values(value)) await rewrite(child, part);
            return;
          }
          const ref = resolve(target, part, ctx);
          if (await media(ref.part)) (node.c[2] as [string, string])[0] = ref.part;
          else Object.assign(node, {t: "Span", c: [node.c[0], node.c[1]]});
        } else if (!target.includes(":") && !target.startsWith("//")) {
          const ref = resolve(target, part, ctx);
          if (!admitted.has(ref.part)) fail(part, "Link to unadmitted EPUB resource");
          if (ref.fragment && loadedParts.has(ref.part) && !ids.has(identity(ref.part, ref.fragment))) warn(part, `Missing EPUB link fragment: ${identity(ref.part, ref.fragment)}`);
          if (loadedParts.has(ref.part)) (node.c[2] as [string, string])[0] = `#${encodeURI(identity(ref.part, ref.fragment))}`;
          else (node.c[2] as [string, string])[0] = uriPart(ref.part) + (ref.fragment ? `#${encodeURIComponent(ref.fragment)}` : "");
        }
      }
      for (const child of Object.values(value)) await rewrite(child, part);
    };
    for (const chapter of chapters) await rewrite(chapter.blocks, chapter.item.part);
    for (const [part, blocks] of noteDocuments) await rewrite(blocks, part);
    const collect = (value: unknown): void => {
      ctx.checkpoint();
      if (!value || typeof value !== "object") return;
      if ("t" in value && value.t === "Div") {
        const block = value as Extract<Block, {t: "Div"}>;
        if (notes.has(block.c[0][0])) noteBlocks.set(block.c[0][0], block.c[1]);
      }
      for (const child of Object.values(value)) collect(child);
    };
    for (const chapter of chapters) collect(chapter.blocks);
    for (const blocks of noteDocuments.values()) collect(blocks);
    for (const key of noteRefs) if (!noteBlocks.has(key)) fail(key, "Missing EPUB note target");
    const expand = (value: unknown, active: Set<string>, depth: number): void => {
      ctx.checkpoint(); ctx.bound("depth", depth);
      if (!value || typeof value !== "object") return;
      if ("t" in value && value.t === "Link") {
        const node = value as Extract<Inline, {t: "Link" | "Image"}>;
        if (node.c[0][2].some(([k, v]) => k === "data-epub-type" && tokens(v).includes("noteref"))) {
          const key = decodeURIComponent(node.c[2][0].slice(1));
          if (active.has(key)) fail(key, "Recursive EPUB note dependency");
          const original = noteBlocks.get(key);
          if (!original) fail(key, "Missing EPUB note target");
          const reserve = (v: unknown): void => {
            ctx.checkpoint(); ctx.charge("nodes", 1);
            if (typeof v === "string") ctx.charge("retainedBytes", v.length * 2);
            else if (v && typeof v === "object") for (const child of Object.values(v)) reserve(child);
          };
          reserve(original);
          const copy = structuredClone(original);
          const next = new Set(active); next.add(key);
          expand(copy, next, depth + 1);
          const provenance: Attr = ["", [], [["data-epub-source", decodeURIComponent(key.split("#")[0]!)]]];
          Object.assign(node, {t: "Note", c: [{t: "Div", c: [provenance, copy]}]});
          return;
        }
      }
      for (const child of Object.values(value)) expand(child, active, depth + 1);
    };
    for (const chapter of chapters) expand(chapter.blocks, new Set(), 0);
    // Keep the original target anchor, but render referenced note prose only in Note.
    const prune = (value: unknown): void => {
      ctx.checkpoint();
      if (!value || typeof value !== "object") return;
      if ("t" in value && value.t === "Note") return;
      if ("t" in value && value.t === "Div") {
        const block = value as Extract<Block, {t: "Div"}>;
        if (noteRefs.has(block.c[0][0])) {(block.c as [Attr, readonly Block[]])[1] = []; return;}
      }
      for (const child of Object.values(value)) prune(child);
    };
    for (const chapter of chapters) prune(chapter.blocks);
    const toc: MetaValue[] = [];
    const navigation = async (item: ManifestItem, ncx: boolean) => {
      const root = await xml(item.part);
      if (ncx && (root.name !== "ncx" || root.uri !== ns.ncx)) fail(item.part, "Invalid NCX namespace");
      if (!ncx) xhtmlTree(root, ctx, item.part);
      const consumed = new Set<XmlElement>();
      const walk = async (node: XmlElement, inToc: boolean, inLandmarks: boolean, destination: MetaValue[]): Promise<void> => {
        ctx.checkpoint();
        const inside = inToc || (!ncx && node.uri === ns.xhtml && node.name === "nav" && tokens(a(node, "type", ns.epub)).includes("toc"));
        const landmarks = inLandmarks || (!ncx && node.uri === ns.xhtml && node.name === "nav" && tokens(a(node, "type", ns.epub)).includes("landmarks"));
        if (landmarks && node.uri === ns.xhtml && node.name === "a" && tokens(a(node, "type", ns.epub)).includes("cover")) {
          const ref = resolve(a(node, "href"), item.part, ctx);
          if (!admitted.has(ref.part) || !await hasPart(ref.part)) fail(item.part, "Missing EPUB landmark cover page");
          metadata["epub-cover-page"] = {t: "MetaString", c: ref.part};
        }
        let nextDestination = destination;
        const anchor = inside && node.uri === ns.xhtml && node.name === "li" ? children(node, "a")[0] : undefined;
        const entry = ncx && node.uri === ns.ncx && node.name === "navPoint" ? node : anchor ?? (inside && node.uri === ns.xhtml && node.name === "a" && !consumed.has(node) ? node : undefined);
        if (entry) {
          if (anchor) consumed.add(anchor);
          const target = ncx ? a(children(entry, "content")[0] ?? entry, "src") : a(entry, "href");
          const ref = resolve(target, item.part, ctx);
          if (!admitted.has(ref.part) || !await hasPart(ref.part)) fail(item.part, "Navigation target is missing or not admitted");
          const label = ncx ? children(entry, "navLabel").map(xmlText).join("") : xmlText(entry);
          const nested: MetaValue[] = [];
          const link = chapterParts.has(ref.part) ? `#${encodeURI(identity(ref.part, ref.fragment))}` : identity(ref.part, ref.fragment);
          destination.push({t: "MetaMap", c: {label: {t: "MetaString", c: label}, target: {t: "MetaString", c: link}, children: {t: "MetaList", c: nested}}});
          nextDestination = nested;
        }
        for (const child of node.children) if (typeof child !== "string") await walk(child, inside, landmarks, nextDestination);
      };
      await walk(root, false, false, toc);
    };
    const ncxId = a(spine[0]!, "toc");
    const nav = [...manifest.values()].filter(i => i.properties.includes("nav"));
    if (nav.length > 1) fail(packagePart, "Ambiguous EPUB navigation");
    if (a(opf, "version") === "3.0" && nav[0]) {
      if (nav[0].media !== "application/xhtml+xml") fail(packagePart, "Unsupported EPUB navigation media type");
      await navigation(nav[0], false);
    } else if (ncxId) {
      const item = manifest.get(ncxId);
      if (!item || item.media !== "application/x-dtbncx+xml") fail(packagePart, "Missing EPUB NCX item");
      await navigation(item, true);
    } else {
      if (nav[0]) await navigation(nav[0], false);
    }
    if (toc.length) metadata["epub-toc"] = {t: "MetaList", c: toc};
    return {blocks: chapters.map(chapter => {
      const attr: Attr = [identity(chapter.item.part), ["epub-chapter"], [["data-epub-source", chapter.item.part], ["data-epub-item-id", chapter.item.id], ["data-epub-linear", chapter.linear], ...(chapter.language ? [["lang", chapter.language] as const] : [])]];
      return {t: "Div", c: [attr, chapter.blocks]};
    }), metadata, resources: [...bag.values()], ...(bookLanguage ? {language: xmlText(bookLanguage)} : {}), ...(["ltr", "rtl"].includes(bookDirection) ? {direction: bookDirection as "ltr" | "rtl"} : {})};
    } catch (reason) {failure = {reason}; throw reason;}
    finally {
      try {await storage?.close().catch(reason => {if (!failure) throw reason;});}
      finally {release?.();}
    }
}
