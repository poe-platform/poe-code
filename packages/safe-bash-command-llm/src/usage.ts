import { referenceJson } from "./reference-json.js";

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
  yield* referenceJson(details, signal);
}
