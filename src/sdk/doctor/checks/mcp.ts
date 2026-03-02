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
          const parsed = JSON.parse(raw);
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            !(configKey in parsed)
          ) {
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
        // TOML: just check it's non-empty and parseable text
        if (raw.trim().length === 0) {
          return {
            status: "warn",
            message: `MCP config file is empty at ${configPath}`
          };
        }
        return {
          status: "pass",
          message: `${agentName} MCP config exists`,
          detail: configPath
        };
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

export function mcpCommandExistsCheck(
  agentName: string,
  serverName: string,
  command: string
): DoctorCheck {
  return {
    id: `mcp.${agentName}.${serverName}.command`,
    category: `mcp:${agentName}`,
    description: `${serverName} MCP command exists`,
    async run(ctx: DoctorContext): Promise<CheckResult> {
      const result = await ctx.runCommand("which", [command]);
      if (result.exitCode === 0) {
        return {
          status: "pass",
          message: `${command} found`,
          detail: result.stdout.trim()
        };
      }
      return {
        status: "warn",
        message: `MCP server "${serverName}" command "${command}" not found on PATH`,
        fix: `Install "${command}" or update MCP config for ${agentName}.`
      };
    }
  };
}
