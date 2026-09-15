import type { AnySchema } from "toolcraft-schema";
import { UserError } from "./user-error.js";

export function validateCasedSchemaMembers(
  schema: AnySchema,
  formatMember: (key: string) => string,
  surface: "SDK member" | "MCP field",
  discriminator?: string
): void {
  switch (schema.kind) {
    case "optional":
      validateCasedSchemaMembers(schema.inner, formatMember, surface, discriminator);
      return;
    case "array":
      validateCasedSchemaMembers(schema.item, formatMember, surface);
      return;
    case "record":
      validateCasedSchemaMembers(schema.value, formatMember, surface);
      return;
    case "union":
      for (const branch of schema.branches) {
        validateCasedSchemaMembers(branch, formatMember, surface);
      }
      return;
    case "oneOf":
      for (const branch of Object.values(schema.branches)) {
        validateCasedSchemaMembers(branch, formatMember, surface, schema.discriminator);
      }
      return;
    case "object": {
      const sourceKeysByMember = new Map<string, string>();
      if (discriminator !== undefined) {
        sourceKeysByMember.set(formatMember(discriminator), discriminator);
      }
      for (const [key, child] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
        const member = formatMember(key);
        const existingKey = sourceKeysByMember.get(member);
        if (existingKey !== undefined) {
          throw new UserError(
            `Parameters "${existingKey}" and "${key}" use conflicting ${surface} "${member}".`
          );
        }
        sourceKeysByMember.set(member, key);
        validateCasedSchemaMembers(child, formatMember, surface);
      }
    }
  }
}
