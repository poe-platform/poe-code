import { jsonValue } from "./json-value.js";

/** Stream JSON with the pinned reference's ASCII escaping and separator spaces.
 * Values use the shared finite-JSON control domain, including JS numeric values. */
export async function* referenceJson(
  value: unknown,
  signal: AbortSignal,
  pretty = false
): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let formatted = "",
    quoted = false,
    escaped = false,
    depth = 0,
    opening = false;
  for await (const bytes of jsonValue(value, signal)) {
    const json = decoder.decode(bytes, { stream: true });
    for (let index = 0; index < json.length; index++) {
      const character = json[index]!;
      const code = json.charCodeAt(index);
      if (pretty && !quoted) {
        const closing = character === "}" || character === "]";
        if (opening && !closing) formatted += "\n" + "  ".repeat(depth);
        const empty = opening && closing;
        opening = false;
        if (closing) {
          depth--;
          if (!empty) formatted += "\n" + "  ".repeat(depth);
        }
        if (character === "{" || character === "[") {
          depth++;
          opening = true;
        }
      }
      if (code >= 127) formatted += "\\u" + code.toString(16).padStart(4, "0");
      else {
        formatted += character;
        if (!quoted && (character === "," || character === ":"))
          formatted += pretty && character === "," ? "\n" + "  ".repeat(depth) : " ";
      }
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = !quoted;
      while (formatted.length >= 4096) {
        signal.throwIfAborted();
        yield encoder.encode(formatted.slice(0, 4096));
        formatted = formatted.slice(4096);
      }
    }
  }
  decoder.decode();
  signal.throwIfAborted();
  if (formatted) yield encoder.encode(formatted);
}
