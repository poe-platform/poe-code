import { createOutputOperation, getCommandArguments, FsError, type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { inheritYieldCheckpoint, yieldTurn } from "../../contracts/yield.js";
import { writeDiagnostic } from "../../escaping.js";
import { pathOf } from "../internal.js";
import { acceptsMimeType, sniffMimeType } from "./mime.js";
import type { LlmCommandsOptions, LlmModel, LlmProvider, LlmRequest } from "./types.js";

const maxBytes = 64 * 1024 * 1024;

interface ModelEntry { provider: LlmProvider; model: LlmModel }
interface Arguments {
  model?: string;
  system?: string;
  prompt: string;
  options: Record<string, string>;
  attachments: { path: string; mimeType?: string }[];
}

async function parse(length: number, text: (index: number) => string, step: () => Promise<void>): Promise<Arguments> {
  const parsed: Arguments = { prompt: "", options: Object.create(null) as Record<string, string>, attachments: [] };
  const operands: string[] = [];
  let ended = false;
  for (let index = 0; index < length; index++) {
    await step();
    const argument = text(index);
    if (ended || !argument.startsWith("-") || argument === "-") { operands.push(argument); continue; }
    if (argument === "--") { ended = true; continue; }
    const equals = argument.indexOf("=");
    const long = argument.startsWith("--");
    const flag = long ? argument.slice(0, equals < 0 ? undefined : equals) : argument.slice(0, 2);
    const attached = long ? equals < 0 ? undefined : argument.slice(equals + 1) : argument.length > 2 ? argument.slice(2) : undefined;
    const take = (): string => {
      if (++index >= length) throw new Error(`Option ${flag} requires an argument`);
      return text(index);
    };
    if (!["-m", "--model", "-s", "--system", "-o", "--option", "-a", "--attachment", "--at"].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = attached ?? take();
    if (flag === "-m" || flag === "--model") parsed.model = value;
    else if (flag === "-s" || flag === "--system") parsed.system = value;
    else if (flag === "-o" || flag === "--option") parsed.options[value] = take();
    else if (flag === "--at") parsed.attachments.push({ path: value, mimeType: take() });
    else parsed.attachments.push({ path: value });
  }
  parsed.prompt = operands.join(" ");
  return parsed;
}

function modelsFor(providers: readonly LlmProvider[]): { models: ModelEntry[]; lookup: Map<string, ModelEntry> } {
  const models: ModelEntry[] = [], lookup = new Map<string, ModelEntry>();
  for (const provider of providers) {
    if (!provider.name || typeof provider.complete !== "function") throw new TypeError("Providers require a name and complete function");
    for (const declared of provider.models) {
      if (!declared.id) throw new TypeError("Models require a nonempty id");
      const model: LlmModel = Object.freeze({ ...declared,
        ...(declared.aliases ? { aliases: Object.freeze([...declared.aliases]) } : {}),
        ...(declared.attachmentTypes ? { attachmentTypes: Object.freeze([...declared.attachmentTypes]) } : {}),
      });
      const entry = { provider, model };
      for (const name of new Set([model.id, `${provider.name}/${model.id}`, ...model.aliases ?? []])) {
        if (!name) throw new TypeError("Model aliases must not be empty");
        if (lookup.has(name)) throw new Error(`Duplicate model id or alias: ${name}`);
        lookup.set(name, entry);
      }
      models.push(entry);
    }
  }
  return { models, lookup };
}

async function interrupted<Value>(start: () => Value | PromiseLike<Value>, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted();
  return new Promise<Value>((resolve, reject) => {
    const aborted = (): void => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return start(); }).then(
      value => { signal.removeEventListener("abort", aborted); resolve(value); },
      error => { signal.removeEventListener("abort", aborted); reject(error); },
    );
  });
}

