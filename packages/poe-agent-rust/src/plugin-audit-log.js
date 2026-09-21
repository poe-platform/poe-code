import { native } from "./native.js";
import * as fsPromises from "node:fs/promises";
import { assertNoSymbolicLinkPath } from "./plugin-args.js";
const auditLog = (logPath, fs = fsPromises) => ({
  name: "audit-log",
  hooks: {
    async postToolUse(ctx) {
      await assertNoSymbolicLinkPath(fs, logPath);
      await fs
        .appendFile(
          logPath,
          `${JSON.stringify(native.mapAgentAuditRecord(new Date().toISOString(), ctx, false))}\n`
        )
        .catch(() => undefined);
    },
    async postCompaction(ctx) {
      await assertNoSymbolicLinkPath(fs, logPath);
      await fs.appendFile(
        logPath,
        `${JSON.stringify(native.mapAgentAuditRecord(new Date().toISOString(), ctx, true))}\n`
      );
    }
  }
});
export default auditLog;
