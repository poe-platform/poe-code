import { hostProcess } from "#agent-platform";
import type { AgentPlugin } from "../runtime/plugin-types.js";

const environment = (cwd: string): AgentPlugin => ({
  name: "environment",
  prompt(ctx, runtime) {
    return {
      ...ctx,
      system: [ctx.system, `Working directory: ${runtime?.cwd ?? cwd}`, `Node: ${hostProcess.version}`]
        .filter(Boolean)
        .join("\n"),
    };
  },
});

export default environment;
