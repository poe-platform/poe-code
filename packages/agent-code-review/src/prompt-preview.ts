import { join, resolve } from "node:path";
import type { ResolvedPromptDocument } from "@poe-code/config-extends";
import {
  BUILT_IN_GENERIC_PROFILE,
  discoverCodeReviewProfiles,
  resolveCodeReviewRolePrompt,
  type CodeReviewProfile
} from "./assets.js";
import type { CodeReviewRunOptions } from "./config.js";
import { requireSafeDocumentSegment } from "./document-schemas.js";
import {
  buildCodeReviewOrchestratorPrompt,
  buildCodeReviewProfileSynthesisPrompt,
  buildCodeReviewReviewerPrompt
} from "./prompt-builders.js";

export const CODE_REVIEW_PREVIEW_SPAWNS = [
  "orchestrator",
  "reviewer",
  "profile-synthesis"
] as const;

export type CodeReviewPreviewSpawn = (typeof CODE_REVIEW_PREVIEW_SPAWNS)[number];

export interface PreviewCodeReviewSpawnPromptInput {
  cwd: string;
  spawn: CodeReviewPreviewSpawn;
  profile?: string;
  profileDirectories?: readonly string[];
  prUrl?: string;
  prDetails?: Record<string, unknown>;
  diff?: string;
  priorActivity?: Record<string, unknown>;
  additionalFeedback?: string;
  commentsPath?: string;
  profilePath?: string;
  partial?: boolean;
}

export interface CodeReviewSpawnPromptPreview {
  spawn: CodeReviewPreviewSpawn;
  prompt: string;
  promptDocument: ResolvedPromptDocument;
  profile?: string;
}

export async function previewCodeReviewSpawnPrompt(
  input: PreviewCodeReviewSpawnPromptInput
): Promise<CodeReviewSpawnPromptPreview> {
  const cwd = resolve(input.cwd);
  if (input.spawn === "profile-synthesis") {
    const profile = requireSafeDocumentSegment(input.profile?.trim() || "preview", "profile");
    const promptDocument = await resolveCodeReviewRolePrompt({ cwd, role: "profile-synthesis" });
    return {
      spawn: input.spawn,
      profile,
      promptDocument,
      prompt: buildCodeReviewProfileSynthesisPrompt({
        template: promptDocument.prompt,
        commentsPath:
          input.commentsPath ?? join(cwd, ".poe-code", "code-review", "ingest", profile, "comments.jsonl"),
        profilePath:
          input.profilePath ?? join(cwd, ".poe-code", "code-review", "profiles", `${profile}.md`),
        partial: input.partial ?? false
      })
    };
  }

  const profiles = await discoverCodeReviewProfiles({
    cwd,
    profileDirectories: input.profileDirectories,
    ...(input.profile ? { filters: [input.profile] } : {})
  });
  const selectedProfile = selectProfile(profiles, input.profile);
  const prUrl = input.prUrl ?? "https://github.com/owner/repository/pull/123";
  const prDetails = input.prDetails ?? { title: "Prompt preview pull request" };

  if (input.spawn === "reviewer") {
    const promptDocument = await resolveCodeReviewRolePrompt({ cwd, role: "subagent" });
    return {
      spawn: input.spawn,
      profile: selectedProfile.name,
      promptDocument,
      prompt: buildCodeReviewReviewerPrompt({
        template: promptDocument.prompt,
        profile: selectedProfile.content,
        prUrl,
        prDetails
      })
    };
  }

  const promptDocument = await resolveCodeReviewRolePrompt({ cwd, role: "orchestrator" });
  const profile = profiles
    .map((availableProfile) => `## ${availableProfile.name}\n\n${availableProfile.content.trim()}`)
    .join("\n\n");
  const options: CodeReviewRunOptions = {
    cwd,
    prUrl,
    draftStore: ".poe-code/code-review/reviews",
    humanGate: { provider: "none" },
    profileDirectories: [...(input.profileDirectories ?? [])],
    ...(input.additionalFeedback ? { additionalFeedback: input.additionalFeedback } : {})
  };
  return {
    spawn: input.spawn,
    profile: selectedProfile.name,
    promptDocument,
    prompt: buildCodeReviewOrchestratorPrompt({
      input: options,
      profiles,
      profile,
      promptTemplate: promptDocument.prompt,
      prDetails,
      diff: input.diff ?? "Prompt preview diff summary",
      priorActivity: input.priorActivity ?? {}
    })
  };
}

function selectProfile(profiles: readonly CodeReviewProfile[], requested?: string): CodeReviewProfile {
  if (profiles.length > 0) {
    return profiles[0];
  }
  return {
    name: requested ?? "generic",
    content: BUILT_IN_GENERIC_PROFILE,
    source: "built-in"
  };
}
