import {loadLlmHelp} from './help-text.js';
import {pluginsCommand} from './plugins-command.js';
import type {LlmPluginQuery} from './tool-registry.js';
import {pythonRepr} from "./python-repr.js";
import {chatOptions, chatOptionSuggestion} from "./chat-options.js";
import {createChatInput} from "./chat-input.js";
import {validateModelOptions} from "./model-options.js";
import type {PromptChatMessage} from "./prompt-tool-chain.js";
import { promptToolChain } from "./prompt-tool-chain.js";
import { createToolApproval } from "./prompt-tool-approval.js";
import { stripPythonWhitespace } from "./python-whitespace.js";
import { selectLlmTools } from "./tool-registry.js";
import { tokenInteger } from "./token-integer.js";
import {discoverLlmLoaders,LlmPluginExit} from "./loader-provider.js";
import { fragmentLoaderCommand } from "./fragment-loader-command.js";
import { toolsCommand } from './tools-command.js';
import { getLlmFragmentPrefix, loadLlmPluginFragments } from "./fragment-loaders.js";
import { sourceBytes } from "./request-source.js";
import { createLlmUrlFragmentSource } from "./url-fragment-source.js";
import { createLlmFragmentSource, type LlmFragmentInputSource } from "./fragments.js";
import { resolveUrlAttachment } from "./url-attachment.js";
import { createLlmUrlSource } from './url-source.js';
import { attachmentBytesId, getLlmAttachmentUrlId } from './attachment-id.js';
import { embeddingCommand } from "./embed-command.js";
import { embeddingModelsCommand } from './embed-models-command.js';
import { serializeLlmTokenUsage } from "./usage.js";
import { createLlmInputBudget } from "./input-budget.js";
import { pipeBytes, createOutputOperation, getCommandArguments, shellValueByteLength, FsError, type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { inheritYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";
import { writeDiagnostic } from "safe-bash-contracts/escaping";
import { pathOf } from "safe-bash-contracts/path";
import { acceptsMimeType, sniffMimeType } from "./mime.js";
import type { LlmCommandsOptions, LlmRequest, LlmInputSource, LlmResponseMetadata, LlmAttachment, LlmSourceAttachment } from "./types.js";
import { createLlmService, type LlmService } from "./service.js";
import { createLlmConfiguration } from "./configuration.js";
import { createLlmTemplateStore, evaluateLlmTemplate, llmTemplateUsesInput, validateLlmTemplateParameters, type TemplateLoaderOptions } from "./templates.js";
import { createLlmSpool } from "./retained-spool.js";
import { findExtractedRange } from "./extract-range.js";
import { fileSource } from "./file-source.js";
import { parseLlmSchemaDsl } from "./schemas.js";
import { resolveLlmSchemaInput } from "./schema-input.js";
import { configurationCommand } from "./configuration-command.js";
import { listLlmModels, LlmModelsUsageError } from "./models-list.js";

import { selectLlmModelByQuery } from "./model-selection.js";

/** Pinned reference CLI target exposed to SDK callers. */
export const llmReferenceVersion = "0.27.1";

interface Arguments {
  help?: boolean;
  async?: boolean;
  toolNames: string[];
  functions: string[];
  chainLimit: number | bigint;
  toolsApprove?: boolean;
  toolsDebug?: boolean;
  promptSupplied?: boolean;
  queries: string[];
  fragments: string[];
  systemFragments: string[];
  schema?: string;
  schemaMulti?: string;
  model?: string;
  system?: string;
  key?: string;
  prompt: string;
  template?: string;
  save?: string;
  noStream?: boolean;
  usage?: boolean;
  extract?: "first" | "last";
  params: Record<string, string>;
  options: Record<string, string>;
  optionNames: string[];
  attachments: { path: string; mimeType?: string }[];
}

class LlmPromptUsageError extends Error {}

const chatUsage = "Usage: llm chat [OPTIONS]\nTry 'llm chat -h' for help.";

function optionAliases(groups:Record<string,string>):Record<string,string> {
  return Object.fromEntries(Object.entries(groups).flatMap(([name,flags])=>flags.split(' ').map(flag=>[flag,name])));
}
const promptSwitches = optionAliases({
  async: "--async", toolsDebug: "--td --tools-debug", toolsApprove: "--ta --tools-approve",
  noLog: "--no-log -n", extract: "-x --extract", extractLast: "--xl --extract-last",
  usage: "-u --usage", noStream: "--no-stream",
});
const promptValueOptions = optionAliases({
  functions: "--functions", toolNames: "-T --tool", chainLimit: "--cl --chain-limit",
  fragments: "-f --fragment", systemFragments: "--sf --system-fragment", queries: "-q --query",
  template: "-t --template", schema: "--schema", schemaMulti: "--schema-multi", key: "--key", save: "--save",
  params: "-p --param", model: "-m --model", system: "-s --system", options: "-o --option",
  attachmentType: "--at --attachment-type", attachment: "-a --attachment",
});

async function parse(length: number, text: (index: number) => string, step: () => Promise<void>, chat = false, toolsDebugEnv?: string): Promise<Arguments> {
  const parsed: Arguments = { toolNames: [], functions: [], chainLimit: 5, prompt: "", queries: [], fragments: [], systemFragments: [], params: {}, optionNames: [], options: Object.create(null) as Record<string, string>, attachments: [] };
  const usage = chat ? chatUsage : "Usage: llm prompt [OPTIONS] [PROMPT]\nTry 'llm prompt --help' for help.";
  const operands: string[] = [];
  let ended = false, chainLimit: string | undefined;
  for (let index = 0; index < length; index++) {
    await step();
    const argument = text(index);
    if (ended || !argument.startsWith("-") || argument === "-") { operands.push(argument); continue; }
    if (argument === "--") { ended = true; continue; }
    const equals = argument.indexOf("="), long = argument.startsWith("--");
    for (let cursor = long ? 0 : 1; cursor < argument.length; cursor++) {
      await step();
      const flag = long ? argument.slice(0, equals < 0 ? undefined : equals) : "-" + argument[cursor];
      if (flag === '-h' || flag === '--help') {
        if (long && equals >= 0) throw new LlmPromptUsageError(`Error: Option '${flag}' does not take a value.`);
        parsed.help = true;
        if (long) break;
        continue;
      }
      if (chat) {
        if (!chatOptions.includes(flag))
          throw new LlmPromptUsageError(`${usage}\n\nError: No such option: ${flag}${await chatOptionSuggestion(flag, step)}`);
      }
      const boolean = promptSwitches[flag];
      if (boolean) {
        if (long && equals >= 0) throw new LlmPromptUsageError(`Error: Option '${flag}' does not take a value.`);
        if (boolean === "extract" || boolean === "extractLast") {
          parsed.extract = boolean === "extractLast" ? "last" : parsed.extract ?? "first"; parsed.noStream = true;
        } else if (boolean !== "noLog") parsed[boolean as "async" | "toolsDebug" | "toolsApprove" | "usage" | "noStream"] = true;
        if (long) break;
        continue;
      }
      const option = promptValueOptions[flag];
      if (!option) throw new Error(`Unknown option: ${flag}`);
      const attached = long ? equals < 0 ? undefined : argument.slice(equals + 1) : argument.slice(cursor + 1) || undefined;
      const arity = ["options", "params", "attachmentType"].includes(option) ? 2 : 1;
      if (length - index - 1 < arity - (attached === undefined ? 0 : 1)) throw new LlmPromptUsageError(`Error: Option '${flag}' requires ${arity === 2 ? "2 arguments" : "an argument"}.`);
      const value = attached ?? text(++index);
      if (["functions", "toolNames", "fragments", "systemFragments", "queries"].includes(option))
        (parsed[option as "functions"] as string[]).push(value);
      else if (option === "chainLimit") chainLimit = value;
      else if (option === "params") Object.defineProperty(parsed.params, value, { value: text(++index), enumerable: true, configurable: true, writable: true });
      else if (option === "options") {
        if (!Object.hasOwn(parsed.options, value)) parsed.optionNames.push(value);
        parsed.options[value] = text(++index);
      }
      else if (option === "attachmentType") parsed.attachments.push({ path: value, mimeType: text(++index) });
      else if (option === "attachment") parsed.attachments.push({ path: value });
      else parsed[option as "model"] = value;
      break;
    }
  }
  if (parsed.help) return parsed;
  if (chainLimit !== undefined) {
    const integer = tokenInteger(chainLimit);
    if (integer === undefined) throw new LlmPromptUsageError(`${usage}\n\nError: Invalid value for '--cl' / '--chain-limit': '${chainLimit}' is not a valid integer.`);
    parsed.chainLimit = BigInt(integer);
  }
  if (!parsed.toolsDebug && toolsDebugEnv) {
    const raw = toolsDebugEnv, value = stripPythonWhitespace(raw).toLowerCase();
    if (["1", "true", "t", "yes", "y", "on"].includes(value)) parsed.toolsDebug = true;
    else if (!["", "0", "false", "f", "no", "n", "off"].includes(value)) {
      const detail = chat ? "" : " Recognized values: , 0, 1, f, false, n, no, off, on, t, true, y, yes";
      throw new LlmPromptUsageError(`${usage}\n\nError: Invalid value for '--td' / '--tools-debug': '${raw}' is not a valid boolean.${detail}`);
    }
  }
  const unexpected = chat ? operands : operands.slice(1);
  if (unexpected.length) throw new LlmPromptUsageError(`${usage}\n\nError: Got unexpected extra argument${unexpected.length === 1 ? "" : "s"} (${unexpected.join(" ")})`);
  parsed.prompt = operands[0] ?? "";
  parsed.promptSupplied = operands.length > 0;
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

async function execute(context: CommandContext, service: LlmService, limits: LlmCommandsOptions["limits"], templateLoaderOptions: TemplateLoaderOptions, collections:LlmCommandsOptions['collections'], fragmentLoaders: NonNullable<LlmCommandsOptions['fragmentLoaders']>, tools: NonNullable<LlmCommandsOptions['tools']>, loadTools: LlmCommandsOptions['loadTools'], managePackages: LlmCommandsOptions['managePackages']) {
  context.signal.throwIfAborted();
  const controller = new AbortController();
  const operation = createOutputOperation(context, context.stdout);
  const signal = AbortSignal.any([operation.signal, controller.signal]);
  inheritYieldCheckpoint(context.signal, signal);
  let iterator: AsyncIterator<string | Uint8Array, LlmResponseMetadata | void> | undefined;
  let responseUsage: LlmResponseMetadata["usage"];
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
  let usageSpool: Awaited<ReturnType<typeof createLlmSpool>> | undefined;
  let outputBytes = 0;
  let outputFailed = false;
  const writeOutput = async (sink: CommandContext["stdout"], chunk: Uint8Array): Promise<void> => {
    try { await sink.write(chunk); }
    catch (error) {
      // A successful concurrent write cannot make a rejected destination safe
      // for a second diagnostic or erase the original sink error.
      outputFailed = true;
      throw error;
    }
  };
  const admitOutput = (size: number): void => {
    if (size > (limits?.maxOutputBytes ?? Infinity) - outputBytes) throw new FsError("EFBIG", { message: "llm output byte limit exceeded" });
    outputBytes += size;
  };
  const write = async (chunk: Uint8Array, immediate = false): Promise<void> => {
    admitOutput(chunk.byteLength);
    if (outputSpool && !immediate) { await outputSpool.write(chunk); return; }
    await writeOutput(operation.output, chunk);
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
  const input = createLlmInputBudget(limits);
  let shellInputBytes = 0;
  const admitInput = (size: number, materialized = false): void => {
    context.inputBudget?.check(shellInputBytes + size);
    input.admit(size, materialized);
    shellInputBytes += size;
  };
  const admitBuffered = (size: number): void => input.admit(size, true);
  const functionSessions = new Set<Awaited<ReturnType<NonNullable<LlmCommandsOptions['loadTools']>>>>();
  const loaderContext = (): CommandContext => {
    const diagnostic = operation.child(context.stderr).output;
    return {...context, signal, stdout: {write: bytes => write(bytes, true)}, stderr: {write: async bytes => {admitOutput(bytes.length); await writeOutput(diagnostic, bytes);}}};
  };
  const loadDefinitions = async (definitions: readonly string[], toolNames: readonly string[] = [], discovery = false, pluginQuery?: LlmPluginQuery) => {
    if (!loadTools) throw new Error("Python tool loading is not configured");
    const loaded = await operation.acquire(async () => {const value = await loadTools({definitions, toolNames, discovery, ...(pluginQuery ? {pluginQuery} : {}),
      context: loaderContext(),
      maxInputBytes: input.remaining(true), maxOutputBytes: limits?.maxOutputBytes ?? Infinity});
      let closing: Promise<void> | undefined;
      return {tools: value.tools, ...(value.plugins ? {plugins: value.plugins} : {}), ...(value.toolboxes ? {toolboxes: value.toolboxes} : {}), close: () => closing ??= Promise.resolve().then(() => value.close())};
    }, value => value.close());
    functionSessions.add(loaded);
    return loaded;
  };
  const invocationLoaders = { ...templateLoaderOptions, get maxBytes() { return input.remaining(true); }, admitBytes: admitBuffered };
  try {
    let argumentsValue = getCommandArguments(context);
    const argumentText = (index: number): string => {
      const value = argumentsValue.values[index];
      if (value === undefined) throw new Error("Missing option argument");
      input.admit(shellValueByteLength(value), true);
      const bytes = argumentsValue.bytes(index);
      if (!bytes) throw new Error("Missing option argument");
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    };
    // Click parses the root options before running eager callbacks. Unknown
    // options are forwarded to the default command, but do not stop this scan.
    let eager: "help" | "version" | undefined;
    let separator: number | undefined;
    for (let index = 0; index < argumentsValue.args.length; index++) {
      await step();
      const token = argumentsValue.args[index]!;
      if (token === "--") { separator = index; break; }
      if (!token.startsWith("-") || token === "-") break;
      if (token.startsWith("--")) {
        const equals = token.indexOf("=");
        const flag = equals < 0 ? token : token.slice(0, equals);
        if (flag !== "--version" && flag !== "--help") continue;
        argumentText(index);
        if (equals >= 0) {
          await writeDiagnostic(context.stderr, `Error: Option '${flag}' does not take a value.\n`, signal);
          return { exitCode: 2 };
        }
        eager ??= flag === "--version" ? "version" : "help";
      } else {
        for (let cursor = 1; cursor < token.length; cursor++) {
          await step();
          if (token[cursor] !== "h") continue;
          argumentText(index);
          eager ??= "help";
          break;
        }
      }
    }
    if (eager === "version") {
      await emitText(`llm, version ${llmReferenceVersion}\n`);
      return { exitCode: 0 };
    }
    if (eager === "help") {
      await emitText(await loadLlmHelp('root'));
      return { exitCode: 0 };
    }
    // A later separator belongs to the explicit or default subcommand.
    if (separator !== undefined) {
      argumentText(separator);
      argumentsValue = argumentsValue.select(Array.from({length:argumentsValue.args.length-1},(_,position)=>position<separator?position:position+1));
    }
    if (argumentsValue.args.length === 2 && argumentsValue.args[0] === "models" && ["--help", "-h"].includes(argumentsValue.args[1]!)) {
      argumentText(0);
      argumentText(1);
      await emitText(await loadLlmHelp("models"));
      return { exitCode: 0 };
    }
    if (argumentsValue.args[0] === 'install' || argumentsValue.args[0] === 'uninstall') {
      const args = Array.from({length:argumentsValue.args.length},(_,index)=>argumentText(index));
      if (!managePackages) {await writeDiagnostic(context.stderr,'Error: Python package management is not configured\n',signal);return {exitCode:1};}
      return await managePackages({args,context:{...context,signal,stdout:{write:chunk=>write(chunk,true)},registerCleanup:operation.registerCleanup}});
    }
    if (argumentsValue.args[0] === 'plugins') {
      argumentText(0);
      const tokens = Array.from({length: argumentsValue.args.length - 1}, (_, index) => argumentText(index + 1));
      return {exitCode: await pluginsCommand(tokens, emitText, text => writeDiagnostic(context.stderr, text, signal), step, signal,
        loadTools ? async query => {
          const session = await loadDefinitions([], [], false, query);
          if (!session.plugins) throw new Error('Python runtime did not return plugin metadata');
          return session.plugins;
        } : undefined)};
    }
    if (argumentsValue.args[0] === 'tools') {
      argumentText(0);
      const tokens=Array.from({length:argumentsValue.args.length-1},(_,index)=>argumentText(index+1));
      return {exitCode:await toolsCommand(tokens,tools,emitText,text=>writeDiagnostic(context.stderr,text,signal),step,signal,loadTools ? loadDefinitions : undefined)};
    }
    if (argumentsValue.args[0] === "fragments") {
      if (argumentsValue.args[1] !== "loaders") {
        await writeDiagnostic(context.stderr, "Error: Fragment history is host-owned. Use a file, URL, or registered loader.\n", signal);
        return {exitCode:2};
      }
      const tokens = Array.from({length:argumentsValue.args.length-2},(_,index)=>argumentText(index+2));
      return {exitCode:await fragmentLoaderCommand(tokens,fragmentLoaders,emitText,text=>writeDiagnostic(context.stderr,text,signal),step,()=>discoverLlmLoaders(fragmentLoaders,{...loaderContext(),kind:'fragments',maxBytes:input.remaining(true),admitBytes:admitBuffered},templateLoaderOptions.provider))};
    }
    if (argumentsValue.args[0] === "schemas" && argumentsValue.args[1] !== "dsl") {
      await writeDiagnostic(context.stderr, "Error: Stored schema history is host-owned. Use an inline schema, file, template, or 'llm schemas dsl'.\n", signal);
      return { exitCode: 2 };
    }
    if (argumentsValue.args[0] === "schemas" && argumentsValue.args[1] === "dsl") {
      const tokens = Array.from({ length: argumentsValue.args.length - 2 }, (_, index) => argumentText(index + 2));
      const usage = "Usage: llm schemas dsl [OPTIONS] INPUT\n";
      if (tokens.includes("--help") || tokens.includes("-h")) {
        await emitText(await loadLlmHelp('schemas-dsl'));
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
        else inputs.push(token);
      }
      failure ??= inputs.length === 0 ? "Missing argument 'INPUT'." : inputs.length > 1 ? `Got unexpected extra argument (${inputs[1]})` : undefined;
      if (failure) {
        await writeDiagnostic(context.stderr, usage + "Try 'llm schemas dsl -h' for help.\n\nError: " + failure + "\n", signal);
        return { exitCode: 2 };
      }
      await emitText(JSON.stringify(parseLlmSchemaDsl(inputs[0]!, multi), null, 2) + "\n");
      return { exitCode: 0 };
    }
    if (argumentsValue.args[0] === 'collections'||argumentsValue.args[0]==='similar'||argumentsValue.args[0]==='embed-multi'||collections&&argumentsValue.args[0]==='embed') {
      const tokens=Array.from({length:argumentsValue.args.length-1},(_,index)=>argumentText(index+1));
      if(!collections){await writeDiagnostic(context.stderr,'Error: Collection storage is not configured\n',signal);return {exitCode:1};}
      return {exitCode:await collections.execute({context:{...context,signal},service,command:argumentsValue.args[0]!,tokens,write,diagnostic:text=>writeDiagnostic(context.stderr,text,signal),step,admit:admitInput,maxConfigurationBytes:limits?.maxConfigurationBytes??Infinity,maxInputBytes:limits?.maxInputBytes??Infinity})};
    }
    if (argumentsValue.args[0] === "embed") {
      const tokens = Array.from({ length: argumentsValue.args.length - 1 }, (_, index) => argumentText(index + 1));
      return { exitCode: await embeddingCommand({...context,signal},service,tokens,write,text => writeDiagnostic(context.stderr,text,signal),step,admitInput,limits?.maxConfigurationBytes) };
    }
    if (argumentsValue.args[0] === "embed-models") {
      const tokens = Array.from({ length: argumentsValue.args.length - 1 }, (_, index) => argumentText(index + 1));
      return { exitCode: await embeddingModelsCommand({...context,signal},service,tokens,emitText,text => writeDiagnostic(context.stderr,text,signal),step,limits?.maxConfigurationBytes) };
    }
    if (argumentsValue.args[0] === "templates") {
      let exitCode = 0;
      try { exitCode = await createLlmTemplateStore(loaderContext(), invocationLoaders).command(Array.from({ length: argumentsValue.args.length - 1 }, (_, index) => argumentText(index + 1)), emitText, text => writeDiagnostic(context.stderr, text, signal)); }
      catch (error) { if(error instanceof LlmPluginExit)throw error; throw new Error(`Error: ${error instanceof Error ? error.message : "Template failed"}`); }
      return { exitCode };
    }
    const configurationInvocation = argumentsValue.args[0] === "keys" || argumentsValue.args[0] === "aliases" || argumentsValue.args[0] === "models" && ["default", "options"].includes(argumentsValue.args[1] ?? "");
    if (configurationInvocation) {
      try {
        const tokens = Array.from({ length: argumentsValue.args.length }, (_, index) => argumentText(index));
        return {exitCode: await configurationCommand({...context, signal}, service, tokens, emitText, text => writeDiagnostic(context.stderr, text, signal), admitInput, limits?.maxConfigurationBytes, step)};
      } catch (error) {
        throw new Error(`Error: ${error instanceof Error ? error.message : "Configuration failed"}`);
      }
    }
    if (argumentsValue.args[0] === "models") {
      await listLlmModels(context, service, Array.from({ length: argumentsValue.args.length - 1 }, (_, index) => argumentText(index + 1)), emitText, step, limits?.maxConfigurationBytes);
      return { exitCode: 0 };
    }
    const isChat = argumentsValue.args[0] === "chat";
    const promptOffset = argumentsValue.args[0] === "prompt" || isChat ? 1 : 0;
    let args = await parse(argumentsValue.args.length - promptOffset, index => argumentText(index + promptOffset), step, isChat, context.env.LLM_TOOLS_DEBUG);
    if (args.help) {await emitText(await loadLlmHelp(isChat ? "chat" : "prompt")); return {exitCode: 0};}
    const configuration = createLlmConfiguration(loaderContext(), limits?.maxConfigurationBytes, invocationLoaders);
    if (args.model === undefined && args.queries.length) {
      try { args.model = (await selectLlmModelByQuery(service.models, args.queries, await configuration.aliases(), signal)).model.id; }
      catch (error) { throw new Error(`Error: ${error instanceof Error ? error.message : "Model selection failed"}`); }
    }
    const templateStore = createLlmTemplateStore(loaderContext(), invocationLoaders);
    const schemaInput = args.schemaMulti ?? args.schema;
    let schema = schemaInput ? await resolveLlmSchemaInput({...context, signal}, schemaInput, {
      multi: Boolean(args.schemaMulti), maxBytes: input.remaining(true), admitBytes: admitBuffered,
      loadTemplate: name => templateStore.load(name),
    }) : undefined;
    if (args.save && args.template) throw new Error("Error: --save cannot be used with --template");
    let stored;
    try { stored = args.template === undefined ? undefined : await templateStore.load(args.template); }
    catch (error) { if(error instanceof LlmPluginExit)throw error; throw new Error(`Error: ${error instanceof Error ? error.message : "Invalid template"}`); }
    if (stored) {
      if (!isChat && stored.schema_object) schema = stored.schema_object;
      try { if (!isChat) validateLlmTemplateParameters(stored, args.params); }
      catch (error) { throw new Error(`Error: ${error instanceof Error ? error.message : "Invalid template"}`); }
    }
    const selected = args.model ?? stored?.model ?? (args.save ? undefined : await configuration.defaultModel());
    const model = selected === undefined ? undefined : await configuration.resolveAlias(selected);
    let entry: ReturnType<LlmService["resolve"]> | undefined;
    try { entry = args.save && selected === undefined ? undefined : service.resolve(model, args.async && !args.save ? {async: true} : undefined); }
    catch (error) {
      if (isChat && error instanceof Error && error.message.startsWith("Unknown model: ")) {
        const missing = selected ?? error.message.slice("Unknown model: ".length);
        throw new Error(`Error: '${missing}' is not a known model`);
      }
      if (!args.async || args.save) throw error;
      let detail = "";
      for await (const bytes of pythonRepr(error instanceof Error ? error.message : String(error), signal)) {
        detail += new TextDecoder().decode(bytes);
        if (detail.length >= 4096) break;
      }
      throw new Error("Error: " + detail);
    }
    if (!args.save && entry?.model.canStream === false) args.noStream = true;
    const streamed = entry !== undefined && service.streamSources !== undefined && entry.provider.completeSources !== undefined && entry.model.inputSources !== false;
    const stagePrompt = streamed && stored === undefined && args.save === undefined;
    if (isChat && args.promptSupplied) throw new LlmPromptUsageError(`${chatUsage}\n\nError: Got unexpected extra argument (${args.prompt})`);
    let chatModelOptions: Record<string, string> | undefined;
    if (isChat) {
      const configured = await configuration.modelOptions(entry!.model.id);
      const names = args.optionNames;
      chatModelOptions = names.length ? args.options : configured;
      if (names.length) {
        const rules = entry!.model.options ?? {}, errors: string[] = [];
        const ordered = [...Object.keys(rules).filter(name => Object.hasOwn(args.options, name)), ...names.filter(name => !Object.hasOwn(rules, name))];
        for (const name of ordered) {
          await step();
          try {validateModelOptions(entry!.model, {[name]: args.options[name]!});}
          catch (error) {errors.push(error instanceof Error ? error.message : String(error));}
        }
        if (errors.length) throw new Error('Error: ' + errors.join('\n'));
      }
    }
    const loadSelectedTools = async () => {
      let selectedTools;
      try {
        const definitions = [...(stored?.functions && Object.getOwnPropertyDescriptor(stored, "functionsTrusted")?.value !== false ? [stored.functions] : []), ...args.functions];
        const names = [...stored?.tools ?? [], ...args.toolNames];
        const dynamicNames = names.filter(name => !tools.has(name));
        const loaded = definitions.length || (loadTools && dynamicNames.length)
          ? await loadDefinitions(definitions, dynamicNames) : {tools: []};
        if (!loadTools) selectedTools = [...loaded.tools, ...selectLlmTools(tools, names)];
        else {
          selectedTools = loaded.tools.filter(tool => tool.selectionIndex === undefined);
          const groups = new Map<number, typeof selectedTools>();
          for (const tool of loaded.tools) if (tool.selectionIndex !== undefined) {
            const group = groups.get(tool.selectionIndex) ?? [];
            group.push(tool); groups.set(tool.selectionIndex, group);
          }
          let dynamicIndex = 0;
          for (const name of names) {
            if (tools.has(name)) selectedTools.push(tools.get(name)!);
            else {
              selectedTools.push(...groups.get(dynamicIndex) ?? []);
              dynamicIndex++;
            }
          }
        }
      }
      catch (error) { throw new Error(`Error: ${error instanceof Error ? error.message : String(error)}`); }

      return selectedTools;
    };
    let selectedTools = isChat ? await loadSelectedTools() : undefined;
    const pendingChatFragments: LlmFragmentInputSource[] = [];
    const chat = isChat ? createChatInput({resolveFragments: async paths => {pendingChatFragments.push(...await prepareFragments(paths, false));}, context: {...context, signal, stdout: {write: bytes => write(bytes, true)}}, operation, write: emitText, diagnostic: text => writeDiagnostic(context.stderr, text, signal), admit: (size, materialized) => materialized ? input.materialize(size) : admitInput(size, false)}) : undefined;
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
    const admittedFragments = new WeakSet<LlmInputSource>(), bufferedFragments = new WeakSet<LlmInputSource>();
    const remoteFragments = new WeakSet<LlmInputSource>();
    const pluginAttachments: LlmAttachment[] = [], pluginSourceAttachments: LlmSourceAttachment[] = [];
    const loadFragments = async function* (paths: readonly string[], system: boolean): AsyncIterable<LlmFragmentInputSource> {
      for (const reference of paths) {
        await step();
        // The reference reads fragments after consuming ordinary prompt stdin.
        if (reference === "-") {
          if (!chat) {yield textSource(""); continue;}
          const source: LlmInputSource = {bytes: {async *[Symbol.asyncIterator]() {
            const input = chat.approvalInput();
            while (true) {const next = await input.next(); if (next.done) return; yield next.value;}
          }}, async dispose() {}};
          admittedFragments.add(source); yield source; continue;
        }
        if (reference.startsWith("http://") || reference.startsWith("https://")) {
          const fetch = context.capabilities?.fetch;
          if (!fetch) throw new Error("Fragment URL loading is not configured");
          const source = await operation.acquire(() => createLlmUrlFragmentSource({url:reference,fetch,signal,maxBytes:input.remaining(!streamed),
            admitBytes:size=>{context.inputBudget?.check(shellInputBytes+size);shellInputBytes+=size;}}),value=>value.dispose());
          remoteFragments.add(source);
          yield source;
          continue;
        }
        if (getLlmFragmentPrefix(reference) !== undefined) {
          try {
            for await (const loaded of loadLlmPluginFragments(reference,fragmentLoaders,{...loaderContext(),get maxBytes(){return input.remaining(!streamed);}},!system,templateLoaderOptions.provider)) {
              const source = await operation.acquire(()=>loaded.source,value=>value.dispose());
              if (loaded.type === "text") { yield source; continue; }
              input.admitText(loaded.mimeType);
              if (loaded.id !== undefined) input.admitText(loaded.id);
              if (!acceptsMimeType(entry!.model.attachmentTypes ?? [], loaded.mimeType)) throw new Error(`Model ${entry!.model.id} does not accept ${loaded.mimeType}`);
              const identity = loaded.id === undefined ? {} : {id:loaded.id};
              if (streamed) {
                const spool = await operation.acquire(()=>createLlmSpool(context.fs,context.cwd,signal,"input"),value=>value.close());
                for await (const bytes of sourceBytes(source.bytes,signal)) {admitInput(bytes.byteLength,false);await spool.write(bytes);}
                pluginSourceAttachments.push({mimeType:loaded.mimeType,source:{bytes:spool.replay(),dispose:spool.close},...identity});
              } else {
                const chunks:Uint8Array[]=[];let size=0;
                for await(const bytes of sourceBytes(source.bytes,signal)){admitInput(bytes.byteLength,true);chunks.push(bytes.slice());size+=bytes.byteLength;}
                const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
                pluginAttachments.push({mimeType:loaded.mimeType,bytes,...identity});
              }
            }
          } catch(error) {signal.throwIfAborted();if(error instanceof LlmPluginExit)throw error;throw new Error(`Error: ${error instanceof Error?error.message:String(error)}`);}
          continue;
        }
        const path = pathOf(context, reference);
        let source: LlmInputSource;
        try { source = await operation.acquire(() => fileSource({fs:context.fs,path,signal,maxBytes:input.remaining(!streamed)}), value=>value.dispose()); }
        catch(error) { if(error instanceof FsError && error.code === "ENOENT") throw new Error(`Error: Fragment '${reference}' not found`); throw error; }
        yield source;
      }
    };
    const admitFragment = (size: number, source: LlmInputSource) => {
      if (admittedFragments.has(source)) {if (!streamed && !bufferedFragments.has(source)) input.materialize(size);}
      else if (remoteFragments.has(source)) input.admit(size, !streamed);
      else admitInput(size, !streamed);
    };
    const prepareFragments = async (paths: readonly string[], system: boolean): Promise<LlmFragmentInputSource[]> => {
      if (!paths.length) return [];
      let hasText = false;
      const source = await operation.acquire(() => createLlmFragmentSource({fs: context.fs, directory: context.cwd, signal, system, normalizeNewlines: true,
        fragments: {async *[Symbol.asyncIterator]() {for await (const source of loadFragments(paths, system)) {hasText = true; yield source;}}},
        admitBytes: admitFragment, admitSeparator: size => input.admit(size, !streamed),
      }), value => value.dispose());
      if (!hasText) {await source.dispose(); return [];}
      const retained = {...source, normalizeNewlines: false};
      admittedFragments.add(retained); bufferedFragments.add(retained);
      return [retained];
    };
    const compose = async (paths: readonly string[], tail: LlmInputSource, system: boolean, prepared: readonly LlmFragmentInputSource[] = []): Promise<LlmInputSource> => operation.acquire(
      () => createLlmFragmentSource({fs:context.fs,directory:context.cwd,signal,fragments: {async *[Symbol.asyncIterator]() {
        yield* prepared; yield* loadFragments(paths, system);
      }},tail,system,normalizeNewlines:true,admitBytes:admitFragment,admitSeparator:size=>input.admit(size,!streamed)}),value=>value.dispose());
    const chatMessages: PromptChatMessage[] = [];
    const initialArgs = args;
    let chatTurn = 0;
    let initialPromptFragments: LlmFragmentInputSource[] = [], initialSystemFragments: LlmFragmentInputSource[] = [];
    const initialAttachments: LlmAttachment[] = [], initialSourceAttachments: LlmSourceAttachment[] = [];
    if (chat) {
      initialPromptFragments = await prepareFragments(args.fragments, false);
      initialSystemFragments = await prepareFragments(args.systemFragments, true);
      initialAttachments.push(...pluginAttachments); initialSourceAttachments.push(...pluginSourceAttachments);
      await emitText(`Chatting with ${entry!.model.id}\nType 'exit' or 'quit' to exit\nType '!multi' to enter multiple lines, then '!end' to finish\nType '!edit' to open your default editor and modify the prompt\nType '!fragment <my_fragment> [<another_fragment> ...]' to insert one or more fragments\n`);
    }
    while (true) {
      if (chat) {pluginAttachments.length = 0; pluginSourceAttachments.length = 0;}
      const chatPrompt = await chat?.next();
      const preparedPrompt = [...(chatPrompt?.includeInitialFragments ? initialPromptFragments : []), ...pendingChatFragments.splice(0)];
      const preparedSystem = chatTurn ? [] : initialSystemFragments;
      if (chat) {
        if (chatPrompt!.includeInitialFragments) {pluginAttachments.push(...initialAttachments); pluginSourceAttachments.push(...initialSourceAttachments);}
        args = {...initialArgs, options: {...initialArgs.options}, attachments: [...initialArgs.attachments],
          fragments: [], systemFragments: []};
        if (chatTurn) delete args.system;
        if (stored) {
          const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
          args.prompt = '';
          for await (const bytes of chatPrompt!.spool.replay()) {input.materialize(bytes.length); args.prompt += decoder.decode(bytes, {stream: true});}
          args.prompt += decoder.decode(); args.promptSupplied = true;
        }
      }
      let stdinIterator: AsyncIterator<Uint8Array> | undefined;
      const openStdin = async (approval = false): Promise<AsyncIterator<Uint8Array>> => approval && chat ? chat.approvalInput() : stdinIterator ??= await operation.acquire<AsyncIterator<Uint8Array>>(() => chatPrompt ? chatPrompt.spool.replay()[Symbol.asyncIterator]() : context.stdinInput
        ? {next: () => approval && context.stdinInput!.readAvailable
          ? context.stdinInput!.readAvailable(4096, signal, 10)
          : context.stdinInput!.read(approval ? 1 : Math.min(65536, input.remaining(!stagePrompt) + 1), signal)}
        : context.stdin[Symbol.asyncIterator](), async resource => {await resource.return?.();});
      let promptSpool: Awaited<ReturnType<typeof createLlmSpool>> | undefined;
      let stdinBytes = 0;
      const fragments: string[] = [];
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const templateUsesInput = stored !== undefined && llmTemplateUsesInput(stored);
      const readTerminalPrompt = !args.promptSupplied && !args.save && !args.attachments.length && !schema && !args.fragments.length;
      if (!(chat && stored) && (stored === undefined || templateUsesInput) && (chat || !context.shellPredicates?.terminal(0) || readTerminalPrompt)) {
        const stdin = await openStdin();
        while (true) {
          await step();
          const result = await interrupted(() => stdin.next(), signal);
          signal.throwIfAborted();
          if (result.done) break;
          const chunk = result.value;
          if (!(chunk instanceof Uint8Array)) throw new TypeError("Byte sources must yield Uint8Array chunks");
          if (!chat) admitInput(chunk.byteLength, !stagePrompt);
          else if (!stagePrompt) input.materialize(chunk.byteLength);
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
      if (stdinBytes && args.prompt) input.admit(1, !stagePrompt);
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
          ...(schema === undefined ? {} : { schema_object: schema }),
          ...(args.model === undefined ? {} : { model: entry!.model.id }),
          ...(prompt ? { prompt } : {}), ...(args.system === undefined ? {} : { system: args.system }),
          ...(args.extract === "last" ? { extract_last: true } : args.extract === "first" ? { extract: true } : {}),
          ...(Object.keys(args.params).length ? { defaults: args.params } : {}),
          ...(Object.keys(args.options).length ? { options: args.options } : {}),
          ...(args.functions.length ? { functions: args.functions.join("\n\n") } : {}),
          ...(args.toolNames.length ? { tools: args.toolNames } : {}),
          ...(args.fragments.length ? { fragments: args.fragments } : {}),
          ...(args.systemFragments.length ? { system_fragments: args.systemFragments } : {}),
          ...(attachments.length ? { attachments } : {}),
          ...(attachmentTypes.length ? { attachment_types: attachmentTypes } : {}),
        };
        await templateStore.save(args.save, saved); return { exitCode: 0 };
      }
      if (stored) {
        try {
          if (!chat && !args.extract && (stored.extract_last || stored.extract)) {
            args.extract = stored.extract_last ? "last" : "first";
            args.noStream = true;
          }
          const evaluated = evaluateLlmTemplate(stored, templateUsesInput ? prompt : "", args.params, input.admitText);
          if (evaluated.prompt && !templateUsesInput && args.prompt) input.admit(1, true);
          if (evaluated.prompt) prompt = !templateUsesInput && args.prompt ? `${evaluated.prompt}\n${args.prompt}` : evaluated.prompt;
          if (args.system === undefined && evaluated.system !== undefined) args.system = evaluated.system;
        }
        catch (error) { throw new Error(`Error: ${error instanceof Error ? error.message : "Invalid template"}`); }
      }
      if (chat && (stored ? ['exit', 'quit'].includes(stripPythonWhitespace(prompt)) : chatPrompt!.exit)) return {exitCode: 0};
      if (!entry) throw new Error("No model selected; use --model or configure defaultModel");
      args.options = chat ? {...chatModelOptions!} : { ...await configuration.modelOptions(entry.model.id), ...stored?.options, ...args.options };
      args.attachments = [
        ...(chat ? [] : stored?.attachments ?? []).map(path => ({ path })),
        ...args.attachments.filter(item => item.mimeType === undefined),
        ...(chat ? [] : stored?.attachment_types ?? []).map(item => ({ path: item.value, mimeType: item.type })),
        ...args.attachments.filter(item => item.mimeType !== undefined),
      ];
      const attachments: LlmAttachment[] = [];
      const sourceAttachments: LlmSourceAttachment[] = [];
      let composedPrompt: LlmInputSource | undefined, composedSystem: LlmInputSource | undefined;
      const promptFragments = [...(chat ? [] : stored?.fragments ?? []), ...args.fragments];
      const systemFragments = [...(chat ? [] : stored?.system_fragments ?? []), ...args.systemFragments];
      const materialize = async (source: LlmInputSource): Promise<string> => {
        const decoder = new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}); let result = "";
        for await (const bytes of source.bytes) result += decoder.decode(bytes,{stream:true});
        return result + decoder.decode();
      };
      if (promptFragments.length || preparedPrompt.length) {
        composedPrompt = await compose(promptFragments,promptSpool ? {bytes:promptSpool.replay(),dispose:promptSpool.close} : textSource(prompt),false,preparedPrompt);
        if (!streamed) prompt = await materialize(composedPrompt);
      }
      if (systemFragments.length || preparedSystem.length) {
        composedSystem = await compose(systemFragments,textSource(args.system ?? ""),true,preparedSystem);
        if (!streamed) args.system = await materialize(composedSystem);
      }
      for (const attachment of args.attachments) {
        await step();
        if (attachment.path.includes("://")) {
          const reference = await resolveUrlAttachment({...context, signal}, attachment.path, attachment.mimeType);
          if (attachment.mimeType === undefined) admitInput(shellValueByteLength(reference.mimeType), true);
          if (!acceptsMimeType(entry.model.attachmentTypes ?? [], reference.mimeType)) throw new Error(`Model ${entry.model.id} does not accept ${reference.mimeType}`);
          if (acceptsMimeType(['image/*'], reference.mimeType)) {
            if (!entry.model.attachmentUrls) throw new Error(`Model ${entry.model.id} does not support URL attachments`);
            if (streamed) sourceAttachments.push(reference); else attachments.push(reference);
          } else {
            const fetch = context.capabilities?.fetch;
            if (!fetch) throw new Error('Attachment URL loading is not configured');
            const source = await operation.acquire(() => createLlmUrlSource({url:reference.url,fetch,signal,
              maxBytes:input.remaining(!streamed),admitBytes:bytes=>admitInput(bytes,!streamed)}), source=>source.dispose());
            const identity = acceptsMimeType(['application/pdf'], reference.mimeType) ? {id:await getLlmAttachmentUrlId(reference.url,signal)} : {};
            if (streamed) sourceAttachments.push({mimeType:reference.mimeType,source,...identity});
            else {
              const chunks:Uint8Array[]=[];let size=0;
              for await (const chunk of source.bytes) { chunks.push(chunk);size+=chunk.length; }
              const bytes=new Uint8Array(size);let offset=0;
              for (const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.length; }
              attachments.push({mimeType:reference.mimeType,bytes,...identity});
            }
          }
          continue;
        }
        const path = pathOf(context, attachment.path);
        const stat = await interrupted(() => context.fs.stat(path, { signal }), signal);
        context.inputBudget?.check(shellInputBytes + stat.size);
        input.check(stat.size, !streamed);
        const remainingBytes = Math.min(input.remaining(!streamed),
          (context.inputBudget?.maxBytes ?? Infinity) - shellInputBytes);
        if (streamed) {
          const source = await operation.acquire(() => fileSource({ fs: context.fs, path, signal, maxBytes: remainingBytes, expectedStat: stat }), source => source.dispose());
          const chunks = source.bytes[Symbol.asyncIterator]();
          const first = await interrupted(() => chunks.next(), signal);
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
                const next = await interrupted(() => chunks.next(), signal);
                if (closed) throw new FsError("EBADF", { message: "LLM attachment source is closed" });
                if (next.done) break;
                yield next.value;
              }
            } },
          } });
          continue;
        }
        const bytes = await interrupted(() => context.fs.readFile(path, { signal,
          ...(remainingBytes === Infinity ? {} : { maxBytes: remainingBytes }),
        }), signal);
        signal.throwIfAborted();
        if (!(bytes instanceof Uint8Array)) throw new TypeError("Attachment read must return Uint8Array");
        admitInput(bytes.byteLength, true);
        const mimeType = attachment.mimeType ?? sniffMimeType(path, bytes);
        if (!acceptsMimeType(entry.model.attachmentTypes ?? [], mimeType)) throw new Error(`Model ${entry.model.id} does not accept ${mimeType}`);
        attachments.push({ mimeType, bytes: new Uint8Array(bytes), ...(acceptsMimeType(['application/pdf'],mimeType) && !bytes.length ? {id:await attachmentBytesId(bytes,signal)} : {}) });
      }
      selectedTools ??= await loadSelectedTools();
      attachments.push(...pluginAttachments);
      sourceAttachments.push(...pluginSourceAttachments);
      const resolvedKey = args.key === undefined ? undefined : await configuration.resolveKey(args.key);
      const request: LlmRequest = {
        ...(args.async ? {async: true} : {}),
        ...(schema === undefined ? {} : { schema }),
        model: entry.model.id, prompt,
        ...(args.system === undefined ? {} : { system: args.system }), attachments, options: args.options, signal, stream: !args.noStream,
        ...(resolvedKey === undefined ? {} : { key: resolvedKey }),
      };
      signal.throwIfAborted();
      if (args.noStream) outputSpool = await operation.acquire(() => createLlmSpool(context.fs, context.cwd, signal), spool => spool.close());
      if (selectedTools.length || chat) {
        const debugOutput = args.toolsDebug ? operation.child(context.stderr).output : undefined;
        const events = promptToolChain({...(chat ? {chatMessages} : {}), context: {...context, signal}, operation, service, streamed, tools: selectedTools,
          ...(debugOutput ? {debugWrite: async (bytes: Uint8Array) => {admitOutput(bytes.length); await writeOutput(debugOutput, bytes);}} : {}),
          ...(args.toolsApprove ? {beforeCall: createToolApproval({context: {...context, signal}, openInput: () => openStdin(true), write: bytes => write(bytes, true), admitInput: chat ? () => {} : admitInput})} : {}),
          chainLimit: args.chainLimit, maxOutputBytes: limits?.maxOutputBytes ?? Infinity,
          remainingInput: () => input.remaining(!streamed), admitInput, textSource,
          request: {...(args.async ? {async: true} : {}), model: request.model, options: request.options, signal, stream: request.stream, ...(schema === undefined ? {} : {schema}), ...(resolvedKey === undefined ? {} : {key: resolvedKey}), prompt: (streamed ? composedPrompt : undefined) ?? (promptSpool ? {bytes: promptSpool.replay(), dispose: promptSpool.close} : textSource(prompt)),
            ...(streamed && composedSystem ? {system: composedSystem} : args.system === undefined ? {} : {system: textSource(args.system)}),
            attachments: streamed ? sourceAttachments : attachments.map(attachment => attachment.url === undefined
              ? {mimeType: attachment.mimeType, ...(attachment.id === undefined ? {} : {id: attachment.id}), source: {bytes: {async *[Symbol.asyncIterator]() {yield attachment.bytes;}}, async dispose() {}}}
              : attachment)
          }
        });
        iterator = (async function* () {
          try {
            for await (const event of events) {
              if (event.type === "text") yield event.text;
              else if (event.type === "bytes") yield event.data;
              else if (args.usage) {
                usageSpool ??= await operation.acquire(() => createLlmSpool(context.fs, context.cwd, signal), spool => spool.close());
                await usageSpool.write(new TextEncoder().encode("Token usage: "));
                for await (const bytes of serializeLlmTokenUsage(event.response.usage, signal)) await usageSpool.write(bytes);
                await usageSpool.write(Uint8Array.of(10));
              }
            }
          } catch (error) {signal.throwIfAborted(); if (outputFailed) throw error; throw new Error(`Error: ${error instanceof Error ? error.message : String(error)}`);}
        })()[Symbol.asyncIterator]();
      } else if (streamed) {
        const events = service.streamSources!({ ...(args.async ? {async: true} : {}), model: request.model, options: request.options, signal, stream: request.stream, prompt: composedPrompt ?? (promptSpool ? { bytes: promptSpool.replay(), dispose: promptSpool.close } : textSource(prompt)),
          ...(schema === undefined ? {} : { schema }),
          ...(composedSystem ? {system:composedSystem} : args.system === undefined ? {} : { system: textSource(args.system) }),
          ...(resolvedKey === undefined ? {} : { key: resolvedKey }),
          attachments: sourceAttachments });
        iterator = (async function* () {
          for await (const event of events) {
            if (event.type === "text") yield event.text;
            else if (event.type === "bytes") yield event.data;
            else responseUsage = event.response.usage;
          }
        })()[Symbol.asyncIterator]();
      } else iterator = service.complete(request)[Symbol.asyncIterator]();
      const text = (entry.model.outputType ?? "text/plain").toLowerCase().startsWith("text/");
      let pendingSurrogate = "";
      while (true) {
        await step();
        const result = await interrupted(() => iterator!.next(), signal);
        signal.throwIfAborted();
        if (result.done) { ended = true; if (result.value?.usage) responseUsage = result.value.usage; break; }
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
      } : undefined)) await writeOutput(operation.output, chunk);
      if (args.extract && text) await writeOutput(operation.output, Uint8Array.of(10));
      if (usageSpool) await pipeBytes(usageSpool.replay(), context.stderr, signal);
      else if (args.usage) {
        await writeDiagnostic(context.stderr, "Token usage: ", signal);
        await pipeBytes(serializeLlmTokenUsage(responseUsage, signal), context.stderr, signal);
        await writeDiagnostic(context.stderr, "\n", signal);
      }
      if (!chat) return { exitCode: 0 };
      await outputSpool?.close(); outputSpool = undefined;
      await usageSpool?.close(); usageSpool = undefined;
      await chatPrompt!.spool.close();
      ended = false; iterator = undefined; responseUsage = undefined;
      chatTurn++;
    }
  } catch (error) {
    context.signal.throwIfAborted();
    operation.signal.throwIfAborted();
    controller.abort(error);
    if (outputFailed) throw error;
    await operation.close();
    if(error instanceof LlmPluginExit)return {exitCode:error.exitCode};
    await writeDiagnostic(context.stderr, `${error instanceof Error ? error.message : "llm provider failed"}\n`, context.signal);
    return { exitCode: error instanceof LlmModelsUsageError || error instanceof LlmPromptUsageError ? 2 : 1 };
  } finally {
    try { await Promise.all([...functionSessions].map(session => session.close())); }
    finally {controller.abort(new Error("llm request closed")); await operation.close();}
  }
}

export function createLlmCommand(options: LlmCommandsOptions = {}): CommandDefinition {
  for (const [name, value] of Object.entries(options.limits ?? {})) {
    if (value === undefined || value === Infinity) continue;
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid llm limit: ${name}`);
  }
  const limits = options.limits === undefined ? undefined : Object.freeze({ ...options.limits });
  if (options.service && (options.providers !== undefined || options.defaultModel !== undefined)) throw new TypeError("Configure providers and defaultModel on the injected LLM service");
  const maxRemoteBytes = options.maxRemoteTemplateBytes ?? limits?.maxInputBytes ?? Infinity;
  const templateLoaderOptions: TemplateLoaderOptions = { maxRemoteBytes, provider:options.loaderProvider, loaders:options.templateLoaders };
  const service = options.service ?? createLlmService({ ...options, providers: options.providers ?? [] });
  const collections=options.collections;
  return { name: "llm", description: "Query injected language and media models", execute: context => execute(context, service, limits, templateLoaderOptions, collections, options.fragmentLoaders ?? new Map(), options.tools ?? new Map(), options.loadTools, options.managePackages) };
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
