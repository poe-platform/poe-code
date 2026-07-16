# Cluster plan: 360 triaged UX issues -> 95 clusters

Ordered by priority: security -> critical/correctness -> usability -> polish.

## C01: Dry-run config diffs leak full API keys
- root_cause: redactContentForDiff redacts only .json/.toml and returns every other format (notably goose secrets.yaml) verbatim, so dry-run mutation diffs print live credentials.
- source_files: src/utils/dry-run.ts, src/providers/goose.ts, src/cli/context.ts
- severity: critical
- impact: security
- risk: high
- fix: Route every dry-run diff through redactContentForDiff and make redaction format-agnostic (key-name based) instead of extension-gated, adding yaml/env/ini coverage.
  Redact by credential key name (CUSTOM_POE_API_KEY, experimental_bearer_token, sk-poe-*, cfut_*) before the unified diff is rendered in context.ts.
  Add regression tests asserting no unredacted secret can reach a dry-run diff for any provider format.
- issue_docs: ux-dry-run-diffs-print-secrets.md, ux-logout-dry-run-still-prints-secrets-reconfirmed.md, ux-logout-dry-run-multi-panel-noise.md

## C02: auth api-key prints the full secret unmasked
- root_cause: executeApiKey writes the stored key to stdout with no masking and no opt-in reveal flag; dryRun is only passed as readOnly so it still prints.
- source_files: src/cli/commands/auth.ts
- severity: critical
- impact: security
- risk: medium
- fix: Mask the key by default (show last 4 chars) and add an explicit --reveal flag for the command-substitution use case.
  Honour --dry-run so it never emits the secret, and add danger copy plus the --reveal option to the command description/help.
- issue_docs: ux-auth-api-key-prints-secret.md, ux-auth-api-key-dry-run-still-prints-secret.md, ux-auth-api-key-help-no-danger-or-mask-flag.md

## C03: --api-key argv flags leak credentials into shell history
- root_cause: auth login / agent register --api-key <key> as a plain argv option, so the secret lands in shell history and ps output with no warning and no env/stdin alternative advertised.
- source_files: src/cli/commands/auth.ts, src/cli/commands/agent.ts, src/cli/commands/login.ts
- severity: medium
- impact: security
- risk: medium
- fix: Keep --api-key working but warn on use and document POE_API_KEY / stdin as the preferred paths in each flag description.
  Apply one shared decision across auth login, agent and provider login rather than patching each surface locally.
- issue_docs: ux-auth-login-api-key-shell-history-risk.md, ux-agent-api-key-flag-on-help.md

## C04: spawn --yes silently grants yolo permissions
- root_cause: resolveSpawnMode returns 'yolo' when assumeYes while the interactive default is 'edit'; SDK/CLI docs disagree on the default mode.
- source_files: src/cli/commands/spawn.ts, src/sdk/types.ts, packages/agent-spawn/src/types.ts
- severity: critical
- impact: security
- risk: high
- fix: Make --yes resolve --mode to the safe interactive default (edit/auto) and require yolo to be passed explicitly.
  Align the SDK default and its documented '(default: yolo)' string with the CLI so one default is defined in one place.
- issue_docs: ux-spawn-yes-defaults-mode-to-yolo.md, ux-sdk-cli-mode-default-mismatch.md

## C05: --mode read is not read-only and mutates the workspace
- root_cause: claude-code spawn config maps mode 'read' to only ['--permission-mode','plan'], which still allows writes, so a read-mode run mutated the plans dir.
- source_files: packages/agent-spawn/src/configs/claude-code.ts
- severity: critical
- impact: security
- risk: high
- fix: Map mode 'read' to a genuinely non-mutating argument set (add explicit disallowed tools / read-only sandbox) rather than relying on plan mode.
  Add a test per spawn config asserting read mode cannot produce a filesystem mutation.
- issue_docs: ux-gaslight-mode-read-still-mutated-plans-dir.md

## C06: Destructive commands run with no confirmation gate
- root_cause: logout, provider logout, unconfigure, worktree remove, tasks import/move --delete-source and runtime templates clear call their executors directly with no confirmOrCancel/assumeYes gate and no danger copy.
- source_files: src/cli/commands/auth.ts, src/cli/commands/logout.ts, src/cli/commands/provider.ts, src/cli/commands/unconfigure.ts, src/cli/commands/worktree.ts, src/cli/commands/tasks.ts, src/cli/commands/runtime/templates/clear.ts
- severity: critical
- impact: usability
- risk: high
- fix: Add a shared confirmOrCancel gate (bypassed only by --yes) plus a blast-radius summary before every destructive executor.
  Update the descriptions/help to state real scope ('removes configuration for ALL configured agents') and order the dryRun check before the prompt in templates clear.
- issue_docs: ux-auth-logout-no-confirmation-removes-all-agents.md, ux-provider-logout-no-confirmation.md, ux-unconfigure-no-confirmation.md, ux-worktree-remove-no-confirmation.md, ux-tasks-import-delete-source-dangerous.md, ux-tasks-move-delete-source-dangerous.md, ux-runtime-templates-clear-no-yes-or-dry-run.md, ux-logout-help-no-danger-or-scope-detail.md, ux-provider-logout-help-no-danger-or-yes.md, ux-auth-logout-same-as-logout-help.md

## C07: skill unconfigure --force deletes the entire agent skills directory
- root_cause: unconfigure() calls removeDirectory on the whole agent localSkillDir with force, so unrelated user-authored skills are recursively deleted; local scope also resolves into the home directory.
- source_files: packages/agent-skill-config/src/apply.ts, src/cli/commands/skill.ts
- severity: critical
- impact: correctness
- risk: high
- fix: Remove only poe-code-managed skill paths, never the shared skills root, and print the blast radius before deleting.
  Fix the local-scope path resolution so it stays inside the project, and cover both with tests over memfs.
- issue_docs: ux-skill-unconfigure-force-deletes-entire-skills-dir.md, ux-skill-unconfigure-dry-run-path-inconsistent.md

## C08: --yes / non-TTY autopicks an arbitrary target document
- root_cause: Multiple discovery helpers return candidates[0] when assumeYes or non-TTY, conflating 'accept defaults' with 'choose my target', so archive/delete/gaslight/pipeline act on documents the user never named.
- source_files: src/cli/commands/plan.ts, packages/plan-browser/src/browser.ts, packages/pipeline/src/plan/discovery.ts, src/cli/commands/gaslight.ts
- severity: critical
- impact: correctness
- risk: high
- fix: Never autopick a target: when no explicit path is given and prompting is impossible, fail with a ValidationError listing candidates.
  Apply the same rule in plan archive/delete/browse, gaslight selectPlans and pipeline plan discovery, and keep --yes limited to confirmation only.
- issue_docs: ux-plan-archive-delete-yes-picks-arbitrary-plan.md, ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md, ux-plan-root-non-tty-dumps-arbitrary-body.md, ux-gaslight-no-plan-autopicks-and-hits-stale-model.md, ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md, ux-pipeline-run-yes-autopicks-completed-plan-nothing-to-run.md, ux-gaslight-plan-path-starts-implement-without-confirm.md

## C09: Dead sonnet-5 model id baked into constants and provider maps
- root_cause: src/cli/constants.ts FRONTIER_MODELS / CLAUDE_CODE_VARIANTS.sonnet / DEFAULT_CLAUDE_CODE_MODEL / GOOSE_MODELS all point at anthropic/claude-sonnet-5, which does not exist in the live catalog; goose.ts repeats it in its context map.
- source_files: src/cli/constants.ts, src/providers/goose.ts, src/providers/claude-code.ts
- severity: critical
- impact: correctness
- risk: high
- fix: Replace anthropic/claude-sonnet-5 with the live anthropic/claude-sonnet-4.6 in constants and the goose context-limit map, and fix the KIMI namespace id.
  Stop writing the whole FRONTIER_MODELS list into goose's custom provider models array when a single model was selected.
  Add a CI check that every id in constants resolves against the live /models catalog so this cannot recur.
- issue_docs: ux-constants-source-of-dead-sonnet-5.md, ux-frontier-models-only-sonnet-5-is-dead.md, ux-configure-yes-dry-run-always-defaults-dead-sonnet-5.md, ux-goose-configure-still-embeds-sonnet-5-in-models-list.md, ux-goose-provider-map-still-has-sonnet-5-context.md, ux-configure-dry-run-writes-stale-model-id.md, ux-kimi-default-model-id-mismatches-catalog-namespace.md

## C10: configure --skip-if-configured still rewrites live config
- root_cause: configure.ts builds the payload (resolving the default model) before the skip check, and skips only when hasMaterialConfigureChange() is false, so an existing differing model triggers a real overwriting write.
- source_files: src/cli/commands/configure.ts
- severity: critical
- impact: correctness
- risk: medium
- fix: Read the existing config first and short-circuit before resolving defaults or building a payload.
  Make --skip-if-configured mean 'do nothing when any config exists', and cover the dry-run preview so it reports 'skipped' rather than 'would configure'.
- issue_docs: ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md, ux-skip-if-configured-dry-run-shows-dead-sonnet-5-default.md

## C11: Model ids written without catalog validation or alias resolution
- root_cause: resolveModel returns any --model string unchanged and configure-payload passes it straight through; claude-code strips the namespace without resolving CLAUDE_CODE_VARIANTS aliases, so typos and bare aliases reach live settings.
- source_files: src/cli/options.ts, src/cli/commands/configure-payload.ts, src/providers/claude-code.ts, src/cli/constants.ts
- severity: critical
- impact: correctness
- risk: high
- fix: Validate --model against the catalog in resolveModel and fail with a ValidationError plus suggestions on a miss.
  Resolve CLAUDE_CODE_VARIANTS aliases (sonnet/haiku) to full ids before stripModelNamespace, and echo the resolved id in the preview.
