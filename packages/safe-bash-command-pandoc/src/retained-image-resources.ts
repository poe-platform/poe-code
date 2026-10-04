import {retainedLocalResourceTarget, retainedResourceSuffix} from "./retained-resource-target.js";
import type {readRetainedRtfDocument} from "./retained-rtf-document.js";
import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedJson} from "./backed-json.js";
import type {backedJsonOrder} from "./backed-json-order.js";
import {BackedText} from "./backed-text.js";
import {BackedTextSet} from "./backed-text-set.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";
import {inspectResourcePath, resourceDirectory, type ResourceOrigin} from "./resources.js";
import {PandocError} from "./errors.js";
type Span = {position: number; length: number};

/** Retain image identity and admitted bytes independently of format validation. */
export async function prepareRetainedImageResources(tree: BackedJson, order: Awaited<ReturnType<typeof backedJsonOrder>>, context: ExecutionContext,
  working: WorkingStorageOptions, options: ConversionOptions, origin: ResourceOrigin | ((node:number)=>Promise<ResourceOrigin>) = {}, embedded?: Pick<Awaited<ReturnType<typeof readRetainedRtfDocument>>["resources"], "count" | "maxIdLength" | "get">) {
  const storage = new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, (working.cacheBytes ?? 1048576) / 16384);
  const release = context.onClose(() => storage.close()), text = new BackedText(storage, units => context.cooperate(units));
  const identities = new BackedTextSet(storage, text);
  const allocatedNames = new BackedTextSet(storage, text), encodedNameLengths = new IntegerTable(storage, 64);
  const allocateName = async (base: string): Promise<string> => {
    let name = base; const dot = base.lastIndexOf(".");
    for (let index = 2; await allocatedNames.has(await text.from([name])); index++) {
      name = dot > 0 ? base.slice(0, dot) + "-" + index + base.slice(dot) : base + "-" + index;
      await context.cooperate();
    }
    await allocatedNames.add(await text.from([name])); return name;
  };
  const targets = new BackedTextSet(storage, text), paths = new BackedTextSet(storage, text), targetSpans = new IntegerTable(storage, 64), pathSpans = new IntegerTable(storage, 64);
  const admittedReferences = new IntegerTable(storage, 64), publishedReferences = new IntegerTable(storage, 64);
  const inputSpans = new IntegerTable(storage, 64), inputIdentities = new IntegerTable(storage, 64), resourceSpans = new IntegerTable(storage, 64);
  const originAt=(node:number)=>typeof origin==="function"?origin(node):Promise.resolve(origin);
  const targetKey=async(node:number):Promise<bigint>=>{
    let embedded=false;
    for await(const chunk of tree.scalarChunks(node)){embedded=dataPrefix(chunk.slice(0,32))!==0;break;}
    const base=context.resources || embedded?undefined:(await originAt(node)).base;
    return BigInt(await targets.add(await text.from((async function*(){
      yield base===undefined?"-:":String(base.length)+":"+base;
      yield* tree.scalarChunks(node);
    })())));
  };
  const fs = context.context.resourceFiles, readOptions = context.signal ? {signal: context.signal} : {};
  let search: number | undefined, searchCount = 0;
  const searchRoots = async function* (defaults: readonly string[]) {
    if (search === undefined) {yield* defaults; return;}
    for (let index = 0; index < searchCount; index++) {
      const position = search + index * 24;
      const bytes = await storage.read(position, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      let path = "";
      for await (const chunk of text.chunks({first: view.getFloat64(0, true), last: view.getFloat64(8, true), units: view.getFloat64(16, true)})) path += chunk;
      yield path;
    }
  };
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
  const location = async (node: number, origin:ResourceOrigin): Promise<string> => {
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
            yield {node, target: target + 32, metadata: rootKey === "meta"};
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
  const resourceIdentity = async (node: number, span: Span): Promise<number> => {
    let prefix = ""; for await (const chunk of tree.scalarChunks(node)) {prefix = chunk.slice(0, 32); break;}
    const embedded = dataPrefix(prefix);
    if (!embedded) await retainedLocalResourceTarget(tree, node, context);
    return identities.add(await text.from((async function* () {
      yield String(span.position) + ":";
      if (!embedded) yield* retainedResourceSuffix(tree, node);
    })()));
  };
  const dataPrefix = (url: string): number => {
    const comma = url.indexOf(",");
    return comma >= 0 && ["data:image/png;base64", "data:image/jpg;base64", "data:image/jpeg;base64"].includes(url.slice(0, comma).toLowerCase()) ? comma + 1 : 0;
  };
  const admitEmbedded = async (): Promise<number> => {
    context.charge("references", 1);
    const name = Number.isFinite(context.limits.retainedBytes) ? await allocateName("resource") : "";
    if (Number.isFinite(context.limits.retainedBytes)) context.charge("retainedBytes", name.length * 2 + 64);
    context.charge("references", 1);
    if (Number.isFinite(context.limits.retainedBytes)) context.charge("retainedBytes", name.length * 2 + 64);
    return name.length;
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
    context.charge("resources", 1); context.charge("resourceBytes", length, false);
    if (Number.isFinite(context.limits.retainedBytes)) context.charge("retainedBytes", length);
    return {position, length};
  };
  const acquire = async (produce: () => Iterable<Uint8Array> | AsyncIterable<Uint8Array>, chargeBytes = true, chargeReferences = false, retain = true): Promise<Span> => {
    const position = storage.allocate(0); let length = 0;
    await context.consume(produce(), async bytes => {if (chargeReferences) context.charge("references", 1); await storage.append(bytes); length += bytes.length;}, chargeBytes ? ["resourceBytes"] : [], retain);
    return {position, length};
  };
  try {
    if (options.resourcePath !== undefined) {
      if (!Array.isArray(options.resourcePath) || !options.resourcePath.length || options.resourcePath.some(path => typeof path !== "string"))
        context.fail("E_OPTION", "resourcePath requires directories");
      const cwd = resourceDirectory(context.context.resourceCwd ?? "/");
      searchCount = options.resourcePath.length;
      search = storage.allocate(searchCount * 24);
      for (let index = 0; index < searchCount; index++) {
        const range = await text.from([resourceDirectory(options.resourcePath[index]!, cwd)]);
        const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
        view.setFloat64(0, range.first, true); view.setFloat64(8, range.last, true); view.setFloat64(16, range.units, true);
        await storage.write(search + index * 24, bytes);
      }
    }
    if (embedded) for await (const image of images()) {
      const name = await tree.smallText(image.target, embedded.maxIdLength);
      if (name === undefined) continue;
      const supplied = await embedded.get(name);
      if (supplied) {
        const key = await targetKey(image.target);
        const identity = BigInt(supplied.identity);
        let record = await resourceSpans.get(identity);
        if (!record) {
          // Reader normalization already charged these owned resource bytes.
          record = BigInt(await save(await acquire(() => supplied.chunks(), false, false, false)));
          await resourceSpans.set(identity, record);
        }
        await inputSpans.set(key, record); await inputIdentities.set(key, identity);
      }
    }
    if (fs && !context.resources) {
      // Validate all target spellings before opening any file, matching embedding admission.
      for await (const image of images()) {
        const key = await targetKey(image.target);
        if (await inputSpans.get(key)) continue;
        let prefix = ""; for await (const chunk of tree.scalarChunks(image.target)) {prefix = chunk.slice(0, 32); break;}
        const start = dataPrefix(prefix);
        if (start) {
          if (!await targetSpans.get(key)) await targetSpans.set(key, BigInt(await save(await data(image.target, start))));
        } else {
          await retainedLocalResourceTarget(tree, image.target, context);
          if (search === undefined) resourceDirectory((await originAt(image.target)).base ?? context.context.resourceCwd ?? "/");
        }
      }
      // Reader-owned resources remain admitted even when a filter removes their images.
      if (Number.isFinite(context.limits.references) || Number.isFinite(context.limits.retainedBytes)) {
        for (let index = 0; index < (embedded?.count ?? 0); index++) {
          const units = await admitEmbedded(), record = await resourceSpans.get(BigInt(index + 1));
          if (record) await encodedNameLengths.set(record, BigInt(units));
          await context.cooperate();
        }
        for await (const image of images()) {
          const key = await targetKey(image.target);
          if (await inputSpans.get(key)) continue;
          const record = await targetSpans.get(key);
          if (record && !await admittedReferences.get(record)) {
            await encodedNameLengths.set(record, BigInt(await admitEmbedded()));
            await admittedReferences.set(record, 1n);
          }
        }
      }
      for await (const image of images()) {
        const id = await targetKey(image.target);
        if (await inputSpans.get(id) || await targetSpans.get(id)) continue;
        const target = await retainedLocalResourceTarget(tree, image.target, context), origin=await originAt(image.target);
        const roots = [resourceDirectory(origin.base ?? context.context.resourceCwd ?? "/")];
        if (origin.base && context.context.resourceCwd) {const cwd = resourceDirectory(context.context.resourceCwd); if (!roots.includes(cwd)) roots.push(cwd);}
        let record = 0;
        for await (const root of searchRoots(roots)) {
          const path = (root === "/" ? "" : root) + "/" + target.name, key = BigInt(await paths.add(await text.from([path])));
          record = Number(await pathSpans.get(key) ?? 0n); if (record) break;
          const type = await inspectResourcePath(fs, path, context); if (type === undefined) continue;
          if (type !== "file") context.fail("E_CAPABILITY", "Image resource is not a regular file");
          context.charge("resources", 1);
          const span = await context.call(async () => {
            // Enroll the returned source before a post-call cancellation check.
            const produce = () => fs.readStream ? fs.readStream(path, readOptions) : (async function* () {
              if (!fs.readFile) context.fail("E_CAPABILITY", "VFS requires explicit resource reads");
              const maxBytes = context.remaining("resourceBytes");
              try {yield await fs.readFile!(path, {...readOptions, ...(maxBytes === Infinity ? {} : {maxBytes})});}
              catch (error) {if (typeof error === "object" && error !== null && "code" in error && error.code === "EFBIG") context.fail("E_LIMIT", "resourceBytes: VFS bounded read refused"); throw error;}
            })();
            return await acquire(produce, true, true);
          });
          if (Number.isFinite(context.limits.retainedBytes)) context.charge("retainedBytes", span.length);
          record = await save(span); context.charge("references", 1);
          if (Number.isFinite(context.limits.retainedBytes)) {
            const name = await allocateName(target.name.slice(target.name.lastIndexOf("/") + 1));
            context.charge("retainedBytes", name.length * 2 + 64);
            await encodedNameLengths.set(BigInt(record), BigInt(encodeURIComponent(name).length));
          }
          await pathSpans.set(key, BigInt(record)); break;
        }
        if (!record) {
          const at = await location(image.node,origin), url = await scalar(image.target);
          if (!options.lossy) throw new PandocError("E_RESOURCE", "convert", "Missing image resource: " + url, undefined, at);
          context.report({code: "W_RESOURCE_MISSING", operation: "convert", message: "Missing image resource: " + url, location: at});
        } else {
          await targetSpans.set(id, BigInt(record));
          if (Number.isFinite(context.limits.references) || Number.isFinite(context.limits.retainedBytes)) {
            const identity = BigInt(await resourceIdentity(image.target, await load(record)));
            if (!await publishedReferences.get(identity)) {
              context.charge("references", 1);
              if (Number.isFinite(context.limits.retainedBytes)) context.charge("retainedBytes", (Number(await encodedNameLengths.get(BigInt(record))) + target.suffixUnits) * 2 + 64);
              await publishedReferences.set(identity, 1n);
            }
          }
        }
      }
    }
  } catch (error) {
    try {await storage.close();} catch { /* Preserve admission failure. */ } finally {release();}
    throw error;
  }
  return {
    async assertReferenced() {
      if (embedded?.count) {
        const used = new IntegerTable(storage, 64); let count = 0;
        for await (const image of images()) {
          const identity = await inputIdentities.get(await targetKey(image.target));
          if (identity === undefined) continue;
          if (!image.metadata && !await used.get(identity)) {await used.set(identity, 1n); count++;}
        }
        if (count !== embedded.count) throw new PandocError("E_RESOURCE", "convert", "Unreferenced RTF resource; embedded fonts/objects unsupported", "rtf");
      }
      if (!fs || context.resources) return;
      const used = new IntegerTable(storage, 64);
      for await (const image of images()) {
        const record = Number(await targetSpans.get(await targetKey(image.target)) ?? 0n);
        if (!record) continue;
        const identity = BigInt(await resourceIdentity(image.target, await load(record)));
        if (!image.metadata) await used.set(identity, 1n);
        else if (!await used.get(identity)) throw new PandocError("E_RESOURCE", "convert", "Unreferenced RTF resource; embedded fonts/objects unsupported", "rtf");
      }
    },
    async html(node: number): Promise<AsyncIterable<Uint8Array> | undefined> {
      const key = await targetKey(node);
      const record = Number(await inputSpans.get(key) ?? (!context.resources ? await targetSpans.get(key) : undefined) ?? 0n);
      if (!record) return undefined;
      const span = await load(record);
      if (Number.isFinite(context.limits.retainedBytes)) {
        const mapped = await encodedNameLengths.get(BigInt(record));
        let units = Number(mapped ?? 0n);
        if (mapped === undefined) for await (const chunk of tree.scalarChunks(node)) units += chunk.length;
        else if (!await inputSpans.get(key)) {
          let prefix = ""; for await (const chunk of tree.scalarChunks(node)) {prefix = chunk.slice(0, 32); break;}
          if (!dataPrefix(prefix)) {
            await retainedLocalResourceTarget(tree, node, context);
            for await (const chunk of retainedResourceSuffix(tree, node)) for (const char of chunk)
              units += " \"<>`".includes(char) ? encodeURIComponent(char).length : char.length;
          }
        }
        context.charge("retainedBytes", units * 2);
      }
      return (async function* () {
        for (let offset = 0; offset < span.length; offset += 16384) {
          await context.cooperate(); yield await storage.read(span.position + offset, Math.min(16384, span.length - offset));
        }
      })();
    },
    async image(node: number) {
      let span: Span;
      const key = await targetKey(node);
      const cached = options.to === "odt" ? Number(await targetSpans.get(key) ?? 0n) : 0;
      const supplied = Number(await inputSpans.get(key) ?? 0n);
      if (supplied) span = await load(supplied);
      else if (context.resources && cached) span = await load(cached);
      else if (context.resources) {
        if (context.context.resources?.resolveSource || context.context.resources?.resolveStream) {
          const id = {length: ((await tree.describe(node)).end - node - 32) / 2, chunks: () => tree.scalarChunks(node)};
          const position = storage.allocate(0);
          const length = await context.consumeResource(id, undefined, async bytes => {await storage.append(bytes);});
          // Match byte-resolver admission followed by writer-owned admission.
          if (options.to !== "odt") {context.charge("resources", 1); context.charge("resourceBytes", length);}
          span = {position, length};
        } else {
          const bytes = await context.resources.resolve(await scalar(node), undefined, context.signal);
          if (!(bytes instanceof Uint8Array)) throw new PandocError("E_RESOURCE", "convert", "Invalid resource bytes", options.to);
          // ODT charges its image bytes in the writer; resolver admission is already charged.
          if (options.to !== "odt") context.charge("resources", 1);
          span = await acquire(() => [bytes], options.to !== "odt", false, false);
        }
        if (options.to === "odt") await targetSpans.set(key, BigInt(await save(span)));
      } else {
        const record = Number(await targetSpans.get(key) ?? 0n);
        if (!record) throw new PandocError("E_RESOURCE", "convert", (options.to === "odt" ? "Missing image resource: " : "Missing explicit picture resource: ") + await scalar(node), options.to);
        span = await load(record);
      }
      const source = {size: span.length, read: (position: number, length: number) => storage.read(span.position + position, length)};
      let identity = Number(key);
      if (options.to === "odt" && !context.resources) {
        identity = await resourceIdentity(node, span);
      }
      return {source, storage, identity, chunks: (async function* () {for (let offset = 0; offset < span.length; offset += 16384) yield await source.read(offset, Math.min(16384, span.length - offset));})()};
    },
    async close() {try {await storage.close();} finally {release();}}
  };
}
