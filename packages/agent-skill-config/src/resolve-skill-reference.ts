import * as fs from "node:fs";
import path from "node:path";
import { getAgentConfig, resolveAgentSupport, resolveSkillDir } from "./configs.js";
import { hasOwnErrorCode } from "./error-codes.js";

export interface SkillSource {
  kind: "resolved";
  ref: string;
  name: string;
  sourceAgentId?: string;
  sourcePath: string;
  scope: "project" | "user";
}

export type SkillResolutionFailure =
  | { kind: "malformed"; ref: string }
  | { kind: "unknown-agent"; ref: string; agentInput: string }
  | { kind: "not-found"; ref: string; searchedPaths: string[] };

export type SkillResolution = SkillSource | SkillResolutionFailure;

interface SearchTier {
  scope: "project" | "user";
  sourcePath: string;
}

function isMalformedSegment(segment: string): boolean {
  return (
    segment.length === 0 ||
    segment !== segment.trim() ||
    segment === "." ||
    segment === ".." ||
    segment.includes("\n") ||
    segment.includes("\r")
  );
}

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

export function resolveSkillReference(ref: string, cwd: string, homeDir: string): SkillResolution {
  const slashIndex = ref.indexOf("/");
  const hasPrefix = slashIndex !== -1;

  if (
    ref.length === 0 ||
    ref !== ref.trim() ||
    (hasPrefix && ref.indexOf("/", slashIndex + 1) !== -1)
  ) {
    return { kind: "malformed", ref };
  }

  if (!hasPrefix) {
    if (isMalformedSegment(ref)) {
      return { kind: "malformed", ref };
    }

    const tiers: SearchTier[] = [
      {
        scope: "project",
        sourcePath: path.resolve(cwd, ".poe-code/skills", ref)
      },
      {
        scope: "user",
        sourcePath: path.resolve(homeDir, ".poe-code/skills", ref)
      }
    ];

    return findSkill(ref, ref, tiers);
  }

  const agentInput = ref.slice(0, slashIndex);
  const name = ref.slice(slashIndex + 1);
  if (isMalformedSegment(agentInput) || isMalformedSegment(name)) {
    return { kind: "malformed", ref };
  }

  const support = resolveAgentSupport(agentInput);
  if (support.status !== "supported" || !support.id) {
    return { kind: "unknown-agent", ref, agentInput };
  }

  const config = getAgentConfig(support.id);
  if (!config) {
    return { kind: "unknown-agent", ref, agentInput };
  }

  const tiers: SearchTier[] = [
    {
      scope: "project",
      sourcePath: path.resolve(resolveSkillDir(config, "local", cwd), name)
    },
    {
      scope: "user",
      sourcePath: path.resolve(resolveSkillDir(config, "global", cwd, homeDir), name)
    }
  ];

  return findSkill(ref, name, tiers, support.id);
}
