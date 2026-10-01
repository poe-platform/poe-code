import {encodeXML} from "entities";
import type {Block, Inline} from "./ast-types.js";
import type {WriterCapability} from "./types.js";
import {imageLength} from "./image-dimensions.js";
import {odtNamespaces as ns, odtMime, odtPackage, odtFailure, fo, xlink, svg} from "./odt-package.js";

export const odtWriter: WriterCapability = {format: "odt", imageResources: "embed", async write(document, ctx) {
  const parts = new Map<string, Uint8Array>([["mimetype", new TextEncoder().encode(odtMime)]]);
  const mediaTypes = new Map<string, string>();
  const images = new Map<string, {name: string; width: number; height: number}>();
  const styles = new Map<string, string>();
  let serial = 0;
  const escaped = (value: string): string => {
    ctx.checkpoint(value.length);
    for (const ch of value) {const code = ch.codePointAt(0)!; if (code < 32 && ![9, 10, 13].includes(code) || code === 0xfffe || code === 0xffff) odtFailure(ctx, "Invalid XML character");}
    const result = encodeXML(value); ctx.charge("retainedBytes", result.length * 2); return result;
  };
  const text = (value: string): string => escaped(value).split(" ").join("<text:s/>").split("\t").join("<text:tab/>").split("\n").join("<text:line-break/>");
  const textStyles: Record<string, string> = {Strong: 'fo:font-weight="bold"', Emph: 'fo:font-style="italic"', Strikeout: 'style:text-line-through-style="solid"', Superscript: 'style:text-position="super 58%"', Subscript: 'style:text-position="sub 58%"', Underline: 'style:text-underline-style="solid"', SmallCaps: 'fo:font-variant="small-caps"', Code: 'fo:font-family="monospace"'};
  for (const [name, properties] of Object.entries(textStyles)) styles.set(name, `<style:style style:name="${name}" style:family="text"><style:text-properties ${properties}/></style:style>`);
  styles.set("Rule", '<style:style style:name="Rule" style:family="paragraph"><style:paragraph-properties fo:border-bottom="0.5pt solid #000000"/></style:style>');
  styles.set("Preformatted", '<style:style style:name="Preformatted" style:family="paragraph"><style:text-properties fo:font-family="monospace"/></style:style>');
  const inlines = async (nodes: readonly Inline[]): Promise<string> => {
    const output: string[] = [];
    for (const node of nodes) {
      await ctx.cooperate();
      switch (node.t) {
        case "Str": output.push(text(node.c)); break;
        case "Space": case "SoftBreak": output.push("<text:s/>"); break;
        case "LineBreak": output.push("<text:line-break/>"); break;
        case "Strong": case "Emph": case "Strikeout": case "Superscript": case "Subscript": case "Underline": case "SmallCaps": output.push(`<text:span text:style-name="${node.t}">${await inlines(node.c)}</text:span>`); break;
        case "Code": output.push(`<text:span text:style-name="Code">${text(node.c[1])}</text:span>`); break;
        case "Span": output.push(await inlines(node.c[1])); break;
        case "Quoted": output.push((node.c[0] === "SingleQuote" ? "‘" : "“") + await inlines(node.c[1]) + (node.c[0] === "SingleQuote" ? "’" : "”")); break;
        case "Link": output.push(`<text:a xlink:type="simple" xlink:href="${escaped(node.c[2][0])}">${await inlines(node.c[1])}</text:a>`); break;
        case "Image": {
          const source = node.c[2][0]; let image = images.get(source);
          ctx.charge("images", 1);
          if (!image) {
            const bytes = document.resources.find(r => r.id === source)?.bytes ?? await ctx.resources?.resolve(source, undefined, ctx.signal);
            if (!bytes) odtFailure(ctx, `Missing image resource: ${source}`, "E_RESOURCE");
            ctx.charge("resourceBytes", bytes.length);
            const {Image, DocumentBudget} = await import("docx");
            const asset = await Image.from_blob(bytes, {signal: ctx.signal ?? new AbortController().signal, budget: new DocumentBudget({embeddedMediaBytes: ctx.limits.resourceBytes, retainedBytes: ctx.limits.retainedBytes, work: ctx.limits.work})});
            image = {name: `Pictures/image-${images.size + 1}.${asset.ext}`, width: asset.width.emu, height: asset.height.emu};
            images.set(source, image); parts.set(image.name, bytes); mediaTypes.set(image.name, asset.content_type);
          }
          const attrs = Object.fromEntries(node.c[0][2]);
          let width = imageLength(attrs.width, image.width, ctx, "odt"), height = imageLength(attrs.height, image.height, ctx, "odt");
          if (attrs.width && !attrs.height) height = width * image.height / image.width;
          if (attrs.height && !attrs.width) width = height * image.width / image.height;
          output.push(`<draw:frame draw:name="Image${++serial}" text:anchor-type="as-char" svg:width="${width / 914400}in" svg:height="${height / 914400}in"><draw:image xlink:href="${image.name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/><svg:title>${escaped(node.c[2][1])}</svg:title><svg:desc>${escaped(node.c[1].map(n => n.t === "Str" ? n.c : n.t === "Space" ? " " : "").join(""))}</svg:desc></draw:frame>`);
          break;
        }
        default: odtFailure(ctx, `Unsupported ODT inline: ${node.t}`, "E_UNSUPPORTED_FEATURE");
      }
    }
    return output.join("");
  };
  const blocks = async (nodes: readonly Block[], paragraphStyle = "", listLevel = 1): Promise<string> => {
    const output: string[] = [];
    for (const node of nodes) {
      await ctx.cooperate();
      switch (node.t) {
        case "Para": case "Plain": output.push(`<text:p${paragraphStyle ? ` text:style-name="${paragraphStyle}"` : ""}>${await inlines(node.c)}</text:p>`); break;
        case "Header": output.push(`<text:h text:outline-level="${node.c[0]}">${await inlines(node.c[2])}</text:h>`); break;
        case "CodeBlock": output.push(`<text:p text:style-name="Preformatted">${text(node.c[1])}</text:p>`); break;
        case "BlockQuote": output.push(await blocks(node.c, "Quotations", listLevel)); break;
        case "HorizontalRule": output.push('<text:p text:style-name="Rule"/>'); break;
        case "Div": output.push(`<text:section text:name="${escaped(node.c[0][0] || `Section${++serial}`)}">${await blocks(node.c[1], paragraphStyle, listLevel)}</text:section>`); break;
        case "BulletList": case "OrderedList": {
          const name = `List${++serial}`, ordered = node.t === "OrderedList";
          const format = ordered ? ({DefaultStyle: "1", Decimal: "1", LowerAlpha: "a", UpperAlpha: "A", LowerRoman: "i", UpperRoman: "I"} as Record<string, string>)[node.c[0][1]] : undefined;
          if (ordered && !format) odtFailure(ctx, "Unsupported ODT list style", "E_UNSUPPORTED_FEATURE");
          styles.set(name, `<text:list-style style:name="${name}">${ordered ? `<text:list-level-style-number text:level="${listLevel}" style:num-format="${format}" text:start-value="${node.c[0][0]}" style:num-prefix="${node.c[0][2] === "TwoParens" ? "(" : ""}" style:num-suffix="${["OneParen", "TwoParens"].includes(node.c[0][2]) ? ")" : "."}"/>` : `<text:list-level-style-bullet text:level="${listLevel}" text:bullet-char="•"/>`}</text:list-style>`);
          const items: string[] = [];
          for (const item of ordered ? node.c[1] : node.c) items.push(`<text:list-item>${await blocks(item, paragraphStyle, listLevel + 1)}</text:list-item>`);
          output.push(`<text:list text:style-name="${name}">${items.join("")}</text:list>`); break;
        }
        case "Table": {
          output.push(await blocks(node.c[1][1]));
          if (!node.c[1][1].length && node.c[1][0]) output.push(`<text:p>${await inlines(node.c[1][0])}</text:p>`);
          output.push(`<table:table table:name="Table${++serial}"><table:table-column table:number-columns-repeated="${node.c[2].length}"/>`);
          for (const [rows, header] of [[node.c[3][1], true], [node.c[4].flatMap(body => [...body[2], ...body[3]]), false], [node.c[5][1], false]] as const) {
            if (header && rows.length) output.push("<table:table-header-rows>");
            for (const row of rows) {
              output.push("<table:table-row>");
              for (const cell of row[1]) {
                if (cell[2] !== 1 || cell[3] !== 1) odtFailure(ctx, "ODT table spans are unsupported", "E_UNSUPPORTED_FEATURE");
                output.push(`<table:table-cell office:value-type="string">${await blocks(cell[4], header ? "Table_20_Heading" : "Table_20_Contents")}</table:table-cell>`);
              }
              output.push("</table:table-row>");
            }
            if (header && rows.length) output.push("</table:table-header-rows>");
          }
          output.push("</table:table>"); break;
        }
        default: odtFailure(ctx, `Unsupported ODT block: ${node.t}`, "E_UNSUPPORTED_FEATURE");
      }
    }
    const value = output.join(""); ctx.bound("outputBytes", value.length); ctx.charge("retainedBytes", value.length * 2); return value;
  };
  const content = await blocks(document.blocks);
  const namespaces = Object.entries(ns).map(([key, value]) => `xmlns:${key}="${value}"`).join(" ") + ` xmlns:fo="${fo}" xmlns:xlink="${xlink}" xmlns:svg="${svg}"`;
  const put = (name: string, xml: string) => {ctx.bound("outputBytes", xml.length); parts.set(name, new TextEncoder().encode(xml));};
  put("content.xml", `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${namespaces} office:version="1.3"><office:automatic-styles>${[...styles.values()].join("")}</office:automatic-styles><office:body><office:text>${content}</office:text></office:body></office:document-content>`);
  put("styles.xml", `<?xml version="1.0"?><office:document-styles ${namespaces} office:version="1.3"><office:styles><style:style style:name="Standard" style:family="paragraph"/><style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-left="0.5in" fo:margin-right="0.5in"/></style:style><style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard"/><style:style style:name="Table_20_Heading" style:display-name="Table Heading" style:family="paragraph" style:parent-style-name="Table_20_Contents"><style:text-properties fo:font-weight="bold"/></style:style></office:styles></office:document-styles>`);
  const title = document.metadata.title;
  put("meta.xml", `<?xml version="1.0"?><office:document-meta xmlns:office="${ns.office}" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta>${title?.t === "MetaString" ? `<dc:title>${escaped(title.c)}</dc:title>` : ""}</office:meta></office:document-meta>`);
  put("META-INF/manifest.xml", `<?xml version="1.0"?><manifest:manifest xmlns:manifest="${ns.manifest}" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${odtMime}"/>${[...parts.keys()].filter(name => name !== "mimetype").map(name => `<manifest:file-entry manifest:full-path="${name}" manifest:media-type="${mediaTypes.get(name) ?? "text/xml"}"/>`).join("")}</manifest:manifest>`);
  return {kind: "binary", bytes: await odtPackage(ctx).write(parts)};
}};
