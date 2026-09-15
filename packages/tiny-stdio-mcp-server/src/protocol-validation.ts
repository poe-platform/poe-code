import { compileJsonSchema, type CompiledJsonSchema } from "toolcraft-schema";
import { inputRequestSchema } from "./input-request-schema.js";
import { isJsonValue } from "./json-value.js";

const validators = new Map<string, CompiledJsonSchema>();

export function validateProtocolValue(
  definition: "InputRequest" | "InputResponses" | "ClientCapabilities" | "ElicitResult" | "CreateMessageResult" | "ListRootsResult",
  value: unknown
): boolean {
  if (!isJsonValue(value)) return false;
  let validator = validators.get(definition);
  if (validator === undefined) {
    validator = compileJsonSchema({ ...inputRequestSchema, $ref: `#/$defs/${definition}` });
    validators.set(definition, validator);
  }
  return validator.validate(value).ok;
}
