import { parseFragment, defaultTreeAdapter as tree, type DefaultTreeAdapterTypes as H } from "parse5";
import { createZipCodec, type ZipEntry, type ZipLimits } from "@poe-code/office-package/zip";
import { createCompressionCodec } from "@poe-code/office-package/compression";
import { writeHtml5 } from "./html-writer.js";
import { PandocError } from "./errors.js";
import type { AdapterContext, WriterCapability } from "./types.js";
import type { Block, Inline } from "./ast-types.js";

// Original reflow stylesheet: fixed size, no URLs, active content or font loads.
const css = "body{margin:1em;line-height:1.5}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}p,a,td{overflow-wrap:anywhere}table{max-width:100%;border-collapse:collapse}th,td{border:1px solid;padding:.3em}h1,h2,h3,h4,h5,h6{break-after:avoid}blockquote{margin-inline:1em}.smallcaps{font-variant:small-caps}.cover{text-align:center}.level-2{margin-inline-start:1em}.level-3,.level-4,.level-5,.level-6{margin-inline-start:2em}";
const uri = (name: string): string => name.split("/").map(encodeURIComponent).join("/");
interface Chapter {name: string; nodes: H.ChildNode[]}

/** EPUB 3.3 single reflowable rendition; no ambient resources, clock or randomness. */
export const epubWriter: WriterCapability = {
  format: "epub",
  math: "source",
  async write(document, ctx) {
    const fail = (message: string, code: "E_RESOURCE" | "E_OPTION" | "E_CAPABILITY" | "E_LIMIT" | "E_METADATA" = "E_CAPABILITY"): never => {
      throw new PandocError(code, ctx.operation ?? "write", message, "epub");
    };
    const escape = (value: string): string => {
      ctx.checkpoint(value.length);
      let result = "";
      for(const ch of value) {
        const c = ch.codePointAt(0)!;
        if((c < 32 && ![9, 10, 13].includes(c)) || c === 0xfffe || c === 0xffff) fail("Invalid XML character");
        result += ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\r": "&#13;"}[ch] ?? ch);
      }
      ctx.charge("retainedBytes", result.length * 2);
      return result;
    };
    const text = (node: H.Node): string => {
      ctx.checkpoint();
      if(tree.isTextNode(node)) return node.value;
      return "childNodes" in node ? node.childNodes.map(text).join("") : "";
    };
    const meta = async (key: string): Promise<string | undefined> => {
      const value = document.metadata[key];
      if(value === undefined) return undefined;
      if(value.t === "MetaString") return value.c;
      if(value.t !== "MetaInlines") return fail(`${key} must be text metadata`, "E_OPTION");
      const result = await writeHtml5({blocks: [{t: "Plain", c: value.c}], metadata: {}, resources: []}, htmlContext);
      if(result.kind !== "text") return fail("Expected text serialization");
      return text(parseFragment(result.text)).trim();
    };
    // Keep budget/session methods bound to their original owner.
    const htmlContext: AdapterContext = new Proxy(ctx, {get(target, key) {
      if(key === "standalone") return false;
      if(key === "rawContent") return ctx.rawContent === "escape" ? "escape" : "reject";
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }});
    const suppliedTitle = ctx.epub?.title ?? await meta("title");
    const suppliedLang = ctx.epub?.language ?? (await meta("lang")) ?? document.language;
    const explicitIdentifier = ctx.epub?.identifier ?? await meta("identifier");
    if (!ctx.yes && (suppliedTitle === undefined || suppliedLang === undefined || explicitIdentifier === undefined)) fail("EPUB requires title, language and identifier; supply metadata or use --yes to accept defaults", "E_METADATA");
    const title = suppliedTitle ?? "Untitled";
    const lang = suppliedLang ?? "en";
    const modified = (await meta("modified")) ?? "1970-01-01T00:00:00Z";
    if(!title.trim() || !lang.trim() || explicitIdentifier !== undefined && !explicitIdentifier.trim()) fail("Publication metadata must be nonempty", "E_OPTION");
    const date = new Date(modified);
    if(modified.length !== 20 || !Number.isFinite(date.getTime()) || date.toISOString().replace(".000Z", "Z") !== modified) fail("modified must be a canonical UTC timestamp to seconds", "E_OPTION");
    const languageParts = lang.split("-");
    if(languageParts.some((p, i) => !p || p.length > 8 || [...p].some(c => !(c.toLowerCase() >= "a" && c.toLowerCase() <= "z") && !(i > 0 && c >= "0" && c <= "9"))) || languageParts[0]!.length < 2) fail("Invalid publication language tag", "E_OPTION");
    const cover = await meta("cover-image");
    const media = new Map<string, {path: string; bytes: Uint8Array; type: string; used: boolean}>();
    for(const resource of document.resources) {
      await ctx.cooperate();
      const name = resource.id;
      if(!name || name.startsWith("/") || name.includes(":") || name.includes("\\") || name.split("/").some(p => !p || p === "." || p === "..")) fail("Unsafe declared resource key", "E_RESOURCE");
      escape(name);
      if(media.has(name)) fail("Duplicate declared resource key", "E_RESOURCE");
      const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
      const b = resource.bytes;
      const type = ext === "png" && [137,80,78,71,13,10,26,10].every((n,i) => b[i] === n) ? "image/png" :
        ["jpg", "jpeg"].includes(ext) && b[0] === 255 && b[1] === 216 && b[2] === 255 ? "image/jpeg" :
        ext === "gif" && ["GIF87a", "GIF89a"].includes(new TextDecoder().decode(b.subarray(0,6))) ? "image/gif" : "";
      if(!type) fail("Unsupported or mismatched declared resource media type", "E_RESOURCE");
      media.set(name, {path: `resources/${name}`, bytes: b, type, used: cover === name});
    }
    if(cover !== undefined && !media.has(cover)) fail("Missing declared cover resource", "E_RESOURCE");
    // Explicit IDs must remain unambiguous before the shared HTML allocator runs.
    const explicitIds = new Set<string>();
    const scan = async (value: unknown): Promise<void> => {
      await ctx.cooperate();
      if(!value || typeof value !== "object") return;
      if(Array.isArray(value)) {
        if(value.length === 3 && typeof value[0] === "string" && Array.isArray(value[1]) && Array.isArray(value[2]) && value[0]) {
          if(explicitIds.has(value[0])) fail("Duplicate explicit publication ID");
          explicitIds.add(value[0]);
        }
        for(const item of value) await scan(item);
      } else for(const item of Object.values(value)) await scan(item);
    };
    await scan(document.blocks);
    // Resolve literal MediaBag identities before HTML URL escaping can conflate
    // a filename's literal %20 with a space. Only owned AST copies are changed.
    const prepare = async (value: unknown): Promise<unknown> => {
      await ctx.cooperate();
      if(!value || typeof value !== "object") return value;
      ctx.charge("references", 1); ctx.charge("retainedBytes", 64);
      if(Array.isArray(value)) {
        const result: unknown[] = [];
        for(const item of value) result.push(await prepare(item));
        return result;
      }
      if("t" in value && (value.t === "Image" || value.t === "Link")) {
        const node = value as Extract<Inline, {t: "Image" | "Link"}>;
        const resource = media.get(node.c[2][0]);
        if(resource) {
          resource.used = true;
          return {...node, c: [await prepare(node.c[0]), await prepare(node.c[1]), [uri(resource.path), node.c[2][1]]]};
        }
        if(node.t === "Image") return fail("Image must name an explicit declared resource", "E_RESOURCE");
      }
      const result: Record<string, unknown> = {};
      for(const [key, item] of Object.entries(value)) result[key] = await prepare(item);
      return result;
    };
    const prepared = await prepare(document.blocks) as readonly Block[];
    const html = await writeHtml5({...document, blocks: prepared, metadata: {}}, htmlContext);
    if(html.kind !== "text") return fail("Expected text serialization");
    ctx.charge("retainedBytes", html.text.length * 4);
    const fragment = parseFragment(html.text);
    const chapters: Chapter[] = [];
    let current: Chapter = {name: "chapter-1.xhtml", nodes: []}, length = 0;
    for(const node of fragment.childNodes) {
      await ctx.cooperate();
      if(tree.isTextNode(node) && !node.value.trim()) continue;
      if(current.nodes.length && (tree.isElementNode(node) && ["h1", "h2", "h3", "h4", "h5", "h6"].slice(0, ctx.epub?.chapterLevel ?? 1).includes(node.tagName) || length >= 65536)) {
        chapters.push(current); current = {name: `chapter-${chapters.length + 1}.xhtml`, nodes: []}; length = 0;
      }
      current.nodes.push(node); length += text(node).length;
    }
    chapters.push(current);
    const targets = new Map<string, string>();
    const resourceUris = new Set([...media.values()].map(r => uri(r.path)));
    const toc: {href: string; label: string; level: string}[] = [];
    const walk = async (node: H.Node, visit: (element: H.Element) => void, depth = 1): Promise<void> => {
      await ctx.cooperate();
      ctx.bound("xmlDepth", depth); ctx.charge("xmlNodes", 1);
      if(tree.isElementNode(node)) visit(node);
      if("childNodes" in node) for(const child of node.childNodes) await walk(child, visit, depth + 1);
    };
    for(const chapter of chapters) {
      const start = toc.length;
      for(const node of chapter.nodes) await walk(node, element => {
        const id = element.attrs.find(a => a.name === "id")?.value;
        if(id) {
          if(targets.has(id) || [...id].some(c => c.charCodeAt(0) <= 32)) fail("Duplicate or invalid publication ID");
          targets.set(id, chapter.name);
        }
        if(["h1","h2","h3","h4","h5","h6"].includes(element.tagName)) toc.push({href: `${chapter.name}#${encodeURIComponent(id!)}`, label: text(element) || title, level: element.tagName.slice(1)});
      });
      if(toc.length === start) toc.push({href: chapter.name, label: chapters.length === 1 ? title : `Chapter ${chapters.indexOf(chapter) + 1}`, level: "1"});
    }
    for(const chapter of chapters) for(const node of chapter.nodes) await walk(node, element => {
      for(const a of element.attrs) {
        if(a.name !== "href" && a.name !== "src") continue;
        if(resourceUris.has(a.value)) continue;
        if(a.name === "src") fail("Image must name an explicit declared resource", "E_RESOURCE");
        if(a.value.startsWith("#")) {
          let id: string;
          // Literal AST IDs (including EPUB-reader scoped IDs) take precedence.
          try {id = targets.has(a.value.slice(1)) ? a.value.slice(1) : decodeURIComponent(a.value.slice(1));} catch {return fail("Invalid fragment URI");}
          const destination = targets.get(id);
          if(!destination) fail("Unknown internal publication target");
          a.value = `${destination === chapter.name ? "" : destination}#${encodeURIComponent(id)}`;
        } else if(!["https:", "http:", "mailto:", "tel:"].some(s => a.value.toLowerCase().startsWith(s))) fail("Unknown local publication target");
      }
    });
    for(const resource of media.values()) if(!resource.used) fail("Orphan declared resource", "E_RESOURCE");
    const serialize = (node: H.ChildNode): string => {
      ctx.checkpoint();
      if(tree.isTextNode(node)) return escape(node.value);
      if(!tree.isElementNode(node)) return "";
      const attrs = node.attrs.map(a => ` ${a.name}="${escape(a.value)}"`).join("");
      if(["br","hr","img","col"].includes(node.tagName)) return `<${node.tagName}${attrs}/>`;
      return `<${node.tagName}${attrs}>${node.childNodes.map(serialize).join("")}</${node.tagName}>`;
    };
    const xhtml = (body: string, name: string): string => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escape(lang)}" xml:lang="${escape(lang)}"><head><title>${escape(name)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
    const parts = new Map<string, Uint8Array>();
    let total = 0;
    const add = (name: string, value: string | Uint8Array): void => {
      ctx.charge("parts", 1);
      const size = typeof value === "string" ? value.length * 3 : value.length;
      ctx.bound("outputBytes", total + size);
      ctx.charge("retainedBytes", size);
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
      total += bytes.length;
      ctx.bound("expandedBytes", total);
      parts.set(name, bytes);
    };
    add("mimetype", "application/epub+zip");
    add("META-INF/container.xml", '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    add("EPUB/style.css", css);
    for(const chapter of chapters) add(`EPUB/${chapter.name}`, xhtml(chapter.nodes.map(serialize).join(""), title));
    for(const resource of media.values()) add(`EPUB/${resource.path}`, resource.bytes);
    if(cover !== undefined) add("EPUB/cover.xhtml", xhtml(`<section class="cover" epub:type="cover"><h1>${escape(title)}</h1><img src="${uri(media.get(cover)!.path)}" alt="${escape(title)}"/></section>`, title));
    add("EPUB/nav.xhtml", xhtml(`<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${toc.map(t => `<li class="level-${t.level}"><a href="${escape(t.href)}">${escape(t.label)}</a></li>`).join("")}</ol></nav>${cover === undefined ? "" : '<nav epub:type="landmarks"><h2>Landmarks</h2><ol><li><a epub:type="cover" href="cover.xhtml">Cover</a></li></ol></nav>'}`, "Contents"));
    // Hash ordered path/length-framed parts, so resource bytes and all publication
    // metadata affect identity. OPF identifier itself is excluded from this hash.
    const digestInput: Uint8Array[] = [];
    let digestSize = 0;
    for(const [name, bytes] of parts) {
      const prefix = new TextEncoder().encode(`${name.length}:${name}:${bytes.length}:`);
      digestInput.push(prefix, bytes); digestSize += prefix.length + bytes.length;
    }
    const metadataBytes = new TextEncoder().encode(JSON.stringify([title, lang, modified]));
    digestInput.push(metadataBytes); digestSize += metadataBytes.length;
    ctx.charge("retainedBytes", digestSize);
    const input = new Uint8Array(digestSize);
    let offset = 0;
    for(const bytes of digestInput) {input.set(bytes, offset); offset += bytes.length; await ctx.cooperate();}
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input));
    ctx.checkpoint();
    const identifier = explicitIdentifier ?? `urn:sha256:${[...digest].map(n => n.toString(16).padStart(2,"0")).join("")}`;
    const items = [`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`, '<item id="css" href="style.css" media-type="text/css"/>', ...chapters.map((c,i) => `<item id="chapter-${i+1}" href="${c.name}" media-type="application/xhtml+xml"/>`), ...[...media.entries()].map(([key,r],i) => `<item id="resource-${i+1}" href="${escape(uri(r.path))}" media-type="${r.type}"${key === cover ? ' properties="cover-image"' : ""}/>`), ...(cover === undefined ? [] : ['<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>'])];
    add("EPUB/package.opf", `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="publication-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="publication-id">${escape(identifier)}</dc:identifier><dc:title>${escape(title)}</dc:title><dc:language>${escape(lang)}</dc:language><meta property="dcterms:modified">${modified}</meta></metadata><manifest>${items.join("")}</manifest><spine>${cover === undefined ? "" : '<itemref idref="cover"/>'}${chapters.map((_,i) => `<itemref idref="chapter-${i+1}"/>`).join("")}</spine></package>`);
    const signal = ctx.signal ?? new AbortController().signal;
    const limits: ZipLimits = {maxArchiveBytes: ctx.limits.outputBytes, maxEntryBytes: ctx.limits.expandedBytes, maxTotalBytes: ctx.limits.expandedBytes, maxMembers: ctx.limits.parts, maxPathBytes: 4096, maxDepth: ctx.limits.depth, maxPaxBytes: 65535, maxTextBytes: 65535, chunkSize: 4096};
    const zip = createZipCodec({compression: createCompressionCodec(), yieldTurn: async () => ctx.cooperate(), fail: message => fail(message, message.includes("limit") ? "E_LIMIT" : "E_CAPABILITY")}, {rejectDuplicateNames: true, validatePayloads: true});
    const entries: ZipEntry[] = [];
    for(const [name, bytes] of parts) {
      const entry = await zip.makeZipEntry(name, bytes, {modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: name === "mimetype" ? "store" : "auto"}, limits, signal);
      if(name === "mimetype") {entry.localExtra = new Uint8Array(); entry.centralExtra = new Uint8Array();}
      entries.push(entry);
    }
    return {kind: "binary", bytes: await zip.writeZipArchive({entries, comment: new Uint8Array()}, limits, signal)};
  }
};
