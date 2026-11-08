import type { Command } from "toolcraft";
import { defineCommand } from "toolcraft";
import type { ObjectSchema } from "toolcraft-schema";
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
