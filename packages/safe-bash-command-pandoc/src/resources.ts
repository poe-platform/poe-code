import { PandocError } from "./errors.js";
import type { Document, ResourceFileSystem, WriteOptions } from "./types.js";
import type { ExecutionContext } from "./execution.js";

export interface ResourceOrigin { readonly base?: string; readonly source?: string }
// Weak parser sidecars survive the SDK read/write seam without retaining documents
// or sharing acquired bytes, media bags, permissions or budgets across invocations.
const targetOrigins = new WeakMap<object, ResourceOrigin>();
const missing = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

/** VFS path spelling, deliberately independent of URI decoding. */
export function resourceDirectory(path: string, cwd = "/"): string {
  if (!path || path.includes("\\") || path.includes(":") || path.includes("\0") || path.startsWith("~"))
    throw new PandocError("E_OPTION", "convert", "Invalid resource directory");
  const parts = (path.startsWith("/") ? path : `${cwd}/${path}`).split("/");
  if (parts.includes("..")) throw new PandocError("E_OPTION", "convert", "Resource directories cannot traverse parents");
  return "/" + parts.filter(p => p && p !== ".").join("/");
}

function localTarget(url: string, context: ExecutionContext): {name: string; suffix: string} {
  const split = [url.indexOf("?"), url.indexOf("#")].filter(n => n >= 0);
  const end = split.length ? Math.min(...split) : url.length;
  const raw = url.slice(0, end);
  if (!raw || raw.startsWith("/") || raw.startsWith("~") || raw.includes(":") || raw.includes("\\"))
    context.fail("E_CAPABILITY", "Only relative local image resources are supported");
  const parts: string[] = [];
  for (const component of raw.split("/")) {
    context.checkpoint();
    let decoded: string;
    try {decoded = decodeURIComponent(component);} catch {return context.fail("E_CAPABILITY", "Invalid image URI escape");}
    if (decoded.includes("/") || decoded.includes("\\") || decoded.includes(":") || [...decoded].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127))
      context.fail("E_CAPABILITY", "Invalid image resource component");
    if (!decoded || decoded === ".") continue;
    if (decoded === "..") {if (!parts.length) context.fail("E_CAPABILITY", "Image resource escapes its search directory"); parts.pop();}
    else parts.push(decoded);
  }
  if (!parts.length || parts[0]!.startsWith("~")) context.fail("E_CAPABILITY", "Invalid image resource name");
  return {name: parts.join("/"), suffix: url.slice(end)};
}

function mediaKeyBasename(key: string, context: ExecutionContext): string {
  // Media keys are literal names, not percent-encoded URIs.
  if (!key || key.startsWith("/") || key.startsWith("~") || key.includes("\\") || key.includes(":") || key.split("/").some(p => !p || p === "." || p === "..") || [...key].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) context.fail("E_CAPABILITY", "Unsafe embedded resource key");
  return key.split("/").at(-1)!;
}

async function inspect(fs: ResourceFileSystem, path: string, context: ExecutionContext): Promise<string | undefined> {
  let current = "";
  let type: string | undefined;
  const parts = path.split("/").filter(Boolean);
  for (let i = 0; i <= parts.length; i++) {
    current = i === 0 ? "/" : (current === "/" ? "" : current) + "/" + parts[i - 1]!;
    context.checkpoint();
    type = (await context.call(async () => {
      try {return await fs.lstat(current, context.signal ? {signal: context.signal} : {});}
      catch (error) {if (missing(error)) return undefined; throw error;}
    }))?.type;
    if (type === undefined) return undefined;
    if (type === "symlink") context.fail("E_CAPABILITY", "Symlink image and extraction paths are unsupported");
    if (i < parts.length && type !== "directory") context.fail("E_IO", "Resource ancestor is not a directory");
  }
  return type;
}

/** Invocation-local media bag. URI spellings map to VFS keys; extracted names
 * are allocated separately and percent encoded only when written back as URLs. */
export class ResourceSession {
  readonly origins = targetOrigins;
  private readonly bag = new Map<string, {path: string; bytes: Uint8Array}>();
  private readonly names = new Set<string>();
  private readonly plans: {path: string; bytes: Uint8Array}[] = [];
  private destination: string | undefined;
  private search: readonly string[] | undefined;
  constructor(private readonly context: ExecutionContext) {}

