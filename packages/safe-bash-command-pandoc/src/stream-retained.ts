import type {RetainedOptions} from "./retained-options.js";
import {mergeRetainedMetadata} from "./retained-metadata.js";
import {writeRetainedOdt} from "./retained-odt.js";
import {inspectRetainedRtfPicture} from "./retained-rtf-pictures.js";
import {prepareRetainedImageResources} from "./retained-image-resources.js";
import {writeRetainedRtf} from "./retained-rtf.js";
import type {ResourceOrigin} from "./resources.js";
import {writeRetainedLatex} from "./retained-latex.js";
import {writeRetainedRst} from "./retained-rst.js";
import {writeRetainedMarkdown} from "./retained-markdown.js";
import {createFormatRegistry} from "./formats.js";
import {writeRetainedHtml} from "./retained-html.js";
import {transformRetainedJson} from "./retained-transforms.js";
import {RetainedOrigins} from "./retained-origins.js";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {assertRetainedPlainMath, writeRetainedPlain} from "./retained-plain.js";
import {readRetainedJson} from "./retained-json.js";
import {PandocError} from "./errors.js";
import type {BackedJson} from "./backed-json.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";

/** Preserve the existing JSON filter origin policy. Native URL admission still
 * needs an individual URI value; this is an explicit remaining whole-value
 * boundary, separate from the retained document and protocol payloads. */
async function checkImageOrigins(tree: BackedJson, context: ExecutionContext): Promise<void> {
  const end = (await tree.describe(tree.rootPosition)).end;
  for (let position = tree.rootPosition; position < end;) {
    await context.cooperate();
    const header = await tree.describe(position);
    if (header.kind === "object") {
      const tag = await tree.property(position, "t");
      if (tag !== undefined && await tree.smallText(tag, 5) === "Image") {
        const content = (await tree.property(position, "c"))!;
        let index = 0;
        for await (const child of tree.children(content)) {
          if (index++ !== 2) continue;
          const target = child + 32;
          let url = "";
          for await (const part of tree.scalarChunks(target)) {context.charge("retainedBytes", part.length * 2); url += part;}
          if (!url.startsWith("/") && !URL.canParse(url))
            throw new PandocError("E_UNSUPPORTED_FEATURE", "convert", "JSON filters cannot preserve relative image source directories");
        }
      }
    }
    position = header.kind === "object" || header.kind === "array" ? position + 32 : header.end;
  }
}

/** Retain each document generation and filter response in caller storage. The
 * previous generation is retired before another filter starts. */
