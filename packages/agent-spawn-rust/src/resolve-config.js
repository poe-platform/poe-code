import { spawnPlanner as planner, spawnCatalog as catalog, getSpawnConfig } from "./planning.js";
export function resolveConfig(input, env = process.env) {
  const id = planner.resolveId(input);
  if (id == null) throw new Error(`Unknown agent "${input}".`);
  return {
    agentId: id,
    binaryName:
      env.POE_AGENT_BINARY?.trim() ||
      catalog.find((entry) => entry.metadata.id === id).metadata.binaryName,
    spawnConfig: getSpawnConfig(id)
  };
}