- issue_docs: ux-configure-accepts-any-string-as-model-no-catalog-check.md, ux-configure-model-alias-sonnet-haiku-written-literally.md, ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md, ux-live-claude-settings-had-sonnet-alias-and-xhigh-restored.md

## C12: --reasoning-effort is accepted, unvalidated and never applied
- root_cause: configure registers --reasoning-effort for all agents but configure-payload gates it on adapter.configurePrompts?.reasoningEffort (only codex declares it), and options.ts ensure() applies no enum check, so the value never reaches the write.
- source_files: src/cli/commands/configure-payload.ts, src/cli/options.ts, src/providers/claude-code.ts, src/cli/commands/configure.ts
- severity: critical
- impact: correctness
- risk: medium
- fix: Validate --reasoning-effort against the selected model's catalog effort enum and reject invalid values.
  Either apply the value for every agent that supports it (writing effortLevel model-aware, not hardcoded) or reject the flag for agents that do not, instead of silently dropping it.
- issue_docs: ux-configure-reasoning-effort-still-ignored-always-high.md, ux-configure-claude-ignores-reasoning-effort-always-xhigh.md, ux-reasoning-effort-bogus-silently-ignored.md, ux-reasoning-effort-flag-silently-ignored-for-some-agents.md

## C13: Empty-string flag values are treated as absent
- root_cause: Resolvers use != null / truthiness checks, so --model '', --api-key '', --resume-thread-id '' and --skill '' pass validation and are silently dropped or fall back to stored/default values inconsistently across agent, configure and spawn.
- source_files: src/cli/options.ts, src/cli/commands/spawn.ts, src/cli/commands/agent.ts, packages/agent-skill-config/src/resolve-skill-reference.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Normalise every flag resolver to reject empty/whitespace-only strings with one shared ValidationError, matching normalizeApiKey's existing behaviour.
  Apply consistently across model, api-key, resume-thread-id, skill/skills so all commands agree, and make bare --skills without a value an explicit error.
- issue_docs: ux-configure-empty-model-accepted-blank-default.md, ux-empty-model-flag-behavior-inconsistent.md, ux-empty-api-key-login-good-but-configure-ignores.md, ux-agent-empty-api-key-silently-uses-stored.md, ux-empty-resume-thread-id-silently-ignored.md, ux-skills-empty-string-silently-ignored.md, ux-skill-empty-string-malformed-reference.md, ux-skills-flag-without-value-is-noop-or-unclear.md

## C14: --base-url is ignored and invisible in the dry-run preview
- root_cause: shared.ts resolves agentBaseUrl from environmentBaseUrl ?? provider.agentBaseUrl and ignores the explicit --base-url/--shape-base-url flags, so the preview shows the provider default instead of the requested URL.
- source_files: src/cli/commands/shared.ts, src/cli/commands/configure.ts, src/cli/commands/provider.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Give the explicit --base-url / --shape-base-url flags precedence in agentBaseUrl resolution and thread them into the payload.
  Surface the effective base URL in the dry-run preview and document what --shape-base-url overrides.
- issue_docs: ux-configure-base-url-may-be-ignored.md, ux-configure-base-url-not-visible-in-dry-run.md, ux-configure-shape-base-url-not-visible-in-dry-run.md, ux-configure-shape-base-url-opaque.md

## C15: memory root INDEX.md/LOG.md are unreachable after init
- root_cause: resolvePageRelPath forces every show/ls path under pages/ while init writes INDEX.md and LOG.md at the memory root, so the files init advertises can never be opened or listed.
- source_files: src/cli/commands/memory.ts, packages/memory/src/pages.ts, packages/memory/src/init.ts
- severity: critical
- impact: correctness
- risk: medium
- fix: Decide the contract: let show/ls address memory-root files (resolve pages/ only as a fallback) and include INDEX/LOG in listPages.
  Stop rewriting every input path unconditionally and report the real resolved path in the not-found error.
- issue_docs: ux-memory-show-cannot-open-root-index-file.md, ux-memory-index-still-broken-after-init-reconfirmed.md

## C16: spawn poe-agent crashes with 'fs.lstat is not a function'
- root_cause: createConfigFileSystem omits lstat while assertConfigPathSafe calls fs.lstat, so an advertised agent crashes immediately with an internal TypeError.
- source_files: src/providers/poe-agent.ts, packages/poe-code-config/src/store.ts
- severity: critical
- impact: correctness
- risk: medium
- fix: Add lstat to the config filesystem abstraction (or make assertConfigPathSafe use a capability the abstraction provides) and cover it with a test.
  Until fixed, hide poe-agent from spawn help rather than advertising a crashing path.
- issue_docs: ux-spawn-poe-agent-crashes-fs-lstat.md

## C17: Root help hides half the registered commands
- root_cause: ROOT_HELP_COMMAND_SPECS hardcodes 19 rows consumed by buildRootHelpRows, so 13 working registered commands (skill, memory, runtime, eval, provider, tasks, launch, utils, maestro, code-review, superintendent, approvals, worktree) never appear in --help.
- source_files: src/cli/program.ts
- severity: critical
- impact: usability
- risk: medium
- fix: Derive root help rows from the actual command registrations instead of a hardcoded list, grouping less-common ones under an 'Advanced' heading.
  Add a test that fails when a registered command is missing from root help.
- issue_docs: ux-root-help-hides-skill-memory-runtime-eval-and-more.md

## C18: Two competing help renderers under one binary
- root_cause: Commander's formatSubcommandHelp and toolcraft's runCLI helpFormatterPlain render different help UIs (casing, usage line, 'npm run dev --' prefix, split OPTIONS blocks) depending on how a command is registered.
- source_files: src/cli/program.ts, packages/toolcraft/src/cli.ts
- severity: high
- impact: usability
- risk: high
- fix: Unify on one help formatter: feed toolcraft-forwarded commands through the same renderer/casing/usage-name as Commander-registered ones.
  Fix the wrapped inline flag rows and the rootUsageName so help never prints 'npm run dev --' as the invocation.
- issue_docs: ux-dual-help-systems.md, ux-eval-help-npm-run-dev-and-inline-flags.md, ux-superintendent-help-format-inconsistencies.md, ux-superintendent-run-help-options-split.md

## C19: Global flags are not listed on subcommand help
- root_cause: formatSubcommandHelp renders only helper.visibleOptions(cmd) and never the root options, so -y/--yes, --dry-run and --verbose are invisible on every subcommand even where the code requires them.
- source_files: src/cli/program.ts, src/cli/commands/memory.ts, src/cli/commands/plan.ts, src/cli/commands/pipeline.ts, src/cli/commands/unconfigure.ts, src/cli/commands/install.ts, src/cli/commands/worktree.ts, src/cli/commands/login.ts
- severity: high
- impact: usability
- risk: medium
- fix: Render inherited root options in formatSubcommandHelp under a 'Global options' section so --yes/--dry-run/--verbose appear everywhere they apply.
  Add a test asserting a command whose body requires --yes documents it.
- issue_docs: ux-global-flags-hidden-on-subcommand-help.md, ux-global-yes-not-listed-on-spawn-gaslight-help.md, ux-spawn-yes-not-in-options.md, ux-memory-cache-clear-help-omits-yes-reconfirmed.md, ux-memory-clear-help-still-no-force-or-yes.md, ux-memory-clear-requires-yes-help-omits-yes.md, ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md, ux-pipeline-init-help-omits-yes.md, ux-pipeline-run-help-omits-yes-and-mode.md, ux-unconfigure-help-omits-yes-and-dry-run.md, ux-install-unconfigure-help-still-sparse-reconfirmed.md, ux-install-help-missing-yes-and-list.md, ux-worktree-remove-help-omits-yes.md, ux-update-help-omits-dry-run.md, ux-login-help-omits-interactive-and-yes.md

## C20: User errors are rendered as system failures
- root_cause: Packages and command bodies throw plain Error instead of CliError/UserError, so bootstrap adds 'See logs at ~/.poe-code' system chrome and debug teases to ordinary user mistakes (missing file, wrong kind, unknown id, bad credentials).
- source_files: src/cli/bootstrap.ts, src/cli/errors.ts, packages/poe-agent/src/agent-session.ts, packages/agent-gaslight/src/run.ts, packages/agent-gaslight/src/config.ts, packages/agent-harness/src/loader/pair.ts, packages/memory/src/ingest.ts, packages/worktree/src/remove.ts, packages/worktree/src/reconcile.ts, packages/agent-skill-config/src/apply.ts, packages/pipeline/src/plan/discovery.ts, packages/workspace-resolver/src/github/clone.ts, packages/task-list/src/backends/gh-issues-client.ts, packages/superintendent/src/document/parse.ts, packages/agent-code-review/src/cli.ts, src/cli/commands/config.ts, src/cli/options.ts
- severity: high
- impact: usability
- risk: high
- fix: Wrap every user-caused throw in the shared UserError/CliError type at its throw site so bootstrap prints clean guidance with no log pointer or stack.
  Give each message a recovery next step (valid values, the path searched, the keys URL) instead of a bare ENOENT or raw upstream payload.
