import { jsonValue } from "./json-value.js";

/** Stream canonical usage using LLM 0.27.1's token_usage() formatting. */
export async function* serializeLlmTokenUsage(usage: Readonly<Record<string, unknown>> | undefined, signal: AbortSignal): AsyncIterable<Uint8Array> {
  signal.throwIfAborted();
  const encoder = new TextEncoder();
  let separator = "";
  for (const name of ["input", "output"] as const) {
    const value = usage?.[name];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`Invalid LLM ${name} token count`);
    yield encoder.encode(`${separator}${value.toLocaleString("en-US", { maximumFractionDigits: 20 })} ${name}`);
    separator = ", ";
  }
  const details = usage?.details;
  if (!details || typeof details !== "object") return;
  let nonempty = false;
  for (const key in details) if (Object.hasOwn(details, key)) { nonempty = true; break; }
  if (!nonempty) return;
  yield encoder.encode(separator);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let formatted = "", quoted = false, escaped = false;
  for await (const bytes of jsonValue(details, signal)) {
    const json = decoder.decode(bytes, { stream: true });
    for (let index = 0; index < json.length; index++) {
      const character = json[index]!;
      const code = json.charCodeAt(index);
      if (code >= 127) formatted += "\\u" + code.toString(16).padStart(4, "0");
      else {
        formatted += character;
        if (!quoted && (character === "," || character === ":")) formatted += " ";
      }
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = !quoted;
      if (formatted.length >= 4096) { signal.throwIfAborted(); yield encoder.encode(formatted); formatted = ""; }
    }
  }
  decoder.decode();
  signal.throwIfAborted();
  if (formatted) yield encoder.encode(formatted);
}
