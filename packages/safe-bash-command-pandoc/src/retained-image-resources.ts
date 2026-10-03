import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedJson} from "./backed-json.js";
import type {backedJsonOrder} from "./backed-json-order.js";
import {BackedText} from "./backed-text.js";
import {BackedTextSet} from "./backed-text-set.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";
import {inspectResourcePath, localResourceTarget, resourceDirectory, type ResourceOrigin} from "./resources.js";
import {PandocError} from "./errors.js";
type Span = {position: number; length: number};

/** Retain image identity and admitted bytes independently of format validation. */
export async function prepareRetainedImageResources(tree: BackedJson, order: Awaited<ReturnType<typeof backedJsonOrder>>, context: ExecutionContext,
  working: WorkingStorageOptions, options: ConversionOptions, origin: ResourceOrigin = {}) {
  const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, (working.cacheBytes ?? 1048576) / 16384);
  const release = context.onClose(() => storage.close()), text = new BackedText(storage, units => context.cooperate(units));
  const identities = new BackedTextSet(storage, text);
  const targets = new BackedTextSet(storage, text), paths = new BackedTextSet(storage, text), targetSpans = new IntegerTable(storage, 64), pathSpans = new IntegerTable(storage, 64);
  const fs = context.context.resourceFiles, readOptions = context.signal ? {signal: context.signal} : {};
  let search: string[] | undefined;
  if (options.resourcePath !== undefined) {
    if (!Array.isArray(options.resourcePath) || !options.resourcePath.length || options.resourcePath.some(path => typeof path !== "string"))
      context.fail("E_OPTION", "resourcePath requires directories");
    search = options.resourcePath.map(path => resourceDirectory(path, resourceDirectory(context.context.resourceCwd ?? "/")));
  }
  const scalar = async (node: number): Promise<string> => {
    let value = ""; for await (const chunk of tree.scalarChunks(node)) value += chunk; return value;
  };
  const at = async (node: number, index: number): Promise<number> => {
    let child = node + 32; for (let i = 0; i < index; i++) child = (await tree.describe(child)).end; return child;
  };
  const save = async (span: Span): Promise<number> => {
    const bytes = new Uint8Array(16), view = new DataView(bytes.buffer); view.setFloat64(0, span.position, true); view.setFloat64(8, span.length, true); return storage.append(bytes);
  };
  const load = async (position: number): Promise<Span> => {
    const bytes = await storage.read(position, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return {position: view.getFloat64(0, true), length: view.getFloat64(8, true)};
  };
  const location = async (node: number): Promise<string> => {
    let path = "";
    while (node !== tree.rootPosition) {
      const header = await tree.describe(node), parent = header.parent, ph = await tree.describe(parent);
      if (ph.kind === "array") {
        let i = 0, sibling = parent + 32;
        while (sibling !== node) {sibling = (await tree.describe(sibling)).end; i++; await context.cooperate();}
        path = "[" + i + "]" + path;
      } else {
        let key = parent + 32;
        while ((await tree.describe(key)).end !== node) {key = (await tree.describe((await tree.describe(key)).end)).end; await context.cooperate();}
        let name = await scalar(key); if (parent === tree.rootPosition && name === "meta") name = "metadata";
        path = "." + name + path;
      }
      node = parent;
    }
    return (origin.source ? origin.source + ":" : "") + "$" + path;
  };
  const images = async function* () {
    for (const rootKey of ["blocks", "meta"]) {
      const root = (await tree.property(tree.rootPosition, rootKey))!; let node = root;
      while (node) {
        await context.cooperate();
        const header = await tree.describe(node);
        if (header.kind === "object") {
          const tag = await tree.property(node, "t");
          if (tag !== undefined && await tree.smallText(tag, 5) === "Image") {
            const content = (await tree.property(node, "c"))!, target = await at(content, 2);
            yield {node, target: target + 32};
          }
        }
        if (header.children && header.kind === "array") {node += 32; continue;}
        if (header.children && header.kind === "object") {node = (await tree.describe(await order.first(node))).end; continue;}
        while (node !== root) {
          const current = await tree.describe(node), parent = await tree.describe(current.parent);
          if (parent.kind === "object") {
            const key = await order.next(node, current.parent);
            if (key) {node = (await tree.describe(key)).end; break;}
          } else if (current.end < parent.end) {node = current.end; break;}
          node = current.parent;
        }
        if (node === root) node = 0;
      }
    }
  };
  const dataPrefix = (url: string): number => {
    const comma = url.indexOf(",");
    return comma >= 0 && ["data:image/png;base64", "data:image/jpg;base64", "data:image/jpeg;base64"].includes(url.slice(0, comma).toLowerCase()) ? comma + 1 : 0;
  };
  const data = async (node: number, start: number): Promise<Span> => {
    const position = storage.allocate(0); let length = 0, skip = start, group = "", ended = false, buffer = new Uint8Array(4096), used = 0;
    for await (const chunk of tree.scalarChunks(node)) for (const char of chunk) {
      if (skip) {skip--; continue;}
      if ("\t\n\f\r ".includes(char)) continue;
      if (ended) context.fail("E_RESOURCE", "Invalid base64 image resource");
      group += char;
      if (group.length === 4) {
        let bytes: string; try {bytes = atob(group);} catch {context.fail("E_RESOURCE", "Invalid base64 image resource");} ended = group.includes("="); group = "";
        for (const byte of bytes) {
          buffer[used++] = byte.charCodeAt(0);
          if (used === buffer.length) {await storage.append(buffer); length += used; buffer = new Uint8Array(4096); used = 0; await context.cooperate();}
        }
      }
    }
    if (group) {let bytes: string; try {bytes = atob(group);} catch {context.fail("E_RESOURCE", "Invalid base64 image resource");} for (const byte of bytes) {buffer[used++] = byte.charCodeAt(0); if (used === buffer.length) {await storage.append(buffer); length += used; buffer = new Uint8Array(4096); used = 0;}}}
    if (used) {await storage.append(buffer.subarray(0, used)); length += used;}
    context.charge("resources", 1); context.charge("resourceBytes", length, false); return {position, length};
  };
  const acquire = async (producer: Iterable<Uint8Array> | AsyncIterable<Uint8Array>): Promise<Span> => {
    const position = storage.allocate(0); let length = 0;
    await context.consume(producer, async bytes => {await storage.append(bytes); length += bytes.length;}, ["resourceBytes"]);
    return {position, length};
  };
  try {
    if (fs && !context.resources) {
      // Validate all target spellings before opening any file, matching embedding admission.
      for await (const image of images()) {
        const key = BigInt(await targets.add(await text.from(tree.scalarChunks(image.target))));
        let prefix = ""; for await (const chunk of tree.scalarChunks(image.target)) {prefix = chunk.slice(0, 32); break;}
        const start = dataPrefix(prefix);
        if (start) {
          if (!await targetSpans.get(key)) await targetSpans.set(key, BigInt(await save(await data(image.target, start))));
        } else {
          localResourceTarget(await scalar(image.target), context);
          if (!search) resourceDirectory(origin.base ?? context.context.resourceCwd ?? "/");
        }
      }
      for await (const image of images()) {
        const id = BigInt(await targets.add(await text.from(tree.scalarChunks(image.target))));
        if (await targetSpans.get(id)) continue;
        const url = await scalar(image.target), target = localResourceTarget(url, context);
        const roots = [resourceDirectory(origin.base ?? context.context.resourceCwd ?? "/")];
        if (origin.base && context.context.resourceCwd) {const cwd = resourceDirectory(context.context.resourceCwd); if (!roots.includes(cwd)) roots.push(cwd);}
        let record = 0;
        for (const root of search ?? roots) {
          const path = (root === "/" ? "" : root) + "/" + target.name, key = BigInt(await paths.add(await text.from([path])));
          record = Number(await pathSpans.get(key) ?? 0n); if (record) break;
          const type = await inspectResourcePath(fs, path, context); if (type === undefined) continue;
          if (type !== "file") context.fail("E_CAPABILITY", "Image resource is not a regular file");
          context.charge("resources", 1);
          const producer = fs.readStream ? await context.call(async () => fs.readStream!(path, readOptions)) : (async function* () {
            if (!fs.readFile) context.fail("E_CAPABILITY", "VFS requires explicit resource reads");
            const maxBytes = context.remaining("resourceBytes");
            try {yield await fs.readFile!(path, {...readOptions, ...(maxBytes === Infinity ? {} : {maxBytes})});}
            catch (error) {if (typeof error === "object" && error !== null && "code" in error && error.code === "EFBIG") context.fail("E_LIMIT", "resourceBytes: VFS bounded read refused"); throw error;}
          })();
          record = await save(await acquire(producer)); await pathSpans.set(key, BigInt(record)); break;
        }
        if (!record) {
          const at = await location(image.node);
          if (!options.lossy) throw new PandocError("E_RESOURCE", "convert", "Missing image resource: " + url, undefined, at);
          context.report({code: "W_RESOURCE_MISSING", operation: "convert", message: "Missing image resource: " + url, location: at});
        } else await targetSpans.set(id, BigInt(record));
      }
    }
  } catch (error) {
    try {await storage.close();} catch { /* Preserve admission failure. */ } finally {release();}
    throw error;
  }
  return {
    async image(node: number) {
      let span: Span;
      const key = BigInt(await targets.add(await text.from(tree.scalarChunks(node))));
      const cached = options.to === "odt" ? Number(await targetSpans.get(key) ?? 0n) : 0;
      if (context.resources && cached) span = await load(cached);
      else if (context.resources) {
        const bytes = await context.resources.resolve(await scalar(node), undefined, context.signal);
        if (!(bytes instanceof Uint8Array)) throw new PandocError("E_RESOURCE", "convert", "Invalid resource bytes", options.to);
        context.charge("resources", 1); span = await acquire([bytes]);
        if (options.to === "odt") await targetSpans.set(key, BigInt(await save(span)));
      } else {
        const record = Number(await targetSpans.get(key) ?? 0n);
        if (!record) throw new PandocError("E_RESOURCE", "convert", (options.to === "odt" ? "Missing image resource: " : "Missing explicit picture resource: ") + await scalar(node), options.to);
        span = await load(record);
      }
      const source = {size: span.length, read: (position: number, length: number) => storage.read(span.position + position, length)};
      let identity = Number(key);
      if (options.to === "odt" && !context.resources) {
        let prefix = ""; for await (const chunk of tree.scalarChunks(node)) {prefix = chunk.slice(0,32); break;}
        const suffix = dataPrefix(prefix) ? "" : localResourceTarget(await scalar(node), context).suffix;
        identity = await identities.add(await text.from([String(span.position) + ":", suffix]));
      }
      return {source, storage, identity, chunks: (async function* () {for (let offset = 0; offset < span.length; offset += 16384) yield await source.read(offset, Math.min(16384, span.length - offset));})()};
    },
    async close() {try {await storage.close();} finally {release();}}
  };
}
