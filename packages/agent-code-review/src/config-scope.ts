import { defineScope } from "@poe-code/poe-code-config/core";
import { isAbsolute } from "node:path";

export interface CodeReviewHumanGateConfig extends Record<string, unknown> {
  provider: "none";
}

function hasOwnEntry(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return hasOwnEntry(record, key) ? record[key] : undefined;
}

function parseHumanGate(value: unknown): CodeReviewHumanGateConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("humanGate must be an object");
  }

  const config = value as Record<string, unknown>;
  for (const key of Object.keys(config)) {
    if (key !== "provider") {
      throw new Error(`humanGate.${key} is not supported`);
    }
  }
  const provider = getOwnEntry(config, "provider") ?? "none";
  if (provider !== "none") {
    throw new Error('humanGate.provider must be "none"');
  }

  return { provider };
}

export function parseCodeReviewProfileDirectories(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((directory) => typeof directory !== "string")) {
    throw new Error("codeReview.profileDirectories must be an array of strings");
  }
  const directories = value.map((directory) => directory.trim());
  if (directories.some((directory) => !directory || !isAbsolute(directory))) {
    throw new Error("codeReview.profileDirectories entries must be absolute paths");
  }
  return [...new Set(directories)];
}

export function parseCodeReviewConfigDocument(value: unknown): {
  agent?: string;
  draftStore?: string;
  humanGate?: CodeReviewHumanGateConfig;
  profileDirectories?: string[];
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("codeReview must be an object");
  }
  const config = value as Record<string, unknown>;
  for (const key of Object.keys(config)) {
    if (!["agent", "draftStore", "humanGate", "profileDirectories"].includes(key)) {
      throw new Error(`codeReview.${key} is not supported`);
    }
  }
  const agent = getOwnEntry(config, "agent");
  if (agent !== undefined && typeof agent !== "string") {
    throw new Error("codeReview.agent must be a string");
  }
  const draftStore = getOwnEntry(config, "draftStore");
  if (draftStore !== undefined && typeof draftStore !== "string") {
    throw new Error("codeReview.draftStore must be a string");
  }
  const humanGate = getOwnEntry(config, "humanGate");
  const profileDirectories = getOwnEntry(config, "profileDirectories");
  return {
    ...(agent === undefined ? {} : { agent }),
    ...(draftStore === undefined ? {} : { draftStore }),
    ...(humanGate === undefined ? {} : { humanGate: parseHumanGate(humanGate) }),
    ...(profileDirectories === undefined
      ? {}
      : { profileDirectories: parseCodeReviewProfileDirectories(profileDirectories) })
  };
}

export const codeReviewConfigScope = defineScope("codeReview", {
  agent: {
    type: "string",
    default: "",
    doc: "Agent used for code review; empty uses normal poe-code default agent resolution."
  },
  draftStore: {
    type: "string",
    default: ".poe-code/code-review/reviews",
    doc: "Directory under .poe-code/code-review containing YAML code review state."
  },
  humanGate: {
    type: "json",
    default: { provider: "none" } satisfies CodeReviewHumanGateConfig,
    parse: parseHumanGate,
    doc: "External human-gate configuration for code review runs."
  },
  profileDirectories: {
    type: "json",
    default: [] as string[],
    parse: parseCodeReviewProfileDirectories,
    doc: "Absolute external reviewer profile directories, in precedence order after repo-local profiles."
  }
});
