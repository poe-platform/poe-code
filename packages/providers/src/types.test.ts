import { describe, expect, expectTypeOf, it } from "vitest";
import type { ApiShapeBinding, ApiShapeId, AuthProvider } from "./index.js";
import { defineProvider } from "./types.js";

describe("provider types", () => {
  it("re-exports the canonical api shape ids", () => {
    expectTypeOf<ApiShapeId>().toEqualTypeOf<
      | "openai-chat-completions"
      | "openai-responses"
      | "anthropic-messages"
      | "google-generations"
    >();
  });

  it("defines provider api shape bindings", () => {
    expectTypeOf<ApiShapeBinding>().toEqualTypeOf<{
      readonly id: ApiShapeId;
      readonly baseUrlPath?: string;
      readonly envBaseUrlPath?: string;
      readonly defaultBaseUrl?: string;
    }>();
  });

  it("allows provider compatibility to be declared through api shape bindings", () => {
    expectTypeOf<AuthProvider["apiShapes"]>().toEqualTypeOf<
      readonly ApiShapeBinding[] | undefined
    >();
  });

  it("freezes provider model input definitions", () => {
    const provider = defineProvider({
      id: "custom",
      label: "Custom",
      modelInput: { kind: "freeform" },
      auth: { kind: "oauth" }
    });

    expect(Object.isFrozen(provider.modelInput)).toBe(true);
  });
});
