import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { policy } from "./policy.js";
import { buildScript, parseStdout } from "./osascript-script.js";
const execFileAsync = promisify(execFile);
export function osascriptProvider(options = {}) {
  const { title, binary } = policy("options", [options]);
  return {
    id: "osascript",
    async requestApproval(request) {
      const script = buildScript(request, title);
      try {
        const { stdout } = await execFileAsync(binary, ["-e", script]);
        return parseStdout(stdout);
      } catch (error) { return policy("error", [error]); }
    }
  };
}
