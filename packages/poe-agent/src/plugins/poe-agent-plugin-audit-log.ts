import * as fsPromises from "node:fs/promises";
import type { AgentPlugin } from "../runtime/plugin-types.js";
import { assertNoSymbolicLinkPath } from "./plugin-args.js";

type AuditLogFileSystem = Pick<typeof fsPromises, "appendFile" | "lstat">;

const auditLog = (logPath: string, fs: AuditLogFileSystem = fsPromises): AgentPlugin => ({
  name: "audit-log",
  hooks: {
    async postToolUse(ctx) {
      await assertNoSymbolicLinkPath(fs, logPath);
      await fs.appendFile(logPath, `${JSON.stringify({ ts: new Date().toISOString(), tool: ctx.tool })}\n`);
    },
    async postCompaction(ctx) {
      await assertNoSymbolicLinkPath(fs, logPath);
      await fs.appendFile(
        logPath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          event: "compaction",
          summary: ctx.summary,
          droppedMessageCount: ctx.droppedMessages.length,
        })}\n`,
      );
    },
  },
});

export default auditLog;
