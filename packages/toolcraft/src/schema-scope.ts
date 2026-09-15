import type { AnySchema } from "toolcraft-schema";

type SchemaScope = "cli" | "mcp" | "sdk";

const unfilteredSchemas = new WeakMap<AnySchema, AnySchema>();

export function filterSchemaForScope(schema: AnySchema, scope: SchemaScope): AnySchema | undefined {
  const filtered = filterScopedSchema(schema, scope);
  if (filtered !== undefined && filtered !== schema && schema.kind !== "optional") {
    unfilteredSchemas.set(filtered, unfilteredSchemas.get(schema) ?? schema);
  }
  return filtered;
}

export function getUnfilteredSchema(schema: AnySchema): AnySchema {
  return unfilteredSchemas.get(schema) ?? schema;
}

function filterScopedSchema(schema: AnySchema, scope: SchemaScope): AnySchema | undefined {
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
    case "json":
      return schema;

    case "record": {
      const value = filterSchemaForScope(schema.value, scope);
      return value === undefined ? undefined : { ...schema, value };
    }

    case "oneOf": {
      const branches = Object.fromEntries(
        Object.entries(schema.branches).flatMap(([name, branch]) => {
          const filtered = filterSchemaForScope(branch, scope);
          return filtered?.kind === "object" ? [[name, filtered]] : [];
        })
      );
      return Object.keys(branches).length === 0 && schema.nullable !== true
        ? undefined
        : { ...schema, branches };
    }

    case "union": {
      const branches = schema.branches.flatMap((branch) => {
        const filtered = filterSchemaForScope(branch, scope);
        return filtered?.kind === "object" ? [filtered] : [];
      });
      return branches.length === 0 && schema.nullable !== true
        ? undefined
        : { ...schema, branches };
    }

    case "object":
      return {
        ...schema,
        shape: Object.fromEntries(
          Object.entries(schema.shape).flatMap(([key, childSchema]) => {
            const filtered = filterSchemaForScope(childSchema, scope);
            return filtered === undefined ? [] : [[key, filtered]];
          })
        )
      };
  }
}