  private allocate(basename: string, bytes: Uint8Array): {path: string; bytes: Uint8Array} {
    if (!basename || basename === "." || basename === "..") this.context.fail("E_CAPABILITY", "Invalid extraction basename");
    let name = basename;
    const dot = basename.lastIndexOf(".");
    for (let n = 2; this.names.has(name); n++) {
      this.context.checkpoint();
      name = dot > 0 ? `${basename.slice(0, dot)}-${n}${basename.slice(dot)}` : `${basename}-${n}`;
    }
    this.names.add(name);
    const entry = {path: this.destination === undefined ? name : `${this.destination === "/" ? "" : this.destination}/${name}`, bytes};
    this.context.charge("references", 1);
    this.context.charge("retainedBytes", entry.path.length * 2 + 64);
    this.plans.push(entry);
    return entry;
  }

  configure(options: WriteOptions): void {
    const cwd = resourceDirectory(this.context.context.resourceCwd ?? "/");
    if (options.resourcePath !== undefined) {
      if (!Array.isArray(options.resourcePath) || !options.resourcePath.length || options.resourcePath.some(p => typeof p !== "string")) this.context.fail("E_OPTION", "resourcePath requires directories");
      this.search = options.resourcePath.map(p => resourceDirectory(p, cwd));
    }
    if (options.extractMedia !== undefined) {
      if (typeof options.extractMedia !== "string") this.context.fail("E_OPTION", "extractMedia requires a directory");
      this.destination = resourceDirectory(options.extractMedia, cwd);
      if (!this.context.context.resourceFiles) this.context.fail("E_CAPABILITY", "Media extraction requires a configured VFS");
    }
  }

