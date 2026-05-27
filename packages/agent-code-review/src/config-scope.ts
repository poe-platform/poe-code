import { defineScope } from "@poe-code/poe-code-config";

export interface CodeReviewHumanGateConfig extends Record<string, unknown> {
  provider: "none";
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
  const provider = config.provider ?? "none";
  if (provider !== "none") {
    throw new Error('humanGate.provider must be "none"');
  }

  return { provider };
}

export function parseCodeReviewConfigDocument(value: unknown): {
  agent?: string;
  draftStore?: string;
  humanGate?: CodeReviewHumanGateConfig;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("codeReview must be an object");
  }
  const config = value as Record<string, unknown>;
  for (const key of Object.keys(config)) {
    if (!["agent", "draftStore", "humanGate"].includes(key)) {
      throw new Error(`codeReview.${key} is not supported`);
    }
  }
  if (config.agent !== undefined && typeof config.agent !== "string") {
    throw new Error("codeReview.agent must be a string");
  }
  if (config.draftStore !== undefined && typeof config.draftStore !== "string") {
    throw new Error("codeReview.draftStore must be a string");
  }
  return {
    ...(config.agent === undefined ? {} : { agent: config.agent }),
    ...(config.draftStore === undefined ? {} : { draftStore: config.draftStore }),
    ...(config.humanGate === undefined ? {} : { humanGate: parseHumanGate(config.humanGate) })
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
  }
});
