import { FsError, toByteSource, type CommandContext, type FileStat, type FileSystem } from "safe-bash-contracts";
import { pathOf } from "safe-bash-contracts/path";
import { publishConfiguration } from "./configuration-publication.js";

/** Configuration is bounded control state; prompts and attachments use separate accounting. */
const maxConfigurationBytes = 1024 * 1024;
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
  defaultModel(): Promise<string | undefined>;
  setDefaultModel(model: string): Promise<void>;
  allModelOptions(): Promise<Options>;
  modelOptions(model: string): Promise<Record<string, string>>;
  setModelOption(model: string, name: string, value: string): Promise<void>;
  clearModelOption(model: string, name: string): Promise<void>;
}

export function createLlmConfiguration(context: Context): LlmConfiguration {
  const { fs, signal } = context;
  const base = context.env.XDG_CONFIG_HOME ?? `${context.env.HOME ?? "/"}/.config`;
  const directory = pathOf(context, context.env.LLM_USER_PATH ?? `${base}/io.datasette.llm`);
  const filename = (name: string): string => `${directory}/${name}`;
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
    if (!await stat(path)) return undefined;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, text = "";
    const source = fs.readStream?.(path, { signal, chunkSize: 16_384 }) ?? toByteSource(await fs.readFile(path, { signal, maxBytes: maxConfigurationBytes }));
    for await (const chunk of source) {
      signal.throwIfAborted();
      if (chunk.byteLength > maxConfigurationBytes - bytes) throw new FsError("EFBIG", { path, message: "LLM configuration byte limit exceeded" });
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
    directory, aliases, resolveAlias, allModelOptions: options,
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
    defaultModel: () => read("default_model.txt"),
    setDefaultModel: model => serialized(() => write("default_model.txt", model)),
    modelOptions: async model => { const values = await options(); return Object.hasOwn(values, model) ? values[model]! : {}; },
    setModelOption,
    clearModelOption: (model, name) => serialized(async () => {
      const expected = await stat(filename("model_options.json"));
      const values = await options();
      if (Object.hasOwn(values, model)) {
        delete values[model]![name];
        if (!Object.keys(values[model]!).length) delete values[model];
      }
      await write("model_options.json", JSON.stringify(values, null, 2), expected);
    }),
  };
}
