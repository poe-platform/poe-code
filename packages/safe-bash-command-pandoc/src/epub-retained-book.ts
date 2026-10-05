import type {RetainedXmlDocument, RetainedXmlNode} from "@poe-code/office-xml/retained-xml-document";
import {equal, literal} from "@poe-code/office-xml/retained-values";
import {ZipDirectoryIndex} from "@poe-code/office-package/zip";
import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import {EpubManifest, type ManifestItem} from "./epub-manifest.js";
import {BackedTextSet} from "./backed-text-set.js";
import {openEpubArchive} from "./epub-archive.js";
import {openEpubXml} from "./epub-retained-xml.js";
import {epubFailure, namespaces as ns} from "./epub-xml.js";
import {identity, resolve, uriPart} from "./epub-uri.js";
import {RetainedRtfAst, type RtfValue} from "./retained-rtf-ast.js";
import {RetainedEpubNotes} from "./retained-epub-notes.js";
import {readRetainedXhtml} from "./retained-xhtml-reader.js";
import type {AdapterContext, InputSource} from "./types.js";

/** Book-wide XML/AST collections and traversal jobs use caller pages. Individual
 * URI/manifest control values still use the legacy string interfaces. */
export async function readRetainedEpubBook(input: InputSource, storage: PagedStorage, ctx: AdapterContext) {
  const archive = await openEpubArchive(input, ctx);
  const ast = new RetainedRtfAst(storage, units => ctx.cooperate(units));
  const fail = (part: string, message: string): never => epubFailure(ctx, part, message);
  const warn = (part: string, message: string, code: "W_RAW_CONTENT" | "W_RESOURCE_MISSING" = "W_RAW_CONTENT") => ctx.report({code, operation: ctx.operation ?? "read", format: "epub", location: part, message});
  const text = async (source: AsyncIterable<Uint8Array>): Promise<string> => {
    const decoder = new TextDecoder(); let result = "";
    for await (const chunk of source) {result += decoder.decode(chunk, {stream: true}); await ctx.cooperate();}
    return result + decoder.decode();
  };
  const valueText = async (value: RtfValue) => {let result = ""; for await (const chunk of ast.text.chunks(await ast.range(value))) result += chunk; return result;};
  const retainedText = async (source: AsyncIterable<Uint8Array>) => ast.string(await ast.text.from((async function* () {
    const decoder = new TextDecoder(); for await (const chunk of source) yield decoder.decode(chunk, {stream: true}); const tail = decoder.decode(); if (tail) yield tail;
  })()));
  const named = async (xml: RetainedXmlDocument, node: RetainedXmlNode, name: string, uri: string) => node.kind === "element" && await equal(xml.raw(node.localName), literal(name)) && await equal(xml.namespace(node), literal(uri));
  const attr = async (xml: RetainedXmlDocument, node: RetainedXmlNode, name: string, uri = "") => {
    for await (const a of xml.attributes(node)) if (await equal(xml.raw(a.localName), literal(name)) && await equal(xml.namespace(a), literal(uri))) return text(xml.text(a));
    return "";
  };
  const children = async function* (xml: RetainedXmlDocument, node: RetainedXmlNode, name: string, uri: string) {
    for await (const child of xml.children(node)) if (await named(xml, child, name, uri)) yield child;
  };
  const first = async (xml: RetainedXmlDocument, node: RetainedXmlNode, name: string, uri: string) => {for await (const child of children(xml, node, name, uri)) return child; return undefined;};
  const xml = async (part: string) => {
    const record = await archive.partRecord(part);
    if (!record) return fail(part, "Missing required EPUB part");
    return openEpubXml(record instanceof Uint8Array ? [record] : archive.partChunks(record), part, ctx);
  };
  const tokens = (value: string) => value.split(" ").filter(Boolean);
  const metadata = await ast.object(), metaIndex = new ZipDirectoryIndex(storage, {maximumKeyLength: Number.MAX_SAFE_INTEGER});
  const putMeta = async (key: string, value: RtfValue, append = false) => {
    const pointer = await metaIndex.get(key);
    if (pointer !== undefined) {
      const pair = {position: pointer}, previous = (await ast.at(pair, 1))!;
      if (append) {
        if (await ast.name(previous) === "MetaList") await ast.push((await ast.content(previous))!, value);
        else await ast.set(pair, 1, await ast.tag("MetaList", await ast.value([previous, value])));
      } else await ast.set(pair, 1, value);
    } else {
      const pair = await ast.value([key, value]); await ast.push(metadata, pair); await metaIndex.set(key, pair.position);
    }
  };
  let opf: RetainedXmlDocument | undefined;
  try {
    const container = await xml("META-INF/container.xml");
    let packagePart = "", rootfiles = 0;
    try {
      if (!await named(container, container.root, "container", ns.container)) fail("META-INF/container.xml", "Invalid EPUB container namespace");
      for await (const group of children(container, container.root, "rootfiles", ns.container)) for await (const file of children(container, group, "rootfile", ns.container)) if (await attr(container, file, "media-type") === "application/oebps-package+xml") {
        if (rootfiles++ === 0) packagePart = await attr(container, file, "full-path");
      }
      if (!rootfiles) fail("META-INF/container.xml", "No supported EPUB rootfile");
      if (rootfiles > 1) warn("META-INF/container.xml", "Multiple EPUB rootfiles: selected first supported rendition");
      packagePart = resolve(packagePart, "", ctx).part;
    } finally {await container.close();}
    opf = await xml(packagePart);
    const version = await attr(opf, opf.root, "version");
    if (!await named(opf, opf.root, "package", ns.opf) || !["2.0", "3.0"].includes(version)) fail(packagePart, "Unsupported EPUB package/version");
    const meta = await first(opf, opf.root, "metadata", ns.opf);
    if (!meta) return fail(packagePart, "Missing EPUB metadata");
    let language: RtfValue | undefined;
    for await (const node of opf.children(meta)) {
      if (node.kind !== "element") continue;
      if (await equal(opf.namespace(node), literal(ns.dc))) {
        const name = await text(opf.raw(node.localName)), value = await retainedText(opf.text(node));
        if (name === "language" && !language) language = value;
        await putMeta(name === "creator" ? "author" : name, await ast.tag("MetaString", value), true);
      }
      if (await named(opf, node, "meta", ns.opf)) {
        const property = await attr(opf, node, "property");
        if (property === "rendition:layout" && (await text(opf.text(node))).trim() === "pre-paginated") fail(packagePart, "Fixed-layout EPUB cannot be faithfully converted to reflow");
        if (await attr(opf, node, "name") === "fixed-layout" && await attr(opf, node, "content") === "true") fail(packagePart, "Fixed-layout EPUB2 cannot be faithfully converted to reflow");
        if (property.startsWith("rendition:") && property !== "rendition:layout") warn(packagePart, `Unsupported EPUB layout metadata: ${property}`);
      }
    }
    const manifest = new EpubManifest(storage, async () => ctx.cooperate());
    for await (const group of children(opf, opf.root, "manifest", ns.opf)) for await (const node of children(opf, group, "item", ns.opf)) {
      const id = await attr(opf, node, "id"), href = await attr(opf, node, "href");
      if (!id || !href || await manifest.has(id)) fail(packagePart, "Invalid or duplicate EPUB manifest ID");
      const target = resolve(href, packagePart, ctx);
      if (target.fragment || await manifest.hasPart(target.part)) fail(packagePart, "Ambiguous EPUB manifest part identity");
      const item: ManifestItem = {ordinal: manifest.size, id, part: target.part, media: await attr(opf, node, "media-type"), properties: tokens(await attr(opf, node, "properties")), fallback: await attr(opf, node, "fallback"), overlay: await attr(opf, node, "media-overlay")};
      if (item.properties.includes("rendition:layout-pre-paginated")) fail(item.part, "Fixed-layout EPUB spine is unsupported");
      if (item.media === "text/css") warn(item.part, "Unsupported EPUB CSS styling/layout loss");
      if (item.overlay || item.media === "application/smil+xml") warn(item.part, "Unsupported EPUB media overlay synchronization loss");
      await manifest.add(item);
    }
    const visits = new IntegerTable(storage);
    for await (const item of manifest.values()) {
      let current: ManifestItem | undefined = item, depth = 0;
      while (current?.fallback) {
        ctx.checkpoint(); ctx.bound("depth", ++depth);
        if (await visits.get(BigInt(current.ordinal)) === BigInt(item.ordinal + 1)) fail(current.part, "Recursive EPUB fallback dependency");
        await visits.set(BigInt(current.ordinal), BigInt(item.ordinal + 1));
        const next: ManifestItem | undefined = await manifest.get(current.fallback);
        if (!next) fail(current.part, "Missing EPUB fallback item");
        current = next;
      }
    }
    let spine: RetainedXmlNode | undefined;
    for await (const node of children(opf, opf.root, "spine", ns.opf)) {if (spine) fail(packagePart, "Missing or ambiguous EPUB spine"); spine = node;}
    if (!spine) return fail(packagePart, "Missing or ambiguous EPUB spine");
    const direction = await attr(opf, spine, "page-progression-direction");
    if (direction && !["ltr", "rtl", "default"].includes(direction)) fail(packagePart, "Invalid EPUB reading direction");
    const chapters = await ast.array(), documents = await ast.array();
    const chapterParts = new BackedTextSet(storage, ast.text), loaded = new BackedTextSet(storage, ast.text);
    const ids = new BackedTextSet(storage, ast.text), noteIds = new BackedTextSet(storage, ast.text), noteRefs = new BackedTextSet(storage, ast.text);
    const notes = new RetainedEpubNotes(ast, storage, ctx);
    const scan = async (document: RetainedXmlDocument, part: string) => {
      let foreignDepth = Infinity;
      for await (const {node, depth} of document.nodes()) {
        if (node.kind !== "element" || depth > foreignDepth) continue;
        foreignDepth = Infinity;
        if (!await equal(document.namespace(node), literal(ns.xhtml))) {foreignDepth = depth; continue;}
        const id = await attr(document, node, "id"), type = tokens(await attr(document, node, "type", ns.epub));
        if (id) {
          const key = identity(part, id);
          if (await ids.has(key)) fail(part, "Duplicate XHTML fragment identity");
          await ids.add(key);
          if (type.includes("footnote") || type.includes("endnote")) await noteIds.add(key);
        }
        if (type.includes("noteref")) {const target = resolve(await attr(document, node, "href"), part, ctx); const key = identity(target.part, target.fragment); await noteRefs.add(key); await notes.reference(key);}
        const name = await text(document.raw(node.localName));
        if (name === "style" || await attr(document, node, "style") || name === "link" && tokens(await attr(document, node, "rel")).includes("stylesheet")) warn(part, "Unsupported EPUB CSS styling/layout loss");
        if (["audio", "video", "object", "embed", "svg", "math"].includes(name)) warn(part, `Unsupported EPUB media loss: ${name}`);
        if (name === "script" || await attr(document, node, "onload") || await attr(document, node, "onclick")) warn(part, "EPUB script content ignored");
        if (await attr(document, node, "base", "http://www.w3.org/XML/1998/namespace")) fail(part, "Unsupported XHTML xml:base resource identity");
      }
    };
    // Read/map each XML part once and retire its caches before the next part.
    const load = async (part: string) => {
      const document = await xml(part);
      try {
        const mapped = await readRetainedXhtml(document, ast, storage, ctx, part);
        await scan(document, part);
        await ast.push(documents, await ast.value([part, mapped.blocks])); await loaded.add(part);
        return mapped;
      } finally {await document.close();}
    };
    for await (const ref of children(opf, spine, "itemref", ns.opf)) {
      const item = await manifest.get(await attr(opf, ref, "idref"));
      if (!item || !await archive.hasPart(item.part)) return fail(packagePart, "Missing EPUB spine item");
      if ((await attr(opf, ref, "properties")).includes("rendition:layout-pre-paginated")) fail(item.part, "Fixed-layout EPUB spine is unsupported");
      if (item.media !== "application/xhtml+xml") fail(item.part, "Unsupported EPUB spine media type");
      if (await chapterParts.has(item.part)) fail(item.part, "Duplicate EPUB spine chapter");
      const mapped = await load(item.part), linear = await attr(opf, ref, "linear") || "yes";
      if (!["yes", "no"].includes(linear)) fail(item.part, "Invalid EPUB spine linear value");
      const pairs = await ast.value([["data-epub-source", item.part], ["data-epub-item-id", item.id], ["data-epub-linear", linear]]);
      const lang = mapped.language ?? language;
      if (lang && (await ast.range(lang)).units) await ast.push(pairs, await ast.value(["lang", lang]));
      await ast.push(chapters, await ast.tag("Div", await ast.value([[identity(item.part), ["epub-chapter"], pairs], mapped.blocks])));
      await chapterParts.add(item.part);
    }
    if (!await ast.count(chapters)) fail(packagePart, "Empty EPUB spine");
    for await (const key of noteRefs) {
      const hash = key.indexOf("#"), part = decodeURIComponent(hash < 0 ? key : key.slice(0, hash));
      if (await loaded.has(part)) continue;
      const item = await manifest.getPart(part);
      if (!item || item.media !== "application/xhtml+xml") fail(part, "Unadmitted EPUB note document");
      ctx.charge("includes", 1); await load(part);
    }
    const mediaParts = new BackedTextSet(storage, ast.text);
    let resourceCount = 0, maxIdLength = 0;
    const media = async (part: string, retain = false): Promise<boolean> => {
      if (await mediaParts.has(part)) return true;
      const item = await manifest.getPart(part);
      if (!item || !await archive.hasPart(part)) {warn(part, "Missing admitted EPUB media resource", "W_RESOURCE_MISSING"); return false;}
      if (!["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(item.media)) {warn(part, `Unsupported EPUB media type: ${item.media}`); return false;}
      if (item.media === "image/svg+xml") {warn(part, "Unsupported EPUB SVG media rendering loss"); return false;}
      if (retain) {ctx.bound("resources", ++resourceCount); maxIdLength = Math.max(maxIdLength, part.length); await mediaParts.add(part);}
      return true;
    };
    let legacyCover: string | undefined, cover: ManifestItem | undefined;
    for await (const node of children(opf, meta, "meta", ns.opf)) if (await attr(opf, node, "name") === "cover") {legacyCover = await attr(opf, node, "content"); break;}
    for await (const item of manifest.values()) if (item.properties.includes("cover-image")) {if (cover) fail(packagePart, "Ambiguous EPUB cover image"); cover = item;}
    cover ??= await manifest.get(legacyCover ?? "");
    if (legacyCover !== undefined && !cover) warn(packagePart, "Missing legacy EPUB cover manifest item", "W_RESOURCE_MISSING");
    if (cover && await media(cover.part, true)) await putMeta("cover-image", await ast.tag("MetaString", await ast.value(cover.part)));
    for await (const group of children(opf, opf.root, "guide", ns.opf)) for await (const ref of children(opf, group, "reference", ns.opf)) if (tokens(await attr(opf, ref, "type")).includes("cover")) {
      const target = resolve(await attr(opf, ref, "href"), packagePart, ctx);
      if (!await manifest.hasPart(target.part) || !await archive.hasPart(target.part)) fail(packagePart, "Missing EPUB guide cover page");
      await putMeta("epub-cover-page", await ast.tag("MetaString", await ast.value(target.part)));
    }
    for await (const item of manifest.values()) if (item.media.startsWith("image/")) await media(item.part, true);
    for await (const entry of ast.children(documents)) {
      const part = await valueText((await ast.at(entry, 0))!), blocks = (await ast.at(entry, 1))!;
      await ast.walk(blocks, async (value, _depth, leaving) => {
        if (leaving) return;
        if (await ast.kind(value) === "array" && await ast.count(value) === 3) {
          const first = (await ast.at(value, 0))!, second = (await ast.at(value, 1))!, third = (await ast.at(value, 2))!;
          if (await ast.kind(first) === "string" && await ast.kind(second) === "array" && await ast.kind(third) === "array") {
            const id = await valueText(first); if (id) await ast.set(value, 0, await ast.value(identity(part, id)));
            const pairs = await ast.array();
            for await (const pair of ast.children(third)) {
              const key = await valueText((await ast.at(pair, 0))!);
              if (key === "epub:type" || key === "xml:lang") {await ast.set(pair, 0, await ast.value(key === "epub:type" ? "data-epub-type" : "lang")); await ast.push(pairs, pair);}
              else if (["title", "lang", "dir", "role"].includes(key) || key.startsWith("data-") || key.startsWith("aria-")) await ast.push(pairs, pair);
              else warn(part, `Unsupported EPUB XHTML attribute loss: ${key}`);
            }
            await ast.set(value, 2, pairs);
          }
        }
        const tag = await ast.name(value);
        if (tag !== "Link" && tag !== "Image") return;
        const content = (await ast.content(value))!, targetTuple = (await ast.at(content, 2))!, target = await valueText((await ast.at(targetTuple, 0))!);
        if (tag === "Image") {
          let admitted = false;
          if (target.includes(":") || target.startsWith("//")) warn(part, "Unsupported remote EPUB image ignored");
          else {const ref = resolve(target, part, ctx); admitted = await media(ref.part); if (admitted) await ast.set(targetTuple, 0, await ast.value(ref.part));}
          if (!admitted) await ast.replaceTag(value, "Span", await ast.value([(await ast.at(content, 0))!, (await ast.at(content, 1))!]));
        } else if (!target.includes(":") && !target.startsWith("//")) {
          const ref = resolve(target, part, ctx);
          if (!await manifest.hasPart(ref.part)) fail(part, "Link to unadmitted EPUB resource");
          if (ref.fragment && await loaded.has(ref.part) && !await ids.has(identity(ref.part, ref.fragment))) warn(part, `Missing EPUB link fragment: ${identity(ref.part, ref.fragment)}`);
          const link = await loaded.has(ref.part) ? `#${encodeURI(identity(ref.part, ref.fragment))}` : uriPart(ref.part) + (ref.fragment ? `#${encodeURIComponent(ref.fragment)}` : "");
          await ast.set(targetTuple, 0, await ast.value(link));
        }
      });
    }
    for await (const entry of ast.children(documents)) await ast.walk((await ast.at(entry, 1))!, async (value, _depth, leaving) => {
      if (leaving || await ast.name(value) !== "Div") return;
      const content = (await ast.content(value))!, id = await valueText((await ast.edge((await ast.at(content, 0))!))!);
      if (await noteIds.has(id)) await notes.add(id, (await ast.at(content, 1))!);
    });
    await notes.validate();
    for await (const chapter of ast.children(chapters)) await notes.expand((await ast.at((await ast.content(chapter))!, 1))!);
    for await (const chapter of ast.children(chapters)) await notes.prune((await ast.at((await ast.content(chapter))!, 1))!);
    // Navigation uses a caller-backed LIFO and destination handles, including
    // nested NCX/nav lists. No depth-sized async recursion or consumed-node Set.
    const toc = await ast.array();
    const navigation = async (item: ManifestItem, ncx: boolean) => {
      const document = await xml(item.part);
      try {
        if (ncx && !await named(document, document.root, "ncx", ns.ncx)) fail(item.part, "Invalid NCX namespace");
        if (!ncx) await readRetainedXhtml(document, ast, storage, ctx, item.part);
        const jobs = await ast.array(), consumed = new IntegerTable(storage);
        const enqueue = async (node: RetainedXmlNode, inside: boolean, landmarks: boolean, destination: RtfValue) => {
          await ast.push(jobs, await ast.value([String(document.reference(node)), inside ? "1" : "", landmarks ? "1" : "", destination]));
        };
        await enqueue(document.root, false, false, toc);
        while (await ast.count(jobs)) {
          const job = (await ast.edge(jobs, true))!; await ast.remove(jobs, true);
          const node = await document.node(Number(await valueText((await ast.at(job, 0))!))), destination = (await ast.at(job, 3))!;
          const isNav = !ncx && await named(document, node, "nav", ns.xhtml), types = isNav ? tokens(await attr(document, node, "type", ns.epub)) : [];
          const inside = !!await valueText((await ast.at(job, 1))!) || isNav && types.includes("toc");
          const landmarks = !!await valueText((await ast.at(job, 2))!) || isNav && types.includes("landmarks");
          if (landmarks && await named(document, node, "a", ns.xhtml) && tokens(await attr(document, node, "type", ns.epub)).includes("cover")) {
            const ref = resolve(await attr(document, node, "href"), item.part, ctx);
            if (!await manifest.hasPart(ref.part) || !await archive.hasPart(ref.part)) fail(item.part, "Missing EPUB landmark cover page");
            await putMeta("epub-cover-page", await ast.tag("MetaString", await ast.value(ref.part)));
          }
          const anchor = inside && await named(document, node, "li", ns.xhtml) ? await first(document, node, "a", ns.xhtml) : undefined;
          const entry = ncx && await named(document, node, "navPoint", ns.ncx) ? node : anchor ?? (inside && await named(document, node, "a", ns.xhtml) && !await consumed.get(BigInt(document.reference(node))) ? node : undefined);
          let next = destination;
          if (entry) {
            if (anchor) await consumed.set(BigInt(document.reference(anchor)), 1n);
            const target = ncx ? await attr(document, await first(document, entry, "content", ns.ncx) ?? entry, "src") : await attr(document, entry, "href");
            const ref = resolve(target, item.part, ctx);
            if (!await manifest.hasPart(ref.part) || !await archive.hasPart(ref.part)) fail(item.part, "Navigation target is missing or not admitted");
            const label = ncx ? await retainedText((async function* () {for await (const label of children(document, entry, "navLabel", ns.ncx)) yield* document.text(label);})()) : await retainedText(document.text(entry));
            const link = await chapterParts.has(ref.part) ? `#${encodeURI(identity(ref.part, ref.fragment))}` : identity(ref.part, ref.fragment);
            const map = await ast.object(); next = await ast.array();
            for (const [key, value] of [["label", await ast.tag("MetaString", label)], ["target", await ast.tag("MetaString", await ast.value(link))], ["children", await ast.tag("MetaList", next)]] as const) await ast.push(map, await ast.value([key, value]));
            await ast.push(destination, await ast.tag("MetaMap", map));
          }
          const reversed = await ast.array();
          for await (const child of document.children(node)) if (child.kind === "element") await ast.push(reversed, await ast.value(String(document.reference(child))));
          while (await ast.count(reversed)) {const id = Number(await valueText((await ast.edge(reversed, true))!)); await ast.remove(reversed, true); await enqueue(await document.node(id), inside, landmarks, next);}
        }
      } finally {await document.close();}
    };
    const ncxId = await attr(opf, spine, "toc"); let nav: ManifestItem | undefined;
    for await (const item of manifest.values()) if (item.properties.includes("nav")) {if (nav) fail(packagePart, "Ambiguous EPUB navigation"); nav = item;}
    if (version === "3.0" && nav) {if (nav.media !== "application/xhtml+xml") fail(packagePart, "Unsupported EPUB navigation media type"); await navigation(nav, false);}
    else if (ncxId) {const item = await manifest.get(ncxId); if (!item || item.media !== "application/x-dtbncx+xml") return fail(packagePart, "Missing EPUB NCX item"); await navigation(item, true);}
    else if (nav) await navigation(nav, false);
    if (await ast.count(toc)) await putMeta("epub-toc", await ast.tag("MetaList", toc));
    await opf.close(); opf = undefined;
    return {ast, blocks: chapters, metadata, language, direction: direction === "ltr" || direction === "rtl" ? direction : undefined,
      archive, mediaParts, resourceCount, maxIdLength};
  } catch (error) {await opf?.close().catch(() => {}); opf = undefined; await archive.close().catch(() => {}); throw error;}
  finally {await opf?.close();}
}
