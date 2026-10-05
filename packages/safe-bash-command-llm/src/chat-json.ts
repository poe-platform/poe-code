import {openAiTools} from "./openai-tools.js";
import { validateAttachmentUrl } from "./url-attachment.js";
import { openAiAttachmentKind } from './openai-attachment.js';
import { pdfJson } from './pdf-json.js';
import { requestAttachments } from "./request-attachments.js";
import { jsonString } from "./json-string.js";
import { base64Stream } from "./base64-stream.js";
import { jsonValue } from "./json-value.js";
import type { LlmSourceRequest } from "./types.js";
/** Sources are borrowed; the caller owns their leases and provider admission. */
export type OpenAiChatSourceRequest = Omit<LlmSourceRequest, "options"> & {
  readonly options: Readonly<Record<string, unknown>>;
};

/** Encode admitted OpenAI-compatible controls and UTF-8/binary sources into a
 * backpressured HTTP body. Does not dispose leases or translate model options.
 * Keep request metadata stable until consumption finishes. maxBytes includes
 * JSON escaping and base64; Infinity explicitly opts out of wire accounting. */
export function chatJson(request: OpenAiChatSourceRequest, limit: number): AsyncIterable<Uint8Array> {
  request.signal.throwIfAborted();
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) throw new RangeError("Invalid provider request byte limit");
  for (const field of ["model", "messages", "stream", "stream_options", "tools"]) if (Object.hasOwn(request.options, field)) throw new TypeError(`${field} is controlled by the provider`);
  if (request.schema && Object.hasOwn(request.options, "response_format")) throw new TypeError("schema conflicts with response_format");
  for (const attachment of requestAttachments(request)) {
    const kind = openAiAttachmentKind(attachment.mimeType);
    if (attachment.id !== undefined && typeof attachment.id !== 'string') throw new TypeError('Invalid attachment id');
    if (attachment.url !== undefined && kind !== 'image') throw new TypeError('Non-image URL attachments require an input source');
  }
  const controls = jsonValue({ ...request.options, ...openAiTools(request.tools), ...(request.stream !== false ? { stream_options: { include_usage: true } } : {}), ...(request.schema ? { response_format: { type: "json_schema", json_schema: { name: "response", schema: request.schema } } } : {}), model: request.model }, request.signal);
  const encoder = new TextEncoder();
  async function* body(): AsyncIterable<Uint8Array> {
    const text = (value: string) => encoder.encode(value);
    let pending: Uint8Array | undefined;
    for await (const chunk of controls) {
      if (pending) yield pending;
      pending = chunk;
    }
    // The final object delimiter is replaced by the streamed message fields.
    yield text(',"messages":[');
    let first = true;
    for (const message of [...(request.system === undefined ? [] : [{ role: "system", content: request.system, attachments: [] }]), ...(request.messages ?? []), { role: "user", content: request.prompt, attachments: request.attachments }]) {
      request.signal.throwIfAborted();
      yield text((first ? "" : ",") + '{"role":' + JSON.stringify(message.role) + ',"content":');
      first = false;
      const attachments = message.attachments ?? [];
      if (attachments.length) yield text('[{"type":"text","text":');
      yield* jsonString(message.content.bytes, request.signal);
      if (attachments.length) {
        yield text("}");
        for (const attachment of attachments) {
          request.signal.throwIfAborted();
          const kind = openAiAttachmentKind(attachment.mimeType);
          if (kind === 'pdf' && attachment.source !== undefined) {
            yield text(',');
            yield* pdfJson(attachment.source, attachment.id, request.signal);
            continue;
          }
          if (attachment.url !== undefined) {
            validateAttachmentUrl(attachment.url);
            yield text(',{"type":"image_url","image_url":{"url":');
            yield* jsonValue(attachment.url, request.signal);
            yield text('}}');
            continue;
          }
          yield text(kind === 'image'
            ? ',{"type":"image_url","image_url":{"url":' + JSON.stringify(`data:${attachment.mimeType};base64,`).slice(0, -1)
            : ',{"type":"input_audio","input_audio":{"data":"');
          for await (const part of base64Stream(attachment.source.bytes, request.signal)) yield text(part);
          yield text(kind === 'image' ? '"}}' : `","format":"${kind}"}}`);
        }
        yield text("]");
      }
      yield text("}");
    }
    request.signal.throwIfAborted();
    yield text(`],"stream":${request.stream !== false}}`);
  }
  async function* limited(): AsyncIterable<Uint8Array> {
    let size = 0;
    for await (const chunk of body()) {
      request.signal.throwIfAborted();
      size += chunk.byteLength;
      if (size > limit) throw new RangeError("Provider request byte limit exceeded");
      yield chunk;
    }
  }
  return limited();
}
