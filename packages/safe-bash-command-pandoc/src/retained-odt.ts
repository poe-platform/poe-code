import type {prepareRetainedImageResources} from "./retained-image-resources.js";
import {retainedImageLength} from "./image-dimensions.js";
import {encodeXML} from "entities";
import {RetainedOdtPackage} from "./retained-odt-package.js";
import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, emptyText, type TextRange} from "./backed-text.js";
import type {BackedJson} from "./backed-json.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";
import {PandocError} from "./errors.js";
import {readJsonNumber} from "./json-number.js";
import {odtMime, odtNamespaces as ns} from "./odt-package.js";
import {odtBaseStyles, odtDocumentNamespaces, odtStylesDocument} from "./odt-styles.js";
type Job = {op: string; node?: number; mode?: string; style?: string; level?: number; value?: string; end?: number; begin?: number};

/** ODT XML continuations and package members stay in caller backing storage. */
export async function writeRetainedOdt(tree: BackedJson, context: ExecutionContext, working: WorkingStorageOptions, options: ConversionOptions, resources: Awaited<ReturnType<typeof prepareRetainedImageResources>>): Promise<void> {
  const signal = context.signal ?? new AbortController().signal;
  const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal}, (working.cacheBytes ?? 1048576) / 16384);
  const release = context.onClose(() => storage.close()), text = new BackedText(storage, units => context.cooperate(units));
  const mediaManifest = emptyText(), images = new IntegerTable(storage, 64); let imageCount = 0;
  const content = emptyText(), styles = await text.from(odtBaseStyles.values());
  let top = 0, serial = 0, failure: {reason: unknown} | undefined;
  const fail = (message: string, code: "E_PARSE" | "E_UNSUPPORTED_FEATURE" = "E_PARSE"): never => {throw new PandocError(code, "convert", message, "odt");};
  const add = async (value: string) => {await text.append(content, await text.from([value]));};
  const push = async (job: Job) => {
    const data = new TextEncoder().encode(JSON.stringify(job)), bytes = new Uint8Array(16 + data.length), view = new DataView(bytes.buffer);
    view.setFloat64(0, top, true); view.setFloat64(8, data.length, true); bytes.set(data, 16); top = await storage.append(bytes);
  };
  const sequence = async (...jobs: Job[]) => {for (let i = jobs.length - 1; i >= 0; i--) await push(jobs[i]!);};
  const literal = (value: string): Job => ({op: "literal", value});
  const list = (node: number, mode: string, style = "", level = 1): Job => ({op: "list", node, mode, style, level});
  const at = async (node: number, index: number) => {let child = node + 32; for (let i = 0; i < index; i++) {child = (await tree.describe(child)).end; await context.cooperate();} return child;};
  const count = async (node: number) => (await tree.describe(node)).children;
  const tagOf = async (node: number) => (await tree.smallText((await tree.property(node, "t"))!, 32))!;
  const number = (node: number) => readJsonNumber(tree.scalarChunks(node), units => context.cooperate(units));
  const escape = async (node: number, spaces = false) => {
    const range = await text.from(tree.scalarChunks(node));
    for await (const chunk of text.unicodeChunks(range)) {
      for (const char of chunk) {const code = char.codePointAt(0)!; if (code < 32 && ![9,10,13].includes(code) || code === 0xfffe || code === 0xffff) fail("Invalid XML character");}
      let value = encodeXML(chunk);
      if (spaces) value = value.split(" ").join("<text:s/>").split("\t").join("<text:tab/>").split("\n").join("<text:line-break/>");
      await add(value);
    }
  };
  try {
    const archive = new RetainedOdtPackage(storage, context);
    const bytes = async function* (values: Iterable<string | TextRange>) {for (const value of values) {if (typeof value === "string") yield new TextEncoder().encode(value); else for await (const chunk of text.unicodeChunks(value)) yield new TextEncoder().encode(chunk);}};
    const putXml = async (name: string, values: (string | TextRange)[]) => {
      if (Number.isFinite(context.limits.references)) context.bound("outputBytes", values.reduce((units, value) => units + (typeof value === "string" ? value.length : value.units), 0));
      await archive.addSource(name, bytes(values));
    };
    await archive.addSource("mimetype", bytes([odtMime]));
    await push(list((await tree.property(tree.rootPosition, "blocks"))!, "block"));
    while (top) {
      await context.cooperate();
      const header = await storage.read(top, 16), view = new DataView(header.buffer, header.byteOffset, header.length), position = top;
      top = view.getFloat64(0, true);
      const job = JSON.parse(new TextDecoder().decode(await storage.read(position + 16, view.getFloat64(8, true)))) as Job;
      const node = job.node ?? 0, style = job.style ?? "", level = job.level ?? 1;
      if (job.op === "blockBudget") {context.bound("outputBytes", content.units - job.begin!); continue;}
      if (job.op === "literal") {await add(job.value!); continue;}
      if (job.op === "escape") {await escape(node, job.mode === "text"); continue;}
      if (job.op === "list") {
        if (job.mode === "block" && Number.isFinite(context.limits.references)) await push({op: "blockBudget", begin: content.units});
        const header = await tree.describe(node);
        if (header.children) await push({op: "next", node: node + 32, end: header.end, mode: job.mode!, style, level});
        continue;
      }
      if (job.op === "next") {
        const end = (await tree.describe(node)).end;
        if (end < job.end!) await push({...job, node: end});
        await push({op: job.mode!, node, style, level}); continue;
      }
      if (job.op === "item") {await sequence(literal("<text:list-item>"), list(node, "block", style, level), literal("</text:list-item>")); continue;}
      if (job.op === "body") {await sequence(list(await at(node, 2), "row", style), list(await at(node, 3), "row", style)); continue;}
      if (job.op === "row") {await sequence(literal("<table:table-row>"), list(await at(node, 1), "cell", style), literal("</table:table-row>")); continue;}
      if (job.op === "cell") {
        if (await number(await at(node, 2)) !== 1 || await number(await at(node, 3)) !== 1) fail("ODT table spans are unsupported", "E_UNSUPPORTED_FEATURE");
        await sequence(literal('<table:table-cell office:value-type="string">'), list(await at(node, 4), "block", style), literal("</table:table-cell>")); continue;
      }
      const tag = (await tree.smallText((await tree.property(node, "t"))!, 32))!, c = (await tree.property(node, "c"))!;
      if (job.op === "table") {
        const head = await at(await at(c, 3), 1), foot = await at(await at(c, 5), 1), hasHead = !!await count(head);
        await sequence(literal(`<table:table table:name="Table${++serial}"><table:table-column table:number-columns-repeated="${await count(await at(c, 2))}"/>`),
          ...(hasHead ? [literal("<table:table-header-rows>"), list(head, "row", "Table_20_Heading"), literal("</table:table-header-rows>")] : []),
          list(await at(c, 4), "body", "Table_20_Contents"), list(foot, "row", "Table_20_Contents"), literal("</table:table>"));
        continue;
      }
      if (job.op === "inline") {
        if (tag === "Str") await escape(c, true);
        else if (tag === "Space" || tag === "SoftBreak") await add("<text:s/>");
        else if (tag === "LineBreak") await add("<text:line-break/>");
        else if (["Strong", "Emph", "Strikeout", "Superscript", "Subscript", "Underline", "SmallCaps"].includes(tag))
          await sequence(literal(`<text:span text:style-name="${tag}">`), list(c, "inline"), literal("</text:span>"));
        else if (tag === "Code") await sequence(literal('<text:span text:style-name="Code">'), {op: "escape", node: await at(c, 1), mode: "text"}, literal("</text:span>"));
        else if (tag === "Span" || tag === "Cite") await push(list(await at(c, 1), "inline"));
        else if (tag === "Quoted") {const single = await tagOf(c + 32) === "SingleQuote"; await sequence(literal(single ? "‘" : "“"), list(await at(c, 1), "inline"), literal(single ? "’" : "”"));}
        else if (tag === "Link") await sequence(literal('<text:a xlink:type="simple" xlink:href="'), {op: "escape", node: (await at(c, 2)) + 32}, literal('">'), list(await at(c, 1), "inline"), literal("</text:a>"));
        else if (tag === "Image") {
          const target = await at(c, 2), resource = await resources.image(target + 32);
          context.charge("images", 1);
          const key = BigInt(resource.identity), stored = Number(await images.get(key) ?? 0n);
          let image: {name: string; width: number; height: number};
          if (stored) {
            const header = await storage.read(stored, 8), length = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0,true);
            image = JSON.parse(new TextDecoder().decode(await storage.read(stored+8,length))) as typeof image;
          } else {
            const {characterizeRetainedRasterHeader, DocumentBudget, Inches, InvalidValueError} = await import("safe-bash-docx-engine/pandoc-adapter");
            context.charge("resourceBytes", resource.source.size);
            const metadata = await characterizeRetainedRasterHeader({size: resource.source.size, read: (position,length) => context.call(() => resource.source.read(position,length))}, resource.storage, {signal, budget: new DocumentBudget({embeddedMediaBytes: context.limits.resourceBytes, retainedBytes: context.limits.retainedBytes, work: context.limits.work})});
            const extension = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/bmp": "bmp", "image/tiff": "tiff"}[metadata.mime];
            const width = Inches(metadata.pixelWidth / (metadata.horizontalDpi ?? 72)).emu, height = Inches(metadata.pixelHeight / (metadata.verticalDpi ?? 72)).emu;
            if (width <= 0) throw new InvalidValueError("Native image width must round to positive EMUs.");
            if (height <= 0) throw new InvalidValueError("Native image height must round to positive EMUs.");
            image = {name: `Pictures/image-${++imageCount}.${extension}`, width, height};
            const payload = new TextEncoder().encode(JSON.stringify(image)), record = new Uint8Array(8+payload.length); new DataView(record.buffer).setFloat64(0,payload.length,true); record.set(payload,8);
            await images.set(key,BigInt(await storage.append(record)));
            await archive.addSource(image.name, resource.chunks);
            await text.append(mediaManifest,await text.from([`<manifest:file-entry manifest:full-path="${image.name}" manifest:media-type="${metadata.mime}"/>`]));
          }
          let widthNode: number | undefined, heightNode: number | undefined;
          const attrs = await at(c+32,2), end = (await tree.describe(attrs)).end;
          for (let pair=attrs+32;pair<end;pair=(await tree.describe(pair)).end) {
            const name = await tree.smallText(pair+32,6); if(name === "width") widthNode = await at(pair,1); if(name === "height") heightNode = await at(pair,1);
          }
          let width = widthNode === undefined ? image.width : await retainedImageLength(tree.scalarChunks(widthNode),context,"odt");
          let height = heightNode === undefined ? image.height : await retainedImageLength(tree.scalarChunks(heightNode),context,"odt");
          if(widthNode !== undefined && heightNode === undefined) height=width*image.height/image.width;
          if(heightNode !== undefined && widthNode === undefined) width=height*image.width/image.height;
          await add(`<draw:frame draw:name="Image${++serial}" text:anchor-type="as-char" svg:width="${width/914400}in" svg:height="${height/914400}in"><draw:image xlink:href="${image.name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/><svg:title>`);
          await escape(await at(target,1)); await add("</svg:title><svg:desc>");
          const alt = await at(c,1), altEnd=(await tree.describe(alt)).end;
          for(let child=alt+32;child<altEnd;child=(await tree.describe(child)).end) {const tag=await tagOf(child); if(tag === "Str") await escape((await tree.property(child,"c"))!); else if(tag === "Space") await add(" ");}
          await add("</svg:desc></draw:frame>");
        }
        else fail("Unsupported ODT inline: " + tag, "E_UNSUPPORTED_FEATURE");
        continue;
      }
      if (tag === "Para" || tag === "Plain") await sequence(literal(`<text:p${style ? ` text:style-name="${style}"` : ""}>`), list(c, "inline"), literal("</text:p>"));
      else if (tag === "Header") await sequence(literal(`<text:h text:outline-level="${await number(c + 32)}">`), list(await at(c, 2), "inline"), literal("</text:h>"));
      else if (tag === "CodeBlock") await sequence(literal('<text:p text:style-name="Preformatted">'), {op: "escape", node: await at(c, 1), mode: "text"}, literal("</text:p>"));
      else if (tag === "BlockQuote") await push(list(c, "block", "Quotations", level));
      else if (tag === "HorizontalRule") await add('<text:p text:style-name="Rule"/>');
      else if (tag === "Div") {
        await add('<text:section text:name="'); const id = c + 64;
        if (await tree.smallText(id, 0) !== "") await escape(id); else await add("Section" + ++serial);
        await sequence(literal('">'), list(await at(c, 1), "block", style, level), literal("</text:section>"));
      } else if (tag === "BulletList" || tag === "OrderedList") {
        const name = "List" + ++serial, ordered = tag === "OrderedList", spec = c + 32;
        const format = ordered ? ({DefaultStyle: "1", Decimal: "1", LowerAlpha: "a", UpperAlpha: "A", LowerRoman: "i", UpperRoman: "I"} as Record<string, string>)[await tagOf(await at(spec, 1))] : undefined;
        if (ordered && !format) fail("Unsupported ODT list style", "E_UNSUPPORTED_FEATURE");
        const delim = ordered ? await tagOf(await at(spec, 2)) : "";
        const xml = `<text:list-style style:name="${name}">${ordered ? `<text:list-level-style-number text:level="${level}" style:num-format="${format}" text:start-value="${await number(spec + 32)}" style:num-prefix="${delim === "TwoParens" ? "(" : ""}" style:num-suffix="${delim === "OneParen" || delim === "TwoParens" ? ")" : "."}"/>` : `<text:list-level-style-bullet text:level="${level}" text:bullet-char="•"/>`}</text:list-style>`;
        await text.append(styles, await text.from([xml]));
        await sequence(literal(`<text:list text:style-name="${name}">`), list(ordered ? await at(c, 1) : c, "item", style, level + 1), literal("</text:list>"));
      } else if (tag === "Table") {
        // Defer the table serial until its caption (which may itself contain lists) finishes.
        const caption = await at(c, 1), long = await at(caption, 1);
        await push({op: "table", node, style, level});
        if (await count(long)) await push(list(long, "block"));
        else if ((await tree.describe(caption + 32)).kind === "array") await sequence(literal("<text:p>"), list(caption + 32, "inline"), literal("</text:p>"));
      } else fail("Unsupported ODT block: " + tag, "E_UNSUPPORTED_FEATURE");
    }
    await putXml("content.xml", [`<?xml version="1.0" encoding="UTF-8"?><office:document-content ${odtDocumentNamespaces} office:version="1.3"><office:automatic-styles>`, styles, "</office:automatic-styles><office:body><office:text>", content, "</office:text></office:body></office:document-content>"]);
    await putXml("styles.xml", [odtStylesDocument]);
    const meta = (await tree.property(tree.rootPosition, "meta"))!, title = await tree.property(meta, "title");
    const titleText = emptyText();
    if (title !== undefined && await tree.smallText((await tree.property(title, "t"))!, 32) === "MetaString") {
      const previous = {...content}; content.first = 0; content.last = 0; content.units = 0;
      await add("<dc:title>"); await escape((await tree.property(title, "c"))!); await add("</dc:title>"); Object.assign(titleText, content); Object.assign(content, previous);
    }
    await putXml("meta.xml", [`<?xml version="1.0"?><office:document-meta xmlns:office="${ns.office}" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta>`, titleText, "</office:meta></office:document-meta>"]);
    await putXml("META-INF/manifest.xml", [`<?xml version="1.0"?><manifest:manifest xmlns:manifest="${ns.manifest}" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${odtMime}"/>`, mediaManifest, ...["content.xml", "styles.xml", "meta.xml"].map(name => `<manifest:file-entry manifest:full-path="${name}" manifest:media-type="text/xml"/>`), "</manifest:manifest>"]);
    const output = await archive.prepare();
    const diagnostics = context.snapshotDiagnostics();
    if (options.failIfWarnings && diagnostics.length) {const first=diagnostics[0]!; throw new PandocError("E_WARNINGS", "convert", `Warnings rejected: ${first.code}: ${first.message}`, first.format, first.location);}
    for await (const chunk of output) await context.emit(chunk);
  } catch (reason) {failure = {reason};}
  try {await storage.close();} catch (reason) {failure ??= {reason};} finally {release();}
  if (failure) throw failure.reason;
}
