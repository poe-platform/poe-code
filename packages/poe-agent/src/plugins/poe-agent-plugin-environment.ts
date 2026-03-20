import type { AgentPlugin } from "../runtime/plugin-types.js";

const environment = (cwd: string): AgentPlugin => ({
  name: "environment",
  prompt(ctx) {
    return {
      ...ctx,
      system: [ctx.system, `Working directory: ${cwd}`, `Node: ${process.version}`]
        .filter(Boolean)
        .join("\n"),
    };
  },
});

export default environment;