- issue_docs: ux-user-errors-look-like-system-failures.md, ux-activity-timeout-ms-uses-system-chrome.md, ux-agent-empty-model-see-logs.md, ux-agent-empty-prompt-see-logs.md, ux-agent-invalid-model-system-chrome.md, ux-code-review-drafts-not-found-debug-tease.md, ux-configure-unknown-provider-see-logs-missing.md, ux-editor-missing-raw-error.md, ux-gaslight-config-missing-enoent-system-chrome.md, ux-gaslight-missing-plan-system-chrome-reconfirmed.md, ux-github-cwd-clone-errors-still-raw-git.md, ux-harness-run-missing-file-system-chrome.md, ux-hooks-bridge-refuse-user-authored-file-opaque.md, ux-launch-missing-process-system-chrome.md, ux-login-rejected-no-recovery.md, ux-memory-agent-commands-invalid-json-opaque.md, ux-memory-ingest-enoent-system-chrome.md, ux-pipeline-run-missing-plan-see-logs.md, ux-provider-login-unknown-has-list-hint-and-see-logs.md, ux-resume-thread-invalid-agent-raw-error.md, ux-runtime-job-missing-see-logs.md, ux-sdk-getpoeapikey-throws-generic-error.md, ux-skill-configure-exists-system-chrome.md, ux-skill-install-missing-file-enoent-see-logs.md, ux-spawn-empty-at-file-see-logs.md, ux-spawn-skill-missing-lists-searched-paths-see-logs.md, ux-superintendent-complete-wrong-kind-debug-tease.md, ux-superintendent-install-already-exists-debug-tease.md, ux-tasks-get-github-401-raw-json.md, ux-traces-enoent-eisdir-still-system-errors.md, ux-utils-config-edit-missing-editor-system-chrome.md, ux-worktree-reconcile-not-found-system-chrome.md, ux-worktree-remove-missing-see-logs.md, ux-eval-empty-source-message-inconsistent-skins.md, ux-eval-init-name-validation-bare-text.md, ux-spawn-gemini-provider-credential-opaque-error.md

## C21: Validation errors still print stack traces
- root_cause: The catch paths call logger.logException for every Error, so even ValidationError (isUserError) prints 'Stack trace: ...', and models.ts double-reports the message.
- source_files: src/cli/logger.ts, src/cli/bootstrap.ts, src/cli/commands/models.ts, src/cli/errors.ts
- severity: high
- impact: usability
- risk: medium
- fix: Branch on isUserError before logException so user errors print message + recovery only, never a stack.
  Remove the duplicate report in the models catch and reuse the cleaner traces --since validation path as the reference.
- issue_docs: ux-validation-error-still-prints-stack.md, ux-models-since-invalid-prints-stack.md, ux-models-endpoint-bogus-double-error-and-stack.md, ux-traces-since-validation-cleaner-than-models.md, ux-spawn-kimi-acp-internal-error-stack.md

## C22: Raw Commander errors for missing or invalid arguments
- root_cause: Commander's .argument/.requiredOption/.choices emit raw 'error: missing required argument' text outside the design system, sometimes duplicated by a second design-system panel, and never list valid choices.
- source_files: src/cli/program.ts, src/cli/bootstrap.ts, src/cli/commands/spawn.ts, src/cli/commands/agent.ts, src/cli/commands/memory.ts, src/cli/commands/harness.ts, src/cli/commands/models.ts, src/cli/commands/worktree.ts, src/cli/commands/skill.ts, src/cli/commands/unconfigure.ts
- severity: medium
- impact: usability
- risk: medium
- fix: Intercept Commander's argument/option errors in bootstrap and re-render them once through the design system with valid choices listed.
  Add .choices() where an enum exists (harness kind, hooks-strategy, memory --agent) and stop the double-report.
- issue_docs: ux-raw-commander-missing-args.md, ux-agent-spawn-missing-args-raw-commander.md, ux-spawn-missing-agent-raw-commander.md, ux-maestro-tick-missing-transition-raw-commander.md, ux-memory-install-requires-agent-raw-commander.md, ux-hooks-strategy-invalid-raw-commander.md, ux-models-view-invalid-uses-raw-commander.md, ux-harness-new-kind-no-choices-listed.md, ux-worktree-reconcile-requires-agent-not-in-error-order.md, ux-memory-write-requires-reason-before-path.md, ux-skill-install-name-and-file-both-required-reconfirmed.md

## C23: toolcraft-forwarded commands emit double or raw argument errors
- root_cause: Commands routed through registerForwardedToolcraftCommand validate args twice, so a missing positional prints the raw Commander line and then a design-system panel, or reports a misleading 'not found'.
- source_files: src/cli/program.ts, packages/toolcraft/src/cli.ts, packages/agent-code-review/src/cli.ts, packages/toolcraft/src/human-in-loop/approvals-commands.ts
- severity: high
- impact: usability
- risk: medium
- fix: Let one layer own argument validation for forwarded commands and suppress the duplicate report.
  Distinguish 'missing id' from 'not found' in approvals and code-review, and drop the 'Missing required parameter' phrasing in favour of the argument name.
- issue_docs: ux-code-review-drafts-missing-arg-double-error.md, ux-superintendent-missing-path-double-error.md, ux-code-review-prompt-preview-missing-spawn-npm-run-dev.md, ux-approvals-missing-id-says-task-not-found-double.md

## C24: Unknown agent errors have no allow-list, suggestions, or shared capability matrix
- root_cause: resolveServiceAdapter and peers throw bare 'Unknown agent'/'Unknown service' for registry misses, and the supported-agent set differs per command (spawn vs configure vs install vs skill vs plan), so valid agents are rejected inconsistently.
- source_files: src/cli/commands/shared.ts, src/cli/commands/plan.ts, src/cli/commands/gaslight.ts, src/cli/commands/install.ts, packages/agent-skill-config/src/configs.ts, packages/agent-defs/src/agents/pi.ts
- severity: high
- impact: usability
- risk: medium
- fix: Throw one shared UserError that lists supported agents for the specific command and suggests the nearest match.
  Derive each command's supported set from one capability matrix in agent-defs so spawn/configure/install/skill/plan cannot drift, and use consistent 'agent' wording.
- issue_docs: ux-unknown-agent-no-allow-list-or-suggestions.md, ux-install-test-pi-unknown-not-spawn-only.md, ux-gaslight-unknown-agent-says-service.md, ux-plan-install-unsupported-agent-pi-kimi.md, ux-agent-capability-matrix-spawn-vs-configure-vs-install.md, ux-skill-configure-agent-list-differs-from-configure.md, ux-spawn-pi-demands-openrouter-not-poe.md

## C25: No did-you-mean suggestions for unknown commands
- root_cause: formatCommandNotFoundPanel receives only unknownCommand/helpArgs with no candidate list, so the root CLI cannot suggest anything even though toolcraft ships a tested suggest() helper.
- source_files: src/cli/command-not-found.ts, packages/toolcraft-design/src/components/command-errors.ts, packages/toolcraft/src/suggest.ts
- severity: medium
- impact: usability
- risk: low
- fix: Pass the registered command list into the not-found panel and use the existing suggest() helper to render 'Did you mean'.
  Scope candidates to the right level so subgroups suggest siblings (eval list -> ls) rather than unrelated commands.
- issue_docs: ux-command-not-found-no-suggestions.md, ux-root-typos-no-did-you-mean-configure-spawn.md, ux-toolcraft-has-suggestions-poe-code-root-does-not.md, ux-eval-unknown-command-suggests-lint-for-list.md

## C26: Non-TTY prompt guidance names POE_NO_PROMPT instead of --yes
- root_cause: prompts/interactive/core.ts rejects non-TTY prompts with a message naming only POE_NO_PROMPT, so CI users are pointed at an env var rather than the documented --yes flag.
- source_files: packages/toolcraft-design/src/prompts/interactive/core.ts, src/cli/commands/gaslight.ts
- severity: high
- impact: usability
- risk: medium
- fix: Rewrite the non-TTY rejection to name --yes first (env var secondary) and include the command being run.
  Ensure the commands that surface it (configure, install, test, runtime init, gaslight ingest) honour --yes on that path.
- issue_docs: ux-non-tty-prompt-wrong-guidance.md, ux-configure-non-tty-demands-poe-no-prompt-not-yes.md, ux-install-non-tty-demands-poe-no-prompt-not-yes.md, ux-test-nontty-demands-poe-no-prompt-not-yes.md, ux-runtime-init-non-tty-poe-no-prompt.md, ux-gaslight-ingest-nontty-demands-poe-no-prompt.md

## C27: Commands hang instead of failing fast without a TTY
- root_cause: resolveApiKey falls through to OAuth with no TTY check, plan question/edit and spawn interactive launch blocking UIs, and memory query spawns with no activityTimeoutMs, so non-interactive runs hang.
- source_files: src/cli/options.ts, src/cli/commands/plan.ts, packages/plan-browser/src/actions.ts, src/cli/commands/spawn.ts, packages/memory/src/query.ts
- severity: high
- impact: usability
- risk: medium
- fix: Gate every interactive path on process.stdin.isTTY and fail fast with actionable guidance instead of blocking.
  Pass activityTimeoutMs through memory query and check $EDITOR exists before spawning it.
- issue_docs: ux-login-non-tty-hangs-on-oauth.md, ux-plan-question-non-tty-may-hang.md, ux-plan-edit-hangs-without-editor.md, ux-spawn-interactive-non-tty-launches-agent-tui-copy.md, ux-memory-query-may-hang-or-stall.md

## C28: Success glyphs are used for failures and partial output
- root_cause: agentPrefix() hardcodes a green bold checkmark for all agent output, so streaming text, reasoning and outright failures all render as success.
- source_files: packages/toolcraft-design/src/acp/components.ts
- severity: high
- impact: usability
- risk: medium
- fix: Make agentPrefix state-aware: neutral glyph for streaming/partial text, success only on completed success, error glyph on failure.
  Ensure spawn/gaslight failure paths pick the error state so an invalid model or fail-fast run never shows checkmarks.
- issue_docs: ux-failure-shown-as-success-markers.md, ux-spawn-invalid-model-shows-success-then-failure.md, ux-acp-stream-uses-success-glyph-for-partial-text.md, ux-successful-spawn-still-uses-checkmark-for-agent-text.md, ux-gaslight-multi-plan-fails-fast-with-success-markers.md

## C29: finalize() closes the panel before the error and repeats the footer
- root_cause: context.finalize() runs in a finally block and always emits the 'Problems?' feedback footer, so the panel closes before the error is printed and the footer repeats once per sub-operation.
- source_files: src/cli/context.ts, src/cli/commands/agent.ts
- severity: high
- impact: usability
- risk: medium
- fix: Order finalize after error rendering (or make it error-aware) so failures print inside the panel.
  Emit the feedback footer once per process on exit, not per finalize call.
