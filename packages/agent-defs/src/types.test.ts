import { describe, expectTypeOf, it } from "vitest";
import type { AgentDefinition, ApiShapeId } from "./index.js";

describe("agent definition types", () => {
  it("keeps api shape ids stable", () => {
    expectTypeOf<ApiShapeId>().toEqualTypeOf<
      | "openai-chat-completions"
      | "openai-responses"
      | "anthropic-messages"
      | "google-generations"
    >();
  });

  it("allows optional api shape ids on agent definitions", () => {
    expectTypeOf<AgentDefinition["apiShapes"]>().toEqualTypeOf<
      readonly ApiShapeId[] | undefined
    >();
  });

  it("allows declarative native OTel capture overlays", () => {
    expectTypeOf<AgentDefinition["otelCapture"]>().toMatchTypeOf<
      | {
          env?: Record<string, string>;
          args?: (endpoint: string, content: boolean) => string[];
        }
      | undefined
    >();
  });

  it("allows spawn-only agents to omit configPath", () => {
    expectTypeOf<AgentDefinition["configPath"]>().toEqualTypeOf<string | undefined>();
  });
});
