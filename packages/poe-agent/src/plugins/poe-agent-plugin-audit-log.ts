import { resolvePluginFileSystem } from "../runtime/filesystem.js";
import * as fsPromises from "node:fs/promises";
import type { AgentPlugin } from "../runtime/plugin-types.js";
import { assertNoSymbolicLinkPath } from "./plugin-args.js";

type AuditLogFileSystem = Pick<typeof fsPromises, "appendFile" | "lstat">;

const auditLog = (logPath: string, legacyFs?: AuditLogFileSystem): AgentPlugin => ({
  name: "audit-log",
  setup(api) { resolvePluginFileSystem(api.runtime, legacyFs, fsPromises); },
  hooks: {
    async postToolUse(ctx, runtime) {
      const fs = resolvePluginFileSystem(runtime, legacyFs, fsPromises);
      await assertNoSymbolicLinkPath(fs, logPath);
      await fs.appendFile(logPath, `${JSON.stringify({ ts: new Date().toISOString(), tool: ctx.tool })}\n`).catch(error => {
        if (runtime?.customFs) throw error;
      });
    },
    async postCompaction(ctx, runtime) {
      const fs = resolvePluginFileSystem(runtime, legacyFs, fsPromises);
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