- issue_docs: ux-error-panel-closes-before-error.md, ux-problems-footer-on-every-success.md

## C30: logout dry-run floods with one panel per agent
- root_cause: logout.ts intros, then loops executeUnconfigure per configured service, and each re-intros/completes/finalizes, producing 720 lines and three footers for one command.
- source_files: src/cli/commands/logout.ts, src/cli/commands/unconfigure.ts
- severity: high
- impact: usability
- risk: medium
- fix: Extract the unconfigure work from its presentation so logout can render one summary panel covering every agent.
  Keep per-agent detail as rows inside the single panel rather than nested intro/complete cycles.
- issue_docs: ux-logout-dry-run-still-multi-panel-unconfigure.md

## C31: Dry-run previews misrepresent the change
- root_cause: The diff baseline is '--- /dev/null' for existing files, so configure --dry-run shows 340 lines of pre-existing settings as a fresh create; other previews print too little or list paths with no panel.
- source_files: src/utils/dry-run.ts, src/cli/context.ts, packages/github-workflows/src/commands.ts, src/providers/gemini-cli.ts
- severity: high
- impact: usability
- risk: medium
- fix: Diff against the real existing file so previews show only the delta, not the whole file as an addition.
  Frame path lists in a panel and report the effective env/model changes for gemini so the preview is neither misleading nor empty.
- issue_docs: ux-configure-dry-run-shows-full-existing-settings-as-create.md, ux-gemini-configure-dry-run-too-quiet.md, ux-gh-install-dry-run-lists-paths-without-panel.md

## C32: provider login/logout --dry-run performs real writes
- root_cause: executeProviderLogout calls unconfigureServicesForProvider outside the dryRun branch and login calls refreshConfiguredServicesForProvider, so --dry-run mutates agent configuration.
- source_files: src/cli/commands/provider.ts
- severity: high
- impact: usability
- risk: high
- fix: Move every mutation behind the dryRun check in both provider login and provider logout so --dry-run only previews.
  Add tests asserting no filesystem mutation occurs under --dry-run for both paths.
- issue_docs: ux-provider-logout-dry-run-unconfigures-agents.md, ux-provider-login-poe-dry-run-rewrites-claude-settings-xhigh.md

## C33: provider login poe --yes fails despite being logged in
- root_cause: provider.ts passes allowStored:false to resolveApiKey, so poe ignores the stored credential that auth status reports and fails under --yes.
- source_files: src/cli/commands/provider.ts, src/cli/options.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Allow the stored credential for providers whose preferred login is poe, so --yes reuses it instead of demanding a re-login.
  Keep allowStored:false only where a fresh credential is genuinely required.
- issue_docs: ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md

## C34: models filters use truthiness and skip validation
- root_cause: The filter chain gates on `if (options.x)` so empty strings are ignored and the full catalog is dumped, while unknown --feature/--provider/--output values match nothing and return a silent empty result.
- source_files: src/cli/commands/models.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Reject empty filter values and validate --provider/--feature/--output against the catalog's known values with suggestions.
  When a filter legitimately matches nothing, say so explicitly rather than printing an empty list or the whole catalog.
- issue_docs: ux-models-empty-search-returns-all.md, ux-models-raw-empty-model-dumps-all-yaml.md, ux-models-feature-bogus-silent-empty.md, ux-models-invalid-provider-silent-empty.md, ux-models-output-json-search-returns-empty-inconsistently.md, ux-models-since-1d-empty-today.md

## C35: models id matching ignores namespace and display name
- root_cause: --model/--view filter on the bare m.id only while the rows render owned_by + '/' + id, so the namespaced id the CLI itself displays returns an empty result.
- source_files: src/cli/commands/models.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Match --model and --view against both the bare id and the namespaced owned_by/id form the CLI renders.
  Make --search consider the combined label too, so copying a displayed id back into the command always works.
- issue_docs: ux-models-exact-id-filter-rejects-namespaced-ids.md, ux-models-view-raw-namespaced-id-returns-empty-array.md, ux-models-search-quoted-catalog-display-name-fails.md, ux-models-search-claude-slash-zero.md

## C36: models output is unbounded
- root_cause: registerModels declares no --limit and applies no default cap, so an unfiltered call dumps the entire 344-model catalog and the parameters view floods the terminal.
- source_files: src/cli/commands/models.ts, src/cli/commands/traces.ts
- severity: high
- impact: usability
- risk: medium
- fix: Add --limit with a sane default cap and a 'showing N of M' footer, mirroring the existing traces --limit option.
  Require a filter (or apply the cap) before rendering the parameters view.
- issue_docs: ux-models-dumps-full-catalog.md, ux-models-no-limit-flag-confirmed.md, ux-models-view-parameters-without-filter-floods.md

## C37: models filter flag ergonomics and undocumented semantics
- root_cause: --feature declares no collector so it is not repeatable, and --feature/--tools filter sequentially with no documentation of whether they AND or OR.
- source_files: src/cli/commands/models.ts
- severity: medium
- impact: usability
- risk: low
- fix: Add a collector to --feature so it repeats, and document the AND semantics of combined filters in help.
  Clarify the relationship between --feature and --tools or collapse them into one flag.
- issue_docs: ux-models-feature-flag-not-repeatable.md, ux-models-tools-and-feature-filter-semantics-undocumented.md

## C38: List commands are unbounded and show stale entries
- root_cause: runtime jobs ls and runtime templates ls register zero options and render every state entry, with no --limit/--since and inconsistent ls/list naming.
- source_files: src/cli/commands/runtime/jobs/ls.ts, src/cli/commands/runtime/templates/ls.ts, src/cli/commands/memory.ts
- severity: high
- impact: usability
- risk: medium
- fix: Add --limit/--since (and --all) to both ls commands with a default cap, and pass them into JobListFilter.
  Standardise on one of ls/list with the other as an alias so memory and runtime agree.
- issue_docs: ux-runtime-jobs-ls-help-no-limit-or-since.md, ux-runtime-jobs-ls-unbounded-may-era-reconfirmed.md, ux-runtime-templates-ls-unbounded-stale.md, ux-runtime-jobs-ls-inconsistent-with-list.md

## C39: runtime jobs report stale 'running' zombies and resolve ambiguously
- root_cause: readDetachedExitCode returns null when docker exec fails, so dead jobs stay 'running', and resolveJob then throws a plain uncapped list of every running candidate.
- source_files: src/cli/commands/runtime/jobs/shared.ts, packages/process-runner/src/docker/docker-execution-env.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Treat an unreachable container as terminated (mark exit unknown/failed) instead of leaving state 'running'.
  Make resolveJob prefer the unambiguous recent match and cap/format the candidate list as a user error.
- issue_docs: ux-runtime-jobs-stale-running-zombies.md, ux-runtime-jobs-stop-lists-many-stale-running.md, ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md

## C40: launch state is corrupt: blank ids, tombstones, false running
- root_cause: listIds() returns every non-file entry in baseDir including tombstone dirs left by remove(), and the supervisor flips to 'running' before the process is confirmed alive.
- source_files: packages/process-launcher/src/launcher.ts, packages/process-launcher/src/supervisor/supervisor.ts, packages/process-launcher/src/state/state-store.ts, src/cli/commands/launch.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Filter tombstone/malformed dirs out of listIds and make remove() clean up rather than rename into a listable state.
  Confirm liveness before reporting 'running', validate process ids, and replace the static start-failure message with the real cause.
- issue_docs: ux-launch-status-blank-id-rows-reconfirmed.md, ux-launch-status-blank-id-zombie-rows.md, ux-launch-status-crashes-on-tombstone-dirs.md, ux-launch-start-claims-running-then-status-stopped.md, ux-launch-start-via-npm-run-dev-confuses-argv.md, ux-launch-start-triggers-turbo-monorepo-build.md

## C41: --detach and --runner-sync are silently ignored
- root_cause: detach is computed as factory.supportsDetach && requested, and the host execution env sets supportsDetach:false, so --detach silently runs inline; --runner-sync has no dependency check on --detach.
- source_files: packages/agent-harness-tools/src/poe-command-execution.ts, packages/process-runner/src/host/host-execution-env.ts, src/cli/commands/runtime-options.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Fail with a clear user error when --detach is requested but the resolved execution env cannot detach, instead of downgrading silently.
  Validate that --runner-sync requires --detach, and honour detach on the failure path too.
- issue_docs: ux-spawn-detach-silently-ignored-without-runtime.md, ux-spawn-detach-ignored-on-failure-path.md, ux-runner-sync-without-detach-silently-ignored.md, ux-detach-runtime-host-still-inline.md

## C42: hooks bridge strategies fail opaquely and refuse valid setups
- root_cause: skill-bridge maps auto to undefined so it refuses user-authored settings, transform throws 'Transforming hooks from codex is not supported', and the hooks path hardcodes binaryName 'poe-code' causing ENOENT.
- source_files: packages/agent-spawn/src/skill-bridge.ts, packages/agent-hook-config/src/bridge-hooks.ts, packages/agent-hook-config/src/symlink-hooks.ts, src/utils/command-checks.ts, src/cli/commands/spawn.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Make auto fall back to a working strategy rather than undefined, and resolve the real binary path instead of hardcoding 'poe-code'.
  Document which source->target hook transforms are supported in --hooks-strategy help and raise a user error naming the supported pairs.
- issue_docs: ux-hooks-auto-strategy-still-refuses-user-settings.md, ux-hooks-from-codex-to-claude-transform-unsupported.md, ux-hooks-from-spawn-poe-code-enoent.md, ux-hooks-strategy-transform-unsupported-opaque.md

