import type { Command } from "@poe-code/cmdkit";
import { defineCommand } from "@poe-code/cmdkit";
import type { ObjectSchema } from "@poe-code/cmdkit-schema";
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