export async function streamRetainedDocument(load: () => Promise<Awaited<ReturnType<typeof readRetainedJson>> & {resourceCount?: number; closeResources?: () => Promise<void>}>, context: ExecutionContext, working: WorkingStorageOptions, options: ConversionOptions, target: "json" | "plain" | "html5" | "commonmark" | "gfm" | "rst" | "latex" | "rtf" | "odt" = "json", origin?: ResourceOrigin, includes?: RetainedOptions): Promise<void> {
  let closeResources: (() => Promise<void>) | undefined;
  let originStorage:PagedStorage | undefined, origins:RetainedOrigins | undefined;
  let releaseOrigins:(()=>void) | undefined;
  let document: Awaited<ReturnType<typeof readRetainedJson>> | undefined;
  let failure: {reason: unknown} | undefined;
  const preflight = async (chunks: AsyncIterable<Uint8Array>) => {
    if (!Number.isFinite(context.limits.outputBytes)) return;
    let length = 0;
    for await (const bytes of chunks) {length += bytes.length; context.bound("outputBytes", length);}
  };
  try {
    if((target==="rtf" || target==="odt") && (options.metadata !== undefined || options.filters?.some(request=>request.kind==="lua"))) {
      originStorage=new PagedStorage({fs:working.fs,cwd:working.directory,env:{},signal:context.signal??new AbortController().signal},(working.cacheBytes??1048576)/16384);
      const owned=originStorage;releaseOrigins=context.onClose(()=>owned.close());
      origins=new RetainedOrigins(originStorage,units=>context.cooperate(units));
    }
    const loaded = await load();
    const resourceCount = loaded.resourceCount ?? 0;
    closeResources = loaded.closeResources;
    document = loaded;
    for (const file of options.metadataFiles ?? []) {
      const next = await mergeRetainedMetadata(document, {source: file}, context, working);
      await document.close();
      document = next;
    }
    if (includes?.metadata) {
      const tree = includes.metadata.tree;
      for await (const root of tree.children(tree.rootPosition)) {
        const next = await mergeRetainedMetadata(document, {tree, root}, context, working);
        await document.close(); document = next;
      }
    }
    if (includes?.typedMetadata) {
      const tree = includes.typedMetadata.tree;
      const next = await mergeRetainedMetadata(document, {tree, root: tree.rootPosition, typed: true}, context, working);
      await origins?.transfer(document.tree, next.tree, tree);
      await document.close(); document = next;
    }
    for (const request of options.filters ?? []) {
      if (request.kind === "json") await checkImageOrigins(document.tree, context);
      await preflight(document.chunks());
      const signal = context.signal ?? new AbortController().signal;
      const response = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal}, (working.cacheBytes ?? 1024 * 1024) / 16384);
      const release = context.onClose(() => response.close());
      const start = response.allocate(0);
      let length = 0, filterFailure: {reason: unknown} | undefined;
      try {
        await context.call(() => context.context.filters!.applyJsonStream!({
          stdin: document!.chunks(), signal,
          stdout: {async write(bytes) {
            context.charge("inputBytes", bytes.length);
            await response.append(bytes);
            length += bytes.length;
          }}
        }, {...request}, Object.assign(context, {to: options.to})));
        const next = await readRetainedJson({chunks: (async function* () {
          for (let offset = 0; offset < length; offset += 16384) yield await response.read(start + offset, Math.min(16384, length - offset));
        })()}, context, working, false);
        if(origins){if(request.kind==="lua")await origins.transfer(document.tree,next.tree);else origins.clear();}
        await document.close();
        document = next;
      } catch (reason) {filterFailure = {reason};}
      try {await response.close();} catch (reason) {filterFailure ??= {reason};}
      finally {release();}
      if (filterFailure) throw filterFailure.reason;
    }
    if (["plain", "commonmark", "gfm", "rtf", "odt"].includes(target)) await assertRetainedPlainMath(document.tree, document.order, context);
    if (options.shiftHeadingLevelBy || options.stripComments) {
      const next = await transformRetainedJson(document.tree, context, working, options, origins?.copy());
      await document.close();
      document = next;
    }
    if (target === "rtf" || target === "odt") {
      const resources = await prepareRetainedImageResources(document.tree, document.order, context, working, options, origins ? async node=>await origins!.inherited(node)?origin??{}:{} : options.filters?.length ? undefined : origin);
      let writerFailure: {reason: unknown} | undefined;
      try {if (target === "odt") await writeRetainedOdt(document.tree, context, working, options, resources);
      else await writeRetainedRtf(document.tree, context, working, options, document.order, async node => {
        const image = await resources.image(node);
        return {...await inspectRetainedRtfPicture(image.source, image.storage, context), chunks: image.chunks};
      }, resources.assertReferenced);}
      catch (reason) {writerFailure = {reason};}
      try {await resources.close();} catch (reason) {writerFailure ??= {reason};}
      if (writerFailure) throw writerFailure.reason;
    }
    else if (target === "plain") await writeRetainedPlain(document.tree, context, working, options);
    else if (target === "latex") await writeRetainedLatex(document.tree, context, working, options, document.order);
    else if (target === "rst") await writeRetainedRst(document.tree, context, working, options);
    else if (target === "html5") await writeRetainedHtml(document.tree, context, working, includes ? {...options, standalone: includes.standalone} : options, includes);
    else if (target === "commonmark" || target === "gfm") await writeRetainedMarkdown(document.tree, context, working, options, createFormatRegistry().resolve(options.to, "write"));
    else {
      if (resourceCount) throw new PandocError("E_UNSUPPORTED_FEATURE", "write", "Pandoc JSON cannot represent resources, language or direction document fields", "json", "$");
      await preflight(document.chunks(options.eol));
      for await (const bytes of document.chunks(options.eol)) await context.emit(bytes);
    }
  } catch (reason) {failure = {reason};}
  try {await document?.close();} catch (reason) {failure ??= {reason};}
  try {await closeResources?.();} catch (reason) {failure ??= {reason};}
  try {await originStorage?.close();} catch (reason) {failure ??= {reason};} finally{releaseOrigins?.();}
  try {await includes?.close();} catch (reason) {failure ??= {reason};}
  if (failure) throw failure.reason;
  await context.completeOutput();
}