## C43: gemini requires a native provider credential instead of Poe
- root_cause: gemini-cli declares apiShapes ['google-generations'] served only by cloudflare, and gemini-cli.ts maps GEMINI_API_KEY to providerCredential, so spawn/test/configure demand a native key or a cloudflare base URL.
- source_files: packages/agent-defs/src/agents/gemini-cli.ts, src/providers/gemini-cli.ts, src/cli/isolated-env.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Let gemini resolve its credential from the Poe API key path like the other agents, or state the native-key requirement up front in help.
  Replace the 'Provider cloudflare requires a base URL' dead end with actionable guidance naming the flag and a working value.
- issue_docs: ux-spawn-gemini-provider-credential-missing.md, ux-test-gemini-requires-native-api-key-not-poe.md, ux-configure-gemini-requires-cloudflare-base-url-when-provider-set.md

## C44: install and test always report success
- root_cause: install.ts always completes with 'Installed <label>.' regardless of the adapter result, and the test failure path dumps raw JSONL stdout/stderr instead of a verdict.
- source_files: src/cli/commands/install.ts, src/cli/commands/test.ts, src/utils/command-checks.ts, src/services/service-install.ts
- severity: medium
- impact: usability
- risk: medium
- fix: Report the real adapter outcome (installed / already present / failed) instead of an unconditional success line.
  Summarise test failures with the cause and keep the raw JSONL behind --verbose.
- issue_docs: ux-install-always-success-reconfirmed.md, ux-test-failure-dumps-jsonl.md

## C45: --force does not overwrite; installs fail with 'already exists'
- root_cause: The install commands declare '--force Overwrite existing files' but never pass flags.force into installSkill, so apply.ts throws 'Skill already exists'; pipeline gates steps.yaml on force but skips the skill entirely.
- source_files: src/cli/commands/experiment.ts, src/cli/commands/pipeline.ts, src/cli/commands/memory.ts, src/cli/commands/gaslight.ts, packages/agent-skill-config/src/apply.ts
- severity: high
- impact: usability
- risk: medium
- fix: Thread --force through to installSkill/scaffold in every install command so it actually overwrites, and add it where missing (memory install).
  Make the skip-vs-overwrite decision uniform across experiment/pipeline/gaslight and show a diff before overwriting.
- issue_docs: ux-experiment-install-force-does-not-overwrite-skill.md, ux-experiment-install-force-still-fails-already-exists.md, ux-experiment-install-already-exists-vs-pipeline-skip.md, ux-pipeline-install-force-skips-skill-overwrites-steps.md, ux-memory-install-no-force-already-exists.md, ux-gaslight-install-force-dry-run-vs-already-exists.md, ux-gaslight-install-force-overwrites-without-diff.md

## C46: Success framing when nothing was done
- root_cause: pipeline install logs 'Skip: ... (already exists)' then unconditionally reports success, and 'Nothing to run.' is followed by a success completion.
- source_files: src/cli/commands/pipeline.ts
- severity: medium
- impact: usability
- risk: low
- fix: Report the aggregate outcome: 'skipped (already installed)' or 'nothing to run' as the terminal state rather than success.
  Exit with a distinct status/verdict when no work occurred.
- issue_docs: ux-pipeline-install-claims-success-when-all-skipped.md, ux-pipeline-nothing-to-run-success-framing.md

## C47: Wrong frontmatter kind is reported as 'document not found'
- root_cause: readExperimentDoc and peers wrap readFile and parseFrontmatter in one bare try/catch, so a kind mismatch becomes 'No markdown doc found', and ralph init requires an existing ralph doc to create one.
- source_files: src/cli/commands/experiment.ts, src/cli/commands/ralph.ts, packages/ralph/src/frontmatter/frontmatter.ts
- severity: high
- impact: usability
- risk: medium
- fix: Separate the read failure from the parse failure so a kind mismatch says 'found <path> but kind is plan, expected experiment'.
  Break the ralph init circular requirement so init can scaffold a ralph doc from nothing.
- issue_docs: ux-experiment-journal-wrong-kind-says-not-found.md, ux-experiment-validate-wrong-kind-says-not-found.md, ux-ralph-run-plan-kind-says-ralph-doc-not-found.md, ux-experiment-ralph-no-doc-wrong-message.md, ux-experiment-journal-error-when-no-doc-provided.md, ux-ralph-init-requires-existing-ralph-doc-circular.md

## C48: superintendent validate reports 'Unclosed tag' with no location
- root_cause: The document parser throws/emits 'Unclosed tag' with no tag name, line number or file context.
- source_files: packages/superintendent/src/document/parse.ts
- severity: high
- impact: usability
- risk: low
- fix: Include the tag name, line/column and file path in the validation message, plus the expected closing form.
  Report it as a user error with a recovery hint rather than a bare bullet.
- issue_docs: ux-superintendent-validate-unclosed-tag.md, ux-superintendent-validate-unclosed-tag-opaque.md

## C49: README.md is treated as a plan document
- root_cause: isSupportedPlanFile accepts any .md and classifies frontmatter-less files as kind plan, so docs/plans/README.md is listed, archivable and deletable.
- source_files: packages/plan-browser/src/discovery.ts
- severity: high
- impact: correctness
- risk: low
- fix: Exclude README.md (and other non-plan docs) from plan discovery, or require plan frontmatter to classify a file as a plan.
  Reject archive/delete on excluded files with a clear reason.
- issue_docs: ux-plan-delete-allows-readme.md, ux-plan-archive-allows-readme.md, ux-plan-list-includes-exactly-one-readme.md, ux-plan-list-includes-readme-reconfirmed.md

## C50: Empty lists render an empty table instead of a message
- root_cause: renderTable is called with no empty-rows guard, and templates ls pushes a placeholder '(empty)' row.
- source_files: src/cli/commands/plan.ts, src/cli/commands/runtime/templates/ls.ts
- severity: medium
- impact: polish
- risk: low
- fix: Add an empty-state branch that prints a short message plus the next step instead of table chrome with no rows.
  Drop the placeholder '(empty)' row.
- issue_docs: ux-empty-plan-kind-lists-still-draw-empty-tables.md, ux-plan-list-empty-table-no-message.md, ux-runtime-templates-ls-empty-rows.md

## C51: Tables ignore terminal width
- root_cause: getColumnWidth/computeColumns size columns from content with no terminal-width budget, so rows reach 213 columns and wrap unreadably; the renderer also joins arrays into one long cell.
- source_files: packages/toolcraft-design/src/components/table.ts, packages/toolcraft/src/renderer.ts, src/cli/commands/provider.ts
- severity: medium
- impact: usability
- risk: medium
- fix: Budget total table width to process.stdout.columns and truncate/wrap the widest cells.
  Render list-valued cells as stacked lines rather than a ', '-joined string.
- issue_docs: ux-tables-ignore-terminal-width.md, ux-provider-list-table-layout-broken.md, ux-code-review-install-output-unframed-wrapped.md

## C52: Raw stdout output bypasses the design system
- root_cause: Many commands write JSON.stringify or hand-built key: value lines straight to process.stdout instead of using the design-system panels/tables the sibling commands use.
- source_files: src/cli/commands/auth.ts, src/cli/commands/memory.ts, src/cli/commands/memory-mcp.ts, src/cli/commands/plan.ts, src/cli/commands/config.ts, src/cli/commands/harness.ts, packages/agent-code-review/src/cli.ts
- severity: medium
- impact: polish
- risk: low
- fix: Route these outputs through the design-system renderer so framing matches models/auth status.
  Keep machine-readable dumps behind --json rather than as the default human output.
- issue_docs: ux-code-review-profiles-bare-table.md, ux-code-review-prompt-preview-unframed.md, ux-memory-ls-search-show-raw-unframed.md, ux-memory-mcp-print-config-raw-json.md, ux-memory-status-after-write-is-terse.md, ux-auth-whoami-raw-json-vs-status-panel.md, ux-plan-markdown-read-raw-yaml-ish-output.md, ux-utils-config-show-dumps-large-json.md, ux-harness-run-success-opaque-result-object.md

## C53: --json is inconsistent and missing where output is machine-read
- root_cause: --json exists only on tasks and traces; auth status, provider list and peers have no --json even though they print structured data.
- source_files: src/cli/commands/auth.ts, src/cli/commands/provider.ts, src/cli/commands/tasks.ts, src/cli/commands/traces.ts
- severity: medium
- impact: usability
- risk: low
- fix: Add a shared --json option helper and register it on every command that renders structured data.
  Make whoami reuse it instead of always dumping raw JSON.
- issue_docs: ux-json-flag-inconsistent-across-commands.md, ux-auth-status-no-json-flag.md, ux-provider-list-no-json-flag.md

## C54: spawn validates --mode before resolving the agent
- root_cause: resolveSpawnMode runs before resolveSpawnTarget, so an empty/invalid agent reports a mode error first and hides the real problem.
- source_files: src/cli/commands/spawn.ts
- severity: high
- impact: usability
- risk: low
- fix: Resolve and validate the agent argument before the mode, so the first error names the actual missing input.
  Add a test asserting error precedence.
- issue_docs: ux-spawn-empty-agent-validates-mode-first.md, ux-spawn-validates-mode-before-agent-reconfirmed.md

## C55: Permission mode sets diverge across commands and are case-sensitive
- root_cause: spawn offers 'yolo|auto|edit|read' while gaslight declares a different choices list, and parseSpawnMode does an exact string match so 'READ' is rejected.
- source_files: src/cli/commands/spawn.ts, src/cli/commands/gaslight.ts, README.md
- severity: high
- impact: usability
- risk: medium
- fix: Define the mode enum once and share it across spawn/gaslight/pipeline so the sets cannot drift.
  Lowercase input before matching, and document the CI-required --mode in the README spawn section.
- issue_docs: ux-permission-mode-sets-differ-across-commands.md, ux-spawn-mode-case-sensitive.md, ux-readme-spawn-omits-mode-for-ci.md

