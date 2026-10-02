import { jsonDictionaryKeys } from "./json-dictionary.js";
import { tokenInteger } from "./token-integer.js";
import type { LlmOption } from "./types.js";

function biasInteger(value: unknown): number | undefined {
 if (typeof value === "boolean") return Number(value);
 if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : undefined;
 if (typeof value !== "string") return undefined;
 const integer = tokenInteger(value);
 return integer === undefined ? undefined : Number(integer);
}


function logitBias(input: LlmOption): Record<string, number> {
 let parsed: unknown = input;
 if (typeof input === "string") {
  try { parsed = JSON.parse(input); }
  catch { throw new TypeError("Invalid OpenAI logit_bias: Invalid JSON in logit_bias string"); }
 }
 if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Invalid OpenAI logit_bias: expected a JSON dictionary");
 const result: Record<string, number> = {};
 for (const key of typeof input === "string" ? jsonDictionaryKeys(input) : Object.keys(parsed)) {
  const value: unknown = (parsed as Record<string, unknown>)[key];
  const token = tokenInteger(key);
  const bias = biasInteger(value);
  if (token === undefined || bias === undefined || !Number.isSafeInteger(bias) || bias < -100 || bias > 100) throw new TypeError("Invalid OpenAI logit_bias: Invalid key-value pair in logit_bias dictionary");
  Object.defineProperty(result, token, { value: bias, enumerable: true, configurable: true, writable: true });
 }
 return result;
}

/** Translate the reference CLI's JSON mode and dictionary or JSON-string token bias options. */
export function openAiChatOptions(options: Record<string, LlmOption>): Record<string, unknown> {
 const { json_object: jsonObject, logit_bias: bias, ...values } = options;
 const result: Record<string, unknown> = { ...values };
 if (bias !== undefined && bias !== null) result.logit_bias = logitBias(bias);
 if (jsonObject !== undefined && jsonObject !== null) {
  if (typeof jsonObject === "object") throw new TypeError("Invalid OpenAI json_object: expected boolean");
  const text = String(jsonObject).toLowerCase();
  if (!["true", "false", "1", "0", "yes", "no", "on", "off", "y", "n", "t", "f"].includes(text)) throw new TypeError("Invalid OpenAI json_object: expected boolean");
  if (["true", "1", "yes", "on", "y", "t"].includes(text)) {
   if (Object.hasOwn(values, "response_format")) throw new TypeError("OpenAI json_object conflicts with response_format");
   result.response_format = { type: "json_object" };
  }
 }
 return result;
}
