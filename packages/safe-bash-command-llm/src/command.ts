import { createOutputOperation, getCommandArguments, FsError, type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { inheritYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";
import { writeDiagnostic } from "safe-bash-contracts/escaping";
import { pathOf } from "safe-bash-contracts/path";
import { acceptsMimeType, sniffMimeType } from "./mime.js";
import type { LlmCommandsOptions, LlmRequest, LlmInputSource } from "./types.js";
import { createLlmService, type LlmService } from "./service.js";
import { createLlmConfiguration } from "./configuration.js";
import { createLlmTemplateStore, evaluateLlmTemplate, llmTemplateUsesInput, validateLlmTemplateParameters, type TemplateLoaderOptions } from "./templates.js";
import { createLlmSpool } from "./retained-spool.js";
import { findExtractedRange } from "./extract-range.js";
import { fileSource } from "./file-source.js";
import { parseLlmSchemaDsl } from "./schemas.js";
import { configurationCommand } from "./configuration-command.js";
import { listLlmModels, LlmModelsUsageError, modelsGroupHelp } from "./models-list.js";

interface Arguments {
  model?: string;
  system?: string;
  key?: string;
  prompt: string;
  template?: string;
  save?: string;
  noStream?: boolean;
  extract?: "first" | "last";
  params: Record<string, string>;
  options: Record<string, string>;
  attachments: { path: string; mimeType?: string }[];
}

async function parse(length: number, text: (index: number) => string, step: () => Promise<void>): Promise<Arguments> {
  const parsed: Arguments = { prompt: "", params: {}, options: Object.create(null) as Record<string, string>, attachments: [] };
  const operands: string[] = [];
  let ended = false;
  for (let index = 0; index < length; index++) {
    await step();
    const argument = text(index);
    if (!ended && ["--no-log", "-n"].includes(argument)) continue;
    if (!ended && ["-x", "--extract", "--xl", "--extract-last"].includes(argument)) { parsed.extract = argument === "--xl" || argument === "--extract-last" ? "last" : parsed.extract ?? "first"; parsed.noStream = true; continue; }
    if (!ended && argument === "--no-stream") { parsed.noStream = true; continue; }
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
    if (!["-m", "--model", "-s", "--system", "-o", "--option", "-a", "--attachment", "--at", "--attachment-type", "-t", "--template", "--save", "-p", "--param", "--key"].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = attached ?? take();
    if (flag === "-t" || flag === "--template") parsed.template = value;
    else if (flag === "--key") parsed.key = value;
    else if (flag === "--save") parsed.save = value;
    else if (flag === "-p" || flag === "--param") Object.defineProperty(parsed.params, value, { value: take(), enumerable: true, configurable: true, writable: true });
    else if (flag === "-m" || flag === "--model") parsed.model = value;
    else if (flag === "-s" || flag === "--system") parsed.system = value;
    else if (flag === "-o" || flag === "--option") parsed.options[value] = take();
    else if (flag === "--at" || flag === "--attachment-type") parsed.attachments.push({ path: value, mimeType: take() });
    else parsed.attachments.push({ path: value });
  }
  parsed.prompt = operands.join(" ");
  return parsed;
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

async function execute(context: CommandContext, service: LlmService, limits: LlmCommandsOptions["limits"], templateLoaderOptions: TemplateLoaderOptions) {
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
    work++;
    if (work % 256 === 0) await yieldTurn(signal);
  };
  let outputSpool: Awaited<ReturnType<typeof createLlmSpool>> | undefined;
  let outputBytes = 0;
  let writing = false;
  const write = async (chunk: Uint8Array): Promise<void> => {
    if (chunk.byteLength > (limits?.maxOutputBytes ?? Infinity) - outputBytes) throw new FsError("EFBIG", { message: "llm output byte limit exceeded" });
    outputBytes += chunk.byteLength;
    if (outputSpool) { await outputSpool.write(chunk); return; }
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
  const inputLimit = Math.min(context.inputBudget?.maxBytes ?? Infinity, limits?.maxInputBytes ?? Infinity);
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
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    };
    if (argumentsValue.args.length === 1 && ["--help", "-h"].includes(argumentsValue.args[0]!)) {
      argumentText(0);
      await emitText("Usage: llm [prompt] [-m MODEL] [-s SYSTEM] [-o KEY VALUE] [-a PATH] [--at PATH MIMETYPE]\n       llm models\nOptions: --model, --system, --option, --attachment; -- ends options\n");
      return { exitCode: 0 };
    }
    if (argumentsValue.args.length === 2 && argumentsValue.args[0] === "models" && ["--help", "-h"].includes(argumentsValue.args[1]!)) {
      argumentText(0);
      argumentText(1);
      await emitText(modelsGroupHelp);
      return { exitCode: 0 };
    }
    if (argumentsValue.args[0] === "schemas" && argumentsValue.args[1] === "dsl") {
      const tokens = Array.from({ length: argumentsValue.args.length - 2 }, (_, index) => argumentText(index + 2));
      const usage = "Usage: llm schemas dsl [OPTIONS] INPUT\n";
      if (tokens.includes("--help") || tokens.includes("-h")) {
        await emitText(usage + "\n  Convert LLM's schema DSL to a JSON schema\n\n      llm schema dsl 'name, age int, bio: their bio'\n\nOptions:\n  --multi     Wrap in an array\n  -h, --help  Show this message and exit.\n");
        return { exitCode: 0 };
      }
      let multi = false, optionsEnded = false;
      const inputs: string[] = [];
      let failure: string | undefined;
      for (const token of tokens) {
        await step();
        if (!optionsEnded && token === "--") optionsEnded = true;
        else if (!optionsEnded && token === "--multi") multi = true;
        else if (!optionsEnded && token.startsWith("-") && token !== "-") { failure = `No such option: ${token}`; break; }
        else { admitInput(new TextEncoder().encode(token).byteLength); inputs.push(token); }
      }
      failure ??= inputs.length === 0 ? "Missing argument 'INPUT'." : inputs.length > 1 ? `Got unexpected extra argument (${inputs[1]})` : undefined;
      if (failure) {
        await writeDiagnostic(context.stderr, usage + "Try 'llm schemas dsl -h' for help.\n\nError: " + failure + "\n", signal);
        return { exitCode: 2 };
      }
      await emitText(JSON.stringify(parseLlmSchemaDsl(inputs[0]!, multi), null, 2) + "\n");
      return { exitCode: 0 };
    }
    if (argumentsValue.args[0] === "templates") {
      let exitCode = 0;
      try { exitCode = await createLlmTemplateStore(context, templateLoaderOptions).command(Array.from({ length: argumentsValue.args.length - 1 }, (_, index) => argumentText(index + 1)), emitText, text => writeDiagnostic(context.stderr, text, signal)); }
      catch (error) { throw new Error(`Error: ${error instanceof Error ? error.message : "Template failed"}`); }
      return { exitCode };
    }
    const configurationInvocation = argumentsValue.args[0] === "keys" || argumentsValue.args[0] === "aliases" || argumentsValue.args[0] === "models" && ["default", "options"].includes(argumentsValue.args[1] ?? "") || argumentsValue.args[0] === "--version";
    if (configurationInvocation) {
      try {
        const tokens = Array.from({ length: argumentsValue.args.length }, (_, index) => argumentText(index));
        if (await configurationCommand(context, service, tokens, emitText, text => writeDiagnostic(context.stderr, text, signal))) return { exitCode: 0 };
      } catch (error) {
        throw new Error(`Error: ${error instanceof Error ? error.message : "Configuration failed"}`);
      }
    }
    if (argumentsValue.args[0] === "models") {
      await listLlmModels(context, service, Array.from({ length: argumentsValue.args.length - 1 }, (_, index) => argumentText(index + 1)), emitText, step);
      return { exitCode: 0 };
    }
    const promptOffset = argumentsValue.args[0] === "prompt" ? 1 : 0;
    const args = await parse(argumentsValue.args.length - promptOffset, index => argumentText(index + promptOffset), step);
    const configuration = createLlmConfiguration(context);
    const templateStore = createLlmTemplateStore(context, templateLoaderOptions);
    if (args.save && args.template) throw new Error("Error: --save cannot be used with --template");
    let stored;
    try { stored = args.template === undefined ? undefined : await templateStore.load(args.template); }
    catch (error) { throw new Error(`Error: ${error instanceof Error ? error.message : "Invalid template"}`); }
    if (stored) {
      try { validateLlmTemplateParameters(stored, args.params); }
      catch (error) { throw new Error(`Error: ${error instanceof Error ? error.message : "Invalid template"}`); }
    }
    const selected = args.model ?? stored?.model ?? (args.save ? undefined : await configuration.defaultModel());
    const model = selected === undefined ? undefined : await configuration.resolveAlias(selected);
    const entry = args.save && selected === undefined ? undefined : service.resolve(model);
    const streamed = entry !== undefined && service.streamSources !== undefined && entry.provider.completeSources !== undefined && entry.model.inputSources !== false;
    const stagePrompt = streamed && stored === undefined && args.save === undefined;
    let promptSpool: Awaited<ReturnType<typeof createLlmSpool>> | undefined;
    let stdinBytes = 0;
    const fragments: string[] = [];
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const templateUsesInput = stored !== undefined && llmTemplateUsesInput(stored);
    if (stored === undefined || templateUsesInput) {
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
        stdinBytes += chunk.byteLength;
        if (stagePrompt) {
          for (let offset = 0; offset < chunk.byteLength; offset += 16384) {
            await step();
            decoder.decode(chunk.subarray(offset, Math.min(offset + 16384, chunk.byteLength)), { stream: true });
          }
          if (chunk.byteLength) {
            promptSpool ??= await operation.acquire(() => createLlmSpool(context.fs, context.cwd, signal, "input"), spool => spool.close());
            await promptSpool.write(chunk);
          }
        } else fragments.push(decoder.decode(chunk, { stream: true }));
      }
    }
    const decoderTail = decoder.decode();
    if (!stagePrompt) fragments.push(decoderTail);
    if (promptSpool && args.prompt) {
      if (stdinBytes) await promptSpool.write(new TextEncoder().encode(" "));
      for (let start = 0; start < args.prompt.length;) {
        await step();
        let end = Math.min(args.prompt.length, start + 8192);
        const last = args.prompt.charCodeAt(end - 1);
        if (end < args.prompt.length && last >= 0xd800 && last <= 0xdbff) end--;
        await promptSpool.write(new TextEncoder().encode(args.prompt.slice(start, end)));
        start = end;
      }
    }
    const content = fragments.join("");
    let prompt = content && args.prompt ? `${content} ${args.prompt}` : content || args.prompt;
    if (args.save) {
      const attachments = args.attachments.filter(item => item.mimeType === undefined).map(item => item.path);
      const attachmentTypes = args.attachments.filter(item => item.mimeType !== undefined).map(item => ({ type: item.mimeType!, value: item.path }));
      const saved = {
        ...(args.model === undefined ? {} : { model: entry!.model.id }),
        ...(prompt ? { prompt } : {}), ...(args.system === undefined ? {} : { system: args.system }),
        ...(args.extract === "last" ? { extract_last: true } : args.extract === "first" ? { extract: true } : {}),
        ...(Object.keys(args.params).length ? { defaults: args.params } : {}),
        ...(Object.keys(args.options).length ? { options: args.options } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(attachmentTypes.length ? { attachment_types: attachmentTypes } : {}),
      };
      await templateStore.save(args.save, saved); return { exitCode: 0 };
    }
    if (stored) {
      try {
        if (!args.extract && (stored.extract_last || stored.extract)) {
          args.extract = stored.extract_last ? "last" : "first";
          args.noStream = true;
        }
        const evaluated = evaluateLlmTemplate(stored, templateUsesInput ? prompt : "", args.params);
        if (evaluated.prompt) prompt = !templateUsesInput && args.prompt ? `${evaluated.prompt}\n${args.prompt}` : evaluated.prompt;
        if (args.system === undefined && evaluated.system !== undefined) args.system = evaluated.system;
      }
      catch (error) { throw new Error(`Error: ${error instanceof Error ? error.message : "Invalid template"}`); }
    }
    if (!entry) throw new Error("No model selected; use --model or configure defaultModel");
    args.options = { ...await configuration.modelOptions(entry.model.id), ...stored?.options, ...args.options };
    args.attachments = [
      ...(stored?.attachments ?? []).map(path => ({ path })),
      ...args.attachments.filter(item => item.mimeType === undefined),
      ...(stored?.attachment_types ?? []).map(item => ({ path: item.value, mimeType: item.type })),
      ...args.attachments.filter(item => item.mimeType !== undefined),
    ];
    const attachments: { mimeType: string; bytes: Uint8Array }[] = [];
    const sourceAttachments: { mimeType: string; source: LlmInputSource }[] = [];
    const textSource = (value: string): LlmInputSource => ({
      async dispose() {},
      bytes: { async *[Symbol.asyncIterator]() {
        for (let offset = 0; offset < value.length;) {
          await step();
          let end = Math.min(value.length, offset + 16384);
          const last = value.charCodeAt(end - 1);
          if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
          yield new TextEncoder().encode(value.slice(offset, end));
          offset = end;
        }
      } },
    });
    for (const attachment of args.attachments) {
      await step();
      if (attachment.path.includes("://")) throw new Error("URL attachments are not supported");
      const path = pathOf(context, attachment.path);
      const stat = await interrupted(() => context.fs.stat(path, { signal }), signal);
      checkInput(stat.size);
      if (streamed) {
        const source = await operation.acquire(() => fileSource({ fs: context.fs, path, signal, maxBytes: inputLimit - inputBytes, expectedStat: stat }), source => source.dispose());
        const input = source.bytes[Symbol.asyncIterator]();
        const first = await interrupted(() => input.next(), signal);
        const mimeType = attachment.mimeType ?? sniffMimeType(path, first.done ? new Uint8Array() : first.value);
        if (!acceptsMimeType(entry.model.attachmentTypes ?? [], mimeType)) throw new Error(`Model ${entry.model.id} does not accept ${mimeType}`);
        admitInput(stat.size);
        let closed = false, consumed = false;
        sourceAttachments.push({ mimeType, source: {
          async dispose() { closed = true; await source.dispose(); },
          bytes: { async *[Symbol.asyncIterator]() {
            if (closed || consumed) throw new FsError("EBADF", { message: "LLM attachment source is closed" });
            consumed = true;
            signal.throwIfAborted();
            if (!first.done) yield first.value;
            while (true) {
              if (closed) throw new FsError("EBADF", { message: "LLM attachment source is closed" });
              const next = await interrupted(() => input.next(), signal);
              if (closed) throw new FsError("EBADF", { message: "LLM attachment source is closed" });
              if (next.done) break;
              yield next.value;
            }
          } },
        } });
        continue;
      }
      const bytes = await interrupted(() => context.fs.readFile(path, { signal,
        ...(inputLimit === Infinity ? {} : { maxBytes: inputLimit - inputBytes }),
      }), signal);
      signal.throwIfAborted();
      if (!(bytes instanceof Uint8Array)) throw new TypeError("Attachment read must return Uint8Array");
      admitInput(bytes.byteLength);
      const mimeType = attachment.mimeType ?? sniffMimeType(path, bytes);
      if (!acceptsMimeType(entry.model.attachmentTypes ?? [], mimeType)) throw new Error(`Model ${entry.model.id} does not accept ${mimeType}`);
      attachments.push({ mimeType, bytes: new Uint8Array(bytes) });
    }
    const resolvedKey = args.key === undefined ? undefined : await configuration.resolveKey(args.key);
    const request: LlmRequest = {
      model: entry.model.id, prompt,
      ...(args.system === undefined ? {} : { system: args.system }), attachments, options: args.options, signal, stream: !args.noStream,
      ...(resolvedKey === undefined ? {} : { key: resolvedKey }),
    };
    signal.throwIfAborted();
    if (args.noStream) outputSpool = await operation.acquire(() => createLlmSpool(context.fs, context.cwd, signal), spool => spool.close());
    if (streamed) {
      const events = service.streamSources!({ model: request.model, options: request.options, signal, stream: request.stream, prompt: promptSpool ? { bytes: promptSpool.replay(), dispose: promptSpool.close } : textSource(prompt),
        ...(args.system === undefined ? {} : { system: textSource(args.system) }),
        ...(resolvedKey === undefined ? {} : { key: resolvedKey }),
        attachments: sourceAttachments });
      iterator = (async function* () {
        for await (const event of events) {
          if (event.type === "text") yield event.text;
          else if (event.type === "bytes") yield event.data;
        }
      })()[Symbol.asyncIterator]();
    } else iterator = service.complete(request)[Symbol.asyncIterator]();
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
      if (!args.extract) await write(Uint8Array.of(10));
    }
    if (outputSpool) for await (const chunk of outputSpool.replay(args.extract && text ? async reader => {
      const range = await findExtractedRange(reader, args.extract === "last", signal);
      return range && range.end > range.start ? range : undefined;
    } : undefined)) { writing = true; await operation.output.write(chunk); writing = false; }
    if (args.extract && text) await operation.output.write(Uint8Array.of(10));
    return { exitCode: 0 };
  } catch (error) {
    context.signal.throwIfAborted();
    operation.signal.throwIfAborted();
    controller.abort(error);
    if (writing) throw error;
    await operation.close();
    await writeDiagnostic(context.stderr, `${error instanceof Error ? error.message.slice(0, 4096) : "llm provider failed"}\n`, context.signal);
    return { exitCode: error instanceof LlmModelsUsageError ? 2 : 1 };
  } finally {
    controller.abort(new Error("llm request closed"));
    await operation.close();
  }
}

export function createLlmCommand(options: LlmCommandsOptions = {}): CommandDefinition {
  for (const [name, value] of Object.entries(options.limits ?? {})) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid llm limit: ${name}`);
  }
  const limits = options.limits === undefined ? undefined : Object.freeze({ ...options.limits });
  if (options.service && (options.providers !== undefined || options.defaultModel !== undefined)) throw new TypeError("Configure providers and defaultModel on the injected LLM service");
  const maxRemoteBytes = options.maxRemoteTemplateBytes ?? limits?.maxInputBytes ?? 1_048_576;
  const templateLoaderOptions: TemplateLoaderOptions = { maxRemoteBytes, ...(options.templateLoaders ? { loaders: options.templateLoaders } : {}) };
  const service = options.service ?? createLlmService({ ...options, providers: options.providers ?? [] });
  return { name: "llm", description: "Query injected language and media models", execute: context => execute(context, service, limits, templateLoaderOptions) };
}

export function createLlmCommands(options: LlmCommandsOptions = {}): readonly CommandDefinition[] {
  return [createLlmCommand(options)];
}

export function llmCommands(options: LlmCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createLlmCommands(options);
  const replace = options.replace ?? false;
  return { name: "llm-commands", setup(host) {
    if (!replace && host.commands.has("llm")) throw new Error("Command already registered: llm");
    for (const definition of definitions) host.commands.register(definition, { replace });
  } };
}
