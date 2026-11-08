import type { AgentPlugin } from "./plugin-types.js";
import type { PluginSpec } from "./plugin-spec.js";
export declare const POLICY_MODES: readonly ["read", "edit", "yolo"];
export type PolicyMode = (typeof POLICY_MODES)[number];
export type PolicyPluginOptions = {
  mode: PolicyMode | undefined | (() => PolicyMode | undefined);
};
export declare const POLICY_MODE_SESSION_KEY = "poe-agent-plugin-policy.mode";
declare const policyPlugin: (options: PolicyPluginOptions) => AgentPlugin;
export default policyPlugin;
export type PolicyPluginConfigOptions = {
  mode: PolicyMode;
};
export declare const spec: PluginSpec<PolicyPluginConfigOptions>;
