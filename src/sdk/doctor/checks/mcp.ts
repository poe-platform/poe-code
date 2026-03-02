import { parse as parseToml } from "smol-toml";
import { isNotFound } from "@poe-code/config-mutations";
import type { DoctorCheck, DoctorContext, CheckResult } from "../types.js";

export function mcpConfigValidCheck(
  agentName: string,
  configPath: string,
  format: "json" | "toml",
  configKey: string
): DoctorCheck {
  return {
    id: `mcp.${agentName}.config-valid`,
    category: `mcp:${agentName}`,
    description: `${agentName} MCP config valid`,
    async run(ctx: DoctorContext): Promise<CheckResult> {
      try {
        const raw = await ctx.fs.readFile(configPath, "utf8");
        if (format === "json") {
          return validateJson(raw, agentName, configPath, configKey);
        }
        return validateToml(raw, agentName, configPath, configKey);
      } catch (error) {
        if (isNotFound(error)) {
          return {
            status: "skip",
            message: `No MCP config file at ${configPath}`
          };
        }
        return {
          status: "fail",
          message: `${agentName} MCP config is invalid: ${(error as Error).message}`,
          fix: `Check or delete ${configPath} and run "poe-code mcp configure ${agentName}".`
        };
      }
    }
  };
}

function validateJson(
  raw: string,
  agentName: string,
  configPath: string,
  configKey: string
): CheckResult {
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || !(configKey in parsed)) {
    return {
      status: "warn",
      message: `No "${configKey}" key in ${configPath}`,
      fix: `Run "poe-code mcp configure ${agentName}" to add MCP servers.`
    };
  }
  return {
    status: "pass",
    message: `${agentName} MCP config is valid`,
    detail: configPath
  };
}

function validateToml(
  raw: string,
  agentName: string,
  configPath: string,
  configKey: string
): CheckResult {
  const parsed = parseToml(raw);
  if (!(configKey in parsed)) {
    return {
      status: "warn",
      message: `No "${configKey}" key in ${configPath}`,
      fix: `Run "poe-code mcp configure ${agentName}" to add MCP servers.`
    };
  }
  return {
    status: "pass",
    message: `${agentName} MCP config is valid`,
    detail: configPath
  };
}
