import type { CommandContext, OutputOperation } from "safe-bash-contracts";
import type { LlmService, LlmServiceSourceRequest, LlmStreamEvent } from "./service.js";
import type { LlmInputSource, LlmMessage, LlmSourceAttachment, LlmToolCall } from "./types.js";
import type { LlmExecutableTool } from "./tool-execution.js";
import { streamLlmToolChain } from "./tool-chain.js";
import { createLlmSpool } from "./retained-spool.js";
import { sourceBytes } from "./request-source.js";
import { jsonValue } from "./json-value.js";

/** Command-local request context, destroyed with its output operation. This is
 * not saved conversation state: no identifiers, lookup, logging or reuse across
 * invocations. The shared service and chain executor remain stateless. */
export async function* promptToolChain(options: {
  context: CommandContext;
  operation: OutputOperation;
  service: LlmService;
  request: Omit<LlmServiceSourceRequest, "messages">;
  streamed: boolean;
  tools: readonly LlmExecutableTool[];
  chainLimit: number;
  maxOutputBytes: number;
  remainingInput(): number;
  admitInput(size: number, materialized: boolean): void;
  textSource(value: string): LlmInputSource;
}): AsyncGenerator<LlmStreamEvent> {
  const {context, operation, request, service, tools, streamed, textSource} = options;
  const signal = request.signal;
  type Spool = Awaited<ReturnType<typeof createLlmSpool>>;
  type Content = {spool: Spool; size: number};
  type Attachment = Omit<LlmSourceAttachment, "source"> & {content?: Content};
  type Message = Omit<LlmMessage, "content" | "attachments"> & {content: Content};
  const create = () => operation.acquire(() => createLlmSpool(context.fs, context.cwd, signal, "input"), spool => spool.close());
  const retain = async (source: LlmInputSource, admit: boolean, text: boolean): Promise<Content> => {
    const spool = await create(); let size = 0;
    const decoder = text ? new TextDecoder("utf-8", {fatal: true}) : undefined;
    try {
      for await (const bytes of sourceBytes(source.bytes, signal)) {
        if (admit) options.admitInput(bytes.length, !streamed);
        decoder?.decode(bytes, {stream: true});
        await spool.write(bytes); size += bytes.length;
      }
      decoder?.decode();
      return {spool, size};
    } finally { await source.dispose(); }
  };
  const retainAttachments = async (attachments: readonly LlmSourceAttachment[], admit: boolean): Promise<Attachment[]> => {
    const result: Attachment[] = [];
    for (const attachment of attachments) {
      const identity = {mimeType: attachment.mimeType, ...(attachment.id === undefined ? {} : {id: attachment.id})};
      if (admit) {
        for await (const bytes of jsonValue({...identity, ...(attachment.url === undefined ? {} : {url: attachment.url})}, signal)) options.admitInput(bytes.length, true);
      }
      result.push(attachment.source ? {...identity, content: await retain(attachment.source, admit, false)} : {...identity, url: attachment.url!});
    }
    return result;
  };
  // Provider disposal retires each reader independently. The enclosing command
  // owns backing-file cleanup, including failures before service admission.
  const lease = (content: Content, activeSignal: AbortSignal): Promise<LlmInputSource> => operation.acquire(() => content.spool.lease(activeSignal), source => source.dispose());
  const sourceAttachments = (attachments: Attachment[], activeSignal: AbortSignal): Promise<LlmSourceAttachment[]> => Promise.all(attachments.map(async attachment => attachment.content
    ? {mimeType: attachment.mimeType, ...(attachment.id === undefined ? {} : {id: attachment.id}), source: await lease(attachment.content, activeSignal)}
    : {mimeType: attachment.mimeType, ...(attachment.id === undefined ? {} : {id: attachment.id}), url: attachment.url!}));
  const materialize = async (content: Content): Promise<string> => {
    let value = ""; const decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});
    for await (const bytes of content.spool.replay()) value += decoder.decode(bytes, {stream: true});
    return value + decoder.decode();
  };
  const bufferedAttachments = async (attachments: Attachment[]) => Promise.all(attachments.map(async attachment => {
    const identity = {mimeType: attachment.mimeType, ...(attachment.id === undefined ? {} : {id: attachment.id})};
    if (!attachment.content) return {...identity, url: attachment.url!};
    const bytes = new Uint8Array(attachment.content.size); let offset = 0;
    for await (const chunk of attachment.content.spool.replay()) {bytes.set(chunk, offset); offset += chunk.length;}
    return {...identity, bytes};
  }));
  const declarations = tools.map(({name, description, inputSchema}) => ({name, ...(description === undefined ? {} : {description}), inputSchema}));
  for await (const bytes of jsonValue(declarations, signal)) options.admitInput(bytes.length, true);
  const prompt = await retain(request.prompt, false, true);
  const system = request.system === undefined ? undefined : await retain(request.system, false, true);
  const initialAttachments = await retainAttachments(request.attachments, false);
  const empty = await retain(textSource(""), false, true);
  const messages: Message[] = [];
  let currentPrompt = prompt, currentAttachments = initialAttachments, currentSystem = system;
  let responseContent: Content | undefined, responseCalls: readonly LlmToolCall[] = [], prepared = false;
  let nextAttachments: Attachment[] = [];
  yield* streamLlmToolChain({
    context: {...context, signal}, tools, chainLimit: options.chainLimit,
    maxOutputBytes: options.maxOutputBytes, maxToolOutputBytes: options.remainingInput(),
    openResponse(index, activeSignal) {
      return (async function* () {
        if (index) {currentPrompt = empty; currentSystem = undefined; currentAttachments = nextAttachments; nextAttachments = [];}
        prepared = false;
        const base = {maxOutputBytes: options.maxOutputBytes, ...(request.model === undefined ? {} : {model: request.model}), options: request.options, signal: activeSignal, stream: request.stream,
          ...(request.key === undefined ? {} : {key: request.key}), tools: declarations,
          ...(!index && request.schema !== undefined ? {schema: request.schema} : {})};
        const events = streamed ? service.streamSources!({...base, prompt: await lease(currentPrompt, activeSignal),
          ...(currentSystem ? {system: await lease(currentSystem, activeSignal)} : {}), attachments: await sourceAttachments(currentAttachments, activeSignal),
          messages: await Promise.all(messages.map(async message => ({...message, content: await lease(message.content, activeSignal)})))
        }) : service.stream({...base, prompt: await materialize(currentPrompt),
          ...(currentSystem ? {system: await materialize(currentSystem)} : {}), attachments: await bufferedAttachments(currentAttachments),
          messages: await Promise.all(messages.map(async message => ({...message, content: await materialize(message.content)})))
        });
        responseContent = {spool: await create(), size: 0};
        let surrogate = "";
        const append = async (text: string): Promise<void> => {
          for await (const bytes of textSource(text).bytes) {await responseContent!.spool.write(bytes); responseContent!.size += bytes.length;}
        };
        for await (const event of events) {
          if (event.type === "text") {
            let text = surrogate + event.text;
            const last = text.charCodeAt(text.length - 1);
            surrogate = last >= 0xd800 && last <= 0xdbff ? text.slice(-1) : "";
            if (surrogate) text = text.slice(0, -1);
            await append(text);
          } else if (event.type === "bytes") {await responseContent.spool.write(event.data); responseContent.size += event.data.length;}
          else {if (surrogate) await append(surrogate); responseCalls = event.response.toolCalls ?? [];}
          yield event;
        }
      })();
    },
    async beforeCall() {
      if (prepared) return;
      prepared = true;
      options.admitInput(responseContent!.size, !streamed);
      for await (const bytes of jsonValue(responseCalls, signal)) options.admitInput(bytes.length, true);
      if (currentSystem?.size) messages.push({role: "system", content: currentSystem});
      // Pinned live chains do not replay prompt attachments from prior rounds.
      // Assistant text and calls are distinct messages in the reference wire.
      if (currentPrompt.size) messages.push({role: "user", content: currentPrompt});
      if (responseContent!.size) messages.push({role: "assistant", content: responseContent!});
      messages.push({role: "assistant", content: empty, toolCalls: responseCalls});
    },
    async visit(result) {
      messages.push({role: "tool", ...(result.call.id === undefined ? {} : {toolCallId: result.call.id}), content: await retain(result.output, true, true)});
      nextAttachments.push(...await retainAttachments(result.attachments, true));
    }
  });
}
