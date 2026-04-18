import type { AnySchema } from "@poe-code/cmdkit-schema";

type SchemaScope = "cli" | "mcp" | "sdk";

export function filterSchemaForScope(schema: AnySchema, scope: SchemaScope): AnySchema | undefined {
  if (schema.scope !== undefined && !schema.scope.includes(scope)) {
    return undefined;
  }

  switch (schema.kind) {
    case "optional": {
      const inner = filterSchemaForScope(schema.inner, scope);

      if (inner === undefined) {
        return undefined;
      }

      if (inner.requiredScopes?.includes(scope)) {
        return inner;
      }

      return { ...schema, inner };
    }

    case "array": {
      const item = filterSchemaForScope(schema.item, scope);
      return item === undefined ? undefined : { ...schema, item };
    }

    case "string":
    case "number":
    case "boolean":
    case "enum":
      return schema;

    case "object":
      return {
        ...schema,
        shape: Object.fromEntries(
          Object.entries(schema.shape).flatMap(([key, childSchema]) => {
            const filtered = filterSchemaForScope(childSchema, scope);
            return filtered === undefined ? [] : [[key, filtered]];
          })
        ),
      };
  }
}
