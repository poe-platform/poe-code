import { policy } from "./policy.js";
export function mockProvider(answer) {
  return {
    id: "mock",
    async requestApproval(_request) {
      if (typeof answer === "function") return policy("clone", [await answer()]);
      return policy("clone", [answer]);
    }
  };
}