  async prepare(document: Document, lossy: boolean, embedImages = false): Promise<Document> {
    if (this.destination === undefined && (!embedImages || !this.context.context.resourceFiles || this.context.resources)) return document;
    const fs = this.context.context.resourceFiles!;
    const ctx = this.context;
    const embedded = new Map<string, Uint8Array>();
    const imageResources = new Map<string, Uint8Array>();
    const embeddedEntries = new Map<string, {path: string; bytes: Uint8Array}>();
    for (const resource of document.resources) {
      if (this.destination !== undefined) mediaKeyBasename(resource.id, ctx);
      const previous = embedded.get(resource.id);
      if (previous) {
        if (embedImages) ctx.fail("E_RESOURCE", "Duplicate embedded resource id");
        if (previous.length !== resource.bytes.length) ctx.fail("E_RESOURCE", "Conflicting embedded resource keys");
        for (let i = 0; i < previous.length; i++) {
          ctx.checkpoint();
          if (previous[i] !== resource.bytes[i]) ctx.fail("E_RESOURCE", "Conflicting embedded resource keys");
        }
      } else embedded.set(resource.id, resource.bytes);
    }
    const validate = async (value: unknown): Promise<void> => {
      await ctx.cooperate();
      if (!value || typeof value !== "object" || value instanceof Uint8Array) return;
      if ("t" in value && value.t === "Image") {
        const image = value as Extract<import("./ast-types.js").Inline, {t: "Image" | "Link"}>;
        const url = image.c[2][0];
        if (this.destination === undefined && embedImages && /^data:image\/(?:png|jpe?g);base64,/i.test(url) && !embedded.has(url)) {
          const comma = url.indexOf(",");
          const raw = atob(url.slice(comma + 1)); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          ctx.charge("resources", 1);
          ctx.charge("resourceBytes", bytes.length);
          ctx.charge("retainedBytes", bytes.length);
          embedded.set(url, bytes);
        }
        if (!embedded.has(url)) {
          localTarget(url, ctx);
          if (!this.search) resourceDirectory(this.origins.get(image.c[2])?.base ?? ctx.context.resourceCwd ?? "/");
        }
      }
      for (const child of Object.values(value)) await validate(child);
    };
    await validate(document.blocks);
    await validate(document.metadata);
    if (this.destination !== undefined) {
      const destinationType = await inspect(fs, this.destination, ctx);
      if (destinationType !== undefined && destinationType !== "directory") ctx.fail("E_IO", "Extraction destination is not a directory");
    }
    for (const [key, bytes] of embedded) {
      const entry = this.allocate(this.destination === undefined ? "resource" : mediaKeyBasename(key, ctx), bytes);
      embeddedEntries.set(key, entry);
      if (embedImages) {
        const id = entry.path.split("/").map(encodeURIComponent).join("/");
        ctx.charge("references", 1);
        ctx.charge("retainedBytes", id.length * 2 + 64);
        imageResources.set(id, bytes);
      }
    }
    const visit = async (value: unknown, path: string): Promise<unknown> => {
      await ctx.cooperate();
      if (value === null || typeof value !== "object" || value instanceof Uint8Array) return value;
      if ("t" in value && value.t === "Image") {
        const image = value as Extract<import("./ast-types.js").Inline, {t: "Image" | "Link"}>;
        const [url, title] = image.c[2];
        const origin = this.origins.get(image.c[2]) ?? {};
        const location = origin.source ? `${origin.source}:${path}` : path;
        const embeddedBytes = embedded.get(url);
        const target = embeddedBytes ? {name: url, suffix: ""} : localTarget(url, ctx);
        const defaultRoots = [resourceDirectory(origin.base ?? ctx.context.resourceCwd ?? "/")];
        if (origin.base && ctx.context.resourceCwd) {
          const cwdRoot = resourceDirectory(ctx.context.resourceCwd);
          if (!defaultRoots.includes(cwdRoot)) defaultRoots.push(cwdRoot);
        }
        const roots = embeddedBytes ? [] : this.search ?? defaultRoots;
        let entry = embeddedEntries.get(url);
        for (const root of entry ? [] : roots) {
          const key = `${root === "/" ? "" : root}/${target.name}`;
          entry = this.bag.get(key);
          if (entry) break;
          const type = await inspect(fs, key, ctx);
          if (type === undefined) continue;
          if (type !== "file") ctx.fail("E_CAPABILITY", "Image resource is not a regular file");
          ctx.charge("resources", 1);
          const chunks: Uint8Array[] = [];
          let length = 0;
          const readOptions = ctx.signal ? {signal: ctx.signal} : {};
          const producer = fs.readStream ? await ctx.call(async () => fs.readStream!(key, readOptions)) : (async function* () {
            if (!fs.readFile) ctx.fail("E_CAPABILITY", "VFS requires explicit resource reads");
            let bytes: Uint8Array;
            const maxBytes = ctx.remaining("resourceBytes");
            try {bytes = await fs.readFile!(key, {...readOptions, ...(maxBytes === Infinity ? {} : {maxBytes})});}
            catch (error) {
              if (typeof error === "object" && error !== null && "code" in error && error.code === "EFBIG") ctx.fail("E_LIMIT", "resourceBytes: VFS bounded read refused");
              throw error;
            }
            yield bytes;
          })();
          await ctx.consume(producer, async bytes => {ctx.charge("references", 1); chunks.push(bytes); length += bytes.length;}, ["resourceBytes"]);
          ctx.charge("retainedBytes", length);
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length; await ctx.cooperate();}
          entry = this.allocate(target.name.split("/").at(-1)!, bytes);
          this.bag.set(key, entry);
          break;
        }
        if (!entry) {
          if (!lossy) throw new PandocError("E_RESOURCE", ctx.operation, `Missing image resource: ${url}`, undefined, location);
          ctx.report({code: "W_RESOURCE_MISSING", operation: ctx.operation, message: `Missing image resource: ${url}`, location});
          return image;
        }
        const outputUrl = entry.path.split("/").map(encodeURIComponent).join("/") + target.suffix;
        if (embedImages && !imageResources.has(outputUrl)) {
          ctx.charge("references", 1);
          ctx.charge("retainedBytes", outputUrl.length * 2 + 64);
          imageResources.set(outputUrl, entry.bytes);
        }
        return {...image, c: [image.c[0], await visit(image.c[1], `${path}.c[1]`), [outputUrl, title]]};
      }
      if (Array.isArray(value)) {const result = []; for (let i = 0; i < value.length; i++) result.push(await visit(value[i], `${path}[${i}]`)); return result;}
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) result[key] = await visit(child, `${path}.${key}`);
      return result;
    };
    const prepared = {...document, blocks: await visit(document.blocks, "$.blocks"), metadata: await visit(document.metadata, "$.metadata")} as Document;
    if (this.destination !== undefined) for (const entry of this.plans) if (await inspect(fs, entry.path, ctx) !== undefined) ctx.fail("E_IO", `Extraction destination already exists: ${entry.path}`);
    return embedImages ? {...prepared, resources: [...imageResources].map(([id, bytes]) => ({id, bytes}))} : prepared;
  }

  async publish(): Promise<void> {
    if (this.destination === undefined || !this.plans.length) return;
    const ctx = this.context;
    const fs = ctx.context.resourceFiles!;
    const options = ctx.signal ? {signal: ctx.signal} : {};
    await ctx.call(() => fs.mkdir(this.destination!, {...options, recursive: true}));
    for (const entry of this.plans) {
      // Recheck after preflight and request exclusive creation. Ancestor authority
      // remains with the provider; this is not a filesystem transaction.
      if (await inspect(fs, entry.path, ctx) !== undefined) ctx.fail("E_IO", "Extraction destination changed after preflight");
      await ctx.call(() => fs.writeFile(entry.path, entry.bytes, {...options, flag: "wx"}));
    }
  }
}
