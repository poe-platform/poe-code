import { describe, expectTypeOf, it } from "vitest";
import type { ApiShapeBinding, ApiShapeId, AuthProvider } from "./index.js";

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
      readonly defaultBaseUrl: string;
    }>();
  });

  it("allows provider compatibility to be declared through api shape bindings", () => {
    expectTypeOf<AuthProvider["apiShapes"]>().toEqualTypeOf<
      readonly ApiShapeBinding[] | undefined
    >();
    expectTypeOf<AuthProvider>().toMatchTypeOf<{
      readonly supportsAgents?: readonly string[];
    }>();
  });
});
