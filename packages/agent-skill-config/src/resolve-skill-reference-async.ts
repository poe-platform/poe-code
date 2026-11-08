import type { FileSystem } from "@poe-code/safe-fs";
import { posixPath as path } from "@poe-code/safe-fs/runtime-core";
import { skillOperations } from "./filesystem.js";
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

export function searchPlan(ref: string, cwd: string, homeDir: string, paths: Pick<typeof path, "join" | "resolve"> = path): SkillResolutionFailure | { ref: string; name: string; tiers: SearchTier[]; sourceAgentId?: string } {
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
        sourcePath: paths.resolve(cwd, ".poe-code/skills", ref)
      },
      {
        scope: "user",
        sourcePath: paths.resolve(homeDir, ".poe-code/skills", ref)
      }
    ];

    return { ref, name: ref, tiers };
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
      sourcePath: paths.resolve(resolveSkillDir(config, "local", cwd, homeDir, paths), name)
    },
    {
      scope: "user",
      sourcePath: paths.resolve(resolveSkillDir(config, "global", cwd, homeDir, paths), name)
    }
  ];

  return { ref, name, tiers, sourceAgentId: support.id };
}

export type SkillRuntimeOptions = {
  fs: FileSystem;
  cwd: string;
  homeDir: string;
  signal?: AbortSignal;
};

export async function resolveSkillReferenceAsync(ref: string, options: SkillRuntimeOptions): Promise<SkillResolution> {
  options.signal?.throwIfAborted();
  const plan = searchPlan(ref, options.cwd, options.homeDir, path);
  if ("kind" in plan) return plan;
  const fs = skillOperations(options);
  for (const tier of plan.tiers) {
    try {
      if (!(await fs.stat(tier.sourcePath)).isDirectory()) continue;
      return { kind: "resolved", ref, name: plan.name, sourcePath: tier.sourcePath, scope: tier.scope,
        ...(plan.sourceAgentId ? { sourceAgentId: plan.sourceAgentId } : {}) };
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!hasOwnErrorCode(error, "ENOENT") && !hasOwnErrorCode(error, "ENOTDIR")) throw error;
    }
  }
  return { kind: "not-found", ref, searchedPaths: plan.tiers.map(tier => tier.sourcePath) };
}
