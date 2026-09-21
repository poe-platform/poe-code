import { runCommand } from "./spawn-run-command.js";
import { native } from "./native.js";
const gitContext = (cwd) => ({
  name: "git-context",
  async prompt(ctx) {
    const [status, log] = await Promise.all([
      runCommand("git", ["status", "--short"], { cwd })
        .then((result) => result.stdout)
        .catch(() => ""),
      runCommand("git", ["log", "--oneline", "-5"], { cwd })
        .then((result) => result.stdout)
        .catch(() => "")
    ]);
    return {
      ...ctx,
      system: native.agentGitContext(
        [ctx.system, "## Git context", status, log].filter(Boolean).map((part) => [part].join(""))
      )
    };
  }
});
export default gitContext;
