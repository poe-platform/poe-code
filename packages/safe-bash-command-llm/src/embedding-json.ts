import { jsonString } from './json-string.js';
import { jsonValue } from './json-value.js';
import type { LlmEmbeddingRequest, LlmEmbeddingSourceRequest } from './types.js';

/** Borrow input sources without buffering; account for the escaped wire body. */
export async function* embeddingJson(request: LlmEmbeddingRequest | LlmEmbeddingSourceRequest, options: Readonly<Record<string, unknown>>, limit: number): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  async function* body(): AsyncIterable<Uint8Array> {
    yield encoder.encode('{"model":');
    yield* jsonValue(request.model, request.signal);
    yield encoder.encode(',"input":[');
    let first = true;
    for (const input of request.inputs) {
      if (!first) yield encoder.encode(',');
      first = false;
      if (typeof input === 'string') yield* jsonValue(input, request.signal);
      else yield* jsonString(input.bytes, request.signal);
    }
    yield encoder.encode(']');
    for (const [key, value] of Object.entries(options)) {
      yield encoder.encode(',');
      yield* jsonValue(key, request.signal);
      yield encoder.encode(':');
      yield* jsonValue(value, request.signal);
    }
    yield encoder.encode('}');
  }
  let size = 0;
  for await (const chunk of body()) {
    request.signal.throwIfAborted();
    size += chunk.byteLength;
    if (size > limit) throw new RangeError('Provider request byte limit exceeded');
    yield chunk;
  }
}
