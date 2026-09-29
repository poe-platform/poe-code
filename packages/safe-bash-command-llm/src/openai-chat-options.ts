import { parseLlmNumericOption } from "./numeric-option.js";
import type { LlmOption } from "./types.js";

function biasInteger(value: unknown): number | undefined {
 if (typeof value === "boolean") return Number(value);
 if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : undefined;
 if (typeof value !== "string" || value.includes(".")) return undefined;
 return parseLlmNumericOption(value, "integer");
}

function logitBias(input: LlmOption): Record<string, number> {
 if (typeof input !== "string") throw new TypeError("Invalid OpenAI logit_bias: expected a JSON dictionary");
 let parsed: unknown;
 try { parsed = JSON.parse(input); }
 catch { throw new TypeError("Invalid OpenAI logit_bias: Invalid JSON in logit_bias string"); }
 if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Invalid OpenAI logit_bias: expected a JSON dictionary");
 const result: Record<string, number> = {};
 for (const [key, value] of Object.entries(parsed)) {
  const token = biasInteger(key), bias = biasInteger(value);
  if (token === undefined || !Number.isSafeInteger(token) || bias === undefined || !Number.isSafeInteger(bias) || bias < -100 || bias > 100) throw new TypeError("Invalid OpenAI logit_bias: Invalid key-value pair in logit_bias dictionary");
  Object.defineProperty(result, String(token), { value: bias, enumerable: true, configurable: true, writable: true });
 }
 return result;
}

/** Translate the reference CLI's JSON mode and JSON-string token bias options. */
export function openAiChatOptions(options: Record<string, LlmOption>): Record<string, unknown> {
 const { json_object: jsonObject, logit_bias: bias, ...values } = options;
 const result: Record<string, unknown> = { ...values };
 if (bias !== undefined && bias !== null) result.logit_bias = logitBias(bias);
 if (jsonObject !== undefined && jsonObject !== null) {
  const text = String(jsonObject).toLowerCase();
  if (!["true", "false", "1", "0", "yes", "no", "on", "off", "y", "n", "t", "f"].includes(text)) throw new TypeError("Invalid OpenAI json_object: expected boolean");
  if (["true", "1", "yes", "on", "y", "t"].includes(text)) {
   if (Object.hasOwn(values, "response_format")) throw new TypeError("OpenAI json_object conflicts with response_format");
   result.response_format = { type: "json_object" };
  }
 }
 return result;
}
