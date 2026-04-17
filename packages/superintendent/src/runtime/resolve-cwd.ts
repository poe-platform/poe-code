import path from "node:path";
import type { AgentRoleConfig } from "../document/parse.js";

export function resolveRoleCwd(role: AgentRoleConfig, docPath: string): string {
  const docDir = path.dirname(docPath);

  if (role.cwd === undefined) {
    return docDir;
  }

  return path.isAbsolute(role.cwd) ? role.cwd : path.resolve(docDir, role.cwd);
}
