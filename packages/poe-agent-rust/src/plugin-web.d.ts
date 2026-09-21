import type { AgentPlugin } from "./plugin-types.js";
import type { PluginSpec } from "./plugin-spec.js";
type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SearchWebFn = (
  query: string,
  options: {
    signal: AbortSignal;
  }
) => Promise<string>;
type WebPluginOptions = {
  searchWeb?: SearchWebFn;
  fetch?: FetchFn;
};
export type WebPluginConfigOptions = Record<string, never>;
declare const webPlugin: (options?: WebPluginOptions) => AgentPlugin;
export default webPlugin;
export declare const spec: PluginSpec<WebPluginConfigOptions>;
