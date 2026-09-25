import CSL from "citeproc";
import {PandocError} from "./errors.js";
import {htmlReader} from "./html.js";
import type {Block, Citation, Inline, MetaValue} from "./ast-types.js";
import type {FilterCapability, MetadataObject} from "./types.js";

const defaultStyle = '<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0"><info><title>Chicago Manual of Style (author-date)</title><id>http://www.zotero.org/styles/chicago-author-date</id><updated>2026-01-01T00:00:00Z</updated></info><citation><layout prefix="(" suffix=")" delimiter="; "><group delimiter=", "><names variable="author"><name form="short" and="text"/></names><date variable="issued"><date-part name="year"/></date></group></layout></citation><bibliography><layout suffix="."><group delimiter=". "><names variable="author"><name name-as-sort-order="all" sort-separator=", " initialize-with=". "/></names><date variable="issued"><date-part name="year"/></date><text variable="title" font-style="italic"/></group></layout></bibliography></style>';
const defaultLocale = '<locale xmlns="http://purl.org/net/xbiblio/csl" version="1.0" xml:lang="en-US"><terms><term name="and">and</term><term name="et-al">et al.</term></terms></locale>';

/** Trusted CSL inputs only: the synchronous processor is not an isolated or
 * instruction-metered runtime. No locale, style or bibliography is fetched. */
export interface CiteprocFilterOptions {
  readonly style?: string;
  readonly locale?: string;
  readonly language?: string;
  readonly references?: readonly MetadataObject[];
}

function metaInlinesToText(inlines: readonly Inline[]): string {
  return inlines.map(inline => {
    if (inline.t === "Str") return inline.c;
    if (inline.t === "Space" || inline.t === "SoftBreak" || inline.t === "LineBreak") return " ";
    if (inline.t === "Code" || inline.t === "Math") return inline.c[1];
    if ("c" in inline && Array.isArray(inline.c)) {
      const children = inline.c.find(part => Array.isArray(part));
      if (Array.isArray(children)) return metaInlinesToText(children as readonly Inline[]);
    }
    return "";
  }).join("");
}

function metaValueToCsl(value: MetaValue, numeric = false): unknown {
  if (value.t === "MetaString") return numeric && /^-?\d+$/.test(value.c) ? Number(value.c) : value.c;
  if (value.t === "MetaBool") return value.c;
  if (value.t === "MetaInlines") {
    const text = metaInlinesToText(value.c);
    return numeric && /^-?\d+$/.test(text) ? Number(text) : text;
  }
  if (value.t === "MetaBlocks") return "";
  if (value.t === "MetaList") return value.c.map(entry => metaValueToCsl(entry, numeric));
  return Object.fromEntries(Object.entries(value.c).map(([key, child]) => [key, metaValueToCsl(child, numeric || key === "date-parts")]));
}