## C56: Flags exist on one command but not its siblings
- root_cause: worktree options, --activity-timeout-ms, --reasoning-effort and the skill/skills flags are registered on some commands and absent on others with no shared option module, and skill vs skills naming collides.
- source_files: src/cli/commands/spawn.ts, src/cli/commands/gaslight.ts, src/cli/commands/skill.ts, src/cli/commands/install.ts, src/cli/commands/worktree-options.ts, src/cli/commands/runtime-options.ts
- severity: high
- impact: usability
- risk: medium
- fix: Extract shared option registrars (worktree, activity timeout, reasoning effort, skill refs) and apply them uniformly to spawn/gaslight/pipeline/install.
  Document the --skill vs --skills relationship and add the missing 'skills' alias.
- issue_docs: ux-install-skill-flags-inconsistent-across-commands.md, ux-gaslight-has-worktree-spawn-does-not.md, ux-gaslight-no-activity-timeout-flag.md, ux-spawn-missing-reasoning-effort-flag.md, ux-skill-and-skills-flags-undocumented-relationship.md, ux-skill-naming-collisions.md

## C57: Commands that write have no --dry-run
- root_cause: code-review install, gaslight ingest, github-workflows install and tasks import expose no --dry-run (or declare the param but never surface the flag), unlike the rest of the CLI.
- source_files: packages/agent-code-review/src/cli.ts, src/cli/commands/gaslight.ts, packages/github-workflows/src/commands.ts, src/cli/commands/tasks.ts
- severity: medium
- impact: usability
- risk: medium
- fix: Register --dry-run on every writing command and read flags.dryRun in its action, matching the configure/install convention.
  Validate required flags after the dry-run branch so tasks import --dry-run does not demand --to.
- issue_docs: ux-code-review-install-no-dry-run-force-writes.md, ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md, ux-gh-install-preview-without-dry-run-flag.md, ux-tasks-import-dry-run-still-requires-to.md

## C58: cursor provider is a no-op that reports success
- root_cause: cursor.ts declares manifest: { configure: [] } so configure performs zero filesystem ops, and --model is accepted but never written.
- source_files: src/providers/cursor.ts, src/utils/dry-run.ts
- severity: medium
- impact: usability
- risk: low
- fix: Either implement the cursor configure manifest or state plainly that cursor requires no configuration and reject --model.
  Stop reporting a successful configure when nothing was written.
- issue_docs: ux-configure-cursor-dry-run-no-filesystem-changes.md, ux-configure-cursor-model-flag-silent-noop.md

## C59: plan edit claims 'Edited' without any change
- root_cause: plan.ts prints `Edited ${plan.path}` unconditionally after editPlan() and never compares content.
- source_files: src/cli/commands/plan.ts, packages/plan-browser/src/actions.ts
- severity: medium
- impact: correctness
- risk: low
- fix: Compare content before/after the editor exits and report 'No changes' when unchanged.
  Frame the message through the design system instead of a bare line.
- issue_docs: ux-plan-edit-editor-true-claims-edited-without-change.md, ux-plan-edit-bare-edited-message.md

## C60: plan routes unknown subcommands into a question session
- root_cause: plan declares .argument('[question]') and routes any non-empty positional to a session, so a typo'd subcommand silently starts an agent run; browse rejects a path argument that view accepts.
- source_files: src/cli/commands/plan.ts
- severity: medium
- impact: usability
- risk: medium
- fix: Check the positional against the registered subcommand names and report unknown-subcommand with suggestions before treating it as a question.
  Accept an optional path argument on browse for parity with view.
- issue_docs: ux-plan-unknown-subcommand-treated-as-question.md, ux-plan-question-starts-session-without-mode.md, ux-plan-browse-rejects-path-argument.md

## C61: plan view / markdown-read are inconsistent and flood output
- root_cause: The json branch always embeds full markdown content with no --include-content flag, not-found errors differ between plan view and markdown-read, depth 1 returns no sections for H1-only docs, and the recovery hint names a non-existent command.
- source_files: src/cli/commands/plan.ts, packages/markdown-reader/src/core/resolve.ts
- severity: high
- impact: usability
- risk: medium
- fix: Add --include-content (default off) to the json output and align the not-found error shape across plan view and markdown-read.
  Fix the depth-1 section walk for H1-only docs and correct the 'try read-markdown' hint to the real command name.
- issue_docs: ux-plan-view-json-embeds-full-content-flood.md, ux-plan-view-vs-markdown-read-not-found-inconsistent.md, ux-markdown-read-depth-1-empty-for-h1-only-structure.md, ux-markdown-read-section-wrong-recovery-command.md, ux-plan-markdown-reader-mcp-help-minimal.md

## C62: approvals --state accepts invalid values and returns silent empty
- root_cause: state is declared as S.Optional(S.String()) with no enum, so an unknown state filters everything out and prints nothing.
- source_files: packages/toolcraft/src/human-in-loop/approvals-commands.ts
- severity: medium
- impact: correctness
- risk: low
- fix: Constrain state to the known enum via the schema so invalid values are rejected with the valid list.
  Print an explicit empty-state message when a valid filter matches nothing.
- issue_docs: ux-approvals-invalid-state-silent-empty-reconfirmed.md

## C63: Invalid PR URL is accepted and fails later with the wrong error
- root_cause: canonicalPullRequestUrl returns the input unchanged when it does not match, so an invalid URL flows on and surfaces as an unrelated downstream failure.
- source_files: packages/github-review/src/pr-url.ts, packages/agent-code-review/src/cli.ts
- severity: high
- impact: usability
- risk: low
- fix: Make canonicalPullRequestUrl reject non-matching input with a user error showing the expected URL shape.
  Validate at the command boundary so the message names the argument.
- issue_docs: ux-code-review-run-invalid-url-wrong-error.md

## C64: eval first-run is broken by the placeholder target repo
- root_cause: init.ts defaultTargetRepo points at poe-code's own git remote, so eval check fails immediately on a freshly initialised eval, and init prints a bare name with a confusing cwd default.
- source_files: packages/agent-eval/src/init/init.ts, packages/agent-eval/src/run/clone.ts, packages/agent-eval/src/cli/check.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Require the target repo at init (or fail check with guidance naming the placeholder) instead of shipping a default that cannot work.
  Print the resolved eval directory rather than a bare name, and make the sourceDir default explicit.
- issue_docs: ux-eval-check-fails-on-placeholder-target-git-remote.md, ux-eval-init-prints-bare-name-and-cwd-default-confusing.md

## C65: harness discovery and template kinds are undiscoverable
- root_cause: The kind argument help is only 'Built-in template kind' with no .choices() or listing, and discoverProjectThenUserHarnesses hardcodes roots to cwd/.poe-code so harnesses created elsewhere are invisible.
- source_files: src/cli/commands/harness.ts
- severity: high
- impact: usability
- risk: medium
- fix: List the built-in kinds in help/.choices() so they need not be guessed.
  Include the directory harness new actually wrote to in discovery roots, and make the no-path error explain how to specify one.
- issue_docs: ux-harness-new-kinds-undocumented-must-guess-demo-names.md, ux-harness-list-only-cwd-not-created-dir.md, ux-harness-run-no-path-says-no-pairs.md

## C66: maestro duplicates flags and confuses path with subcommand
- root_cause: program.ts defines --config and --workflow both as 'Path to WORKFLOW.md' then throws, and maestro takes a free-form [path] while special-casing 'tui'.
- source_files: src/cli/program.ts
- severity: high
- impact: usability
- risk: medium
- fix: Keep one flag (alias the other) for the workflow path and remove the conflicting throw.
  Register tui as a real subcommand instead of special-casing the positional path.
- issue_docs: ux-maestro-config-vs-workflow-flags-duplicated.md, ux-maestro-dry-run-path-vs-flag-confusion.md

## C67: memory query/explain expose internals and lack a --model flag
- root_cause: query registers only --budget/--agent with '--budget <tokens> Token budget' phrasing that leaks the token-budget internal, and no --model despite the underlying spawn accepting one.
- source_files: src/cli/commands/memory.ts, packages/memory/src/query.ts
- severity: medium
- impact: usability
- risk: low
- fix: Add --model to memory query/explain and pass it through to the spawn call.
  Reword --budget in user terms and expand the terse argument descriptions.
- issue_docs: ux-memory-query-no-model-flag.md, ux-memory-query-terse-description-and-budget-exposed.md, ux-memory-explain-budget-token-internals.md

## C68: usage exposes pagination internals and hides its default
- root_cause: --pages is described as 'Number of pages to load automatically' with page size hardcoded to limit=20, and balance is registered hidden while being the default action.
- source_files: src/cli/commands/usage.ts
- severity: medium
- impact: usability
- risk: low
- fix: Replace --pages with a --limit expressed in entries and derive pagination internally.
  Unhide balance (or document it as the default) so the default action is discoverable.
- issue_docs: ux-usage-help-hides-default-balance-reconfirmed.md, ux-usage-list-pages-exposes-pagination-internals.md, ux-usage-pages-1-still-shows-20-entries.md

## C69: traces titles are agent names and json floods untruncated
- root_cause: The poe-code reader sets title from the parsed log file name (an agent name), and run.ts JSON.stringify's references with untruncated titles while render.ts truncates.
- source_files: packages/agent-traces/src/readers/poe-code.ts, src/cli/commands/traces.ts
- severity: medium
- impact: usability
- risk: low
- fix: Derive trace titles from the prompt/session content like the claude reader, not the log file name.
  Apply the same truncation policy to json output as the rendered view, or gate full titles behind a flag.
- issue_docs: ux-traces-json-includes-full-prompt-titles.md, ux-traces-poe-code-source-titles-are-agent-names.md

