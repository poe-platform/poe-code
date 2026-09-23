import { resolvePluginFileSystem } from "@poe-code/poe-agent";
import { native } from "./native.js";
import * as fsPromises from "node:fs/promises";
import { assertNoSymbolicLinkPath } from "./plugin-args.js";
const auditLog = (logPath, legacyFs) => ({
  name: "audit-log",
  setup(api) { resolvePluginFileSystem(api.runtime, legacyFs, fsPromises); },
  hooks: {
    async postToolUse(ctx, runtime) {
      const fs = resolvePluginFileSystem(runtime, legacyFs, fsPromises);
      await assertNoSymbolicLinkPath(fs, logPath);
      await fs
        .appendFile(
          logPath,
          `${JSON.stringify(native.mapAgentAuditRecord(new Date().toISOString(), ctx, false))}\n`
        ).catch(error => { if (runtime?.customFs) throw error; });
    },
    async postCompaction(ctx, runtime) {
      const fs = resolvePluginFileSystem(runtime, legacyFs, fsPromises);
      await assertNoSymbolicLinkPath(fs, logPath);
      await fs.appendFile(
        logPath,
        `${JSON.stringify(native.mapAgentAuditRecord(new Date().toISOString(), ctx, true))}\n`
      );
    }
  }
});
export default auditLog;
