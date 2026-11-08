import { policy } from "./policy.js";
export async function requestApproval(args) {
  const { provider, ...request } = args;
  return policy("result", [await provider.requestApproval(policy("request", [request]))]);
}
