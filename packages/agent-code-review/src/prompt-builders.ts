import { CODE_REVIEW_USER_FACING_OUTPUT_CONTRACT, type CodeReviewProfile } from "./assets.js";
import type { CodeReviewRunOptions } from "./config.js";

export function buildCodeReviewOrchestratorPrompt(input: {
  input: CodeReviewRunOptions;
  profiles: readonly CodeReviewProfile[];
  profile: string;
  promptTemplate: string;
  prDetails: Record<string, unknown>;
  diff: string;
  priorActivity: Record<string, unknown>;
}): string {
  const additionalFeedback = input.input.additionalFeedback?.trim();
  return [
    input.promptTemplate,
    ORCHESTRATOR_WORKFLOW_PROMPT,
    `\nPROFILE CARDS\n${input.profiles
      .map((profile) => `## ${profile.name}\n\n${profile.content.trim()}`)
      .join("\n\n")}`,
    `\nPRIMARY REVIEW PROFILE\n${input.profile}`,
    additionalFeedback ? `\nADDITIONAL FEEDBACK\n${additionalFeedback}` : "",
    `\nPULL REQUEST\n${input.input.prUrl}\n${JSON.stringify(input.prDetails)}`,
    `\nPRIOR COMMENTS AND REVIEWS\n${JSON.stringify(input.priorActivity)}`,
    `\nDIFF SUMMARY\n${input.diff}`
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCodeReviewReviewerPrompt(input: {
  template: string;
  profile: string;
  prUrl: string;
  prDetails: unknown;
}): string {
  return `${input.template}

REQUIRED REVIEW FLOW
1. Read the pull request details, diff, and prior review activity with the available code_review_pr_* tools before drafting.
2. Do not raise a concern already covered by an existing comment or prior review unless changed code introduces a distinct new issue.
3. Apply the assigned profile and create exactly one raw review draft with code_review_create_draft; do not publish anything.
4. The only allowed MCP tools are code_review_pr_view, code_review_pr_diff, code_review_pr_comments, and code_review_create_draft.
5. ${CODE_REVIEW_USER_FACING_OUTPUT_CONTRACT}

PROFILE
${input.profile}

PULL REQUEST
${input.prUrl}
${JSON.stringify(input.prDetails)}`;
}

export function buildCodeReviewProfileSynthesisPrompt(input: {
  template: string;
  commentsPath: string;
  profilePath: string;
  partial: boolean;
}): string {
  return `${input.template.trim()}\n\n# Profile synthesis task\n\nRead the normalized review evidence from \`${input.commentsPath}\` and directly write the completed Markdown profile to \`${input.profilePath}\`.\n\nRequirements:\n- Write in first person so the profile can be inserted directly into runtime code-review prompts.\n- Describe concrete review priorities, likely concerns, tone, and useful heuristics grounded in the evidence.\n- ${CODE_REVIEW_USER_FACING_OUTPUT_CONTRACT}\n- Do not write analysis or summaries anywhere other than the requested profile file.\n${input.partial ? "- The fetched evidence is partial because API rate limits interrupted collection; be conservative about claims.\n" : ""}`;
}

const ORCHESTRATOR_WORKFLOW_PROMPT = `
REQUIRED ORCHESTRATION FLOW
1. Treat PRIOR COMMENTS AND REVIEWS as already-raised concerns and do not repeat the same underlying finding.
2. Use code_review_profile_list and spawn useful reviewer profiles through code_review_agent_spawn; spawn at least one available profile unless none can evaluate the change.
3. code_review_agent_spawn is asynchronous. Poll code_review_agent_status until all spawned reviewers are completed or failed before reading drafts.
4. Read completed raw reviews with code_review_list_drafts, merge useful new findings, and deduplicate overlapping or previously reported concerns.
5. Create exactly one final merged review with code_review_create_draft, even when there are no new findings.
6. Do not publish reviews or expose orchestration details in the final review text.
7. ${CODE_REVIEW_USER_FACING_OUTPUT_CONTRACT}`;
