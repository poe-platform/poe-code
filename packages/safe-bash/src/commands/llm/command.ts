import { createOutputOperation, getCommandArguments, readBytes, resolvePath, writeBytes, type CommandDefinition } from "../../contracts/index.js";
import { yieldTurn } from "../../contracts/yield.js";
import { attachmentMime } from "./mime.js";
import type { LlmCommandsOptions, LlmModel, LlmProvider, LlmRequest } from "./types.js";

const maxBytes = 64 * 1024 * 1024;

export function createCommand(options: LlmCommandsOptions): CommandDefinition {
  const models = new Map<string, { provider: LlmProvider; model: LlmModel }>();
  const declarations: { provider: LlmProvider; model: LlmModel }[] = [];
  for (const provider of options.providers) {
    if (!provider.name || typeof provider.complete !== "function") throw new TypeError("Invalid LLM provider");
    for (const source of provider.models) {
      const model: LlmModel = { ...source, ...(source.aliases ? { aliases: [...source.aliases] } : {}), ...(source.attachmentTypes ? { attachmentTypes: [...source.attachmentTypes] } : {}) };
      const entry = { provider, model };
      for (const name of [model.id, ...(model.aliases ?? [])]) {
        if (!name) throw new TypeError("Model names must be nonempty");
        if (models.has(name)) throw new Error(`Duplicate model: ${name}`);
        models.set(name, entry);
      }
      declarations.push(entry);
    }
  }
  return { name: "llm", description: "Query explicitly injected language and media models", async execute(context) {
    const output = createOutputOperation(context, context.stdout);
    const signal = output.signal;
    let iterator: AsyncIterator<string | Uint8Array> | undefined;
    let closed = false;
    let ended = false;
    output.registerCleanup(() => {
      if (closed) return;
      closed = true;
      if (!ended && iterator?.return) {
        const returned = Promise.resolve().then(() => iterator!.return!());
        void returned.catch(() => {});
      }
    });
    const wait = <Value>(pending: PromiseLike<Value>): Promise<Value> => new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      Promise.resolve(pending).then(value => {
        signal.removeEventListener("abort", abort); resolve(value);
      }, error => { signal.removeEventListener("abort", abort); reject(error); });
    });
    let inputBytes = 0;
    let argumentBytes = 0;
    let work = 0;
    const step = async () => {
      signal.throwIfAborted();
      if (closed) throw new Error("LLM invocation is closed");
      if (++work > 1_000_000) throw new Error("LLM work limit exceeded");
      if (work % 256 === 0) await yieldTurn(signal);
    };
    const admit = (bytes: number) => {
      context.inputBudget?.check(inputBytes + bytes);
      if (bytes > maxBytes - inputBytes) throw new Error("LLM input byte limit exceeded");
      inputBytes += bytes;
    };
    const emitText = async (text: string) => {
      for (let offset = 0; offset < text.length;) {
        await step();
        let end = Math.min(text.length, offset + 16_384);
        if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
        await output.output.write(new TextEncoder().encode(text.slice(offset, end)));
        offset = end;
      }
    };
    try {
      const args = getCommandArguments(context);
      const text = (index: number): string => {
        const bytes = args.bytes(index);
        if (!bytes) throw new Error("Missing option argument");
        if (bytes.length > maxBytes - argumentBytes) throw new Error("LLM argument byte limit exceeded");
        argumentBytes += bytes.length;
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      };
      const positional: string[] = [];
      const files: { path: string; mime?: string }[] = [];
      const settings: Record<string, string> = Object.create(null) as Record<string, string>;
      let modelName = options.defaultModel;
      let system: string | undefined;
      let operands = false;
      for (let index = 0; index < args.args.length; index++) {
        await step();
        const arg = text(index);
        if (!operands && arg === "--") { operands = true; continue; }
        if (!operands && ["-m", "--model"].includes(arg)) modelName = text(++index);
        else if (!operands && ["-s", "--system"].includes(arg)) system = text(++index);
        else if (!operands && ["-o", "--option"].includes(arg)) { const key = text(++index); settings[key] = text(++index); }
        else if (!operands && ["-a", "--attachment", "--at"].includes(arg)) {
          const path = text(++index);
          files.push(arg === "--at" ? { path, mime: text(++index) } : { path });
        } else if (!operands && arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        else positional.push(arg);
      }
      if (args.args[0] === "models" && positional.length === 1 && !files.length) {
        for (const { provider, model } of declarations) {
          await step();
          await emitText(`${provider.name}/${model.id}\taliases: ${(model.aliases ?? []).join(", ")}\tattachments: ${(model.attachmentTypes ?? []).join(", ")}\toutput: ${model.outputType ?? "text/plain"}\n`);
        }
        return { exitCode: 0 };
      }
      const selected = modelName === undefined ? undefined : models.get(modelName);
      if (!selected) throw new Error(`Unknown model: ${modelName ?? "(no default model)"}`);
      const chunks: Uint8Array[] = [];
      let stdinBytes = 0;
      for await (const bytes of readBytes(context.stdin, signal)) {
        await step(); admit(bytes.length); stdinBytes += bytes.length; chunks.push(new Uint8Array(bytes));
      }
      const stdin = new Uint8Array(stdinBytes);
      let offset = 0;
      for (const bytes of chunks) { stdin.set(bytes, offset); offset += bytes.length; }
      const content = new TextDecoder("utf-8", { fatal: true }).decode(stdin);
      const instruction = positional.join(" ");
      const attachments: LlmRequest["attachments"][number][] = [];
      for (const file of files) {
        await step();
        const path = resolvePath(context.cwd, file.path);
        const stat = await wait(context.fs.stat(path, { signal }));
        context.inputBudget?.check(inputBytes + stat.size);
        if (stat.size > maxBytes - inputBytes) throw new Error("LLM input byte limit exceeded");
        const bytes = await wait(context.fs.readFile(path, { signal, maxBytes: Math.min(maxBytes, context.inputBudget?.maxBytes ?? maxBytes) - inputBytes }));
        signal.throwIfAborted(); admit(bytes.length);
        const mimeType = file.mime ?? attachmentMime(bytes, file.path);
        if (!selected.model.attachmentTypes?.some(type => type === mimeType || (type.endsWith("/*") && mimeType.startsWith(type.slice(0, -1))))) throw new Error(`Model ${selected.model.id} does not accept ${mimeType}`);
        attachments.push({ mimeType, bytes: new Uint8Array(bytes) });
      }
      const request: LlmRequest = { model: selected.model.id, prompt: content && instruction ? `${content}\n\n${instruction}` : content || instruction, attachments, options: settings, signal, ...(system === undefined ? {} : { system }) };
      signal.throwIfAborted();
      iterator = selected.provider.complete(request)[Symbol.asyncIterator]();
      const binary = !(selected.model.outputType ?? "text/plain").startsWith("text/");
      while (true) {
        await step();
        const next = await wait(iterator.next());
        signal.throwIfAborted();
        if (next.done) { ended = true; break; }
        if (binary ? !(next.value instanceof Uint8Array) : typeof next.value !== "string") throw new Error("Invalid provider response: mixed text and binary chunks or wrong output type");
        if (typeof next.value === "string") await emitText(next.value);
        else await output.output.write(next.value);
      }
      if (!binary) await output.output.write(new Uint8Array([10]));
      return { exitCode: 0 };
    } catch (error) {
      context.signal.throwIfAborted();
      signal.throwIfAborted();
      await writeBytes(context.stderr, new TextEncoder().encode(`llm: ${error instanceof Error ? error.message.slice(0, 4096) : "Provider failed"}\n`), context.signal);
      return { exitCode: 1 };
    } finally { await output.close(); }
  } };
}
