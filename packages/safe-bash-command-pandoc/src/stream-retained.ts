import {prepareRetainedRtfResources} from "./retained-rtf-resources.js";
import {writeRetainedRtf} from "./retained-rtf.js";
import type {ResourceOrigin} from "./resources.js";
import {writeRetainedLatex} from "./retained-latex.js";
import {writeRetainedRst} from "./retained-rst.js";
import {writeRetainedMarkdown} from "./retained-markdown.js";
import {createFormatRegistry} from "./formats.js";
import {writeRetainedHtml} from "./retained-html.js";
import {transformRetainedJson} from "./retained-transforms.js";
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
export async function streamRetainedDocument(load: () => Promise<Awaited<ReturnType<typeof readRetainedJson>>>, context: ExecutionContext, working: WorkingStorageOptions, options: ConversionOptions, target: "json" | "plain" | "html5" | "commonmark" | "gfm" | "rst" | "latex" | "rtf" = "json", origin?: ResourceOrigin): Promise<void> {
  let document: Awaited<ReturnType<typeof readRetainedJson>> | undefined;
  let failure: {reason: unknown} | undefined;
  const preflight = async (chunks: AsyncIterable<Uint8Array>) => {
    if (!Number.isFinite(context.limits.outputBytes)) return;
    let length = 0;
    for await (const bytes of chunks) {length += bytes.length; context.bound("outputBytes", length);}
  };
  try {
    document = await load();
    for (const request of options.filters ?? []) {
      await checkImageOrigins(document.tree, context);
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
        await document.close();
        document = next;
      } catch (reason) {filterFailure = {reason};}
      try {await response.close();} catch (reason) {filterFailure ??= {reason};}
      finally {release();}
      if (filterFailure) throw filterFailure.reason;
    }
    if (["plain", "commonmark", "gfm", "rtf"].includes(target)) await assertRetainedPlainMath(document.tree, document.order, context);
    if (options.shiftHeadingLevelBy || options.stripComments) {
      const next = await transformRetainedJson(document.tree, context, working, options);
      await document.close();
      document = next;
    }
    if (target === "rtf") {
      const resources = await prepareRetainedRtfResources(document.tree, document.order, context, working, options, origin);
      let writerFailure: {reason: unknown} | undefined;
      try {await writeRetainedRtf(document.tree, context, working, options, document.order, resources.image);}
      catch (reason) {writerFailure = {reason};}
      try {await resources.close();} catch (reason) {writerFailure ??= {reason};}
      if (writerFailure) throw writerFailure.reason;
    }
    else if (target === "plain") await writeRetainedPlain(document.tree, context, working, options);
    else if (target === "latex") await writeRetainedLatex(document.tree, context, working, options, document.order);
    else if (target === "rst") await writeRetainedRst(document.tree, context, working, options);
    else if (target === "html5") await writeRetainedHtml(document.tree, context, working, options);
    else if (target === "commonmark" || target === "gfm") await writeRetainedMarkdown(document.tree, context, working, options, createFormatRegistry().resolve(options.to, "write"));
    else {
      await preflight(document.chunks(options.eol));
      for await (const bytes of document.chunks(options.eol)) await context.emit(bytes);
    }
  } catch (reason) {failure = {reason};}
  try {await document?.close();} catch (reason) {failure ??= {reason};}
  if (failure) throw failure.reason;
  await context.completeOutput();
}
