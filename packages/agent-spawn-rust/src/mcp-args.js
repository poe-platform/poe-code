import { spawnPlanner as planner } from "./planning.js";
export function getMcpArgs(config, servers) {
  const args = typeof config.mcpArgs === "function";
  const admitted = planner.mcpAdmission(
    config.agentId,
    JSON.stringify(servers ?? {}),
    args || typeof config.mcpEnv === "function" || config.mcpFile !== undefined,
    args,
    true
  );
  return admitted ? config.mcpArgs(servers) : [];
}
export function getMcpEnv(config, servers) {
  const env = typeof config.mcpEnv === "function";
  const admitted = planner.mcpAdmission(
    config.agentId,
    JSON.stringify(servers ?? {}),
    true,
    env,
    false
  );
  return admitted ? config.mcpEnv(servers) : {};
}
