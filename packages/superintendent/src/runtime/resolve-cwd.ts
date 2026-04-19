import path from "node:path";
import type { AgentRoleConfig } from "../document/parse.js";

export function resolveRoleCwd(
  role: AgentRoleConfig,
  docPath: string,
  defaultCwd: string
): string {
  if (role.cwd === undefined) {
    return defaultCwd;
  }

  if (path.isAbsolute(role.cwd)) {
    return role.cwd;
  }

  return path.resolve(path.dirname(docPath), role.cwd);
}
