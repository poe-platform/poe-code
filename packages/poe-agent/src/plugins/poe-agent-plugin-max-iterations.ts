import type { AgentPlugin } from "../runtime/plugin-types.js";

const maxIterations = (limit: number): AgentPlugin => {
  let count = 0;

  return {
    name: "max-iterations",
    hooks: {
      preIteration() {
        if (++count > limit) {
          return "abort";
        }
      },
    },
  };
};

export default maxIterations;
