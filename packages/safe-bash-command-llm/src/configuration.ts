import { FsError, toByteSource, type CommandContext, type FileStat, type FileSystem } from "safe-bash-contracts";
import { pathOf } from "safe-bash-contracts/path";
import { publishConfiguration } from "./configuration-publication.js";

const locks = new WeakMap<FileSystem, Map<string, Promise<void>>>();
type Context = Pick<CommandContext, "fs" | "cwd" | "env" | "signal">;
type Options = Record<string, Record<string, string>>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function stringRecord(value: unknown): value is Record<string, string> {
  return record(value) && Object.values(value).every(item => typeof item === "string");
}

export interface LlmConfiguration {
  readonly directory: string;
  aliases(): Promise<Record<string, string>>;
  resolveAlias(name: string): Promise<string>;
  setAlias(name: string, model: string): Promise<void>;
  removeAlias(name: string): Promise<void>;
  defaultModel(filename?: string): Promise<string | undefined>;
  setDefaultModel(model: string | null, filename?: string): Promise<void>;
  allModelOptions(): Promise<Options>;
  modelOptions(model: string): Promise<Record<string, string>>;
  setModelOption(model: string, name: string, value: string): Promise<void>;
  clearModelOption(model: string, name?: string): Promise<void>;
  keys(): Promise<Record<string, string>>;
  getKey(name: string): Promise<string>;
  setKey(name: string, value: string): Promise<void>;
  resolveKey(keyOrAlias: string): Promise<string>;
}

