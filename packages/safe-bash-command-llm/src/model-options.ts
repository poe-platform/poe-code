import { parseLlmNumericOption } from "./numeric-option.js";
import type { LlmModel, LlmOption } from "./types.js";

/** Validate and translate declared options before storage or provider execution. */
export function validateModelOptions(model: LlmModel, values: Readonly<Record<string, LlmOption>>): Record<string, LlmOption> {
  if (model.options === undefined) return { ...values };
  const result: Record<string, LlmOption> = {};
  for (const [name, input] of Object.entries(values)) {
    const fail = (message: string): never => { throw new Error(`${name}\n  ${message}`); };
    const rule = Object.hasOwn(model.options, name) ? model.options[name] : undefined;
    if (!rule) return fail("Extra inputs are not permitted");
    let value: LlmOption = input;
    if (input === null && rule.nullable) { result[name] = null; continue; }
    switch (rule.type) {
      case "number":
      case "integer": {
        const parsed = parseLlmNumericOption(input, rule.type);
        if (parsed === undefined) return fail(rule.type === "integer" ? "Input should be a valid integer, unable to parse string as an integer" : "Input should be a valid number, unable to parse string as a number");
        value = parsed;
        if (rule.type === "integer" && !Number.isSafeInteger(value)) fail("Input should be a valid integer");
        if (rule.maximum !== undefined && !(value <= rule.maximum)) fail(`Input should be less than or equal to ${rule.maximum}`);
        if (rule.minimum !== undefined && !(value >= rule.minimum)) fail(`Input should be greater than or equal to ${rule.minimum}`);
        if (!Number.isFinite(value)) fail("Input should be a valid number, unable to parse string as a number");
        break;
      }
      case "boolean": {
        const text = String(input).toLowerCase();
        if (["true", "1", "yes", "on"].includes(text)) value = true;
        else if (["false", "0", "no", "off"].includes(text)) value = false;
        else fail("Input should be a valid boolean");
        break;
      }
      case "string":
        if (typeof input !== "string") fail("Input should be a valid string");
        break;
    }
    Object.defineProperty(result, name, { value, enumerable: true, configurable: true, writable: true });
  }
  return result;
}
