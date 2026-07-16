import crypto from "node:crypto";
import os from "node:os";
import {
  bridgeActiveSkills,
  cleanupBridgedSkills,
  type BridgeManifest
} from "@poe-code/agent-skill-config";
import {
  bridgeHooks,
  cleanupBridgedHooks,
  type BridgeHookManifest
} from "@poe-code/agent-hook-config";
import { logger } from "toolcraft-design";
import type { HookBridgeOptions } from "./types.js";

export interface BridgedRunManifest {
  skills?: BridgeManifest;
  hooks?: BridgeHookManifest;
}

export function bridgeResourcesForRun(
  agentId: string,
  cwd: string,
  skills: string[] | undefined,
  hooks: HookBridgeOptions | undefined
): BridgedRunManifest | undefined {
  if ((!skills || skills.length === 0) && !hooks) {
    return undefined;
  }

  const runId = crypto.randomUUID();
  const manifests: BridgedRunManifest = {};

  try {
    if (skills && skills.length > 0) {
      manifests.skills = bridgeActiveSkills(agentId, cwd, skills, os.homedir(), runId);
      for (const warning of manifests.skills.warnings) {
        logger.warn(warning.message);
      }
    }

    if (hooks) {
      manifests.hooks = bridgeHooks(hooks.from, agentId, cwd, os.homedir(), runId, {
        strategy: hooks.strategy,
        scope: hooks.scope
      });
      for (const warning of manifests.hooks.warnings ?? []) {
        logger.warn(warning);
      }
      for (const drop of manifests.hooks.drops) {
        logger.warn(
          `Dropped bridged hook event "${drop.source.event}" with handler type "${drop.source.handler.type}": ${drop.detail}`
        );
      }
    }
  } catch (error) {
    cleanupResourcesForRun(manifests);
    throw error;
  }

  return manifests;
}

export function cleanupResourcesForRun(manifest: BridgedRunManifest | undefined): void {
  if (!manifest) {
    return;
  }
  if (manifest.hooks) {
    cleanupBridgedHooks(manifest.hooks);
  }
  if (manifest.skills) {
    cleanupBridgedSkills(manifest.skills);
  }
}
