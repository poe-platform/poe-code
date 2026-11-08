import {unicodeOrder} from "./python-unicode.js";
import {getLlmFragmentPrefix} from './fragment-loaders.js';
import {discoverLlmLoaders,LlmLoaderLookupError,LlmPluginExit,type LlmLoaderProvider} from './loader-provider.js';
import {formatLoaderDescription} from './loader-description.js';
import {commandArguments} from './command-arguments.js';
import { jsonValue } from "./json-value.js";
import { FsError, type CommandContext } from "safe-bash-contracts";
import { pathOf } from "safe-bash-contracts/path";
import { createLlmConfiguration } from "./configuration.js";
import { publishConfiguration } from "./configuration-publication.js";


export interface LlmTemplate {
  name: string;
  prompt?: string;
  system?: string;
  model?: string;
  defaults?: Record<string, string>;
  options?: Record<string, string>;
  attachments?: string[];
  attachment_types?: { type: string; value: string }[];
  extract?: boolean;
  extract_last?: boolean;
  schema_object?: Record<string, unknown>;
  fragments?: string[];
  system_fragments?: string[];
  tools?: string[];
  functions?: string;
}
const templateFields = ["name", "prompt", "system", "model", "defaults", "options", "attachments", "attachment_types", "extract", "extract_last", "schema_object", "fragments", "system_fragments", "tools", "functions"];
function template(value: unknown, name: string): LlmTemplate {
  if (typeof value === "string") return { name, prompt: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid template: ${name}`);
  const fields = { ...value, name } as Record<string, unknown>;
  for (const [key, item] of Object.entries(fields)) {
    if (!templateFields.includes(key)) throw new Error(`Unsupported template field: ${key}`);
    if (item === null) { delete fields[key]; continue; }
    if (["attachments", "fragments", "system_fragments", "tools"].includes(key)) {
      if (!Array.isArray(item) || item.some(value => typeof value !== "string")) throw new Error(`Invalid template: ${name}`);
    } else if (key === "attachment_types") {
      if (!Array.isArray(item) || item.some(value => !value || typeof value !== "object" || Array.isArray(value) || typeof value.type !== "string" || typeof value.value !== "string")) throw new Error(`Invalid template: ${name}`);
      fields[key] = item.map(({ type, value }: { type: string; value: string }) => ({ type, value }));
    } else if (["defaults", "options"].includes(key)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid template: ${name}`);
    } else if (key === "schema_object") {
      if (typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid template: ${name}`);
    } else if (["extract", "extract_last"].includes(key)) {
      if (typeof item !== "boolean") throw new Error(`Invalid template: ${name}`);
    } else if (typeof item !== "string") throw new Error(`Invalid template: ${name}`);
  }
  return { ...fields, name } as LlmTemplate;
}
function interpolate(text: string | undefined, params: Record<string, string>, validateOnly = false, admitText?: (text: string) => void): string | undefined {
  if (!text) return text;
  let result = "";
  const append = (value: string): void => { if (!validateOnly) { admitText?.(value); result += value; } };
  const missing: string[] = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "$") { const point = text.codePointAt(index)!; const literal = String.fromCodePoint(point); append(literal); if (point > 65535) index++; continue; }
    if (text[index + 1] === "$") { append("$"); index++; continue; }
    const start = index, braced = text[index + 1] === "{";
    if (braced) index++;
    let name = "";
    while (index + 1 < text.length && "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".includes(text[index + 1]!)) name += text[++index];
    if (!name || "0123456789".includes(name[0]!) || braced && text[index + 1] !== "}") throw new Error(`Invalid placeholder in template at position ${start}`);
    if (braced) index++;
    if (!Object.hasOwn(params, name)) missing.push(name);
    else if (!validateOnly) append(String(params[name]));
  }
  if (missing.length) throw new Error(`Missing variables: ${missing.join(", ")}`);
  return result;
}
export function validateLlmTemplateParameters(value: LlmTemplate, params: Record<string, string>): void {
  const variables = { ...value.defaults, ...params, input: "" };
  for (const text of [value.prompt, value.system]) interpolate(text, variables, true);
}
/** Reference Template.vars() includes named placeholders, excluding braced and escaped forms. */
export function llmTemplateUsesInput(value: LlmTemplate): boolean {
  for (const text of [value.prompt, value.system]) {
    if (!text) continue;
    for (let index = 0; index < text.length; index++) {
      if (text[index] !== "$") continue;
      if (text[index + 1] === "$") { index++; continue; }
      let name = "";
      while (index + 1 < text.length && "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".includes(text[index + 1]!)) name += text[++index];
      if (name === "input") return true;
    }
  }
  return false;
}
export function evaluateLlmTemplate(value: LlmTemplate, input: string, params: Record<string, string>, admitText?: (text: string) => void): { prompt: string; system?: string } {
  const variables = { ...value.defaults, ...params, input };
  if (!value.prompt) admitText?.(input);
  return { prompt: value.prompt ? interpolate(value.prompt, variables, false, admitText)! : input, ...(value.system === undefined ? {} : { system: interpolate(value.system, variables, false, admitText)! }) };
}
export type LlmTemplateLoaderContext = LlmTemplateStoreContext & { readonly maxBytes: number };
export type LlmTemplateLoader = ((remainder: string, signal: AbortSignal, context?: LlmTemplateLoaderContext) => Promise<LlmTemplate> | LlmTemplate) & { readonly description?: string };
export interface TemplateLoaderOptions {
  readonly provider?: LlmLoaderProvider|undefined;
  readonly maxRemoteBytes: number;
  readonly maxBytes?: number;
  readonly admitBytes?: (size: number) => void;
  readonly loaders?: ReadonlyMap<string, LlmTemplateLoader>|undefined;
}
import {waitForSource as abortLoader} from "./request-source.js";
export type LlmTemplateStoreContext = Pick<CommandContext, "fs" | "cwd" | "env" | "signal"> &
  Partial<Omit<CommandContext, "fs" | "cwd" | "env" | "signal">> & {
    readonly fetch?: typeof globalThis.fetch | undefined;
  };
export function createLlmTemplateStore(context: LlmTemplateStoreContext, loaders?: TemplateLoaderOptions) {
  const directory = `${createLlmConfiguration(context).directory}/templates`;
  const filename = (name: string): string => {
    if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") throw new Error(`Invalid template name: ${name}`);
    return `${directory}/${name}.yaml`;
  };
  const load = async (name: string): Promise<LlmTemplate> => {
    try {
      context.signal.throwIfAborted();
      if (name.startsWith("https://") || name.startsWith("http://")) {
        const fetch = context.fetch ?? context.capabilities?.fetch;
        if (!fetch) throw new Error("Template URL loading is not configured");
        if (!loaders || loaders.maxRemoteBytes !== Infinity && (!Number.isSafeInteger(loaders.maxRemoteBytes) || loaders.maxRemoteBytes < 1)) throw new Error("Template URL byte limit is not configured");
        const materializedLimit = loaders.maxBytes ?? Infinity;
        let response: Response | undefined, failed = false;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const abort = () => { void reader?.cancel().catch(() => {}); };
        try {
          response = await abortLoader(() => fetch(name, { signal: context.signal }), context.signal, async response => { await response.body?.cancel(); });
          if (!response.ok) {
            const kind = response.status < 500 ? "Client" : "Server";
            throw new Error(`${kind} error '${response.status} ${response.statusText}' for url '${name}'\nFor more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/${response.status}`);
          }
          reader = response.body?.getReader();
          context.signal.addEventListener("abort", abort, { once: true });
          context.signal.throwIfAborted();
          const decoder = new TextDecoder("utf-8", { fatal: true });
          const chunks: string[] = [];
          let total = 0;
          while (reader) {
            context.signal.throwIfAborted();
            const next = await abortLoader(() => reader!.read(), context.signal);
            context.signal.throwIfAborted();
            if (next.done) break;
            total += next.value.byteLength;
            if (total > loaders.maxRemoteBytes) throw new RangeError("Template URL exceeds byte limit");
            if (total > materializedLimit) throw new FsError("EFBIG", {message:"llm buffered input byte limit exceeded"});
            loaders.admitBytes?.(next.value.byteLength);
            chunks.push(decoder.decode(next.value, { stream: true }));
          }
          chunks.push(decoder.decode());
          const { parse } = await import("yaml");
          const value = template(parse(chunks.join("")), name);
          Object.defineProperty(value, "functionsTrusted", { value: false });
          return value;
        } catch (error) {
          failed = true;
          context.signal.throwIfAborted();
          throw new Error(`Could not load template ${name}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          context.signal.removeEventListener("abort", abort);
          if (reader) {
            const cancelled = reader.cancel();
            if (context.signal.aborted) { void cancelled.catch(() => undefined); reader.releaseLock(); }
            else try { await cancelled.catch(error => { if (!failed) throw error; }); } finally { reader.releaseLock(); }
          } else if (response?.body) {
            const cancelled = response.body.cancel();
            if (context.signal.aborted) void cancelled.catch(() => undefined);
            else await cancelled.catch(error => { if (!failed) throw error; });
          }
        }
      }
      const { parse } = await import("yaml");
      let path = pathOf(context, name);
      try { await context.fs.stat(path, { signal: context.signal }); }
      catch (error) {
        if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;
        const prefix = getLlmFragmentPrefix(name);
        if (prefix !== undefined) {
          const loader = loaders?.loaders?.get(prefix)??loaders?.provider?.templates(prefix);
          if (!loader) throw new Error(`Unknown template prefix: ${prefix}`);
          try {
            const materializedLimit = loaders?.maxBytes ?? Infinity;
            const loaded = await abortLoader(() => loader(name.slice(prefix.length + 1), context.signal, {...context, maxBytes: materializedLimit}), context.signal);
            context.signal.throwIfAborted();
            let loadedBytes = 0;
            if (loaders?.admitBytes || materializedLimit !== Infinity) for await (const bytes of jsonValue(loaded, context.signal)) {
              loadedBytes += bytes.byteLength;
              if (loadedBytes > materializedLimit) throw new FsError("EFBIG", {message:"llm buffered input byte limit exceeded"});
              loaders?.admitBytes?.(bytes.byteLength);
            }
            const value = template(loaded, loaded.name);
            Object.defineProperty(value, "functionsTrusted", { value: false });
            return value;
          } catch (error) {
            context.signal.throwIfAborted();
            if(error instanceof LlmLoaderLookupError||error instanceof LlmPluginExit)throw error;
            throw new Error(`Could not load template ${name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        path = filename(name);
      }
      const size = (await context.fs.stat(path, {signal:context.signal})).size;
      if (size > (loaders?.maxBytes ?? Infinity)) throw new FsError("EFBIG", {message:"llm buffered input byte limit exceeded"});
      const bytes = await context.fs.readFile(path, { signal: context.signal, ...(loaders?.maxBytes === undefined || loaders.maxBytes === Infinity ? {} : {maxBytes:loaders.maxBytes}) });
      loaders?.admitBytes?.(bytes.byteLength);
      return template(parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), name);
    } catch (error) {
      if (error instanceof FsError && error.code === "ENOENT") throw new Error(`Invalid template: ${name}`);
      throw error;
    }
  };
  const publish = async (name: string, bytes: Uint8Array): Promise<void> => {
    const path = filename(name);
    await context.fs.mkdir(directory, { recursive: true, signal: context.signal });
    const parent = await context.fs.stat(directory, { signal: context.signal });
    let expected;
    try { expected = await context.fs.lstat(path, { signal: context.signal }); }
    catch (error) { if (!(error instanceof FsError) || error.code !== "ENOENT") throw error; expected = null; }
    await publishConfiguration(context.fs, directory, path, bytes, parent, expected, context.signal);
  };
  return {
    directory, load,
    async save(name: string, value: Omit<LlmTemplate, "name">): Promise<void> {
      const { stringify } = await import("yaml");
      await publish(name, new TextEncoder().encode(stringify(value, { indent: 4, lineWidth: 0 })));
    },
    async command(args: readonly string[], output: (text: string) => Promise<void>, diagnostic: (text: string) => Promise<void>): Promise<number> {
      const parsed = await commandArguments("templates", args, ["list", "edit", "loaders", "path", "show"], output, diagnostic, async () => {context.signal.throwIfAborted();});
      if (typeof parsed === "number") return parsed;
      const {command, operands} = parsed;
      const name = operands[0];
      if (command === "loaders") {
        const registered=await discoverLlmLoaders(loaders?.loaders,{...context,kind:'templates',maxBytes:loaders?.maxBytes??Infinity,admitBytes:loaders?.admitBytes},loaders?.provider);
        if (!registered.size) await output("No template loaders found\n");
        else for (const [prefix, loader] of registered) {
          context.signal.throwIfAborted();
          await output(prefix + ":\n" + formatLoaderDescription(loader.description).join("\n") + "\n");
        }
        return 0;
      }
      if (command === "path") { await output(directory + "\n"); return 0; }
      if (command === "show" && name) {
        let value;
        try { value = await load(name); } catch { throw new Error(`Template '${name}' not found or invalid`); }
        const { templateYaml } = await import("./template-yaml.js");
        await output(templateYaml(value));
        return 0;
      }
      if (command === "edit") {
        if (!context.invoke) throw new Error("Template editor is not configured");
        const path = filename(name!);
        try { await context.fs.lstat(path, { signal: context.signal }); }
        catch (error) { if (!(error instanceof FsError) || error.code !== "ENOENT") throw error; await publish(name!, new TextEncoder().encode("prompt: ")); }
        const editor = context.env.VISUAL || context.env.EDITOR || "vi";
        const result = await context.invoke("sh", ["-c", editor + ' "$1"', "llm-template-editor", path], {
          signal: context.signal, cwd: context.cwd, env: context.env, replaceEnv: true, ...(context.stdin ? { stdin: context.stdin } : {}), ...(context.stdout ? { stdout: context.stdout } : {}), ...(context.stderr ? { stderr: context.stderr } : {}), externalInvocation: true,
        });
        context.signal.throwIfAborted();
        if (result.exitCode !== 0) throw new Error("Editing failed!");
        await load(name!);
        return 0;
      }
      let files;
      try { files = await context.fs.readdir(directory, { signal: context.signal }); }
      catch (error) { if (error instanceof FsError && error.code === "ENOENT") return 0; throw error; }
      const values: LlmTemplate[] = [];
      for (const file of files) {
        if (file.type !== "file" || !file.name.endsWith(".yaml")) continue;
        try { values.push(await load(file.name.slice(0, -5))); } catch { context.signal.throwIfAborted(); }
      }
      const width = Math.max(0, ...values.map(value => [...value.name].length));
      for (const value of values.sort((a, b) => unicodeOrder(a.name, b.name))) {
        const description = (value.system ? `system: ${value.system}${value.prompt ? ` prompt: ${value.prompt}` : ""}` : value.prompt ?? "").split("\n").join(" ");
        let suppliedColumns = NaN;
        const columnText = (context.env.COLUMNS ?? "").trim();
        const digits = columnText.startsWith("+") || columnText.startsWith("-") ? columnText.slice(1) : columnText;
        let valid = digits.length > 0;
        for (const digit of digits) if (!"0123456789".includes(digit)) { valid = false; break; }
        if (valid) suppliedColumns = Number(columnText);
        const columns = Number.isSafeInteger(suppliedColumns) && suppliedColumns > 0 ? suppliedColumns : 80;
        const text = `${value.name}${" ".repeat(width - [...value.name].length)} : ${description}`;
        const points = [...text];
        const truncated = points.length > columns ? points.slice(0, Math.max(0, columns - 3)).join("") + "..." : text;
        await output(truncated + "\n");
      }
      return 0;
    },
  };
}
