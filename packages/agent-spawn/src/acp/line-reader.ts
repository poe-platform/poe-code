import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

function chunkToString(chunk: unknown, decoder: StringDecoder): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof Uint8Array) return decoder.write(Buffer.from(chunk));
  return String(chunk);
}

export async function* readLines(stream: Readable): AsyncGenerator<string> {
  let buffer = "";
  const decoder = new StringDecoder("utf8");

  for await (const chunk of stream as AsyncIterable<unknown>) {
    buffer += chunkToString(chunk, decoder);

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      yield buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
    }
  }

  buffer += decoder.end();

  if (buffer.length > 0) {
    yield buffer;
  }
}