export function createLlmConfiguration(context: Context, maxConfigurationBytes = Infinity, admission?: { readonly maxBytes?: number; readonly admitBytes?: (size: number) => void }): LlmConfiguration {
  if (maxConfigurationBytes !== Infinity && (!Number.isSafeInteger(maxConfigurationBytes) || maxConfigurationBytes < 0)) throw new TypeError("Invalid llm configuration byte limit");
  const { fs, signal } = context;
  const base = context.env.XDG_CONFIG_HOME ?? `${context.env.HOME ?? "/"}/.config`;
  const directory = pathOf(context, context.env.LLM_USER_PATH ?? `${base}/io.datasette.llm`);
  const filename = (name: string): string => `${directory}/${name}`;
  const defaultFilename = (name = "default_model.txt"): string => {
    if (!name.endsWith(".txt") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
      throw new TypeError("A model default filename must be a .txt basename");
    }
    return name;
  };
  const stat = async (path: string): Promise<FileStat | null> => {
    try {
      const result = await fs.lstat(path, { signal });
      if (result.type !== "file") throw new FsError("EINVAL", { path, message: "LLM configuration must be a regular file" });
      return result;
    } catch (error) {
      if (error instanceof FsError && error.code === "ENOENT") return null;
      throw error;
    }
  };
  const read = async (name: string): Promise<string | undefined> => {
    const path = filename(name);
    const stored = await stat(path);
    if (!stored) return undefined;
    const limit = Math.min(maxConfigurationBytes, admission?.maxBytes ?? Infinity);
    if (stored.size > limit) throw new FsError("EFBIG", {path,message:"LLM configuration byte limit exceeded"});
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, text = "";
    const source = fs.readStream?.(path, { signal, chunkSize: 16_384 }) ?? toByteSource(await fs.readFile(path, { signal, ...(limit === Infinity ? {} : { maxBytes: limit }) }));
    for await (const chunk of source) {
      signal.throwIfAborted();
      if (chunk.byteLength > limit - bytes) throw new FsError("EFBIG", { path, message: "LLM configuration byte limit exceeded" });
      admission?.admitBytes?.(chunk.byteLength);
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  };
  const write = async (name: string, text: string, observed?: FileStat | null): Promise<void> => {
    signal.throwIfAborted();
    if (!fs.publishFileConditional && !fs.writeFileConditional && !fs.createStagedFile) throw new FsError("ENOTSUP", { message: "LLM configuration requires atomic conditional publication" });
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > maxConfigurationBytes) throw new FsError("EFBIG", { message: "LLM configuration byte limit exceeded" });
    await fs.mkdir(directory, { recursive: true, signal });
    const parent = await fs.stat(directory, { signal });
    const path = filename(name), expected = observed === undefined ? await stat(path) : observed;
    await publishConfiguration(fs, directory, path, bytes, parent, expected, signal);
  };
  const serialized = async (operation: () => Promise<void>): Promise<void> => {
    let entries = locks.get(fs);
    if (!entries) { entries = new Map(); locks.set(fs, entries); }
    const previous = entries.get(directory) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => { signal.throwIfAborted(); return operation(); });
    entries.set(directory, current);
    try { await current; }
    finally { if (entries.get(directory) === current) entries.delete(directory); }
  };
  const json = async (name: string): Promise<unknown> => {
    const text = await read(name);
    return text === undefined ? {} : JSON.parse(text) as unknown;
  };
  const aliases = async (): Promise<Record<string, string>> => {
    const value = await json("aliases.json");
    if (!stringRecord(value)) throw new Error("Invalid aliases.json: expected string values");
    return value;
  };
  const options = async (): Promise<Options> => {
    const value = await json("model_options.json");
    if (!record(value) || !Object.values(value).every(stringRecord)) throw new Error("Invalid model_options.json: expected model option objects");
    return value as Options;
  };
  const keysDefault = { "// Note": "This file stores secret API credentials. Do not share!" };
  const readKeysObject = async (): Promise<{ exists: boolean; values: Record<string, string> }> => {
    const text = await read("keys.json");
    if (text === undefined) return { exists: false, values: {} };
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!stringRecord(parsed)) return { exists: true, values: { ...keysDefault } };
      return { exists: true, values: parsed };
    } catch {
      return { exists: true, values: { ...keysDefault } };
    }
  };
  const keys = async (): Promise<Record<string, string>> => {
    const { exists, values } = await readKeysObject();
    if (!exists) return {};
    const copy = { ...values };
    delete copy["// Note"];
    return copy;
  };
  const getKey = async (name: string): Promise<string> => {
    const { exists, values } = await readKeysObject();
    if (!exists) throw new Error("No keys found");
    if (!Object.hasOwn(values, name) || name === "// Note") throw new Error(`No key found with name '${name}'`);
    return values[name]!;
  };
  const setKey = (name: string, value: string): Promise<void> => serialized(async () => {
    const expected = await stat(filename("keys.json"));
    const { exists, values } = await readKeysObject();
    const current: Record<string, string> = exists ? { ...values } : { ...keysDefault };
    current[name] = value;
    await write("keys.json", JSON.stringify(current, null, 2) + "\n", expected);
  });
  const resolveKey = async (keyOrAlias: string): Promise<string> => {
    const { exists, values } = await readKeysObject();
    if (exists && Object.hasOwn(values, keyOrAlias) && keyOrAlias !== "// Note") return values[keyOrAlias]!;
    return keyOrAlias;
  };
  const resolveAlias = async (name: string): Promise<string> => {
    const values = await aliases(), seen = new Set<string>();
    while (Object.hasOwn(values, name)) {
      if (seen.has(name)) throw new Error(`Alias cycle: ${name}`);
      seen.add(name); name = values[name]!;
    }
    return name;
  };
  const setModelOption = (model: string, name: string, value: string): Promise<void> => serialized(async () => {
    const expected = await stat(filename("model_options.json"));
    const values = await options();
    const previous = Object.hasOwn(values, model) ? values[model]! : {};
    const next = { ...values, [model]: { ...previous, [name]: value } };
    await write("model_options.json", JSON.stringify(next, null, 2), expected);
  });
  return {
    directory, aliases, resolveAlias, allModelOptions: options, keys, getKey, setKey, resolveKey,
    setAlias: (name, model) => serialized(async () => {
      const expected = await stat(filename("aliases.json"));
      const values = await aliases();
      const canonical = await resolveAlias(model);
      await write("aliases.json", JSON.stringify({ ...values, [name]: canonical }, null, 4) + "\n", expected);
    }),
    removeAlias: name => serialized(async () => {
      const expected = await stat(filename("aliases.json"));
      const values = await aliases();
      if (!Object.hasOwn(values, name)) throw new Error(`No such alias: ${name}`);
      delete values[name];
      await write("aliases.json", JSON.stringify(values, null, 4) + "\n", expected);
    }),
    defaultModel: async name => (await read(defaultFilename(name)))?.trim(),
    setDefaultModel: (model, name) => serialized(async () => {
      const target = defaultFilename(name);
      if (model !== null) {
        await write(target, model);
        return;
      }
      const path = filename(target), expected = await stat(path);
      if (!expected) return;
      if (!fs.removeFileConditional) throw new FsError("ENOTSUP", {path,message:"Clearing LLM defaults requires atomic conditional removal"});
      const parent = await fs.stat(directory, {signal});
      await fs.removeFileConditional(path, {parent,expected,signal});
    }),
    modelOptions: async model => { const values = await options(); return Object.hasOwn(values, model) ? values[model]! : {}; },
    setModelOption,
    clearModelOption: (model, name) => serialized(async () => {
      const expected = await stat(filename("model_options.json"));
      const values = await options();
      if (!Object.hasOwn(values, model)) return;
      if (name === undefined) delete values[model];
      else {
        delete values[model]![name];
        if (!Object.keys(values[model]!).length) delete values[model];
      }
      await write("model_options.json", JSON.stringify(values, null, 2), expected);
    }),
  };
}
