import { expect, it } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { metadataSchemas } from "./metadata-schema.js";

it.each(["sanitize", "properties.set", "properties.remove", "tags.add", "tags.set", "tags.remove"])(
  "%s admits positive affected counts and rejects invalid counts",
  (operation) => {
    const schema = compileJsonSchema(metadataSchemas[operation]!.result.properties.affected);
    expect(schema.validate(1).ok).toBe(true);
    expect(schema.validate(0).ok).toBe(true);
    expect(schema.validate(-1).ok).toBe(false);
    expect(schema.validate(0.5).ok).toBe(false);
  }
);
