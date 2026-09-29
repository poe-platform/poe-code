import { FsError, type CommandContext } from "safe-bash-contracts";
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
}
const templateFields = ["name", "prompt", "system", "model", "defaults", "options", "attachments", "attachment_types"];
function template(value: unknown, name: string): LlmTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid template: ${name}`);
  const fields = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(fields)) {
    if (!templateFields.includes(key)) throw new Error(`Unsupported template field: ${key}`);
    if (key === "attachments") {
      if (!Array.isArray(item) || item.some(value => typeof value !== "string")) throw new Error(`Invalid template: ${name}`);
    } else if (key === "attachment_types") {
      if (!Array.isArray(item) || item.some(value => !value || typeof value !== "object" || Array.isArray(value) || typeof value.type !== "string" || typeof value.value !== "string")) throw new Error(`Invalid template: ${name}`);
      fields[key] = item.map(({ type, value }: { type: string; value: string }) => ({ type, value }));
    } else if (["defaults", "options"].includes(key)) {
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.values(item).some(value => typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) throw new Error(`Invalid template: ${name}`);
    } else if (typeof item !== "string") throw new Error(`Invalid template: ${name}`);
  }
  return { ...fields, name } as LlmTemplate;
}
function interpolate(text: string | undefined, params: Record<string, string>, validateOnly = false): string | undefined {
  if (!text) return text;
  let result = "";
  const missing: string[] = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "$") { if (!validateOnly) result += text[index]; continue; }
    if (text[index + 1] === "$") { if (!validateOnly) result += "$"; index++; continue; }
    const start = index, braced = text[index + 1] === "{";
    if (braced) index++;
    let name = "";
    while (index + 1 < text.length && "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".includes(text[index + 1]!)) name += text[++index];
    if (!name || "0123456789".includes(name[0]!) || braced && text[index + 1] !== "}") throw new Error(`Invalid placeholder in template at position ${start}`);
    if (braced) index++;
    if (!Object.hasOwn(params, name)) { if (!missing.includes(name)) missing.push(name); }
    else if (!validateOnly) result += String(params[name]);
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
export function evaluateLlmTemplate(value: LlmTemplate, input: string, params: Record<string, string>): { prompt: string; system?: string } {
  const variables = { ...value.defaults, ...params, input };
  return { prompt: value.prompt ? interpolate(value.prompt, variables)! : input, ...(value.system === undefined ? {} : { system: interpolate(value.system, variables)! }) };
}
export function createLlmTemplateStore(context: CommandContext) {
  const directory = `${createLlmConfiguration(context).directory}/templates`;
  const filename = (name: string): string => {
    if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") throw new Error(`Invalid template name: ${name}`);
    return `${directory}/${name}.yaml`;
  };
  const load = async (name: string): Promise<LlmTemplate> => {
    try {
      const { parse } = await import("yaml");
      const bytes = await context.fs.readFile(filename(name), { signal: context.signal });
      return template(parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), name);
    } catch (error) {
      if (error instanceof FsError && error.code === "ENOENT") throw new Error(`Invalid template: ${name}`);
      throw error;
    }
  };
  return {
    directory, load,
    async save(name: string, value: Omit<LlmTemplate, "name">): Promise<void> {
      const { stringify } = await import("yaml");
      const path = filename(name);
      await context.fs.mkdir(directory, { recursive: true, signal: context.signal });
      const parent = await context.fs.stat(directory, { signal: context.signal });
      let expected;
      try { expected = await context.fs.lstat(path, { signal: context.signal }); }
      catch (error) { if (!(error instanceof FsError) || error.code !== "ENOENT") throw error; expected = null; }
      const bytes = new TextEncoder().encode(stringify(value, { indent: 4, lineWidth: 0 }));
      await publishConfiguration(context.fs, directory, path, bytes, parent, expected, context.signal);
    },
    async command(args: readonly string[], output: (text: string) => Promise<void>): Promise<void> {
      const [command, name] = args;
      if (command === "path" && args.length === 1) { await output(directory + "\n"); return; }
      if (command === "show" && name && args.length === 2) {
        let value;
        try { value = await load(name); } catch { throw new Error(`Template '${name}' not found or invalid`); }
        const { stringify } = await import("yaml");
        const sorted = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
        await output(stringify(sorted, { indent: 4, lineWidth: 0 }) + "\n"); return;
      }
      if (command !== undefined && command !== "list" || args.length > 1) throw new Error("Invalid templates command");
      let files;
      try { files = await context.fs.readdir(directory, { signal: context.signal }); }
      catch (error) { if (error instanceof FsError && error.code === "ENOENT") return; throw error; }
      const values: LlmTemplate[] = [];
      for (const file of files) {
        if (file.type !== "file" || !file.name.endsWith(".yaml")) continue;
        try { values.push(await load(file.name.slice(0, -5))); } catch { context.signal.throwIfAborted(); }
      }
      const width = Math.max(0, ...values.map(value => [...value.name].length));
      for (const value of values.sort((a, b) => a.name.localeCompare(b.name))) {
        const description = (value.system ? `system: ${value.system}${value.prompt ? ` prompt: ${value.prompt}` : ""}` : value.prompt ?? "").split("\n").join(" ");
        await output(`${value.name}${" ".repeat(width - [...value.name].length)} : ${description}\n`);
      }
    },
  };
}
