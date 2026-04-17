import { appendFile } from "node:fs/promises";
import type { AgentPlugin } from "../runtime/plugin-types.js";

const auditLog = (logPath: string): AgentPlugin => ({
  name: "audit-log",
  hooks: {
    async postToolUse(ctx) {
      await appendFile(logPath, `${JSON.stringify({ ts: new Date().toISOString(), tool: ctx.tool })}\n`);
    },
    async postCompaction(ctx) {
      await appendFile(
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