## C70: update/version misdetect the install and nag dev builds
- root_cause: detectPoeCodePackageManager reads only npm_config_user_agent/npm_execpath so it always suggests npm install -g, and semver.gt has no 0.0.0-dev guard.
- source_files: src/services/update.ts, src/services/version.ts
- severity: medium
- impact: usability
- risk: low
- fix: Detect the real install source (global npm / pnpm / bun / local) and suggest the matching upgrade command.
  Skip the version nag for 0.0.0-dev builds.
- issue_docs: ux-update-always-suggests-npm-install-g.md, ux-version-nags-dev-to-major-jump.md

## C71: Logger glyphs and verbose prefixes are noisy or ambiguous
- root_cause: infoSymbol and successSymbol are both magenta so states are indistinguishable, formatMessage prefixes '[scope] ' on every verbose line, and the spinner fallback writes a bare line before the panel.
- source_files: src/cli/logger.ts, packages/toolcraft-design/src/prompts/primitives/spinner.ts
- severity: low-medium
- impact: polish
- risk: low
- fix: Give info and success distinct colours/glyphs so the states read apart at a glance.
  Prefix the scope once per block rather than per line, and align the spinner fallback with the panel framing.
- issue_docs: ux-success-and-info-share-magenta-glyphs.md, ux-verbose-prefixes-every-log-line.md, ux-verbose-spawn-prefix-minimal.md, ux-auth-status-spinner-pre-panel.md

## C72: Help lacks examples and does not group advanced flags
- root_cause: Only models.ts calls addHelpText, so configure/spawn and the other primary commands ship no examples, and spawn lists 22 flat options including raw MCP JSON schema and infrastructure flags.
- source_files: src/cli/commands/configure.ts, src/cli/commands/spawn.ts, src/cli/commands/models.ts, src/cli/commands/plan.ts, src/cli/program.ts
- severity: medium
- impact: usability
- risk: low
- fix: Add an Examples block to each primary command and group spawn's options into Common/Advanced/Infrastructure.
  Move the raw MCP schema out of the flag description and document the TUI keybindings referenced by --tui.
- issue_docs: ux-configure-help-missing-examples.md, ux-primary-commands-still-lack-examples.md, ux-spawn-advanced-flags-undifferentiated.md, ux-spawn-help-infrastructure-flags-exposed.md, ux-models-help-duplicate-sections-unstyled.md, ux-plan-help-stacked-layout-and-internal-commands.md, ux-plan-help-keymap-hint-unframed.md, ux-dashboard-keybindings-undocumented-on-cli-help.md

## C73: utils symlink help bypasses the design system
- root_cause: utils-symlink.ts overrides configureHelp with a hardcoded formatHelp returning plain uncoloured strings, and registers skills only as a nested command with no top-level alias.
- source_files: src/cli/commands/utils-symlink.ts
- severity: medium
- impact: polish
- risk: low
- fix: Drop the hardcoded formatHelp override and use the shared design-system help formatter.
  Add the top-level alias so the skills symlink command is reachable where users look for it.
- issue_docs: ux-utils-symlink-help-missing-design-system-colors.md, ux-utils-symlink-help-unformatted-white-text.md, ux-utils-symlink-skills-is-nested-not-top-level.md

## C74: Help formatting polish: casing, usage lines, parent-help fallbacks
- root_cause: Group commands print 'help [command] display help for command' in lowercase, usage lines show [options] instead of <command>, addHelpCommand(false) is applied inconsistently, and an unknown worktree subcommand prints parent help and exits 0.
- source_files: src/cli/program.ts, src/cli/commands/worktree.ts, src/cli/commands/pipeline.ts, src/cli/commands/ralph.ts, src/cli/commands/experiment.ts, src/cli/commands/worktree-options.ts
- severity: low
- impact: polish
- risk: low
- fix: Normalise the help command description casing and the group usage line to '<command>' across every group.
  Apply addHelpCommand consistently, exit non-zero on unknown subcommands, and drop the trailing period on the worktree flag description.
- issue_docs: ux-harness-help-command-lowercase-description.md, ux-provider-help-command-lowercase-systemic.md, ux-help-subcommand-inconsistency.md, ux-group-commands-usage-shows-options-not-command.md, ux-worktree-unknown-subcommand-shows-parent-help.md, ux-worktree-flag-description-trailing-period.md

## C75: Parent groups only dump help instead of doing something useful
- root_cause: The pipeline/skill/provider/launch/worktree groups register no .action() (or call this.help()), so a bare group invocation just prints help.
- source_files: src/cli/commands/pipeline.ts, src/cli/commands/skill.ts, src/cli/commands/provider.ts, src/cli/commands/launch.ts, src/cli/commands/worktree.ts
- severity: medium
- impact: usability
- risk: low
- fix: Give each group a useful default action (usually its status/list subcommand) or exit non-zero with a clear 'pick a subcommand' panel.
  Apply one convention across all groups.
- issue_docs: ux-group-commands-print-help-only.md, ux-many-parent-groups-only-dump-help.md

## C76: Branding leaks: toolcraft name, extra npm bins, inconsistent tagline
- root_cause: renderHumanInLoopPending hardcodes 'toolcraft approvals' in copy, package.json publishes six bins, and program.ts defines two different taglines.
- source_files: packages/toolcraft/src/cli.ts, package.json, src/cli/program.ts
- severity: high
- impact: usability
- risk: medium
- fix: Parameterise the toolcraft copy so forwarded commands print the host binary name.
  Trim the published bins to the supported set and define the tagline once.
- issue_docs: ux-approval-copy-hardcodes-toolcraft-in-source.md, ux-extra-npm-bins-still-published-reconfirmed.md, ux-root-tagline-inconsistent.md

## C77: Missing doctor / health overview command
- root_cause: No doctor command is registered anywhere (rg finds no matches outside docs), so there is no single health/diagnostic overview.
- source_files: src/cli/program.ts
- severity: high
- impact: usability
- risk: medium
- fix: Add a doctor command that reports auth, configured agents, model catalog reachability and runtime availability with pass/fail rows.
  Register it in root help and reuse the existing status checks rather than duplicating them.
- issue_docs: ux-doctor-still-missing-reconfirmed-2026-07-08.md, ux-doctor-and-completion-still-missing.md, ux-no-doctor-or-health-overview-command.md

## C78: Missing shell completion command
- root_cause: No completion command is registered in program.ts, so there is no way to install shell completions.
- source_files: src/cli/program.ts
- severity: medium
- impact: usability
- risk: low
- fix: Add a completion command emitting bash/zsh/fish scripts derived from the Commander tree.
  Register it in root help.
- issue_docs: ux-completion-command-missing.md

## C79: Missing top-level aliases: help, whoami, version, dashboard
- root_cause: help/whoami/version/dashboard are not registered at root (whoami exists only under auth, version only as -V, dashboard only as maestro tui), so the conventional invocations fail with 'Unknown command'.
- source_files: src/cli/program.ts, src/cli/commands/version.ts, src/cli/commands/auth.ts
- severity: medium
- impact: usability
- risk: low
- fix: Register root-level help, whoami, version and dashboard aliases forwarding to their existing implementations.
  Include them in root help so the conventional forms are discoverable.
- issue_docs: ux-help-command-not-registered.md, ux-whoami-root-missing-auth-only.md, ux-version-subcommand-missing-use-flag.md, ux-dashboard-command-missing.md

## C80: skill group lacks list and bridge subcommands
- root_cause: skill.ts registers only install/configure/unconfigure, so there is no way to see which skills are installed.
- source_files: src/cli/commands/skill.ts
- severity: high
- impact: usability
- risk: low
- fix: Add skill list (and the bridge subcommand) reusing the existing discovery helpers.
  Register them in the group help.
- issue_docs: ux-skill-list-command-missing.md, ux-skill-no-list-or-bridge-subcommands.md

## C81: ralph validate command is missing
- root_cause: ralph.ts registers only init/run, so a ralph doc cannot be validated the way experiment/superintendent docs can.
- source_files: src/cli/commands/ralph.ts
- severity: medium
- impact: usability
- risk: low
- fix: Add ralph validate reusing the existing frontmatter parser and the experiment validate output shape.
  Register it in ralph help.
- issue_docs: ux-ralph-validate-command-missing.md

## C82: utils config path subcommand is missing
- root_cause: config.ts registers only show/init/edit, so there is no way to print the config file path.
- source_files: src/cli/commands/config.ts
- severity: medium
- impact: usability
- risk: low
- fix: Add utils config path printing the resolved config file location.
  Reuse the same resolver show/edit use.
- issue_docs: ux-utils-config-path-subcommand-missing.md

## C83: runtime jobs show subcommand is missing
- root_cause: jobs/index.ts registers ls/attach/logs/stop/sync/sandbox but no show, so 'jobs show' misfires and suggests stop.
- source_files: src/cli/commands/runtime/jobs/index.ts, src/cli/commands/runtime/jobs/shared.ts
- severity: medium
- impact: usability
- risk: low
- fix: Add a jobs show subcommand rendering a single job's detail via the existing resolveJob.
  Register it so the suggestion engine stops pointing at stop.
- issue_docs: ux-runtime-jobs-show-unknown-suggests-stop.md

## C84: braintrust has only status with no enable/disable and no next step
- root_cause: Only 'status' is registered under the braintrust group and it logs a bare 'disabled' with no way to change it.
- source_files: src/cli/commands/braintrust.ts
- severity: medium
- impact: usability
- risk: low
- fix: Add enable/disable subcommands and print the next step when status is disabled.
  Register them in the group help.
- issue_docs: ux-braintrust-only-status-no-enable.md, ux-braintrust-status-disabled-no-next-step.md

## C85: --yes silently picks the default agent
- root_cause: install/plan install/skill configure fall back to DEFAULT_SERVICE_AGENT (claude-code) under --yes with no echo, so a skill is written for an agent the user never chose.
- source_files: src/cli/commands/configure.ts, src/cli/commands/plan.ts, src/cli/commands/skill.ts, src/cli/commands/install.ts
- severity: high
- impact: usability
- risk: medium
- fix: Echo the resolved agent and scope in the output whenever --yes selects a default, so the choice is visible.
  Use one shared default-agent resolver across install/plan/skill instead of per-command constants.
