import { S, UserError, defineCommand, defineGroup } from "toolcraft";
import { canonicalPullRequestUrl } from "github-review";
import { discoverCodeReviewProfiles, installCodeReviewAssets } from "./assets.js";
import {
  type CodeReviewCommitResult,
  type CodeReviewPublicationPayload,
  type CommitCodeReviewDraftsInput,
  commitCodeReviewDrafts
} from "./commit.js";
import { ingestCodeReviewProfile } from "./ingest.js";
import { parseCodeReviewAgentMcpArgs, runCodeReviewAgentMcp } from "./mcp.js";
import {
  type CodeReviewOrchestrationInput,
  type CodeReviewResult,
  runCodeReview
} from "./review.js";
import { readCodeReviewDraft } from "./review-store.js";
import { loadCodeReviewRuntimeConfig } from "./config.js";
import {
  CODE_REVIEW_PREVIEW_SPAWNS,
  previewCodeReviewSpawnPrompt,
  type CodeReviewSpawnPromptPreview,
  type PreviewCodeReviewSpawnPromptInput
} from "./prompt-preview.js";

function requirePrUrlParam(prUrl: string): string {
  try {
    return canonicalPullRequestUrl(prUrl);
  } catch (error) {
    throw new UserError(
      `Invalid prUrl argument. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

type RunCodeReviewHandler = (input: CodeReviewOrchestrationInput) => Promise<CodeReviewResult>;
type CommitCodeReviewDraftsHandler = (
  input: CommitCodeReviewDraftsInput
) => Promise<CodeReviewCommitResult | CodeReviewPublicationPayload>;
type PreviewCodeReviewSpawnPromptHandler = (
  input: PreviewCodeReviewSpawnPromptInput
) => Promise<CodeReviewSpawnPromptPreview>;

const agentMcpCommand = defineCommand({
  name: "agent-mcp",
  description: "Run the stdio MCP server used by code review agents.",
  params: S.Object({
    role: S.Enum(["agent", "orchestrator", "subagent"] as const, {
      description: "Review-agent role controlling exposed MCP tools."
    }),
    session: S.String({ description: "Code-review session id." }),
    actor: S.String({ description: "Actor writing drafts in this process." }),
    cwd: S.String({ description: "Repository working directory." }),
    draftStore: S.Optional(S.String({ description: "Absolute YAML review state directory." })),
    agent: S.String({ description: "Poe Code agent used for subagents." }),
    profiles: S.Optional(S.String({ description: "Comma-separated allowed profile names." })),
    profileDirectories: S.Optional(S.String({ description: "JSON array of external profile directories." }))
  }),
  scope: ["cli"],
  handler: async ({ params }) =>
    runCodeReviewAgentMcp(
      parseCodeReviewAgentMcpArgs([
        "--role",
        params.role,
        "--session",
        params.session,
        "--actor",
        params.actor,
        "--cwd",
        params.cwd,
        ...(params.draftStore ? ["--draft-store", params.draftStore] : []),
        "--agent",
        params.agent,
        ...(params.profiles ? ["--profiles", params.profiles] : []),
        ...(params.profileDirectories ? ["--profile-directories", params.profileDirectories] : [])
      ])
    )
});

export const installCodeReviewAssetsCommand = defineCommand({
  name: "install",
  description: "Install repo-local code review profiles and prompts.",
  params: S.Object({
    cwd: S.Optional(S.String({ description: "Repository root directory." })),
    force: S.Optional(
      S.Boolean({
        description: "Overwrite existing profile and prompt files."
      })
    ),
    dryRun: S.Optional(
      S.Boolean({
        description: "Preview the profile and prompt files without writing them."
      })
    )
  }),
  scope: ["cli"],
  handler: async ({ params }) => {
    const dryRun = Boolean(params.dryRun);
    const result = await installCodeReviewAssets({
      cwd: params.cwd?.trim() || process.cwd(),
      force: Boolean(params.force),
      dryRun
    });
    return dryRun
      ? {
          wouldCreate: result.created,
          wouldOverwrite: result.overwritten,
          wouldSkip: result.skipped
        }
      : result;
  }
});

export const listCodeReviewProfilesCommand = defineCommand({
  name: "profiles",
  description: "List configured code review profiles.",
  params: S.Object({
    cwd: S.Optional(S.String({ description: "Repository root directory." }))
  }),
  scope: ["cli"],
  handler: async ({ params }) => {
    const cwd = params.cwd?.trim() || process.cwd();
    const config = await loadCodeReviewRuntimeConfig(cwd);
    return (await discoverCodeReviewProfiles({ cwd, profileDirectories: config.profileDirectories })).map(
      ({ name, source, filePath }) => ({
        name,
        source,
        ...(filePath ? { filePath } : {})
      })
    );
  }
});

export const readCodeReviewDraftCommand = defineCommand({
  name: "drafts",
  description: "Read the current YAML draft for a pull request.",
  positional: ["prUrl"],
  params: S.Object({
    prUrl: S.String({ description: "GitHub pull request URL." }),
    cwd: S.Optional(S.String({ description: "Repository root directory." })),
    draftStore: S.Optional(S.String({ description: "YAML review state directory." }))
  }),
  scope: ["cli"],
  handler: async ({ params }) => {
    const draft = await readCodeReviewDraft({
      prUrl: requirePrUrlParam(params.prUrl),
      cwd: params.cwd?.trim() || process.cwd(),
      ...(params.draftStore ? { draftStore: params.draftStore } : {})
    });
    if (draft === undefined) {
      throw new Error(`No active code review draft found for ${params.prUrl}.`);
    }
    return draft;
  }
});

function createPromptPreviewCommand(
  preview: PreviewCodeReviewSpawnPromptHandler = (input) => previewCodeReviewSpawnPrompt(input)
) {
  return defineCommand({
    name: "prompt-preview",
    description: "Preview the exact prompt for a code review spawn without side effects.",
    params: S.Object({
      spawn: S.Enum(CODE_REVIEW_PREVIEW_SPAWNS, {
        description: "Spawn role to preview."
      }),
      profile: S.Optional(S.String({ description: "Reviewer profile name." })),
      cwd: S.Optional(S.String({ description: "Repository root directory." }))
    }),
    scope: ["cli"],
    handler: async ({ params }) => {
      const cwd = params.cwd?.trim() || process.cwd();
      const config = await loadCodeReviewRuntimeConfig(cwd);
      return preview({
        cwd,
        spawn: params.spawn,
        profileDirectories: config.profileDirectories,
        ...(params.profile ? { profile: params.profile } : {})
      });
    }
  });
}

export const promptPreviewCodeReviewCommand = createPromptPreviewCommand();

function createRunCodeReviewCommand(run: RunCodeReviewHandler = (input) => runCodeReview(input)) {
  return defineCommand({
    name: "run",
    description: "Run an agent-assisted GitHub pull request review.",
    positional: ["prUrl"],
    params: S.Object({
      prUrl: S.String({ description: "GitHub pull request URL." }),
      cwd: S.Optional(S.String({ description: "Repository root directory." })),
      agent: S.Optional(S.String({ description: "Poe Code review agent." })),
      draftStore: S.Optional(S.String({ description: "YAML review state directory." })),
      profilePath: S.Optional(
        S.String({ description: "Explicit reviewer profile Markdown path." })
      ),
      promptPath: S.Optional(
        S.String({
          description: "Explicit orchestrator prompt Markdown path."
        })
      ),
      profiles: S.Optional(S.Array(S.String(), { description: "Reviewer profile filter." })),
      additionalFeedback: S.Optional(S.String({ description: "Additional rerun feedback." }))
    }),
    scope: ["cli"],
    handler: async ({ params }) =>
      run({
        prUrl: requirePrUrlParam(params.prUrl),
        cwd: params.cwd?.trim() || process.cwd(),
        ...(params.agent ? { agent: params.agent } : {}),
        ...(params.draftStore ? { draftStore: params.draftStore } : {}),
        ...(params.profilePath ? { profilePath: params.profilePath } : {}),
        ...(params.promptPath ? { promptPath: params.promptPath } : {}),
        ...(params.profiles ? { profiles: params.profiles } : {}),
        ...(params.additionalFeedback ? { additionalFeedback: params.additionalFeedback } : {})
      })
  });
}

export const runCodeReviewCommand = createRunCodeReviewCommand();

function createCommitCodeReviewDraftsCommand(
  commit: CommitCodeReviewDraftsHandler = (input) => commitCodeReviewDrafts(input)
) {
  return defineCommand({
    name: "commit",
    description: "Validate and publish a merged code review draft to GitHub.",
    positional: ["prUrl"],
    params: S.Object({
      prUrl: S.String({ description: "GitHub pull request URL." }),
      cwd: S.Optional(S.String({ description: "Repository root directory." })),
      draftStore: S.Optional(S.String({ description: "YAML review state directory." })),
      dryRun: S.Optional(
        S.Boolean({
          description: "Preview the validated GitHub review payload only."
        })
      ),
      actor: S.Optional(S.String({ description: "Publishing actor receipt name." }))
    }),
    scope: ["cli"],
    handler: async ({ params }) =>
      commit({
        prUrl: requirePrUrlParam(params.prUrl),
        cwd: params.cwd?.trim() || process.cwd(),
        ...(params.draftStore ? { draftStore: params.draftStore } : {}),
        ...(params.actor ? { actor: params.actor } : {}),
        dryRun: Boolean(params.dryRun)
      })
  });
}

export const commitCodeReviewDraftsCommand = createCommitCodeReviewDraftsCommand();

export const ingestCodeReviewProfileCommand = defineCommand({
  name: "ingest",
  description: "Build a runtime reviewer profile from GitHub review history.",
  positional: ["githubUsername"],
  params: S.Object({
    githubUsername: S.String({ description: "GitHub username to ingest." }),
    repo: S.Array(S.String(), {
      description: "GitHub owner/name repository; repeat --repo for more."
    }),
    profile: S.Optional(S.String({ description: "Output reviewer profile name." })),
    agent: S.Optional(S.String({ description: "Poe Code agent used for synthesis." })),
    cwd: S.Optional(S.String({ description: "Repository root directory." }))
  }),
  scope: ["cli"],
  handler: async ({ params }) =>
    ingestCodeReviewProfile({
      username: params.githubUsername,
      repos: params.repo,
      ...(params.profile ? { profile: params.profile } : {}),
      ...(params.agent ? { agent: params.agent } : {}),
      cwd: params.cwd?.trim() || process.cwd()
    })
});

export interface CodeReviewCliDependencies {
  run?: RunCodeReviewHandler;
  commit?: CommitCodeReviewDraftsHandler;
  preview?: PreviewCodeReviewSpawnPromptHandler;
}

export function createCodeReviewGroup(dependencies: CodeReviewCliDependencies = {}) {
  return defineGroup({
    name: "code-review",
    description: "Run agent-assisted GitHub pull request reviews.",
    children: [
      agentMcpCommand,
      installCodeReviewAssetsCommand,
      listCodeReviewProfilesCommand,
      dependencies.preview ? createPromptPreviewCommand(dependencies.preview) : promptPreviewCodeReviewCommand,
      dependencies.run ? createRunCodeReviewCommand(dependencies.run) : runCodeReviewCommand,
      dependencies.commit
        ? createCommitCodeReviewDraftsCommand(dependencies.commit)
        : commitCodeReviewDraftsCommand,
      ingestCodeReviewProfileCommand,
      readCodeReviewDraftCommand
    ]
  });
}

export const codeReviewGroup = createCodeReviewGroup();
