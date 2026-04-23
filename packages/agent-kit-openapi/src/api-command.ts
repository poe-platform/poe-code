import type { Command } from "agent-kit";
import { defineCommand } from "agent-kit";
import type { ObjectSchema } from "agent-kit-schema";
import type { OpenApiClientServices } from "./define-client.js";

type ApiScope = readonly ["cli", "mcp", "sdk"];

export function defineApiCommand<TParamsSchema extends ObjectSchema<any>>(
  config: Parameters<
    typeof defineCommand<OpenApiClientServices, string, TParamsSchema, undefined, unknown, ApiScope>
  >[0]
): Command<OpenApiClientServices, TParamsSchema, undefined, unknown> {
  return defineCommand<OpenApiClientServices, string, TParamsSchema, undefined, unknown, ApiScope>(
    config
  );
}
