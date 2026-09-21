import crypto from "node:crypto";
import os from "node:os";
import { bridgeActiveSkills, cleanupBridgedSkills } from "./skills/index.js";
import { bridgeHooks, cleanupBridgedHooks } from "./hooks/index.js";
import { logger } from "./design/index.js";

export function bridgeResourcesForRun(agentId, cwd, skills, hooks) {
  if ((!skills || skills.length === 0) && !hooks) return undefined;
  const runId = crypto.randomUUID(),
    manifests = {};
  try {
    if (skills && skills.length > 0) {
      manifests.skills = bridgeActiveSkills(agentId, cwd, skills, os.homedir(), runId);
      for (const warning of manifests.skills.warnings) logger.warn(warning.message);
    }
    if (hooks) {
      manifests.hooks = bridgeHooks(hooks.from, agentId, cwd, os.homedir(), runId, {
        strategy: hooks.strategy,
        scope: hooks.scope
      });
      for (const warning of manifests.hooks.warnings ?? []) logger.warn(warning);
      for (const drop of manifests.hooks.drops)
        logger.warn(
          `Dropped bridged hook event "${drop.source.event}" with handler type "${drop.source.handler.type}": ${drop.detail}`
        );
    }
  } catch (error) {
    cleanupResourcesForRun(manifests);
    throw error;
  }
  return manifests;
}
export function cleanupResourcesForRun(manifest) {
  if (!manifest) return;
  if (manifest.hooks) cleanupBridgedHooks(manifest.hooks);
  if (manifest.skills) cleanupBridgedSkills(manifest.skills);
}
