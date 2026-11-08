import { native } from "./native.js";
const maxIterations = (limit) => ({
  name: "max-iterations",
  hooks: {
    preIteration(ctx) {
      if (native.agentIterationExceeded(ctx.iterationNumber, limit)) {
        return "abort";
      }
    }
  }
});
export default maxIterations;
