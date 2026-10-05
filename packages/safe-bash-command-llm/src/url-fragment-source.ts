import { pythonFileCodepages } from "safe-bash-csv-engine/python-file-codepages";
import { pythonSingleByteCodepages } from "safe-bash-csv-engine/python-codepages";
import { normalizeEncoding, pythonCodecAliases } from "safe-bash-csv-engine/python-codec-aliases";
import { createLlmUrlSource, type LlmUrlSourceOptions } from "./url-source.js";
import type { LlmFragmentInputSource } from "./fragments.js";

function charset(header: string | null): string {
  // Parameter boundaries must respect quoted semicolons and quoted-pairs.
  const parameters: string[] = [];
  let part = "",
    quoted = false,
    escaped = false;
  for (const character of header ?? "") {
    if (escaped) {
      part += character;
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character === ";" && !quoted) {
      parameters.push(part);
      part = "";
    } else part += character;
  }
  parameters.push(part);
  for (const parameter of parameters.slice(1)) {
    const equals = parameter.indexOf("=");
    if (equals >= 0 && parameter.slice(0, equals).trim().toLowerCase() === "charset")
      return parameter.slice(equals + 1).trim();
  }
  return "utf-8";
}

interface Decoder {
  decode(bytes?: Uint8Array, options?: { stream?: boolean }): string;
}
function responseDecoder(header: string | null): Decoder {
  const name = charset(header),
    encoding = pythonCodecAliases[normalizeEncoding(name)] ?? "utf-8";
  const table = pythonSingleByteCodepages[encoding] ?? pythonFileCodepages[encoding];
  if (table)
    return {
      decode(bytes) {
        let result = "";
        for (const byte of bytes ?? []) {
          const code = table[byte]!;
          result += String.fromCodePoint(code < 0 ? 0xfffd : code);
        }
        return result;
      }
    };
  if (encoding !== "utf-8" && encoding !== "utf-8-sig")
    throw new Error(`Unsupported URL fragment charset: ${name}`);
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  if (encoding === "utf-8") return decoder;
  const signature = Uint8Array.of(239, 187, 191);
  let offset = 0,
    decided = false;
  return {
    decode(bytes = new Uint8Array(), options) {
      let index = 0,
        prefix = "";
      while (!decided && index < bytes.length) {
        if (bytes[index] !== signature[offset]) {
          decided = true;
          prefix = decoder.decode(signature.subarray(0, offset), { stream: true });
          break;
        }
        index++;
        offset++;
        if (offset === 3) decided = true;
      }
      return decided ? prefix + decoder.decode(bytes.subarray(index), options) : "";
    }
  };
}

/** HTTPX-compatible UTF-8/single-byte text, acquired only through caller fetch.
 * Redirects are limited to three, raw bytes are admitted before decoding, and
 * emitted UTF-8 chunks remain bounded. Other declared codecs fail explicitly. */
export function createLlmUrlFragmentSource(
  options: Omit<LlmUrlSourceOptions, "maxRedirects">
): LlmFragmentInputSource {
  let decoder: Decoder | undefined,
    contentType: string | null = null;
  const raw = createLlmUrlSource({
    ...options,
    maxRedirects: 3,
    fetch: async (input, init) => {
      const response = await options.fetch(input, init);
      contentType = response.headers.get("content-type");
      return response;
    }
  });
  return {
    normalizeNewlines: false,
    dispose: raw.dispose,
    bytes: {
      async *[Symbol.asyncIterator]() {
        const encoder = new TextEncoder();
        try {
          for await (const bytes of raw.bytes) {
            if (!bytes.length) continue;
            decoder ??= responseDecoder(contentType);
            const text = decoder.decode(bytes, { stream: true });
            if (text) yield encoder.encode(text);
          }
          options.signal.throwIfAborted();
          const tail = decoder?.decode();
          if (tail) yield encoder.encode(tail);
        } finally {
          await raw.dispose();
        }
      }
    }
  };
}