async function execute(context: CommandContext, lookup: ReadonlyMap<string, ModelEntry>, models: readonly ModelEntry[], defaultModel: string | undefined) {
  context.signal.throwIfAborted();
  const controller = new AbortController();
  const operation = createOutputOperation(context, context.stdout);
  const signal = AbortSignal.any([operation.signal, controller.signal]);
  inheritYieldCheckpoint(context.signal, signal);
  let iterator: AsyncIterator<string | Uint8Array> | undefined;
  let closed = false;
  let ended = false;
  operation.registerCleanup(() => {
    if (closed) return;
    closed = true;
    controller.abort(new Error("llm request closed"));
    if (!ended && iterator) {
      const resource = iterator;
      void Promise.resolve().then(() => resource.return?.()).catch(() => {});
    }
  });
  let work = 0;
  const step = async (): Promise<void> => {
    signal.throwIfAborted();
    if (closed) throw new Error("LLM invocation is closed");
    if (++work > 1_000_000) throw new Error("LLM work limit exceeded");
    if (work % 256 === 0) await yieldTurn(signal);
  };
  let writing = false;
  const write = async (chunk: Uint8Array): Promise<void> => {
    writing = true;
    await operation.output.write(chunk);
    writing = false;
  };
  const emitText = async (text: string): Promise<void> => {
    for (let offset = 0; offset < text.length;) {
      await step();
      let end = Math.min(text.length, offset + 16_384);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      await write(new TextEncoder().encode(text.slice(offset, end)));
      offset = end;
    }
  };
  let inputBytes = 0;
  let argumentBytes = 0;
  const inputLimit = Math.min(maxBytes, context.inputBudget?.maxBytes ?? maxBytes);
  const checkInput = (size: number): void => {
    context.inputBudget?.check(inputBytes + size);
    if (size > inputLimit - inputBytes) throw new FsError("EFBIG", { message: "llm input byte limit exceeded" });
  };
  const admitInput = (size: number): void => {
    checkInput(size);
    inputBytes += size;
  };
  try {
    const argumentsValue = getCommandArguments(context);
    const argumentText = (index: number): string => {
      const bytes = argumentsValue.bytes(index);
      if (!bytes) throw new Error("Missing option argument");
      if (bytes.byteLength > maxBytes - argumentBytes) throw new Error("LLM argument byte limit exceeded");
      argumentBytes += bytes.byteLength;
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    };
    if (argumentsValue.args.length === 1 && ["--help", "-h"].includes(argumentsValue.args[0]!)) {
      argumentText(0);
      await emitText("Usage: llm [prompt] [-m MODEL] [-s SYSTEM] [-o KEY VALUE] [-a PATH] [--at PATH MIMETYPE]\n       llm models\nOptions: --model, --system, --option, --attachment; -- ends options\n");
      return { exitCode: 0 };
    }
    const args = await parse(argumentsValue.args.length, argumentText, step);
    if (argumentsValue.args[0] === "models" && args.prompt === "models" && !args.attachments.length) {
      for (const { provider, model } of models) {
        await step();
        await emitText(`${provider.name}/${model.id}	aliases: ${model.aliases?.join(", ") || "-"}	attachments: ${model.attachmentTypes?.join(", ") || "-"}	output: ${model.outputType ?? "text/plain"}\n`);
      }
      return { exitCode: 0 };
    }
    const selected = args.model ?? defaultModel;
    if (selected === undefined) throw new Error("No model selected; use --model or configure defaultModel");
    const entry = lookup.get(selected);
    if (!entry) throw new Error(`Unknown model: ${selected}`);
    const fragments: string[] = [];
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const input = await operation.acquire<AsyncIterator<Uint8Array>>(() => context.stdinInput
      ? { next: () => context.stdinInput!.read(Math.min(65536, inputLimit - inputBytes + 1), signal) }
      : context.stdin[Symbol.asyncIterator](), async iterator => { await iterator.return?.(); });
    while (true) {
      await step();
      const result = await interrupted(() => input.next(), signal);
      signal.throwIfAborted();
      if (result.done) break;
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) throw new TypeError("Byte sources must yield Uint8Array chunks");
      admitInput(chunk.byteLength);
      fragments.push(decoder.decode(chunk, { stream: true }));
    }
    fragments.push(decoder.decode());
    const content = fragments.join("");
    const attachments: { mimeType: string; bytes: Uint8Array }[] = [];
    for (const attachment of args.attachments) {
      await step();
      if (attachment.path.includes("://")) throw new Error("URL attachments are not supported");
      const path = pathOf(context, attachment.path);
      const stat = await interrupted(() => context.fs.stat(path, { signal }), signal);
      checkInput(stat.size);
      const bytes = await interrupted(() => context.fs.readFile(path, { signal, maxBytes: inputLimit - inputBytes }), signal);
      signal.throwIfAborted();
      if (!(bytes instanceof Uint8Array)) throw new TypeError("Attachment read must return Uint8Array");
      admitInput(bytes.byteLength);
      const mimeType = attachment.mimeType ?? sniffMimeType(path, bytes);
      if (!acceptsMimeType(entry.model.attachmentTypes ?? [], mimeType)) throw new Error(`Model ${entry.model.id} does not accept ${mimeType}`);
      attachments.push({ mimeType, bytes: new Uint8Array(bytes) });
    }
    const request: LlmRequest = {
      model: entry.model.id, prompt: content && args.prompt ? `${content}\n\n${args.prompt}` : content || args.prompt,
      ...(args.system === undefined ? {} : { system: args.system }), attachments, options: args.options, signal,
    };
    signal.throwIfAborted();
    iterator = entry.provider.complete(request)[Symbol.asyncIterator]();
    const text = (entry.model.outputType ?? "text/plain").toLowerCase().startsWith("text/");
    let pendingSurrogate = "";
    while (true) {
      await step();
      const result = await interrupted(() => iterator!.next(), signal);
      signal.throwIfAborted();
      if (result.done) { ended = true; break; }
      if (text ? typeof result.value !== "string" : !(result.value instanceof Uint8Array)) throw new Error(`Provider ${entry.provider.name} returned a response chunk incompatible with ${entry.model.outputType ?? "text/plain"}`);
      if (typeof result.value === "string") {
        let chunk = pendingSurrogate + result.value;
        const last = chunk.charCodeAt(chunk.length - 1);
        pendingSurrogate = last >= 0xd800 && last <= 0xdbff ? chunk.slice(-1) : "";
        if (pendingSurrogate) chunk = chunk.slice(0, -1);
        if (chunk) await emitText(chunk);
      } else await write(result.value);
    }
    if (text) {
      if (pendingSurrogate) await emitText(pendingSurrogate);
      await write(Uint8Array.of(10));
    }
    return { exitCode: 0 };
  } catch (error) {
    context.signal.throwIfAborted();
    operation.signal.throwIfAborted();
    controller.abort(error);
    if (writing) throw error;
    await operation.close();
    await writeDiagnostic(context.stderr, `${error instanceof Error ? error.message.slice(0, 4096) : "llm provider failed"}\n`, context.signal);
    return { exitCode: 1 };
  } finally {
    controller.abort(new Error("llm request closed"));
    await operation.close();
  }
}

export function createLlmCommands(options: LlmCommandsOptions): readonly CommandDefinition[] {
  const { models, lookup } = modelsFor(options.providers);
  const defaultModel = options.defaultModel;
  return [{ name: "llm", description: "Query injected language and media models", execute: context => execute(context, lookup, models, defaultModel) }];
}

export function llmCommands(options: LlmCommandsOptions): VirtualShellPlugin {
  const definitions = createLlmCommands(options);
  const replace = options.replace ?? false;
  return { name: "llm-commands", setup(host) {
    if (!replace && host.commands.has("llm")) throw new Error("Command already registered: llm");
    for (const definition of definitions) host.commands.register(definition, { replace });
  } };
}
