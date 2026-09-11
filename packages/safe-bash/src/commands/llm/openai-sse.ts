import type { ByteSource } from "../../contracts/index.js";
import { openAiBytes, openAiError, openAiRecord } from "./openai-http.js";

async function* events(source: ByteSource, signal: AbortSignal, limit: number, responseLimit: number): AsyncIterable<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let line = "", data: string[] = [], size = 0, afterCarriageReturn = false;
  for await (const chunk of openAiBytes(source, signal, responseLimit)) {
    const text = decoder.decode(chunk, { stream: true });
    for (const character of text) {
      if (afterCarriageReturn && character === "\n") { afterCarriageReturn = false; continue; }
      afterCarriageReturn = character === "\r";
      const codePoint = character.codePointAt(0)!;
      size += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
      if (size > limit) throw new Error("OpenAI SSE event exceeds buffer limit: event byte limit exceeded");
      if (character !== "\n" && character !== "\r") {
        line += character;
        continue;
      }
      if (line === "") {
        if (data.length > 0) yield data.join("\n");
        data = [];
        size = 0;
      } else if (line === "data" || line.startsWith("data:")) {
        const value = line.slice(5);
        data.push(value.startsWith(" ") ? value.slice(1) : value);
      }
      line = "";
    }
  }
  decoder.decode();
  throw new Error("OpenAI chat stream ended before [DONE]");
}

export async function* openAiChat(source: ByteSource, signal: AbortSignal, limit = 1024 * 1024, responseLimit = 64 * 1024 * 1024): AsyncIterable<string> {
  for await (const data of events(source, signal, limit, responseLimit)) {
    signal.throwIfAborted();
    if (data.trim() === "[DONE]") return;
    let parsed: unknown;
    try { parsed = JSON.parse(data); }
    catch { throw new Error("OpenAI returned malformed SSE JSON"); }
    if (!openAiRecord(parsed)) throw new Error("OpenAI returned a non-object SSE event");
    if (parsed.error != null) throw new Error(`OpenAI: ${openAiError(parsed.error) ?? "stream failed"}`);
    if (!Array.isArray(parsed.choices)) throw new Error("OpenAI SSE event has no choices");
    for (const choice of parsed.choices) {
      signal.throwIfAborted();
      if (!openAiRecord(choice) || !openAiRecord(choice.delta)) throw new Error("OpenAI SSE event has a malformed delta");
      const content = choice.delta.content;
      if (content != null && typeof content !== "string") throw new Error("OpenAI SSE delta.content is not text");
      if (typeof content === "string" && content.length > 0) yield content;
    }
  }
}
