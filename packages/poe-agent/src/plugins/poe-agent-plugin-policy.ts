import type { SpawnMode } from "@poe-code/agent-spawn";
import type { AgentPlugin, PluginApi } from "../runtime/plugin-types.js";
import { readRequiredEnum, rejectUnknownKeys, toOptionsObject } from "./parse-options.js";
import type { PluginSpec } from "./registry.js";

export type PolicyPluginOptions = {
  mode: SpawnMode | undefined | (() => SpawnMode | undefined);
};

export const POLICY_MODE_SESSION_KEY = "poe-agent-plugin-policy.mode";

const policyPlugin = (options: PolicyPluginOptions): AgentPlugin => {
  let getTool: PluginApi["getTool"] = () => undefined;

  return {
    name: "poe-agent-plugin-policy",
    setup(api) {
      getTool = api.getTool.bind(api);
    },
    hooks: {
      sessionStart(ctx) {
        const mode = resolveMode(options.mode);
        ctx.session.set(POLICY_MODE_SESSION_KEY, mode);
      },
      async preToolUse(ctx) {
        const mode = ctx.session.get(POLICY_MODE_SESSION_KEY) as SpawnMode | undefined;
        if (mode === undefined || mode === "yolo") {
          return;
        }

        const tool = getTool(ctx.tool);
        if (!tool?.policy) {
          return {
            reject: `Tool "${ctx.tool}" does not declare policy metadata and is blocked in ${mode} mode.`
          };
        }

        if (!tool.policy[mode]) {
          return {
            reject: `Tool "${ctx.tool}" is not allowed in ${mode} mode.`
          };
        }

        const validationError = await tool.policy.validate?.(ctx.args, mode);
        if (!validationError) {
          return;
        }

        return {
          reject: validationError
        };
      }
    }
  };
};

function resolveMode(mode: PolicyPluginOptions["mode"]): SpawnMode | undefined {
  return typeof mode === "function" ? mode() : mode;
}

export default policyPlugin;

export type PolicyPluginConfigOptions = {
  mode: SpawnMode;
};

export const spec: PluginSpec<PolicyPluginConfigOptions> = {
  name: "policy",
  parseOptions(input) {
    const obj = toOptionsObject(input);
    rejectUnknownKeys(obj, ["mode"]);
    return {
      mode: readRequiredEnum(obj, "mode", ["read", "edit", "yolo"] as const),
    };
  },
  factory: options => policyPlugin(options),
};
