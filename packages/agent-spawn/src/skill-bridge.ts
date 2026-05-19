import crypto from "node:crypto";
import os from "node:os";
import {
  bridgeActiveSkills,
  cleanupBridgedSkills,
  type BridgeManifest
} from "@poe-code/agent-skill-config";
import { logger } from "@poe-code/design-system";

export function bridgeSkillsForRun(
  agentId: string,
  cwd: string,
  skills: string[] | undefined
): BridgeManifest | undefined {
  if (!skills || skills.length === 0) {
    return undefined;
  }

  const manifest = bridgeActiveSkills(agentId, cwd, skills, os.homedir(), crypto.randomUUID());
  for (const warning of manifest.warnings) {
    logger.warn(warning.message);
  }
  return manifest;
}

export function cleanupSkillsForRun(manifest: BridgeManifest | undefined): void {
  if (!manifest) {
    return;
  }
  cleanupBridgedSkills(manifest);
}
