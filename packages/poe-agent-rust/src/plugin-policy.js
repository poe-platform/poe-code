import { native } from "./native.js";
import { readRequiredEnum, rejectUnknownKeys, toOptionsObject } from "./parse-options.js";
export const POLICY_MODES = ["read", "edit", "yolo"];
export const POLICY_MODE_SESSION_KEY = "poe-agent-plugin-policy.mode";
const policyPlugin = (options) => {
  let getTool = () => undefined;
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
        const mode = ctx.session.get(POLICY_MODE_SESSION_KEY);
        if (native.agentPolicyPermissive(mode)) {
          return;
        }
        const tool = getTool(ctx.tool);
        if (!tool?.policy) {
          return {
            reject: native.agentPolicyFailure(ctx.tool, mode, true)
          };
        }
        if (!tool.policy[mode]) {
          return {
            reject: native.agentPolicyFailure(ctx.tool, mode, false)
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
function resolveMode(mode) {
  return typeof mode === "function" ? mode() : mode;
}
export default policyPlugin;
export const spec = {
  name: "policy",
  parseOptions(input) {
    const obj = toOptionsObject(input);
    rejectUnknownKeys(obj, ["mode"]);
    return {
      mode: readRequiredEnum(obj, "mode", POLICY_MODES)
    };
  },
  factory: (options) => policyPlugin(options)
};
