---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

setup:
  prompt: |
    Prepare the `poe-code` working tree before implementing this pipeline.

    Check for existing local changes and do not overwrite or revert them. If the working tree is clean, pull the latest changes for the currently checked-out branch with `git pull --ff-only` before starting task work. If local changes or a non-fast-forward update prevent pulling safely, report the condition clearly and preserve the existing worktree unchanged.

teardown:
  prompt: |
    Finalize the completed `agent-code-review` pipeline work in `poe-code`.

    Run the relevant tests and validations, commit only files changed for this plan using a Conventional Commit message, and push the implementation on a branch suitable for review. Open a GitHub pull request targeting `main` for these changes, including a concise implementation summary and the validation commands/results in the pull request body. Do not include unrelated local changes in the commit or pull request.

tasks:
  - id: port-github-review-package
    title: Port reusable GitHub review mechanics
    prompt: |
      Create a new workspace package `packages/github-review` that ports the GitHub PR/review mechanics from `/home/kjopek/automations/packages/agent-github-review-tools`.

      The package must own only GitHub mechanics, with no agent/profile/orchestrator concepts. Implement and export:
      - `parseGitHubPullRequestRef(prUrl)` and `canonicalPullRequestUrl(prUrl)`.
      - PR metadata fetch via `gh pr view`.
      - PR diff fetch via `gh pr diff`.
      - PR comments/reviews fetches needed by review agents.
      - diff parsing that exposes right-side reviewable lines.
      - inline comment validation against right-side diff lines.
      - pull request review submission, pull request review comment edit, and delete via `gh api`.

      All GitHub authentication must be delegated to the GitHub CLI. Do not read `GITHUB_TOKEN` or `GH_TOKEN` directly; tests should use an injected fake command runner instead of calling real `gh`.

      Add `package.json`, `tsconfig.json`, `README.md`, source files, and unit tests. Use Node 22-compatible TypeScript. Keep the package independent from `agent-code-review`.
    status:
      implement: done
      refactor: done
      test: done

  - id: add-review-history-fetch
    title: Add GitHub review-history fetching for profile ingest
    prompt: |
      Extend `packages/github-review` with paginated review-history fetching for profile ingest.

      Add an async API that accepts `{ username, repos, cwd?, since?, maxComments?, onRateLimit? }` and yields normalized comments authored by that GitHub username. Repositories are strings in `owner/name` form.

      Fetch these artifacts from GitHub using `gh api`, not HTML scraping:
      - pull request review comments authored by the user;
      - pull request review bodies authored by the user;
      - pull request issue comments authored by the user only when the issue is a pull request.

      Normalize each item to include repo, PR number/title/url, author login, creation timestamp, kind (`review_comment`, `review_body`, or `pr_comment`), body, and path/line/diff hunk when available.

      Be conservative with GitHub rate limits. Parse pagination links and rate-limit headers such as `x-ratelimit-remaining` and `x-ratelimit-reset`. Stop with a clear resumable error or back off when remaining requests are low. Add tests with fake `gh api` responses covering pagination, rate headers, filtering, and partial results.
    status:
      implement: done
      refactor: done
      test: done

  - id: scaffold-agent-code-review-package
    title: Scaffold agent-code-review package and config
    prompt: |
      Create a new workspace package `packages/agent-code-review` published internally as `agent-code-review`.

      The package must depend on `github-review`, `toolcraft`, `toolcraft-schema`, `@poe-code/poe-code-config`, and the existing poe-code spawn APIs as needed. It owns profile loading, prompt loading, review orchestration, YAML review state, CLI group, SDK exports, and `code-review agent-mcp`.

      Add a `codeReview` config scope using the existing `.poe-code/config.json` config system. Defaults:
      - `agent`: omitted means use normal poe-code default agent resolution.
      - `draftStore`: `.poe-code/code-review/reviews`.
      - `humanGate.provider`: `none`.

      Do not support `AUTOMATIONS_*` environment variables. Do not require `OPENAI_API_KEY` for runtime review. Add package README and tests for config defaults and SDK input overriding config.
    status:
      implement: done
      refactor: done
      test: done

  - id: implement-install-profiles-prompts
    title: Install repo-local profiles and role prompts
    prompt: |
      In `packages/agent-code-review`, implement repo-local profile and prompt assets.

      Profiles live under `.poe-code/code-review/profiles`. Runtime discovers every `*.md` profile there. If no repo profile files exist, expose a built-in short `generic` fallback profile. If repo profiles exist, do not automatically include `generic`. Unknown profile filters are hard errors.

      Role prompts live under `.poe-code/code-review/prompts`:
      - `orchestrator.md`
      - `subagent.md`
      - `agent.md`
      - `profile-synthesis.md`

      Runtime loads repo prompt files when present and uses built-in fallback prompts when files are missing.

      Add `poe-code code-review install [--cwd <repo>] [--force]` through the package CLI group. It must create:
      - `.poe-code/code-review/profiles/generic.md`
      - `.poe-code/code-review/prompts/orchestrator.md`
      - `.poe-code/code-review/prompts/subagent.md`
      - `.poe-code/code-review/prompts/agent.md`
      - `.poe-code/code-review/prompts/profile-synthesis.md`

      The install command must not overwrite existing files unless `--force` is passed. Add tests for profile discovery, prompt fallback, install idempotence, and forced overwrite.
    status:
      implement: done
      refactor: done
      test: done

  - id: implement-yaml-review-store
    title: Store reviews as PR-scoped YAML files
    prompt: |
      In `packages/agent-code-review`, replace the old SQLite draft model with one YAML file per reviewed PR.

      Review files live under `.poe-code/code-review/reviews` by default and are named `<org>_<repo>_PR<number>.yaml`, for example `acme_web_PR123.yaml`. Archive files move to `.poe-code/code-review/reviews/archive`.

      The YAML file must include:
      - version, session id, PR URL, canonical PR ref, selected agent, selected profiles, state, timestamps;
      - immutable `raw_reviews` per profile/subagent;
      - `subagents` status records;
      - one `merged_review` created by the orchestrator;
      - append-only `orchestrator_actions` explaining actions such as dropped duplicate comments, merged same-line comments, or selected decision;
      - `published` receipt after commit.

      Raw reviews are immutable after creation. The orchestrator may create/replace only `merged_review` and append `orchestrator_actions`.

      Implement atomic YAML writes by writing a temp file in the same directory and renaming. Commit must write the published receipt and move the full PR YAML file to `archive/`; if the archive target exists, append a timestamp suffix. Add tests for filename generation, round trips, immutable raw reviews, action appends, commit archive behavior, and archive collision handling.
    status:
      implement: done
      refactor: done
      test: done

  - id: implement-agent-mcp-role-tools
    title: Implement role-filtered code-review agent MCP
    prompt: |
      In `packages/agent-code-review`, implement `poe-code code-review agent-mcp` as a standalone stdio MCP server for review agents.

      It must receive explicit process arguments, not environment variables:
      - `--role agent|orchestrator|subagent`
      - `--session <id>`
      - `--actor <name>`
      - `--cwd <repo>`
      - `--agent <agent>`
      - `--profiles <csv>` when the run filters profiles

      Expose role-filtered tools:
      - `agent` and `subagent`: `code_review_pr_view`, `code_review_pr_diff`, `code_review_pr_comments`, `code_review_create_draft`.
      - `orchestrator`: all agent/subagent tools plus `code_review_profile_list`, `code_review_agent_spawn`, `code_review_agent_status`, `code_review_list_drafts`, `code_review_edit_inline_comment`, `code_review_delete_inline_comment`, `code_review_discard_draft`, and dry-run-only `code_review_commit_drafts`.

      Real GitHub publishing must not be available inside spawned agents. `code_review_commit_drafts` through MCP is dry-run only.

      Add tests that tool lists differ by role, context comes from args, subagents cannot access orchestrator-only tools, and MCP initialize/tools-list works.
    status:
      implement: done
      refactor: done
      test: done

  - id: implement-review-orchestration
    title: Port review orchestration and subagent spawning
    prompt: |
      In `packages/agent-code-review`, port the multi-reviewer orchestration flow from `/home/kjopek/automations/packages/agent-github-review-tools`.

      `runCodeReview` must:
      - resolve config, cwd, PR URL, session id, selected agent, and profile filters;
      - fetch PR details and diff through `github-review`;
      - read prior PR comments/reviews before drafting so agents avoid duplicate findings;
      - load role prompts from `.poe-code/code-review/prompts` or built-in fallbacks;
      - spawn an orchestrator with review MCP server config;
      - let the orchestrator spawn subagents through `code_review_agent_spawn`;
      - record immutable raw reviews per profile in the PR YAML file;
      - have the orchestrator create exactly one `merged_review`;
      - append `orchestrator_actions`;
      - support `additionalFeedback` in the orchestrator prompt for external Slack/human-gate reruns.

      Use the existing poe-code `spawn` SDK. Do not shell out to `codex` directly. Subagent spawn accepts optional `agent`; when omitted, it inherits the run agent. Store the resolved agent per subagent in YAML.

      Add integration tests with fake `spawn` and fake `github-review` proving sessions, subagents, raw reviews, merged review, actions, and additional feedback behavior.
    status:
      implement: done
      refactor: done
      test: done

  - id: implement-commit-drafts
    title: Commit merged review and archive YAML
    prompt: |
      In `packages/agent-code-review`, implement `commitCodeReviewDrafts` and CLI `poe-code code-review commit <github-pr-url>`.

      The command must read the PR YAML file from `.poe-code/code-review/reviews/<org>_<repo>_PR<number>.yaml`, validate `merged_review.comments` against the current PR diff through `github-review`, and submit exactly one GitHub pull request review through `github-review`.

      `--dry-run` must print/return exactly what would be published without calling GitHub and without moving the YAML file. Non-dry-run commit must write a `published` receipt with GitHub review id/url, actor, session, and timestamp, then move the full PR YAML file to `.poe-code/code-review/reviews/archive`. If the archive path already exists, append a timestamp suffix.

      If there is no `merged_review`, fail clearly and do not call GitHub. If inline comments are invalid for the current diff, do not submit an invalid payload; surface the validation result clearly.

      Add unit and integration tests for dry-run, successful publish, missing merged review, invalid inline comments, published receipt, archive move, and archive collision.
    status:
      implement: done
      refactor: done
      test: done

  - id: implement-profile-ingest
    title: Ingest GitHub review history into profiles
    prompt: |
      In `packages/agent-code-review`, implement `poe-code code-review ingest <github-username> --repo <owner/name> [--repo <owner/name>...] [--profile <name>] [--agent <agent>] [--cwd <repo>]`.

      Only support repeated `--repo owner/name` flags for multiple repositories. Do not add `--repos-file` or comma-separated repo parsing.

      The command must:
      - call `github-review` review-history fetching for the GitHub username and repo list;
      - write ingest artifacts under `.poe-code/code-review/ingest/<profile>/`;
      - write `source.yaml` with username, repos, fetch timestamp, pagination/rate-limit observations, and output profile path;
      - write `comments.jsonl` with normalized comments;
      - write `synthesis-prompt.md`;
      - spawn the selected agent with a task to read `comments.jsonl` and directly write `.poe-code/code-review/profiles/<profile>.md`.

      Profile synthesis must use an agent spawn, not a direct LLM/OpenAI SDK call. The generated profile must be first-person, usable by runtime review prompts, and must not mention GitHub usernames, source URLs, or that it was generated.

      Add tests for CLI parsing, repeated repos, artifact writing, fake rate-limit partial progress, agent prompt content, and final profile path behavior.
    status:
      implement: done
      refactor: done
      test: done

  - id: add-code-review-schemas
    title: Add schemas for config, profiles, prompts, and review YAML
    prompt: |
      Add explicit validation schemas for every persisted or user-provided code-review document.

      In `packages/agent-code-review`, define schemas using the repo's existing schema conventions for:
      - `codeReview` config scope from `.poe-code/config.json`;
      - profile frontmatter accepted in `.poe-code/code-review/profiles/*.md`;
      - role prompt metadata if prompt files use frontmatter;
      - PR review YAML files at `.poe-code/code-review/reviews/<org>_<repo>_PR<number>.yaml`;
      - ingest `source.yaml` files under `.poe-code/code-review/ingest/<profile>/`.

      On read, validate and return actionable errors that include the file path and failing field. On write, emit only schema-valid YAML. Add tests with malformed YAML, unknown versions, missing required fields, invalid decisions, invalid comment line numbers, and invalid profile names.

      Do not silently coerce unsafe values such as path separators in profile names, actor names, session ids, repo names, or archive filenames.
    status:
      implement: done
      refactor: done
      test: done

  - id: harden-paths-and-filesystem-safety
    title: Harden path handling and filesystem safety
    prompt: |
      Add filesystem safety protections to `packages/agent-code-review` and `packages/github-review`.

      Requirements:
      - All paths derived from profile names, actors, sessions, repos, PR URLs, and archive names must be sanitized and verified to stay under the intended `.poe-code/code-review` subdirectory.
      - Reject path traversal, absolute paths where a name is expected, hidden path segment tricks, empty names, and names that normalize to the same filename.
      - Atomic writes must create parent directories, write temp files in the destination directory, fsync if the local helper pattern supports it, and rename.
      - Archive moves must never overwrite an existing archive file; add timestamp suffixes on collisions.
      - Test with spaces, Unicode-like punctuation if supported by existing repo conventions, path separators, `..`, duplicate normalized names, and concurrent-looking temp files.

      Keep tests in memory where practical using existing repo test patterns; do not create uncontrolled files in the real workspace.
    status:
      implement: done
      refactor: done
      test: done

  - id: build-fixture-harness
    title: Build fixture harness for deterministic review tests
    prompt: |
      Build a deterministic test harness for code-review flows.

      Add fixtures under the relevant package test fixture directories, not under real user `.poe-code` state:
      - a fake repo with `.poe-code/code-review/profiles`;
      - a fake repo with no profiles to exercise `generic`;
      - default prompt fixtures;
      - GitHub PR metadata/diff/comment fixtures;
      - review-history pagination fixtures including rate-limit headers;
      - YAML review file fixtures for draft, merged, published, and archived states.

      Add fake implementations for:
      - `github-review` command runner;
      - agent spawn runner;
      - clock/time;
      - filesystem where the package pattern allows it.

      Use this harness in integration tests so `runCodeReview`, `commitCodeReviewDrafts`, and `ingestCodeReviewProfile` can run without network, real `gh`, real agents, or real repo state.
    status:
      implement: done
      refactor: done
      test: done

  - id: harden-github-api-rate-limits
    title: Harden GitHub API pagination and rate-limit handling
    prompt: |
      Strengthen `packages/github-review` GitHub API behavior beyond basic fetching.

      Implement a reusable GitHub API response parser that extracts:
      - JSON body;
      - status code;
      - pagination links;
      - `x-ratelimit-limit`;
      - `x-ratelimit-remaining`;
      - `x-ratelimit-reset`;
      - `retry-after` when present.

      Apply it to review-history ingest and any other paginated GitHub API reads. Handle secondary rate limits and abuse-limit style responses from `gh api` by returning a typed/resumable error with reset time and partial progress.

      Add tests for:
      - multi-page success;
      - missing link header;
      - malformed header values;
      - low remaining requests;
      - retry-after responses;
      - non-JSON API output;
      - partial output already written to ingest artifacts.
    status:
      implement: done
      refactor: done
      test: done

  - id: add-prompt-contract-tests
    title: Add prompt rendering and role contract tests
    prompt: |
      Add prompt rendering tests in `packages/agent-code-review`.

      Validate that built-in and installed prompt files receive the right variables for each role:
      - orchestrator prompt includes PR URL/title, profile cards, primary profile body, prior comments/reviews summary, subagent instructions, diff summary, and optional `additionalFeedback`;
      - subagent prompt includes exactly one profile body, PR URL/title, allowed MCP tools, and rules for avoiding duplicate findings;
      - agent prompt covers direct non-orchestrated review mode;
      - profile-synthesis prompt tells the spawned agent to read `comments.jsonl` and directly write `.poe-code/code-review/profiles/<profile>.md`.

      Add contract assertions that final review prompts forbid mentioning dry-run, fake-submit, orchestration, subagents, internal tool flow, source GitHub username, source URLs, or generation details in user-facing review/profile output.

      Include tests that repo prompt overrides are loaded and rendered, while missing prompt files fall back to built-ins.
    status:
      implement: done
      refactor: done
      test: done

  - id: add-failure-recovery-and-resume
    title: Add failure recovery and resume semantics
    prompt: |
      Make `agent-code-review` resilient to interrupted runs and partial YAML state.

      Define and implement behavior for:
      - stale pending/running subagents whose process is gone or whose log never appears;
      - a run interrupted after some raw reviews were written but before `merged_review`;
      - a commit interrupted after GitHub submit succeeds but before archive move;
      - a commit interrupted after receipt write but before archive move;
      - an archive file already existing;
      - an ingest interrupted after partial `comments.jsonl` write.

      The implementation should prefer idempotent reruns. Re-running `code-review run <pr>` should reuse valid immutable raw reviews where possible, refresh stale status, and create/replace only `merged_review` and append action logs. Re-running `commit <pr>` after a successful published receipt should not submit a second GitHub review.

      Add tests for every recovery scenario using fake clocks, fake filesystem, fake GitHub submit, and fake agents.
    status:
      implement: done
      refactor: done
      test: done

  - id: add-security-and-env-audit-tests
    title: Add security and environment isolation tests
    prompt: |
      Add explicit tests that the port removed automations-specific and secret-specific coupling.

      Tests must verify:
      - no runtime code in `packages/agent-code-review` reads `AUTOMATIONS_*`;
      - no runtime code requires `OPENAI_API_KEY`;
      - GitHub submission code delegates auth to `gh` and does not read `GITHUB_TOKEN` or `GH_TOKEN` directly;
      - Slack env vars such as `SLACK_BOT_TOKEN` are not referenced by `poe-code` code-review packages;
      - spawned agent MCP context is passed through explicit args, not hidden env vars;
      - subagent MCP role cannot access commit/publish tools;
      - user-controlled text in profiles, prompts, comments, and ingest artifacts cannot change filesystem destinations.

      Implement these as unit tests or static grep-style tests using repo test conventions. Avoid brittle tests over generated dist files.
    status:
      implement: done
      test: done

  - id: add-ci-style-e2e-test
    title: Add CI-style end-to-end test path
    prompt: |
      Add a deterministic CI-style end-to-end test for the code-review workflow.

      The test should simulate a GitHub Actions usage without requiring actual GitHub or real agents:
      - fixture repo checked out at a cwd;
      - `.poe-code/config.json`;
      - optional `.poe-code/code-review/profiles`;
      - fake `gh` runner;
      - fake agent spawn implementation;
      - command invocation equivalent to `poe-code code-review run "$PR_URL"` followed by `poe-code code-review commit "$PR_URL"`.

      Verify:
      - generic profile works when no profiles exist;
      - installed repo prompts are used when present;
      - review YAML is created at `.poe-code/code-review/reviews/<org>_<repo>_PR<number>.yaml`;
      - raw reviews are immutable;
      - merged review is submitted exactly once;
      - published receipt is written;
      - YAML is moved to archive after commit;
      - no network, real `gh`, or real model call happens.
    status:
      implement: done
      refactor: done
      test: done

  - id: wire-root-cli-and-exports
    title: Wire code-review into poe-code CLI and exports
    prompt: |
      Wire `agent-code-review` into the root `poe-code` CLI and package exports.

      Add a `code-review` command group to the root CLI with:
      - `install`
      - `profiles`
      - `ingest`
      - `run`
      - `drafts`
      - `commit`
      - `agent-mcp`

      The root CLI should be lightweight and only wire the package command group, consistent with repo guidance that package logic belongs in packages. Add root help entries as needed.

      Export SDK functions and types from `agent-code-review`, including profile loading, install, ingest, session creation, review run, draft read, commit, MCP server config creation, CLI group, and MCP runner.

      Add CLI help/smoke tests for the new root commands. Use Node 22.
    status:
      implement: done
      refactor: done
      test: done

  - id: document-and-qa-code-review
    title: Document and QA code-review workflow
    prompt: |
      Add package READMEs and QA documentation for the new code review workflow.

      `packages/github-review/README.md` must explain SDK purpose, GitHub CLI authentication through `gh`, exported functions, and that tests use fake command runners.

      `packages/agent-code-review/README.md` must document:
      - `.poe-code/code-review/profiles`
      - `.poe-code/code-review/prompts`
      - `.poe-code/code-review/reviews`
      - `.poe-code/code-review/ingest`
      - `poe-code code-review install`
      - `profiles`, `ingest`, `run`, `drafts`, `commit`, and `agent-mcp`
      - CI usage with explicit PR URL and `GH_TOKEN` for `gh`
      - Slack/external human-gate integration through SDK `additionalFeedback`, with no Slack code in poe-code

      Add a markdown QA plan, not a script, covering:
      - install in a fixture repo;
      - profiles fallback;
      - ingest with fake GitHub responses;
      - run with fake agents;
      - commit dry-run;
      - commit against a disposable PR if credentials are available.
    status:
      implement: done
      test: done
---

# Context

This pipeline implements the feature planned in the previous generic `Agent Code Review` plan. It ports the existing review system from `/home/kjopek/automations/packages/agent-github-review-tools` into `poe-code` while changing the public shape:

- Profiles: `.poe-code/code-review/profiles/*.md`.
- Prompts: `.poe-code/code-review/prompts/{orchestrator,subagent,agent,profile-synthesis}.md`.
- Review state: one YAML file per PR at `.poe-code/code-review/reviews/<org>_<repo>_PR<number>.yaml`, archived after publish.
- Ingest artifacts: `.poe-code/code-review/ingest/<profile>/`.
- Install command: `poe-code code-review install` creates `profiles/generic.md` and default prompts.
- GitHub auth: delegated to `gh`; code does not read `GITHUB_TOKEN` directly.
- Runtime review does not require `OPENAI_API_KEY`.
- Slack is external to `poe-code`; integrations use SDK `additionalFeedback` and `commitCodeReviewDrafts`.
- Ingest uses GitHub APIs through `gh api`, is rate-limit aware, and uses an agent to write the profile file directly.
