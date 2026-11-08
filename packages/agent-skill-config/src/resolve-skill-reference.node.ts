import * as fs from "node:fs";
import { searchPlan, type SkillResolution } from "./resolve-skill-reference-async.js";
import { hasOwnErrorCode } from "./error-codes.js";
type SearchTier = { scope: "project" | "user"; sourcePath: string };

function isDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR")) {
      return false;
    }
    throw error;
  }
}

function findSkill(
  ref: string,
  name: string,
  tiers: SearchTier[],
  sourceAgentId?: string
): SkillResolution {
  for (const tier of tiers) {
    if (isDirectory(tier.sourcePath)) {
      return {
        kind: "resolved",
        ref,
        name,
        ...(sourceAgentId ? { sourceAgentId } : {}),
        sourcePath: tier.sourcePath,
        scope: tier.scope
      };
    }
  }

  return {
    kind: "not-found",
    ref,
    searchedPaths: tiers.map((tier) => tier.sourcePath)
  };
}

/** Synchronous compatibility API using the host filesystem. */
export function resolveSkillReference(ref: string, cwd: string, homeDir: string): SkillResolution {
  const plan = searchPlan(ref, cwd, homeDir);
  return "kind" in plan ? plan : findSkill(ref, plan.name, plan.tiers, plan.sourceAgentId);
}
