import CSL from "citeproc";
import {PandocError} from "./errors.js";
import {htmlReader} from "./html.js";
import type {Block, Citation, Inline} from "./ast-types.js";
import type {FilterCapability, MetadataObject} from "./types.js";

/** Trusted CSL inputs only: the synchronous processor is not an isolated or
 * instruction-metered runtime. No locale, style or bibliography is fetched. */
export interface CiteprocFilterOptions {
  readonly style: string;
  readonly locale: string;
  readonly language?: string;
  readonly references: readonly MetadataObject[];
}

/** Run citeproc-js with explicitly supplied CSL style, locale and references. */
export function createCiteprocFilterCapability(options: CiteprocFilterOptions): FilterCapability {
  if (!options || typeof options.style !== "string" || typeof options.locale !== "string" || !Array.isArray(options.references))
    throw new TypeError("CSL style, locale and references are required");
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
      const serialized = JSON.stringify(options.references);
      context.charge("retainedBytes", serialized.length * 5);
      context.charge("text", options.style.length + options.locale.length + serialized.length);
      const items = new Map<string, Record<string, unknown>>();
      for (const item of JSON.parse(serialized) as Record<string, unknown>[]) {
        context.checkpoint();
        if (typeof item.id !== "string" || !item.id || items.has(item.id))
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
          retrieveLocale: () => options.locale,
          retrieveItem: id => {
            context.checkpoint();
            const item = items.get(id);
            if (!item) throw new PandocError("E_AST", "convert", `Missing CSL reference: ${id}`);
            return item;
          }
        }, options.style, options.language ?? "en-US");
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