- issue_docs: ux-install-yes-silently-defaults-to-claude.md, ux-plan-install-yes-defaults-claude-writes-skill.md, ux-skill-configure-yes-defaults-agent-silently.md

## C86: spawn logging fails silently and never reports its path
- root_cause: ensureOpen() swallows mkdir/open failures in a try/catch so an unwritable log dir is silently ignored, the default path is undocumented, and --log-content carries no warning that it records message content.
- source_files: packages/agent-spawn/src/acp/middlewares/spawn-log.ts, packages/agent-spawn/src/acp/spawn-log-path.ts, src/cli/commands/spawn.ts
- severity: high
- impact: correctness
- risk: medium
- fix: Report log-dir failures as a user error instead of swallowing them, and print the resolved log path once when logging is on.
  Add a warning to --log-content that prompts and tool content are written to disk.
- issue_docs: ux-log-dir-unwritable-silently-ignored.md, ux-log-file-name-no-path-feedback.md, ux-log-content-flag-no-danger-warning.md

## C87: opencode model ids get a triple namespace prefix
- root_cause: providerModel() prefixes PROVIDER_NAME onto an already-namespaced id, so the written model is not found and the failure dumps a stack.
- source_files: src/providers/opencode.ts, src/cli/constants.ts
- severity: medium
- impact: correctness
- risk: low
- fix: Strip any existing namespace before applying the provider prefix so the id is namespaced exactly once.
  Add a test over the namespaced/bare/aliased input forms.
- issue_docs: ux-opencode-model-triple-namespace.md, ux-test-opencode-model-not-found-dumps-stack.md

## C88: --mcp-servers accepts an empty map silently
- root_cause: mcp-spawn-config.ts returns undefined for an empty server map with no error or warning, so a misconfigured file looks like it worked.
- source_files: src/cli/mcp-spawn-config.ts
- severity: low-medium
- impact: usability
- risk: low
- fix: Reject an empty --mcp-servers map with a user error naming the file and the expected shape.
  Keep the existing missing-file ValidationError wording as the reference for the message.
- issue_docs: ux-mcp-servers-empty-object-accepted.md, ux-mcp-servers-missing-file-almost-good.md

## C89: codex spawn inherits stdin on a tty-less run
- root_cause: spawn.ts sets stdin to inherit whenever the prompt is an argument, so a tty-less run consumes the caller's stdin and reports success.
- source_files: packages/agent-spawn/src/spawn.ts
- severity: medium
- impact: usability
- risk: medium
- fix: Only inherit stdin when a TTY is present; otherwise use 'ignore' so the agent cannot swallow piped input.
  Add a test covering the tty-less argument-prompt path.
- issue_docs: ux-spawn-codex-reads-stdin-message-on-tty-less-success.md

## C90: configure --provider demands a model without listing the choices
- root_cause: resolveFreeformProviderModel throws a plain 'requires a model' Error with no list of the provider's available models.
- source_files: src/cli/commands/configure-payload.ts
- severity: medium
- impact: usability
- risk: low
- fix: Raise a user error that lists the provider's available models (or points at models --provider <x>).
  Reuse the catalog lookup the models command already has.
- issue_docs: ux-configure-provider-requires-model-without-listing-models.md

## C91: goose skill dir diverges from the other agents
- root_cause: configs.ts sets goose localSkillDir to '.agents/skills' while claude and peers use their own agent dirs, with no explanation.
- source_files: packages/agent-skill-config/src/configs.ts
- severity: low-medium
- impact: usability
- risk: low
- fix: Confirm the correct goose skill directory and align it (or document why it differs) in the config table.
  Surface the resolved dir in the configure output so it is not a surprise.
- issue_docs: ux-skill-configure-goose-writes-dot-agents-skills.md

## C92: gaslight help copy misstates behaviour and undocumented archive interaction
- root_cause: The plans argument help says 'Markdown plans to implement sequentially' and the default prompt is 'Implement', while --archive/--no-archive defaults differ between gaslight and pipeline with no documentation.
- source_files: src/cli/commands/gaslight.ts, packages/agent-gaslight/src/config.ts, src/cli/commands/pipeline.ts
- severity: high
- impact: usability
- risk: low
- fix: Correct the argument/prompt copy to describe what gaslight actually does with the plan.
  Document the --archive default and align it with pipeline or explain the difference in help.
- issue_docs: ux-gaslight-help-says-plan-to-implement.md, ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md

## C93: otel capture reports success without showing the endpoint
- root_cause: native-otel.ts builds the endpoint but never prints it, so --capture-otel alone silently succeeds with no indication of where traces went.
- source_files: packages/agent-spawn/src/native-otel.ts
- severity: medium
- impact: usability
- risk: low
- fix: Print the resolved OTEL endpoint when capture is enabled, and warn when it is unset rather than succeeding silently.
- issue_docs: ux-capture-otel-alone-silent-success.md

## C94: github-workflows --eject flag is undocumented
- root_cause: commands.ts declares eject: S.Optional(S.Boolean()) with no description, so help shows a bare flag.
- source_files: packages/github-workflows/src/commands.ts
- severity: low-medium
- impact: usability
- risk: low
- fix: Add a description explaining what --eject writes and when to use it.
- issue_docs: ux-gh-install-eject-flag-opaque.md

## C95: experiment/pipeline expose internal paths and plan-path as a subcommand
- root_cause: The install description embeds the '/experiment' skill path, and plan-path is registered as a .command() rather than a flag or output field.
- source_files: src/cli/commands/experiment.ts, src/cli/commands/pipeline.ts
- severity: low
- impact: polish
- risk: low
- fix: Reword the install description to drop the internal skill path.
  Expose plan-path as a flag/output field rather than a subcommand, consistently for pipeline and experiment.
- issue_docs: ux-experiment-install-description-exposes-path.md, ux-pipeline-experiment-plan-path-as-subcommand.md

## Collision groups (clusters sharing source files)

- C01+C09 (src/providers/goose.ts)
- C01+C29+C31 (src/cli/context.ts)
- C01+C31+C58 (src/utils/dry-run.ts)
- C02+C03+C06+C52+C53+C79 (src/cli/commands/auth.ts)
- C03+C13+C22+C29 (src/cli/commands/agent.ts)
- C03+C19 (src/cli/commands/login.ts)
- C04+C13+C22+C27+C42+C54+C55+C56+C72+C86 (src/cli/commands/spawn.ts)
- C06+C14+C32+C33+C51+C53+C75 (src/cli/commands/provider.ts)
- C06+C19+C22+C30 (src/cli/commands/unconfigure.ts)
- C06+C19+C22+C74+C75 (src/cli/commands/worktree.ts)
- C06+C30 (src/cli/commands/logout.ts)
- C06+C53+C57 (src/cli/commands/tasks.ts)
- C07+C20+C45 (packages/agent-skill-config/src/apply.ts)
- C07+C22+C56+C75+C80+C85 (src/cli/commands/skill.ts)
- C08+C19+C24+C27+C50+C52+C59+C60+C61+C72+C85 (src/cli/commands/plan.ts)
- C08+C20 (packages/pipeline/src/plan/discovery.ts)
- C08+C24+C26+C45+C55+C56+C57+C92 (src/cli/commands/gaslight.ts)
- C09+C11+C12 (src/providers/claude-code.ts)
- C09+C11+C87 (src/cli/constants.ts)
- C10+C12+C14+C72+C85 (src/cli/commands/configure.ts)
- C11+C12+C13+C20+C27+C33 (src/cli/options.ts)
- C11+C12+C90 (src/cli/commands/configure-payload.ts)
- C14+C24 (src/cli/commands/shared.ts)
- C15+C19+C22+C38+C45+C52+C67 (src/cli/commands/memory.ts)
- C17+C18+C19+C22+C23+C66+C72+C74+C76+C77+C78+C79 (src/cli/program.ts)
- C18+C23+C76 (packages/toolcraft/src/cli.ts)
- C19+C24+C44+C56+C85 (src/cli/commands/install.ts)
- C19+C45+C46+C74+C75+C92+C95 (src/cli/commands/pipeline.ts)
- C20+C21 (src/cli/errors.ts)
- C20+C21+C22 (src/cli/bootstrap.ts)
- C20+C23+C52+C57+C63 (packages/agent-code-review/src/cli.ts)
- C20+C48 (packages/superintendent/src/document/parse.ts)
- C20+C52+C82 (src/cli/commands/config.ts)
- C20+C92 (packages/agent-gaslight/src/config.ts)
- C21+C22+C34+C35+C36+C37+C72 (src/cli/commands/models.ts)
- C21+C71 (src/cli/logger.ts)
- C22+C52+C65 (src/cli/commands/harness.ts)
- C23+C62 (packages/toolcraft/src/human-in-loop/approvals-commands.ts)
- C24+C91 (packages/agent-skill-config/src/configs.ts)
- C27+C59 (packages/plan-browser/src/actions.ts)
- C27+C67 (packages/memory/src/query.ts)
- C31+C43 (src/providers/gemini-cli.ts)
- C31+C57+C94 (packages/github-workflows/src/commands.ts)
- C36+C53+C69 (src/cli/commands/traces.ts)
- C38+C50 (src/cli/commands/runtime/templates/ls.ts)
- C39+C83 (src/cli/commands/runtime/jobs/shared.ts)
- C40+C75 (src/cli/commands/launch.ts)
- C41+C56 (src/cli/commands/runtime-options.ts)
- C42+C44 (src/utils/command-checks.ts)
- C45+C47+C74+C95 (src/cli/commands/experiment.ts)
- C47+C74+C81 (src/cli/commands/ralph.ts)
- C56+C74 (src/cli/commands/worktree-options.ts)
