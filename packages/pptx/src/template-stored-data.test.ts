import { describe, expect, it } from "vitest";
import { validateTemplateBindings } from "./template-bindings.js";

describe("template stored data validation", () => {
  it.each(["name", "kind", "scope", "slide", "cardinality", "bytes", "contentType"])(
    "rejects a missing own %s without reading an inherited accessor",
    (field) => {
      const image: Record<string, unknown> = { bytes: [1], contentType: "image/gif" };
      const binding: Record<string, unknown> = {
        name: "badge",
        kind: "image",
        scope: "slides",
        slide: 1,
        cardinality: "one",
        image
      };
      const owner = field === "bytes" || field === "contentType" ? image : binding;
      const value = owner[field];
      delete owner[field];
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, field);
      let reads = 0;
      let error: unknown;
      try {
        Object.defineProperty(Object.prototype, field, {
          configurable: true,
          get() {
            reads++;
            return value;
          }
        });
        try {
          validateTemplateBindings([binding]);
        } catch (caught) {
          error = caught;
        }
      } finally {
        if (previous) Object.defineProperty(Object.prototype, field, previous);
        else Reflect.deleteProperty(Object.prototype, field);
      }
      expect(error).toMatchObject({ code: "invalid-value" });
      expect(reads).toBe(0);
    }
  );
});
