import * as fsPromises from "node:fs/promises";
import type { AgentPlugin } from "./plugin-types.js";
type AuditLogFileSystem = Pick<typeof fsPromises, "appendFile" | "lstat">;
declare const auditLog: (logPath: string, fs?: AuditLogFileSystem) => AgentPlugin;
export default auditLog;
