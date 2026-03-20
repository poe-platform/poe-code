import { runCommand as exec } from "@poe-code/agent-spawn";
import type { AgentPlugin } from "../runtime/plugin-types.js";

const gitContext = (cwd: string): AgentPlugin => ({
  name: "git-context",
  async prompt(ctx) {
    const [status, log] = await Promise.all([
      exec("git", ["status", "--short"], { cwd })
        .then(result => result.stdout)
        .catch(() => ""),
      exec("git", ["log", "--oneline", "-5"], { cwd })
        .then(result => result.stdout)
        .catch(() => ""),
    ]);

    return {
      ...ctx,
      system: [ctx.system, "## Git context", status, log].filter(Boolean).join("\n"),
    };
  },
});

export default gitContext;
