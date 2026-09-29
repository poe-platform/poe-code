import { jsonString } from "./json-string.js";
import { base64Stream } from "./base64-stream.js";
import { acceptsMimeType } from "./mime.js";
import type { LlmSourceRequest } from "./types.js";
/** Admit provider-owned control fields before opening the streamed HTTP body. */
export function chatJson(request: LlmSourceRequest, limit: number): AsyncIterable<Uint8Array> {
  request.signal.throwIfAborted();
  for (const field of ["model", "messages", "stream"]) if (Object.hasOwn(request.options, field)) throw new TypeError(`${field} is controlled by the provider`);
  if (request.schema && Object.hasOwn(request.options, "response_format")) throw new TypeError("schema conflicts with response_format");
  for (const attachment of request.attachments) if (!acceptsMimeType(["image/*"], attachment.mimeType)) throw new TypeError("Only image attachments are supported");
  const controls = JSON.stringify({ ...request.options, ...(request.schema ? { response_format: { type: "json_schema", json_schema: { name: "response", schema: request.schema } } } : {}), model: request.model });
  const encoder = new TextEncoder();
  async function* body(): AsyncIterable<Uint8Array> {
    const text = (value: string) => encoder.encode(value);
    yield text(controls.slice(0, -1) + ',"messages":[');
    let first = true;
    for (const message of [...(request.system === undefined ? [] : [{ role: "system", content: request.system }]), ...(request.messages ?? [])]) {
      request.signal.throwIfAborted();
      yield text((first ? "" : ",") + '{"role":' + JSON.stringify(message.role) + ',"content":');
      first = false;
      yield* jsonString(message.content.bytes, request.signal);
      yield text("}");
    }
    yield text((first ? "" : ",") + '{"role":"user","content":');
    if (request.attachments.length) yield text('[{"type":"text","text":');
    yield* jsonString(request.prompt.bytes, request.signal);
    if (request.attachments.length) {
      yield text("}");
      for (const attachment of request.attachments) {
        request.signal.throwIfAborted();
        yield text(',{"type":"image_url","image_url":{"url":' + JSON.stringify(`data:${attachment.mimeType};base64,`).slice(0, -1));
        for await (const part of base64Stream(attachment.source.bytes, request.signal)) yield text(part);
        yield text('"}}');
      }
      yield text("]");
    }
    request.signal.throwIfAborted();
    yield text('}],"stream":true}');
  }
  async function* limited(): AsyncIterable<Uint8Array> {
    let size = 0;
    for await (const chunk of body()) {
      size += chunk.byteLength;
      if (size > limit) throw new RangeError("Provider request byte limit exceeded");
      yield chunk;
    }
  }
  return limited();
}