/** Run citeproc-js with supplied or metadata CSL references and bounded defaults. */
export function createCiteprocFilterCapability(options: CiteprocFilterOptions = {}): FilterCapability {
  if (!options || typeof options !== "object" ||
      (options.style !== undefined && typeof options.style !== "string") ||
      (options.locale !== undefined && typeof options.locale !== "string") ||
      (options.references !== undefined && !Array.isArray(options.references)))
    throw new TypeError("CSL style, locale and references must be valid when supplied");
  const style = options.style ?? defaultStyle;
  const locale = options.locale ?? defaultLocale;
  return {
    supports: request => request.kind === "citeproc",
    async apply(document, request, context) {
      if (request.kind !== "citeproc") throw new PandocError("E_CAPABILITY", "convert", "This capability supports citeproc only");
      context.checkpoint();
      const citations: Extract<Inline, {t: "Cite"}>[] = [];
      const bibliographies: object[] = [];
      const collect = async (value: unknown, depth: number): Promise<void> => {
        await context.cooperate();
        context.bound("depth", depth);
        if (!value || typeof value !== "object") return;
        if ("t" in value && value.t === "Div" && "c" in value && Array.isArray(value.c) && value.c[0]?.[0] === "refs") {
          context.charge("references", 1);
          bibliographies.push(value);
          return;
        }
        if ("t" in value && value.t === "Cite") {
          context.charge("references", 1);
          citations.push(value as Extract<Inline, {t: "Cite"}>);
          return;
        }
        context.charge("references", Object.keys(value).length);
        for (const child of Object.values(value)) await collect(child, depth + 1);
      };
      await collect(document.blocks, 0);
      if (!citations.length) return document;
      const metadataRefs = document.metadata.references ? metaValueToCsl(document.metadata.references) : undefined;
      const rawRefs = options.references ?? (Array.isArray(metadataRefs) ? metadataRefs : []);
      const serialized = JSON.stringify(rawRefs);
      context.charge("retainedBytes", serialized.length * 5);
      context.charge("text", style.length + locale.length + serialized.length);
      const items = new Map<string, Record<string, unknown>>();
      for (const item of JSON.parse(serialized) as Record<string, unknown>[]) {
        context.checkpoint();
        if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || items.has(item.id))
          throw new PandocError("E_AST", "convert", "CSL references require unique string IDs");
        items.set(item.id, item);
      }
      const affix = (values: readonly Inline[]): string => values.map(value => {
        if (value.t === "Str") return value.c;
        if (value.t === "Space" || value.t === "SoftBreak" || value.t === "LineBreak") return " ";
        throw new PandocError("E_UNSUPPORTED_FEATURE", "convert", "Citation prefixes and suffixes require plain text");
      }).join("");
      const citationItem = (citation: Citation): Record<string, unknown> => {
        context.checkpoint();
        if (!items.has(citation.citationId)) throw new PandocError("E_AST", "convert", `Missing CSL reference: ${citation.citationId}`);
        return {id: citation.citationId, prefix: affix(citation.citationPrefix), suffix: affix(citation.citationSuffix),
          "suppress-author": citation.citationMode === "SuppressAuthor"};
      };
      const clusters = citations.map((citation, index) => ({
        citationID: String(index), citationItems: citation.c[0].map(citationItem),
        properties: {noteIndex: citation.c[0][0]?.citationNoteNum ?? 0,
          ...(citation.c[0][0]?.citationMode === "AuthorInText" ? {mode: "composite"} : {})}
      }));
      let rendered: [string, number, string][];
      let bibliography: false | [Record<string, unknown>, string[]];
      let noteStyle = false;
      try {
        const processor = new CSL.Engine({
          retrieveLocale: () => locale,
          retrieveItem: id => {
            context.checkpoint();
            const item = items.get(id);
            if (!item) throw new PandocError("E_AST", "convert", `Missing CSL reference: ${id}`);
            return item;
          }
        }, style, options.language ?? document.language ?? "en-US");
        noteStyle = processor.opt.xclass === "note";
        if (noteStyle) for (let index = 0; index < clusters.length; index++) {
          if (!clusters[index]!.properties.noteIndex) clusters[index]!.properties.noteIndex = index + 1;
        }
        rendered = processor.rebuildProcessorState(clusters, "html", []);
        bibliography = processor.makeBibliography();
      } catch (error) {
        if (error instanceof PandocError) throw error;
        throw new PandocError("E_AST", "convert", `CSL processing failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      context.checkpoint();
      const parse = async (html: string): Promise<readonly Block[]> => {
        context.charge("retainedBytes", html.length * 2);
        context.charge("inputBytes", html.length * 3);
        return (await htmlReader.read({text: html, bytes: new Uint8Array()}, context)).blocks;
      };
      const replacements = new Map<object, Inline | Block>();
      for (const [id, , html] of rendered) {
        const citation = citations[Number(id)];
        if (!citation) throw new PandocError("E_AST", "convert", "CSL returned an unknown citation");
        const blocks = await parse(`<p>${html}</p>`);
        if (blocks.length !== 1 || blocks[0]?.t !== "Para") throw new PandocError("E_AST", "convert", "CSL citation is not inline content");
        replacements.set(citation, noteStyle && !citation.c[0][0]?.citationNoteNum
          ? {t: "Note", c: blocks}
          : {...citation, c: [citation.c[0], blocks[0].c]});
      }
      if (replacements.size !== citations.length) throw new PandocError("E_AST", "convert", "CSL did not format every citation");
      let references: Block | undefined;
      if (bibliography) {
        const entries: Block[] = [];
        for (const html of bibliography[1]) entries.push(...await parse(html));
        context.charge("references", entries.length);
        references = {t: "Div", c: [["refs", ["references", "csl-bib-body"], []], entries]};
        for (const existing of bibliographies) replacements.set(existing, references);
      }
      const replace = async (value: unknown, depth: number): Promise<unknown> => {
        await context.cooperate();
        context.bound("depth", depth);
        if (!value || typeof value !== "object") return value;
        if (replacements.has(value)) return replacements.get(value);
        context.charge("references", Object.keys(value).length);
        context.charge("retainedBytes", Object.keys(value).length * 16);
        const entries: (readonly [string, unknown])[] = [];
        for (const [key, child] of Object.entries(value)) entries.push([key, await replace(child, depth + 1)]);
        if (entries.every(([key, child]) => child === (value as Record<string, unknown>)[key])) return value;
        return Array.isArray(value) ? entries.map(([, child]) => child) : Object.fromEntries(entries);
      };
      const blocks = await replace(document.blocks, 0) as readonly Block[];
      if (!references || bibliographies.length) return {...document, blocks};
      context.charge("references", blocks.length + 1);
      return {...document, blocks: [...blocks, references]};
    }
  };
}
