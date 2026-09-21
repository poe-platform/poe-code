import type { EnvironmentReference } from "./configuration.js";
import type { ConfigurationBindingOptions } from "./runtime-configuration.js";

/** Read explicit own environment values once, without accessors or excess bytes. */
export function credentialEnvironmentReader(options: Pick<ConfigurationBindingOptions, "env" | "maxCredentialBytes">): (reference: EnvironmentReference, required?: boolean) => string | undefined {
  const limit = options.maxCredentialBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("maxCredentialBytes must be a positive safe integer");
  if (typeof options.env !== "object" || options.env === null) throw new Error("MCP credential environment must be an object");
  let credentialBytes = 0;
  const values = new Map<string, string | undefined>();
  return (reference: EnvironmentReference, required = false): string | undefined => {
    if (!values.has(reference.env)) {
      const descriptor = Object.getOwnPropertyDescriptor(options.env, reference.env);
      if (descriptor !== undefined && (!("value" in descriptor) || (descriptor.value !== undefined && typeof descriptor.value !== "string")))
        throw new Error(`Invalid MCP credential environment value for ${reference.env}`);
      const value = descriptor?.value as string | undefined;
      credentialBytes += value === undefined ? 0 : Buffer.byteLength(value, "utf8");
      if (credentialBytes > limit) throw new Error("MCP credential environment byte limit exceeded");
      values.set(reference.env, value === "" ? undefined : value);
    }
    const value = values.get(reference.env);
    if (required && (value === undefined || value.trim() === "")) throw new Error(`Missing required MCP environment variable ${reference.env}`);
    return value;
  };
}
