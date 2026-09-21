import type { SchemaFetchOptions } from "./schema.js";

/** Capture declared policies and selected host handles before asynchronous work. */
export function snapshotRemoteMcpSchemaOptions<Options extends SchemaFetchOptions>(options: Options): Options {
  return { ...options, signal: options.signal, fetch: options.fetch, oauthDiscoveryCache: options.oauthDiscoveryCache,
    onWarning: options.onWarning, onElicitationRequest: options.onElicitationRequest,
    requestTimeoutMs: options.requestTimeoutMs, maxResponseBytes: options.maxResponseBytes,
    maxTools: options.maxTools, maxPages: options.maxPages };
}
