import type { AgentPlugin } from "../runtime/plugin-types.js";

const maxIterations = (limit: number): AgentPlugin => ({
  name: "max-iterations",
  hooks: {
    preIteration(ctx) {
      if (ctx.iterationNumber > limit) {
        return "abort";
      }
    },
  },
});

export default maxIterations;
