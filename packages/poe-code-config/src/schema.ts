import type {
  BraintrustIntegrationConfig,
  ScopeDefinition,
  ScopeSchema
} from "./types.js";

export function defineScope<const S extends ScopeSchema>(
  scope: string,
  schema: S
): ScopeDefinition<S> {
  return {
    scope,
    schema
  };
}

export const integrationsConfigScope = defineScope("integrations", {
  braintrust: {
    type: "json",
    default: {
      enabled: false
    } satisfies BraintrustIntegrationConfig,
    parse: parseBraintrustIntegrationConfig,
    doc: "Braintrust integration configuration"
  }
});

export { runtimeConfigScope } from "./runtime.js";

function parseBraintrustIntegrationConfig(value: unknown): BraintrustIntegrationConfig {
  if (!isRecord(value)) {
    throw new Error("expected an object");
  }

  const enabled = value.enabled === undefined ? false : value.enabled;
  if (typeof enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }

  return {
    enabled,
    ...optionalStringEntry("apiKey", value.apiKey),
    ...optionalStringEntry("apiUrl", value.apiUrl),
    ...optionalStringEntry("project", value.project)
  };
}

function optionalStringEntry(key: string, value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }

  return { [key]: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
