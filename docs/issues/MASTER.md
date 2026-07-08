# UX issues — master priority list

**1 = fix first.** Count: **267**. Continuous audit 2026-07-07.

## Master list (1–N)

| # | Status | Severity | Area | Issue | One-line problem |
| ---: | --- | --- | --- | --- | --- |
| 1 | open | **Critical** | Security / dry-run | [ux-dry-run-diffs-print-secrets.md](./ux-dry-run-diffs-print-secrets.md) | Dry-run unconfigure/logout diffs print full API keys & bearer tokens |
| 2 | open | **Critical** | Auth / security | [ux-auth-api-key-prints-secret.md](./ux-auth-api-key-prints-secret.md) | `auth api-key` prints full secret to stdout with no mask/opt-in |
| 3 | open | **Critical** | Auth / dry-run | [ux-auth-api-key-dry-run-still-prints-secret.md](./ux-auth-api-key-dry-run-still-prints-secret.md) | `auth api-key --dry-run` still prints full secret |
| 4 | open | **Critical** | Config / models | [ux-hardcoded-stale-sonnet-5-in-product-defaults.md](./ux-hardcoded-stale-sonnet-5-in-product-defaults.md) | Product defaults hard-code dead `anthropic/claude-sonnet-5` model id |
| 5 | open | **Critical** | Spawn / poe-agent | [ux-spawn-poe-agent-crashes-fs-lstat.md](./ux-spawn-poe-agent-crashes-fs-lstat.md) | Advertised `spawn poe-agent` crashes: `fs.lstat is not a function` |
| 6 | open | **Critical** | Plan / destructive | [ux-plan-archive-delete-yes-picks-arbitrary-plan.md](./ux-plan-archive-delete-yes-picks-arbitrary-plan.md) | `plan archive|delete --yes` without path mutates an arbitrary plan |
| 7 | open | **Critical** | Auth / destructive | [ux-logout-overclaims-scope.md](./ux-logout-overclaims-scope.md) | `logout` copy says credentials but factory-resets agents + config |
| 8 | open | **High** | Approvals / recovery | [ux-approval-copy-hardcodes-toolcraft-in-source.md](./ux-approval-copy-hardcodes-toolcraft-in-source.md) | Confirmed packages/toolcraft/src/cli.ts and mcp.ts hardcode toolcraft approvals. |
| 9 | open | **High** | Approvals / recovery | [ux-approval-queued-message-says-toolcraft.md](./ux-approval-queued-message-says-toolcraft.md) | Blocked-flow copy Track toolcraft approvals show id. |
| 10 | open | **High** | Auth / security | [ux-auth-api-key-help-no-danger-warning.md](./ux-auth-api-key-help-no-danger-warning.md) | Help says only Display stored API key with no mention of masking, --reveal, or secret handling — even thoug… |
| 11 | open | **High** | Code-review / errors | [ux-code-review-drafts-missing-arg-double-error.md](./ux-code-review-drafts-missing-arg-double-error.md) | Missing prUrl shows raw error: missing required argument then design-system error with same text and npm ru… |
| 12 | open | **High** | Configure / models | [ux-configure-accepts-invalid-model-without-validation.md](./ux-configure-accepts-invalid-model-without-validation.md) | configure --model totally-fake-model-xyz --yes --dry-run proceeds to plan writes without validating the mod… |
| 13 | open | **High** | Dry-run | [ux-configure-codex-dry-run-still-leaks-and-noise.md](./ux-configure-codex-dry-run-still-leaks-and-noise.md) | Reconfirmed: even with explicit --model openai/gpt-5.3-codex, dry-run still dumps large config rewrites (pr… |
| 14 | open | **High** | Dry-run / privacy | [ux-configure-dry-run-dumps-entire-existing-agent-config.md](./ux-configure-dry-run-dumps-entire-existing-agent-config.md) | configure codex --dry-run emits a full rewrite-style diff of the agent config that includes dozens of unrel… |
| 15 | open | **High** | Configure / models | [ux-configure-dry-run-writes-stale-model-id.md](./ux-configure-dry-run-writes-stale-model-id.md) | configure --yes --dry-run for claude shows default model anthropic/claude-sonnet-5 and would write model cl… |
| 16 | open | **High** | Help / identity | [ux-development-mode-usage-intentional-but-leaks.md](./ux-development-mode-usage-intentional-but-leaks.md) | execution-context maps development to npm run dev -- leaking into all help/errors. |
| 17 | open | **High** | Help | [ux-dual-help-systems.md](./ux-dual-help-systems.md) | Commander vs toolcraft help completely different UIs. |
| 18 | open | **High** | Models / flags | [ux-empty-model-flag-behavior-inconsistent.md](./ux-empty-model-flag-behavior-inconsistent.md) | --model "" on agent fails with Missing model (good-ish); on spawn falls through to stale configured model a… |
| 19 | open | **High** | Errors / design system | [ux-error-panel-closes-before-error.md](./ux-error-panel-closes-before-error.md) | finalize Problems? then detached error. |
| 20 | open | **High** | Install / consistency | [ux-experiment-install-already-exists-vs-pipeline-skip.md](./ux-experiment-install-already-exists-vs-pipeline-skip.md) | experiment install when skill exists hard-errors Skill already exists; pipeline install --dry-run skips exi… |
| 21 | open | **High** | Experiment / Ralph | [ux-experiment-ralph-no-doc-wrong-message.md](./ux-experiment-ralph-no-doc-wrong-message.md) | experiment validate/journal and ralph run without doc say No markdown doc found under docs/plans. Provide a… |
| 22 | open | **High** | Pipeline / trust | [ux-failure-shown-as-success-markers.md](./ux-failure-shown-as-success-markers.md) | Pipeline/gaslight use ✓ next to API errors. |
| 23 | open | **High** | Gaslight | [ux-gaslight-ingest-failure-dumps-jsonl.md](./ux-gaslight-ingest-failure-dumps-jsonl.md) | Ingest analysis failure JSONL after Analyzed N prompts. |
| 24 | open | **High** | Gaslight | [ux-gaslight-no-plan-autopicks-and-hits-stale-model.md](./ux-gaslight-no-plan-autopicks-and-hits-stale-model.md) | gaslight --yes without plan-path autopicks a plan (e.g. 15-spawn-hooks.md) and fails on dead default model … |
| 25 | open | **High** | Spawn / github | [ux-github-cwd-clone-errors-still-raw-git.md](./ux-github-cwd-clone-errors-still-raw-git.md) | Invalid github://owner/repo still dumps Cloning into… ERROR: Repository not found fatal… See logs — reconfi… |
| 26 | open | **High** | Hooks / spawn | [ux-hooks-from-spawn-poe-code-enoent.md](./ux-hooks-from-spawn-poe-code-enoent.md) | test/spawn with --hooks-from may exec poe-code not on PATH (tsx entry), opaque ENOENT. |
| 27 | open | **High** | Hooks / spawn | [ux-hooks-strategy-transform-unsupported-opaque.md](./ux-hooks-strategy-transform-unsupported-opaque.md) | Transforming hooks to claude-code is not supported yet is informative but still Error + See logs; help list… |
| 28 | open | **High** | Agents | [ux-inconsistent-agent-surface-across-commands.md](./ux-inconsistent-agent-surface-across-commands.md) | configure/wrap/spawn/skill different agent unions. |
| 29 | open | **High** | Skills / consistency | [ux-install-skill-flags-inconsistent-across-commands.md](./ux-install-skill-flags-inconsistent-across-commands.md) | Skill-related install commands use inconsistent flag sets: skill install has --local/--global/--yes; memory… |
| 30 | open | **High** | Launch | [ux-launch-status-crashes-on-tombstone-dirs.md](./ux-launch-status-crashes-on-tombstone-dirs.md) | After launch rm, tombstone dirs named .state-removed-<id>-<uuid> can cause subsequent launch status/start/s… |
| 31 | open | **High** | Launch | [ux-launch-status-shows-dash-id-ghost-rows.md](./ux-launch-status-shows-dash-id-ghost-rows.md) | After failed/removed processes, launch status may show a table row with ID "-", STATUS stopped, empty metri… |
| 32 | open | **High** | Auth / CI | [ux-login-non-tty-hangs-on-oauth.md](./ux-login-non-tty-hangs-on-oauth.md) | Bare login starts OAuth wait forever without TTY. |
| 33 | open | **High** | Logout / dry-run | [ux-logout-dry-run-multi-panel-noise.md](./ux-logout-dry-run-multi-panel-noise.md) | Logout dry-run floods diffs, multiple footers, and can print secrets. |
| 34 | open | **High** | Auth / destructive | [ux-logout-help-no-danger-or-scope-detail.md](./ux-logout-help-no-danger-or-scope-detail.md) | logout help only says Remove all configuration and credentials with no file list, agent impact, or confirma… |
| 35 | open | **High** | Maestro | [ux-maestro-dry-run-path-vs-flag-confusion.md](./ux-maestro-dry-run-path-vs-flag-confusion.md) | `maestro dry-run` treats dry-run as a WORKFLOW.md path (Missing workflow file …/dry-run). `maestro --dry-ru… |
| 36 | open | **High** | Models | [ux-models-exact-id-filter-rejects-namespaced-ids.md](./ux-models-exact-id-filter-rejects-namespaced-ids.md) | models --model anthropic/claude-opus-4.7 returns 0/341 while --model claude-opus-4.7 and --search opus-4.7 … |
| 37 | open | **High** | Config / models | [ux-models-search-confirms-sonnet-5-absent-from-catalog.md](./ux-models-search-confirms-sonnet-5-absent-from-catalog.md) | Live catalog has no sonnet-5 (`models --search sonnet-5` → 0/341) while product defaults still reference it… |
| 38 | open | **High** | Errors | [ux-models-since-validation-still-prints-stack.md](./ux-models-since-validation-still-prints-stack.md) | Invalid --since still dumps ERROR log + ValidationError stack + design-system error — reconfirm of validati… |
| 39 | open | **High** | Interactive / CI | [ux-non-tty-prompt-wrong-guidance.md](./ux-non-tty-prompt-wrong-guidance.md) | Error says POE_NO_PROMPT=1; product contract is --yes. |
| 40 | open | **High** | Safety copy | [ux-permission-mode-sets-differ-across-commands.md](./ux-permission-mode-sets-differ-across-commands.md) | spawn: yolo/auto/edit/read; gaslight: read/edit/yolo/auto with default auto; harness: read/edit/auto/yolo; … |
| 41 | open | **High** | Agents | [ux-pi-spawnable-but-not-configurable.md](./ux-pi-spawnable-but-not-configurable.md) | pi on spawn help; configure pi unknown; spawn works. |
| 42 | open | **High** | Pipeline | [ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md](./ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md) | --task foo --yes picks some plan, shows 21/21 done, then task not found. |
| 43 | open | **High** | Plan / destructive | [ux-plan-archive-help-omits-yes-behavior.md](./ux-plan-archive-help-omits-yes-behavior.md) | plan archive help shows optional path and --kind/--output but does not document non-TTY selection requiring… |
| 44 | open | **High** | Plan / destructive | [ux-plan-delete-allows-readme.md](./ux-plan-delete-allows-readme.md) | plan delete dry-run accepts docs/plans/README.md. |
| 45 | open | **High** | Plan / editor | [ux-plan-edit-hangs-without-editor.md](./ux-plan-edit-hangs-without-editor.md) | plan edit without EDITOR/VISUAL can hang or fail to return a clear ValidationError within a short time (obs… |
| 46 | open | **High** | Auth / providers | [ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md](./ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md) | auth status reports Logged in as … but provider login poe --yes says No API key found and points to --api-k… |
| 47 | open | **High** | Provider / dry-run | [ux-provider-logout-dry-run-unconfigures-agents.md](./ux-provider-logout-dry-run-unconfigures-agents.md) | provider logout dry-run walks agent unconfigure not just credentials. |
| 48 | open | **High** | Docs / CI | [ux-readme-spawn-omits-mode-for-ci.md](./ux-readme-spawn-omits-mode-for-ci.md) | README CI spawn one-liners omit --mode/--yes; fail non-interactively. |
| 49 | open | **High** | Configure | [ux-reasoning-effort-bogus-silently-ignored.md](./ux-reasoning-effort-bogus-silently-ignored.md) | configure claude --reasoning-effort bogus --yes --dry-run still plans effortLevel xhigh without rejecting u… |
| 50 | open | **High** | Configure | [ux-reasoning-effort-flag-silently-ignored-for-some-agents.md](./ux-reasoning-effort-flag-silently-ignored-for-some-agents.md) | configure claude --reasoning-effort low/medium/max --yes --dry-run still plans effortLevel xhigh (or does n… |
| 51 | open | **High** | Help / identity | [ux-root-help-footer-npm-run-dev-for-options.md](./ux-root-help-footer-npm-run-dev-for-options.md) | Footer: Run npm run dev -- <command> --help. |
| 52 | open | **High** | Help / identity | [ux-root-help-usage-line-is-npm-run-dev.md](./ux-root-help-usage-line-is-npm-run-dev.md) | Root help Usage: npm run dev -- <command>. |
| 53 | open | **High** | Runtime jobs | [ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md](./ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md) | runtime jobs logs without jobId errors with More than one … Pass a job id and lists many jobs including run… |
| 54 | open | **High** | SDK / safety | [ux-sdk-cli-mode-default-mismatch.md](./ux-sdk-cli-mode-default-mismatch.md) | SDK defaults mode to yolo; CLI spawn prompts/--yes yolo; gaslight defaults auto. |
| 55 | open | **High** | Configure / models | [ux-skip-if-configured-shows-stale-default-model.md](./ux-skip-if-configured-shows-stale-default-model.md) | Already-configured path prints anthropic/claude-sonnet-5 as default model though API rejects it. |
| 56 | open | **High** | Spawn / runtime | [ux-spawn-detach-silently-ignored-without-runtime.md](./ux-spawn-detach-silently-ignored-without-runtime.md) | spawn … --detach without --runtime still runs the agent inline and succeeds; no warning that detach require… |
| 57 | open | **High** | Spawn / gemini | [ux-spawn-gemini-provider-credential-opaque-error.md](./ux-spawn-gemini-provider-credential-opaque-error.md) | spawn gemini with an explicit model can fail with Cannot resolve "providerCredential": no active provider o… |
| 58 | open | **High** | Spawn / interactive | [ux-spawn-interactive-raw-agent-error.md](./ux-spawn-interactive-raw-agent-error.md) | Interactive spawn without prompt/TTY surfaces raw agent-native --print error outside design system. |
| 59 | open | **High** | Spawn / interactive | [ux-spawn-interactive-still-uses-stale-model-bare-error.md](./ux-spawn-interactive-still-uses-stale-model-bare-error.md) | Even with prompt and -i, non-TTY spawn can surface bare API Error: 400 Unsupported model without design-sys… |
| 60 | open | **High** | Safety copy | [ux-spawn-mode-and-permission-copy.md](./ux-spawn-mode-and-permission-copy.md) | Modes minimal definition; --yes uses yolo buried; order differs spawn vs gaslight. |
| 61 | open | **High** | Config / models | [ux-stale-configured-model-fails-late.md](./ux-stale-configured-model-fails-late.md) | Invalid configured model ids only fail mid gaslight/pipeline with API 400 and success checkmarks. |
| 62 | open | **High** | Superintendent / errors | [ux-superintendent-missing-path-double-error.md](./ux-superintendent-missing-path-double-error.md) | superintendent validate and complete without path print raw Commander missing required argument then design… |
| 63 | open | **High** | Agents | [ux-test-and-install-reject-spawn-only-agents-as-unknown.md](./ux-test-and-install-reject-spawn-only-agents-as-unknown.md) | poe-agent/pi fail test/install with Unknown agent (false). |
| 64 | open | **High** | Test / errors | [ux-test-failure-dumps-jsonl.md](./ux-test-failure-dumps-jsonl.md) | test failure inlines hook JSONL flood. |
| 65 | open | **High** | Help / identity | [ux-toolcraft-help-points-at-npm-run-dev.md](./ux-toolcraft-help-points-at-npm-run-dev.md) | Toolcraft groups bake monorepo invocation. |
| 66 | open | **High** | Help / identity | [ux-toolcraft-suggests-options-but-still-npm-run-dev.md](./ux-toolcraft-suggests-options-but-still-npm-run-dev.md) | Good option suggestions; wrong recovery footer. |
| 67 | open | **High** | Errors / consistency | [ux-traces-since-validation-cleaner-than-models.md](./ux-traces-since-validation-cleaner-than-models.md) | traces --since notaduration returns short Invalid duration for --since without stack; models --since notadu… |
| 68 | open | **High** | Errors / trust | [ux-user-errors-look-like-system-failures.md](./ux-user-errors-look-like-system-failures.md) | Recoverable errors thrown as Error; bootstrap See logs + errors.log. |
| 69 | open | **High** | Errors | [ux-validation-error-still-prints-stack.md](./ux-validation-error-still-prints-stack.md) | ValidationError paths dump stack + double-render. |
| 70 | open | Medium–High | Spawn / workspaces | [ux-github-cwd-clone-errors-unframed.md](./ux-github-cwd-clone-errors-unframed.md) | Bad locator raw git stderr. |
| 71 | open | Medium–High | Maestro | [ux-maestro-dry-run-hits-github-without-workflow.md](./ux-maestro-dry-run-hits-github-without-workflow.md) | Dry-run hits GraphQL 401 JSON. |
| 72 | open | Medium–High | Runtime | [ux-runtime-jobs-stale-running-zombies.md](./ux-runtime-jobs-stale-running-zombies.md) | running since May. |
| 73 | open | Medium | Visual language | [ux-acp-stream-uses-success-glyph-for-partial-text.md](./ux-acp-stream-uses-success-glyph-for-partial-text.md) | Checkmark for partial text. |
| 74 | open | Medium | Agent | [ux-agent-invalid-model-system-chrome.md](./ux-agent-invalid-model-system-chrome.md) | 404 + logs. |
| 75 | open | Medium | Errors | [ux-agent-spawn-missing-args-raw-commander.md](./ux-agent-spawn-missing-args-raw-commander.md) | agent without prompt and spawn without agent print error: missing required argument without design-system f… |
| 76 | open | Medium | Auth / security | [ux-api-key-flags-encourage-shell-history-leaks.md](./ux-api-key-flags-encourage-shell-history-leaks.md) | Flags without history warning. |
| 77 | open | Medium | Approvals | [ux-approvals-invalid-state-silent-empty-reconfirmed.md](./ux-approvals-invalid-state-silent-empty-reconfirmed.md) | approvals list --state bogus returns No approvals found without invalid-state error — reconfirm. |
| 78 | open | Medium | Approvals | [ux-approvals-invalid-state-silent-empty.md](./ux-approvals-invalid-state-silent-empty.md) | nope looks empty queue. |
| 79 | open | Medium | IA / install | [ux-binary-wrappers-undocumented.md](./ux-binary-wrappers-undocumented.md) | dist/bin wrappers no help map. |
| 80 | open | Medium | Spawn / flags | [ux-capture-otel-content-without-capture-silent.md](./ux-capture-otel-content-without-capture-silent.md) | spawn with --capture-otel-content alone succeeds without enabling otel capture or warning that --capture-ot… |
| 81 | open | Medium | Errors | [ux-code-review-double-error-skin.md](./ux-code-review-double-error-skin.md) | Raw + toolcraft both. |
| 82 | open | Medium | Errors / recovery | [ux-command-not-found-no-suggestions.md](./ux-command-not-found-no-suggestions.md) | confgure/skills/pipelne no suggestion. |
| 83 | open | Medium | Dry-run | [ux-configure-dry-run-floods-diff.md](./ux-configure-dry-run-floods-diff.md) | Huge settings diffs. |
| 84 | open | Medium | Configure | [ux-configure-provider-requires-model-without-listing-models.md](./ux-configure-provider-requires-model-without-listing-models.md) | When a provider requires an explicit model, configure errors Pass --model without listing available models,… |
| 85 | open | Medium | Configure | [ux-configure-yes-silent-default-agent.md](./ux-configure-yes-silent-default-agent.md) | Picks Claude without upfront line. |
| 86 | open | Medium | Dashboard / TUI | [ux-dashboard-keybindings-undocumented-on-cli-help.md](./ux-dashboard-keybindings-undocumented-on-cli-help.md) | Live dashboards support q quit and Ctrl+C forceQuit but --tui help only says Show a live dashboard without … |
| 87 | open | Medium | Editor | [ux-editor-error-still-system-chrome.md](./ux-editor-error-still-system-chrome.md) | Set $EDITOR + logs. |
| 88 | open | Medium | Auth | [ux-empty-api-key-flag-silently-ignored.md](./ux-empty-api-key-flag-silently-ignored.md) | --api-key '' falls back to stored key. |
| 89 | open | Medium | Plan list | [ux-empty-plan-kind-lists-still-draw-empty-tables.md](./ux-empty-plan-kind-lists-still-draw-empty-tables.md) | plan list --kind experiment/ralph/superintendent draws full empty table borders with no "No plans" message … |
| 90 | open | Medium | Eval | [ux-eval-empty-source-message-inconsistent-skins.md](./ux-eval-empty-source-message-inconsistent-skins.md) | eval check/lint print bare Eval source does not contain… lines; eval report uses design-system ■ Error for … |
| 91 | open | Medium | Eval / suggestions | [ux-eval-unknown-command-suggests-lint-for-list.md](./ux-eval-unknown-command-suggests-lint-for-list.md) | eval list is not a command; error Did you mean: lint? which is a poor suggestion for list (distance match w… |
| 92 | open | Medium | Gaslight | [ux-gaslight-config-missing-enoent.md](./ux-gaslight-config-missing-enoent.md) | Raw ENOENT. |
| 93 | open | Medium | Gaslight | [ux-gaslight-multi-plan-fails-fast-with-success-markers.md](./ux-gaslight-multi-plan-fails-fast-with-success-markers.md) | Multi-plan gaslight fails first plan with ✓ agent API error and message plan 1/2 … failed without summarizi… |
| 94 | open | Medium | Gaslight / safety | [ux-gaslight-no-activity-timeout-flag.md](./ux-gaslight-no-activity-timeout-flag.md) | Long gaslight runs cannot set activity timeout from CLI though spawn supports --activity-timeout-ms; users … |
| 95 | open | Medium | Naming | [ux-gaslight-opaque-naming.md](./ux-gaslight-opaque-naming.md) | Root gaslight no plain gloss. |
| 96 | open | Medium | Gaslight / naming | [ux-gaslight-unknown-agent-says-service.md](./ux-gaslight-unknown-agent-says-service.md) | Says service not agent. |
| 97 | open | Medium | Dry-run | [ux-gemini-configure-dry-run-too-quiet.md](./ux-gemini-configure-dry-run-too-quiet.md) | configure gemini --yes --dry-run only shows Gemini model resolved line and would configure without listing … |
| 98 | open | Medium | GitHub workflows | [ux-gh-install-dry-run-lists-paths-without-panel.md](./ux-gh-install-dry-run-lists-paths-without-panel.md) | github-workflows install --dry-run prints bare workflow paths and would write messages without panel framin… |
| 99 | open | Medium | Help | [ux-global-flags-hidden-on-subcommand-help.md](./ux-global-flags-hidden-on-subcommand-help.md) | --yes/--dry-run/--verbose missing on most help. |
| 100 | open | Medium | First-run | [ux-group-commands-print-help-only.md](./ux-group-commands-print-help-only.md) | pipeline bare help only. |
| 101 | open | Medium | Harness | [ux-harness-missing-file-system-chrome.md](./ux-harness-missing-file-system-chrome.md) | Good message + See logs. |
| 102 | open | Medium | Harness | [ux-harness-unknown-template-still-omits-kind-list.md](./ux-harness-unknown-template-still-omits-kind-list.md) | Unknown harness template "notakind" still prints only that message without listing ralph-demo, coverage-dem… |
| 103 | open | Medium | Help | [ux-help-command-not-registered.md](./ux-help-command-not-registered.md) | help not registered. |
| 104 | open | Medium | IA | [ux-hidden-and-orphan-commands.md](./ux-hidden-and-orphan-commands.md) | memory-mcp top-level; agent vs spawn poe-agent. |
| 105 | open | Medium | Hooks / spawn | [ux-hooks-bridge-refuse-user-authored-file-opaque.md](./ux-hooks-bridge-refuse-user-authored-file-opaque.md) | spawn with --hooks-from/--hooks-scope can fail with Refuse to replace user-authored hook file at …/settings… |
| 106 | open | Medium | Spawn / hooks | [ux-hooks-from-unsupported-system-chrome.md](./ux-hooks-from-unsupported-system-chrome.md) | Allow-list + See logs. |
| 107 | open | Medium | Help / IA | [ux-important-commands-absent-from-root-help.md](./ux-important-commands-absent-from-root-help.md) | skill/memory/provider missing no show-all. |
| 108 | open | Medium | Install | [ux-install-yes-defaults-agent-silently.md](./ux-install-yes-defaults-agent-silently.md) | install --yes without agent installs Claude Code without stating default selection policy in the first line. |
| 109 | open | Medium | Scripting | [ux-json-flag-inconsistent-across-commands.md](./ux-json-flag-inconsistent-across-commands.md) | Some commands only. |
| 110 | open | Medium | Configure / models | [ux-kimi-default-model-id-mismatches-catalog-namespace.md](./ux-kimi-default-model-id-mismatches-catalog-namespace.md) | configure kimi dry-run plans default_model = poe/kimi-k2.5 while models catalog lists novita ai/kimi-k2.5. … |
| 111 | open | Medium | Launch / dev UX | [ux-launch-commands-trigger-full-turbo-rebuild.md](./ux-launch-commands-trigger-full-turbo-rebuild.md) | Invoking launch through npm run dev / predev runs turbo build across 68 packages before the command, adding… |
| 112 | open | Medium | Launch | [ux-launch-start-opaque-failure.md](./ux-launch-start-opaque-failure.md) | Missing -- → failed to start. |
| 113 | open | Medium | Launch | [ux-launch-start-via-npm-run-dev-confuses-argv.md](./ux-launch-start-via-npm-run-dev-confuses-argv.md) | launch start can mis-parse process ids and commands when invoked through npm run dev (turbo predev noise, s… |
| 114 | open | Medium | Privacy | [ux-log-content-flags-underwarn-sensitive-data.md](./ux-log-content-flags-underwarn-sensitive-data.md) | --log-content no PII warning. |
| 115 | open | Medium | Auth / help | [ux-login-help-omits-interactive-and-yes.md](./ux-login-help-omits-interactive-and-yes.md) | login help only lists --api-key and -h; does not document interactive OAuth browser flow, non-TTY requireme… |
| 116 | open | Medium | Auth / help | [ux-login-help-omits-oauth-default.md](./ux-login-help-omits-oauth-default.md) | Only --api-key documented. |
| 117 | open | Medium | Auth | [ux-login-rejected-no-recovery.md](./ux-login-rejected-no-recovery.md) | API key rejected only. |
| 118 | open | Medium | First-run | [ux-many-parent-groups-only-dump-help.md](./ux-many-parent-groups-only-dump-help.md) | Beyond pipeline/experiment/ralph, bare invocations of skill, memory, provider, runtime, launch, worktree, u… |
| 119 | open | Medium | Destructive | [ux-memory-clear-help-still-no-force-or-yes.md](./ux-memory-clear-help-still-no-force-or-yes.md) | memory clear --help still only shows -h/--help despite being fully destructive when initialized. |
| 120 | open | Medium | Destructive | [ux-memory-clear-no-confirmation.md](./ux-memory-clear-no-confirmation.md) | Destructive no confirm. |
| 121 | open | Medium | Memory / install | [ux-memory-install-already-exists-system-chrome.md](./ux-memory-install-already-exists-system-chrome.md) | memory install when skill exists fails with Skill already exists: path and See logs, without --force guidan… |
| 122 | open | Medium | Memory | [ux-memory-write-requires-reason-before-path.md](./ux-memory-write-requires-reason-before-path.md) | memory write without args fails on required option --reason before missing path argument — wrong recovery o… |
| 123 | open | Medium | Memory | [ux-memory-write-requires-reason-raw-commander.md](./ux-memory-write-requires-reason-raw-commander.md) | memory write without --reason prints raw error: required option '--reason <text>' not specified instead of … |
| 124 | open | Medium | Memory | [ux-memory-write-success-is-raw-unframed.md](./ux-memory-write-success-is-raw-unframed.md) | After memory write, stdout dumps frontmatter/body and path:line snippets without design-system success pane… |
| 125 | open | Medium | Configure / models | [ux-model-id-namespace-stripping-surprises.md](./ux-model-id-namespace-stripping-surprises.md) | configure --model anthropic/claude-sonnet-4.6 dry-run writes model as claude-sonnet-4-6 (dots to hyphens / … |
| 126 | open | Medium | Models | [ux-models-dumps-full-catalog.md](./ux-models-dumps-full-catalog.md) | 300+ rows default. |
| 127 | open | Medium | Models | [ux-models-feature-bogus-silent-empty.md](./ux-models-feature-bogus-silent-empty.md) | Invalid feature name returns 0 models / No models match rather than invalid feature error — reconfirm of si… |
| 128 | open | Medium | Models | [ux-models-feature-flag-not-repeatable.md](./ux-models-feature-flag-not-repeatable.md) | models --feature tools --feature reasoning does not AND features; Commander keeps a single string so the la… |
| 129 | open | Medium | Models | [ux-models-input-bogus-silent-empty.md](./ux-models-input-bogus-silent-empty.md) | Invalid input modality returns 0 models without listing valid modalities text/image/audio/video. |
| 130 | open | Medium | Models | [ux-models-invalid-feature-silent-empty.md](./ux-models-invalid-feature-silent-empty.md) | --feature notreal → 0/341. |
| 131 | open | Medium | Models | [ux-models-invalid-modality-silent-empty.md](./ux-models-invalid-modality-silent-empty.md) | --input smell → 0/341. |
| 132 | open | Medium | Models | [ux-models-view-invalid-uses-raw-commander.md](./ux-models-view-invalid-uses-raw-commander.md) | Invalid --view value uses Commander option argument is invalid. Allowed choices… while other models validat… |
| 133 | open | Medium | First-run / diagnostics | [ux-no-doctor-or-health-overview-command.md](./ux-no-doctor-or-health-overview-command.md) | There is no poe-code doctor (or similar) that summarizes auth status, configured agents, stale models, prov… |
| 134 | open | Medium | Configure / models | [ux-opencode-model-triple-namespace.md](./ux-opencode-model-triple-namespace.md) | configure opencode dry-run plans model poe/anthropic/claude-opus-4.7 — a third namespace style (poe/owner/m… |
| 135 | open | Medium | Pipeline | [ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md](./ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md) | Good validation Problems first. |
| 136 | open | Medium | Pipeline / TUI | [ux-pipeline-tui-flag-ignored-on-init-failure.md](./ux-pipeline-tui-flag-ignored-on-init-failure.md) | pipeline run --tui still shows non-dashboard failure path with success markers and Problems-before-error wh… |
| 137 | open | Medium | Pipeline | [ux-pipeline-validate-enoent-system-error.md](./ux-pipeline-validate-enoent-system-error.md) | System chrome. |
| 138 | open | Medium | Pipeline | [ux-pipeline-validate-wrong-kind-system-chrome.md](./ux-pipeline-validate-wrong-kind-system-chrome.md) | kind must be pipeline + See logs. |
| 139 | open | Medium | Plan browser | [ux-plan-archive-allows-readme.md](./ux-plan-archive-allows-readme.md) | Would archive README.md. |
| 140 | open | Medium | Plan browser | [ux-plan-browse-non-tty-dumps-first-plan.md](./ux-plan-browse-non-tty-dumps-first-plan.md) | plan browse without a TTY prints a full rendered plan (first/selected) rather than an error, list, or expli… |
| 141 | open | Medium | Docs / CLI sync | [ux-plan-docs-advertise-goal-and-chat-commands-missing.md](./ux-plan-docs-advertise-goal-and-chat-commands-missing.md) | Plan content (e.g. agent-goal plan) documents `poe-code goal …` and `poe-code chat` slash surfaces, but CLI… |
| 142 | open | Medium | Plan browser | [ux-plan-list-includes-noise-files.md](./ux-plan-list-includes-noise-files.md) | README.md listed as plan. |
| 143 | open | Medium | Plan | [ux-plan-markdown-read-section-wrong-command-hint.md](./ux-plan-markdown-read-section-wrong-command-hint.md) | When section match fails, error says try read-markdown to see TOC, but the actual command is plan markdown-… |
| 144 | open | Medium | Plan | [ux-plan-markdown-read-system-chrome.md](./ux-plan-markdown-read-system-chrome.md) | file not found + logs. |
| 145 | open | Medium | Plan | [ux-plan-non-tty-unclear-failure.md](./ux-plan-non-tty-unclear-failure.md) | plan question bare 400. |
| 146 | open | Medium | Help | [ux-primary-commands-lack-examples-in-help.md](./ux-primary-commands-lack-examples-in-help.md) | models has Examples; configure/spawn do not. |
| 147 | open | Medium | Help | [ux-primary-commands-still-lack-examples.md](./ux-primary-commands-still-lack-examples.md) | spawn, configure, and gaslight --help still have no Examples section while models --help is best-in-class w… |
| 148 | open | Medium | Providers | [ux-provider-list-agents-column-incomplete.md](./ux-provider-list-agents-column-incomplete.md) | Omits spawn-only agents. |
| 149 | open | Medium | Provider auth | [ux-provider-login-missing-key-system-chrome.md](./ux-provider-login-missing-key-system-chrome.md) | Good message + logs. |
| 150 | open | Medium | Workflows | [ux-ralph-experiment-wrong-kind-says-not-found.md](./ux-ralph-experiment-wrong-kind-says-not-found.md) | Existing plan wrong kind. |
| 151 | open | Medium | Errors | [ux-raw-commander-invalid-option-choices.md](./ux-raw-commander-invalid-option-choices.md) | --view nope raw. |
| 152 | open | Medium | Errors | [ux-raw-commander-missing-args.md](./ux-raw-commander-missing-args.md) | unconfigure/wrap missing agent raw error. |
| 153 | open | Medium | Docs / CLI sync | [ux-readme-features-wrap-but-cli-missing.md](./ux-readme-features-wrap-but-cli-missing.md) | README wrap quickstart removed; wrap CLI residual (muscle memory / external docs) |
| 154 | open | Medium | Configure | [ux-reasoning-effort-flag-opaque.md](./ux-reasoning-effort-flag-opaque.md) | No validation/examples. |
| 155 | open | Medium | Spawn | [ux-resume-thread-errors-are-agent-raw.md](./ux-resume-thread-errors-are-agent-raw.md) | Long agent usage text. |
| 156 | open | Medium | Runtime | [ux-runtime-jobs-list-unbounded-opaque-statuses.md](./ux-runtime-jobs-list-unbounded-opaque-statuses.md) | History dump; lost unexplained. |
| 157 | open | Medium | Runtime jobs | [ux-runtime-jobs-show-unknown-suggests-stop.md](./ux-runtime-jobs-show-unknown-suggests-stop.md) | runtime jobs show is not a command; Commander Did you mean: stop? — users expect show/get for job details. |
| 158 | open | Medium | Runtime / errors | [ux-runtime-missing-deps-good-message-system-chrome.md](./ux-runtime-missing-deps-good-message-system-chrome.md) | spawn --runtime docker/e2b missing engine/API key messages include install links and config paths (excellen… |
| 159 | open | Medium | SDK | [ux-sdk-getpoeapikey-throws-generic-error.md](./ux-sdk-getpoeapikey-throws-generic-error.md) | SDK credential helper throws new Error("No API key found…") rather than a typed/user-facing error class, so… |
| 160 | open | Medium | Spawn / skills | [ux-skill-bridge-failure-system-chrome.md](./ux-skill-bridge-failure-system-chrome.md) | Paths listed + See logs. |
| 161 | open | Medium | Skills / agents | [ux-skill-configure-kimi-unsupported-abrupt.md](./ux-skill-configure-kimi-unsupported-abrupt.md) | Skills not supported for kimi. |
| 162 | open | Medium | Skills | [ux-skill-configure-yes-defaults-agent-silently.md](./ux-skill-configure-yes-defaults-agent-silently.md) | skill configure --yes --local without agent configures claude-code without stating default selection policy… |
| 163 | open | Medium | Skills | [ux-skill-install-name-and-file-both-required.md](./ux-skill-install-name-and-file-both-required.md) | Serial required options opaque. |
| 164 | open | Medium | Naming | [ux-skill-naming-collisions.md](./ux-skill-naming-collisions.md) | skills≠skill; dual /plan. |
| 165 | open | Medium | Skills / first-run | [ux-skill-parent-no-next-step-guidance.md](./ux-skill-parent-no-next-step-guidance.md) | poe-code skill with no subcommand prints a bare subcommand list without suggesting the common onboarding pa… |
| 166 | open | Medium | Skills | [ux-skill-unconfigure-defaults-agent-and-soft-blocks.md](./ux-skill-unconfigure-defaults-agent-and-soft-blocks.md) | skill unconfigure without agent defaults to claude-code and refuses non-empty skill dirs unless --force, bu… |
| 167 | open | Medium | Spawn / skills | [ux-skills-flag-without-value-is-noop-or-unclear.md](./ux-skills-flag-without-value-is-noop-or-unclear.md) | spawn … --skills with no value still runs the agent successfully (boolean presence?) without error or warni… |
| 168 | open | Medium | Configure | [ux-skip-if-configured-still-writes-when-model-differs.md](./ux-skip-if-configured-still-writes-when-model-differs.md) | Passing --skip-if-configured with an explicit --model that differs from stored config still runs a full con… |
| 169 | open | Medium | Spawn help | [ux-spawn-advanced-flags-undifferentiated.md](./ux-spawn-advanced-flags-undifferentiated.md) | ~20 options ungrouped. |
| 170 | open | Medium | Spawn / codex | [ux-spawn-codex-reads-stdin-message-on-tty-less-success.md](./ux-spawn-codex-reads-stdin-message-on-tty-less-success.md) | Even when prompt is provided as an argument, successful codex spawn emits Reading additional input from std… |
| 171 | open | Medium | Spawn / paths | [ux-spawn-cwd-missing-system-chrome.md](./ux-spawn-cwd-missing-system-chrome.md) | spawn -C /missing says Workspace path does not exist (good) but still attaches errors.log system-failure fo… |
| 172 | open | Medium | Spawn / runtime | [ux-spawn-detach-ignored-on-failure-path.md](./ux-spawn-detach-ignored-on-failure-path.md) | With --detach, spawn still appears to run the agent path that fails on stale model in-foreground with succe… |
| 173 | open | Medium | Spawn | [ux-spawn-no-prompt-system-chrome.md](./ux-spawn-no-prompt-system-chrome.md) | No prompt provided via argument or stdin is correct message but still See logs system chrome. |
| 174 | open | Medium | Spawn / errors | [ux-spawn-validates-mode-before-agent.md](./ux-spawn-validates-mode-before-agent.md) | Invalid agent fails missing --mode first. |
| 175 | open | Medium | Visual language | [ux-successful-spawn-still-uses-checkmark-for-agent-text.md](./ux-successful-spawn-still-uses-checkmark-for-agent-text.md) | Even successful spawn pi output prefixes agent thinking/answer lines with ✓, same glyph as success status —… |
| 176 | open | Medium | Superintendent | [ux-superintendent-validate-unclosed-tag-opaque.md](./ux-superintendent-validate-unclosed-tag-opaque.md) | No location. |
| 177 | open | Medium | Tables | [ux-tables-ignore-terminal-width.md](./ux-tables-ignore-terminal-width.md) | Wide at COLUMNS=40. |
| 178 | open | Medium | Tasks / auth | [ux-tasks-github-auth-raw-error.md](./ux-tasks-github-auth-raw-error.md) | tasks get raw GraphQL 401. |
| 179 | open | Medium | Spawn / timeouts | [ux-timeout-errors-use-system-chrome.md](./ux-timeout-errors-use-system-chrome.md) | 0.001s + See logs. |
| 180 | open | Medium | Errors / recovery | [ux-toolcraft-has-suggestions-poe-code-root-does-not.md](./ux-toolcraft-has-suggestions-poe-code-root-does-not.md) | suggest.ts exists; root unused. |
| 181 | open | Medium | Help / visual | [ux-toolcraft-heading-doubles-poe-code.md](./ux-toolcraft-heading-doubles-poe-code.md) | Double name heading. |
| 182 | open | Medium | Traces | [ux-traces-directory-path-eisdir.md](./ux-traces-directory-path-eisdir.md) | traces docs EISDIR. |
| 183 | open | Medium | Traces | [ux-traces-missing-file-system-error.md](./ux-traces-missing-file-system-error.md) | System chrome. |
| 184 | open | Medium | Destructive | [ux-unconfigure-no-confirmation.md](./ux-unconfigure-no-confirmation.md) | Immediate rewrite no --yes gate. |
| 185 | open | Medium | Unconfigure | [ux-unconfigure-nonconfigured-agent-still-plans-mutations.md](./ux-unconfigure-nonconfigured-agent-still-plans-mutations.md) | unconfigure gemini --dry-run still emits large settings diffs and backup deletes even when user mental mode… |
| 186 | open | Medium | Update | [ux-update-always-suggests-npm-install-g.md](./ux-update-always-suggests-npm-install-g.md) | Ignores install method. |
| 187 | open | Medium | Usage | [ux-usage-list-no-json-flag.md](./ux-usage-list-no-json-flag.md) | usage list lacks --json/--output; scripts cannot machine-parse usage history without scraping tables. trace… |
| 188 | open | Medium | Utils / config | [ux-utils-config-path-subcommand-missing.md](./ux-utils-config-path-subcommand-missing.md) | utils config path fails with too many arguments; only show/init/edit exist. Users often need the path witho… |
| 189 | open | Medium | Utils / config | [ux-utils-config-show-dumps-large-json.md](./ux-utils-config-show-dumps-large-json.md) | utils config show prints full global config JSON including configured_services detail — useful but noisy; n… |
| 190 | open | Medium | Version | [ux-version-nags-dev-to-major-jump.md](./ux-version-nags-dev-to-major-jump.md) | Local 0.0.0-dev build reports Update available to 4.0.0 and suggests npm install -g, which is noise for con… |
| 191 | open | Medium | Tables | [ux-wide-tables-truncate-critical-cells.md](./ux-wide-tables-truncate-critical-cells.md) | Agents column ellipsis. |
| 192 | open | Medium | Worktree | [ux-worktree-remove-no-confirmation.md](./ux-worktree-remove-no-confirmation.md) | Destructive no confirm. |
| 193 | open | Medium | Worktree | [ux-worktree-remove-not-found-system-chrome.md](./ux-worktree-remove-not-found-system-chrome.md) | worktree remove no-such → Worktree not found in registry + See logs. |
| 194 | open | Medium | Dry-run | [ux-wrap-dry-run-forwards-flag.md](./ux-wrap-dry-run-forwards-flag.md) | would run goose --dry-run. |
| 195 | open | Medium | Dry-run | [ux-wrap-resolves-alias-but-dry-run-lies.md](./ux-wrap-resolves-alias-but-dry-run-lies.md) | kimi-cli --dry-run invented. |
| 196 | open | Low–Medium | Agent defaults | [ux-agent-default-model-hardcoded.md](./ux-agent-default-model-hardcoded.md) | default anthropic/claude-opus-4.7. |
| 197 | open | Low–Medium | Auth | [ux-auth-whoami-raw-json-vs-status-panel.md](./ux-auth-whoami-raw-json-vs-status-panel.md) | auth whoami dumps raw JSON identity; auth status uses design-system Logged in as. Dual presentation for sam… |
| 198 | open | Low–Medium | Auth polish | [ux-auth-whoami-raw-json.md](./ux-auth-whoami-raw-json.md) | JSON vs status design-system. |
| 199 | open | Low–Medium | Code-review | [ux-code-review-profiles-raw-table.md](./ux-code-review-profiles-raw-table.md) | code-review profiles dumps a minimal ascii table of name/source without Poe panel framing used elsewhere. |
| 200 | open | Low–Medium | Code-review / visual | [ux-code-review-profiles-table-outside-design-system.md](./ux-code-review-profiles-table-outside-design-system.md) | No Poe framing. |
| 201 | open | Low–Medium | Help | [ux-command-aliases-undocumented-on-root-help.md](./ux-command-aliases-undocumented-on-root-help.md) | Work but not shown. |
| 202 | open | Low–Medium | Configure help | [ux-configure-shape-base-url-opaque.md](./ux-configure-shape-base-url-opaque.md) | Jargon no examples. |
| 203 | open | Low–Medium | Editor | [ux-editor-missing-raw-error.md](./ux-editor-missing-raw-error.md) | throw new Error Set $EDITOR. |
| 204 | open | Low–Medium | Eval | [ux-eval-errors-outside-design-system.md](./ux-eval-errors-outside-design-system.md) | Some eval plain text. |
| 205 | open | Low–Medium | Eval | [ux-eval-init-success-is-bare-paths.md](./ux-eval-init-success-is-bare-paths.md) | eval init prints folder name and next: poe-code eval check … as bare lines; also next command may still be … |
| 206 | open | Low–Medium | Eval | [ux-eval-report-debug-flag-undocumented-in-error.md](./ux-eval-report-debug-flag-undocumented-in-error.md) | eval report with no eval folders says Use --debug for a stack trace while primary help may not surface --de… |
| 207 | open | Low–Medium | Experiment | [ux-experiment-journal-wrong-doc-type-message.md](./ux-experiment-journal-wrong-doc-type-message.md) | Doc not found for existing. |
| 208 | open | Low–Medium | Install / IA | [ux-extra-npm-bins-confusing.md](./ux-extra-npm-bins-confusing.md) | poe-code-configure + test servers. |
| 209 | open | Low–Medium | Gaslight | [ux-gaslight-archive-and-no-archive-both-accepted.md](./ux-gaslight-archive-and-no-archive-both-accepted.md) | Passing both --archive and --no-archive does not error; one silently wins (Commander negate) while help lis… |
| 210 | open | Low–Medium | GH workflows | [ux-gh-install-eject-flag-opaque.md](./ux-gh-install-eject-flag-opaque.md) | Description eject. |
| 211 | open | Low–Medium | Install | [ux-install-always-claims-success.md](./ux-install-always-claims-success.md) | No already-present state. |
| 212 | open | Low–Medium | Launch | [ux-launch-status-shows-failed-experiment-leftovers.md](./ux-launch-status-shows-failed-experiment-leftovers.md) | stopped leftovers no cleanup hint. |
| 213 | open | Low–Medium | Errors / consistency | [ux-mcp-servers-missing-file-almost-good.md](./ux-mcp-servers-missing-file-almost-good.md) | Good message class vary. |
| 214 | open | Low–Medium | Memory / MCP | [ux-memory-mcp-print-config-raw-json.md](./ux-memory-mcp-print-config-raw-json.md) | Bare JSON no guidance. |
| 215 | open | Low–Medium | Memory | [ux-memory-status-after-write-is-terse.md](./ux-memory-status-after-write-is-terse.md) | memory status prints Pages/Bytes/Last write/Tokens as bare lines without panel framing or interpretation (h… |
| 216 | open | Low–Medium | Models | [ux-models-raw-view-bypasses-design-system.md](./ux-models-raw-view-bypasses-design-system.md) | No framing. |
| 217 | open | Low–Medium | Models | [ux-models-tools-and-feature-filter-semantics-undocumented.md](./ux-models-tools-and-feature-filter-semantics-undocumented.md) | --tools is documented as shorthand for --feature tools, but combining --tools with --feature web_search ret… |
| 218 | open | Low–Medium | Help / completion | [ux-no-shell-completion-command.md](./ux-no-shell-completion-command.md) | No poe-code completion (bash/zsh/fish) command to install tab completion, despite a large command surface w… |
| 219 | open | Low–Medium | Auth polish | [ux-oauth-url-dumps-full-query-string.md](./ux-oauth-url-dumps-full-query-string.md) | Long authorize URL line. |
| 220 | open | Low–Medium | Pipeline | [ux-pipeline-validate-success-still-problems-footer.md](./ux-pipeline-validate-success-still-problems-footer.md) | Valid pipeline validation ends with Problems? GitHub link after Plan is valid success. |
| 221 | open | Low–Medium | Plan list | [ux-plan-list-empty-table-no-message.md](./ux-plan-list-empty-table-no-message.md) | No no-plans message. |
| 222 | open | Low–Medium | Plan list | [ux-plan-list-output-json-unframed.md](./ux-plan-list-output-json-unframed.md) | plan list --output json prints a raw JSON array to stdout with no design-system intro; --output md prints a… |
| 223 | open | Low–Medium | Plan | [ux-plan-markdown-read-raw-yaml-ish-output.md](./ux-plan-markdown-read-raw-yaml-ish-output.md) | plan markdown-read prints raw file:/frontmatter:/sections: blocks without design-system framing used by pla… |
| 224 | open | Low–Medium | Plan view | [ux-plan-view-json-dumps-full-markdown-content.md](./ux-plan-view-json-dumps-full-markdown-content.md) | plan view --output json includes a huge content string of the full plan body, which is useful for tooling b… |
| 225 | open | Low–Medium | Design system | [ux-problems-footer-on-every-success.md](./ux-problems-footer-on-every-success.md) | finalize always. |
| 226 | open | Low–Medium | Runtime | [ux-runtime-templates-ls-shows-empty-docker-row.md](./ux-runtime-templates-ls-shows-empty-docker-row.md) | runtime templates ls includes a docker row with (empty) hash and dashes, plus many old e2b artifacts — nois… |
| 227 | open | Low–Medium | Runtime | [ux-runtime-templates-ls-unbounded-noise.md](./ux-runtime-templates-ls-unbounded-noise.md) | Old e2b /tmp rows. |
| 228 | open | Low–Medium | Configure | [ux-shape-base-url-error-good-message-system-prefix.md](./ux-shape-base-url-error-good-message-system-prefix.md) | Good text system prefix. |
| 229 | open | Low–Medium | Spawn / skills | [ux-skill-and-skills-flags-undocumented-relationship.md](./ux-skill-and-skills-flags-undocumented-relationship.md) | Both merge; help silent. |
| 230 | open | Low–Medium | Skills | [ux-skill-configure-goose-writes-dot-agents-skills.md](./ux-skill-configure-goose-writes-dot-agents-skills.md) | skill configure goose --yes --local succeeds at ./.agents/skills while claude uses ./.claude/skills — path … |
| 231 | open | Low–Medium | Configure | [ux-skip-if-configured-still-noises-dry-run.md](./ux-skip-if-configured-still-noises-dry-run.md) | Still full would-configure. |
| 232 | open | Low–Medium | Design system | [ux-spawn-success-still-problems-footer.md](./ux-spawn-success-still-problems-footer.md) | Even successful spawn pi/claude/goose runs end with Problems? GitHub issues link, training users to ignore … |
| 233 | open | Low–Medium | Visual language | [ux-success-and-info-share-magenta-glyphs.md](./ux-success-and-info-share-magenta-glyphs.md) | logger ◆ and ● magenta. |
| 234 | open | Low–Medium | Traces | [ux-traces-cwd-only-flag-removed-or-renamed.md](./ux-traces-cwd-only-flag-removed-or-renamed.md) | traces defaults to cwd-only listing; expansion is via --all-workspaces. The flag --cwd-only is unknown. Ear… |
| 235 | open | Low–Medium | Usage | [ux-usage-help-hides-default-balance.md](./ux-usage-help-hides-default-balance.md) | Bare usage balance; help omits. |
| 236 | open | Low–Medium | Utils | [ux-utils-symlink-skills-scope-error-vs-agents.md](./ux-utils-symlink-skills-scope-error-vs-agents.md) | skills dry-run needs flags. |
| 237 | open | Low–Medium | Logging / verbose | [ux-verbose-prefixes-every-log-line.md](./ux-verbose-prefixes-every-log-line.md) | [models] on tables. |
| 238 | open | Low–Medium | Version | [ux-version-update-nag-on-dev-builds.md](./ux-version-update-nag-on-dev-builds.md) | Always update available. |
| 239 | open | Low–Medium | Worktree | [ux-worktree-reconcile-requires-agent-not-in-error-order.md](./ux-worktree-reconcile-requires-agent-not-in-error-order.md) | worktree reconcile without args hits required option --agent before missing name, similar to spawn mode-bef… |
| 240 | open | Low | Errors / positive pattern | [ux-activity-timeout-zero-good-validation.md](./ux-activity-timeout-zero-good-validation.md) | Invalid --activity-timeout-ms "0" returns a clear ValidationError-style message without raw Commander text … |
| 241 | open | Low | Spawn / positive pattern | [ux-activity-timeout-zero-validation-good.md](./ux-activity-timeout-zero-validation-good.md) | Invalid activity timeout returns Expected a positive integer without stack. |
| 242 | open | Low | Braintrust | [ux-braintrust-status-opaque.md](./ux-braintrust-status-opaque.md) | disabled only. |
| 243 | open | Low | Configure / positive pattern | [ux-configure-success-vscode-next-steps-good.md](./ux-configure-success-vscode-next-steps-good.md) | After configuring Claude Code, a Next steps note with vscode://settings/claudeCode.disableLoginPrompt deep … |
| 244 | open | Low | Configure / positive pattern | [ux-configure-unknown-provider-good-message.md](./ux-configure-unknown-provider-good-message.md) | configure --provider notaprovider returns Unknown provider "notaprovider" cleanly (could still list known p… |
| 245 | open | Low | Spawn / positive pattern | [ux-e2b-missing-key-error-good.md](./ux-e2b-missing-key-error-good.md) | No E2B API key message points to E2B_API_KEY and config.json paths — good recovery (still See logs). |
| 246 | open | Low | Harness | [ux-harness-unknown-template-no-kinds.md](./ux-harness-unknown-template-no-kinds.md) | No allow-list. |
| 247 | open | Low | Polish | [ux-help-subcommand-inconsistency.md](./ux-help-subcommand-inconsistency.md) | Some groups help [command]. |
| 248 | open | Low | Auth | [ux-login-yes-message-good-but-worth-aligning.md](./ux-login-yes-message-good-but-worth-aligning.md) | --yes fail-fast good; bare hangs. |
| 249 | open | Low | Maestro | [ux-maestro-dual-invocation-shape.md](./ux-maestro-dual-invocation-shape.md) | Parent + run unclear. |
| 250 | open | Low | Maestro | [ux-maestro-duplicate-config-flags.md](./ux-maestro-duplicate-config-flags.md) | --config and --workflow same. |
| 251 | open | Low | Spawn / positive pattern | [ux-mcp-servers-validation-good.md](./ux-mcp-servers-validation-good.md) | Invalid MCP server JSON without command returns a clear field-level ValidationError without system chrome. |
| 252 | open | Low | Models / positive pattern | [ux-models-help-examples-are-excellent.md](./ux-models-help-examples-are-excellent.md) | models --help includes Filters, Views, and Examples sections — best-in-class help in the CLI; other primary… |
| 253 | open | Low | Pipeline / positive pattern | [ux-pipeline-max-runs-zero-good-validation.md](./ux-pipeline-max-runs-zero-good-validation.md) | Invalid max-runs "0" returns clear positive-integer validation without raw Commander text — positive patter… |
| 254 | open | Low | Plan / positive pattern | [ux-plan-install-success-good.md](./ux-plan-install-success-good.md) | plan install shows Create path and Installed plan skill with design-system framing — positive pattern. |
| 255 | open | Low | Plan / positive pattern | [ux-plan-output-invalid-validation-good.md](./ux-plan-output-invalid-validation-good.md) | Invalid --output value "bad" returns Expected one of: terminal, md, json without raw Commander skin. |
| 256 | open | Low | Plan path | [ux-plan-path-commands-bare-stdout-reconfirmed.md](./ux-plan-path-commands-bare-stdout-reconfirmed.md) | pipeline/experiment/superintendent plan-path print absolute path as bare stdout — good for scripting, incon… |
| 257 | open | Low | Plan paths | [ux-plan-path-commands-bare-stdout.md](./ux-plan-path-commands-bare-stdout.md) | Path only. |
| 258 | open | Low | Brand | [ux-root-tagline-inconsistent.md](./ux-root-tagline-inconsistent.md) | Different one-liners. |
| 259 | open | Low | Configure / positive pattern | [ux-shape-base-url-invalid-validation-good.md](./ux-shape-base-url-invalid-validation-good.md) | Invalid --shape-base-url value returns Use <shape-id>=<url> clearly. |
| 260 | open | Low | Skills / positive pattern | [ux-skill-install-from-file-works-well.md](./ux-skill-install-from-file-works-well.md) | skill install with --file/--name/--yes/--local produces a clear design-system success naming agent and path… |
| 261 | open | Low | Spawn / positive pattern | [ux-spawn-invalid-mode-validation-good.md](./ux-spawn-invalid-mode-validation-good.md) | Invalid --mode "bogus" returns Expected yolo, auto, edit, or read without Commander raw skin. |
| 262 | open | Low | Spawn / positive pattern | [ux-spawn-runtime-docker-error-good-install-hints.md](./ux-spawn-runtime-docker-error-good-install-hints.md) | No container engine found includes Docker Desktop / Colima / Podman install hints — good recovery copy (sti… |
| 263 | open | Low | Test / positive pattern | [ux-test-with-valid-model-succeeds.md](./ux-test-with-valid-model-succeeds.md) | test claude --model anthropic/claude-haiku-4.5 succeeds with Tested Claude Code framing when model is valid… |
| 264 | open | Low | Update / positive pattern | [ux-update-package-manager-override-works.md](./ux-update-package-manager-override-works.md) | update --package-manager bun --dry-run correctly plans bun install -g poe-code@latest — positive package-ma… |
| 265 | open | Low | Usage / positive pattern | [ux-usage-balance-presentation-good.md](./ux-usage-balance-presentation-good.md) | usage balance shows Balance, Plan, Add-on, next grant with design-system framing and helpful next-points link. |
| 266 | open | Low | Utils / positive pattern | [ux-utils-config-init-already-exists-is-info.md](./ux-utils-config-init-already-exists-is-info.md) | config init when project config exists prints Project config already exists at path without error exit dram… |
| 267 | open | Low | Utils / positive pattern | [ux-utils-symlink-skills-yes-local-dry-run-works.md](./ux-utils-symlink-skills-yes-local-dry-run-works.md) | With explicit scope flags, dry-run shows rename+symlink plan — positive once scope is provided (still subje… |

## Platform fixes

1. Secret redaction (dry-run diffs + auth) + danger help  
2. Remove/replace dead `claude-sonnet-5` defaults  
3. Intentional-only dry-run diffs  
4. models `--model` accept namespaced ids  
5. Reject empty/invalid explicit flags  
6. Unified permission mode enum  
7. Unified skill-install scope flags + idempotent install policy  
8. UserError classification  
9. displayBinaryName vs npm run dev / toolcraft  
10. Agent capability matrix  
11. Destructive policy + model catalog validation  
12. Doctor overview  
13. Launch/runtime job state store resilience + prune  
14. Parent-group next-step defaults  
15. Detach requires runtime / explicit job id  
16. Copy models-style Examples to spawn/configure/gaslight  

## Alphabetical index

| File | # |
| --- | ---: |
| [ux-acp-stream-uses-success-glyph-for-partial-text.md](./ux-acp-stream-uses-success-glyph-for-partial-text.md) | 73 |
| [ux-activity-timeout-zero-good-validation.md](./ux-activity-timeout-zero-good-validation.md) | 240 |
| [ux-activity-timeout-zero-validation-good.md](./ux-activity-timeout-zero-validation-good.md) | 241 |
| [ux-agent-default-model-hardcoded.md](./ux-agent-default-model-hardcoded.md) | 196 |
| [ux-agent-invalid-model-system-chrome.md](./ux-agent-invalid-model-system-chrome.md) | 74 |
| [ux-agent-spawn-missing-args-raw-commander.md](./ux-agent-spawn-missing-args-raw-commander.md) | 75 |
| [ux-api-key-flags-encourage-shell-history-leaks.md](./ux-api-key-flags-encourage-shell-history-leaks.md) | 76 |
| [ux-approval-copy-hardcodes-toolcraft-in-source.md](./ux-approval-copy-hardcodes-toolcraft-in-source.md) | 8 |
| [ux-approval-queued-message-says-toolcraft.md](./ux-approval-queued-message-says-toolcraft.md) | 9 |
| [ux-approvals-invalid-state-silent-empty-reconfirmed.md](./ux-approvals-invalid-state-silent-empty-reconfirmed.md) | 77 |
| [ux-approvals-invalid-state-silent-empty.md](./ux-approvals-invalid-state-silent-empty.md) | 78 |
| [ux-auth-api-key-dry-run-still-prints-secret.md](./ux-auth-api-key-dry-run-still-prints-secret.md) | 3 |
| [ux-auth-api-key-help-no-danger-warning.md](./ux-auth-api-key-help-no-danger-warning.md) | 10 |
| [ux-auth-api-key-prints-secret.md](./ux-auth-api-key-prints-secret.md) | 2 |
| [ux-auth-whoami-raw-json-vs-status-panel.md](./ux-auth-whoami-raw-json-vs-status-panel.md) | 197 |
| [ux-auth-whoami-raw-json.md](./ux-auth-whoami-raw-json.md) | 198 |
| [ux-binary-wrappers-undocumented.md](./ux-binary-wrappers-undocumented.md) | 79 |
| [ux-braintrust-status-opaque.md](./ux-braintrust-status-opaque.md) | 242 |
| [ux-capture-otel-content-without-capture-silent.md](./ux-capture-otel-content-without-capture-silent.md) | 80 |
| [ux-code-review-double-error-skin.md](./ux-code-review-double-error-skin.md) | 81 |
| [ux-code-review-drafts-missing-arg-double-error.md](./ux-code-review-drafts-missing-arg-double-error.md) | 11 |
| [ux-code-review-profiles-raw-table.md](./ux-code-review-profiles-raw-table.md) | 199 |
| [ux-code-review-profiles-table-outside-design-system.md](./ux-code-review-profiles-table-outside-design-system.md) | 200 |
| [ux-command-aliases-undocumented-on-root-help.md](./ux-command-aliases-undocumented-on-root-help.md) | 201 |
| [ux-command-not-found-no-suggestions.md](./ux-command-not-found-no-suggestions.md) | 82 |
| [ux-configure-accepts-invalid-model-without-validation.md](./ux-configure-accepts-invalid-model-without-validation.md) | 12 |
| [ux-configure-codex-dry-run-still-leaks-and-noise.md](./ux-configure-codex-dry-run-still-leaks-and-noise.md) | 13 |
| [ux-configure-dry-run-dumps-entire-existing-agent-config.md](./ux-configure-dry-run-dumps-entire-existing-agent-config.md) | 14 |
| [ux-configure-dry-run-floods-diff.md](./ux-configure-dry-run-floods-diff.md) | 83 |
| [ux-configure-dry-run-writes-stale-model-id.md](./ux-configure-dry-run-writes-stale-model-id.md) | 15 |
| [ux-configure-provider-requires-model-without-listing-models.md](./ux-configure-provider-requires-model-without-listing-models.md) | 84 |
| [ux-configure-shape-base-url-opaque.md](./ux-configure-shape-base-url-opaque.md) | 202 |
| [ux-configure-success-vscode-next-steps-good.md](./ux-configure-success-vscode-next-steps-good.md) | 243 |
| [ux-configure-unknown-provider-good-message.md](./ux-configure-unknown-provider-good-message.md) | 244 |
| [ux-configure-yes-silent-default-agent.md](./ux-configure-yes-silent-default-agent.md) | 85 |
| [ux-dashboard-keybindings-undocumented-on-cli-help.md](./ux-dashboard-keybindings-undocumented-on-cli-help.md) | 86 |
| [ux-development-mode-usage-intentional-but-leaks.md](./ux-development-mode-usage-intentional-but-leaks.md) | 16 |
| [ux-dry-run-diffs-print-secrets.md](./ux-dry-run-diffs-print-secrets.md) | 1 |
| [ux-dual-help-systems.md](./ux-dual-help-systems.md) | 17 |
| [ux-e2b-missing-key-error-good.md](./ux-e2b-missing-key-error-good.md) | 245 |
| [ux-editor-error-still-system-chrome.md](./ux-editor-error-still-system-chrome.md) | 87 |
| [ux-editor-missing-raw-error.md](./ux-editor-missing-raw-error.md) | 203 |
| [ux-empty-api-key-flag-silently-ignored.md](./ux-empty-api-key-flag-silently-ignored.md) | 88 |
| [ux-empty-model-flag-behavior-inconsistent.md](./ux-empty-model-flag-behavior-inconsistent.md) | 18 |
| [ux-empty-plan-kind-lists-still-draw-empty-tables.md](./ux-empty-plan-kind-lists-still-draw-empty-tables.md) | 89 |
| [ux-error-panel-closes-before-error.md](./ux-error-panel-closes-before-error.md) | 19 |
| [ux-eval-empty-source-message-inconsistent-skins.md](./ux-eval-empty-source-message-inconsistent-skins.md) | 90 |
| [ux-eval-errors-outside-design-system.md](./ux-eval-errors-outside-design-system.md) | 204 |
| [ux-eval-init-success-is-bare-paths.md](./ux-eval-init-success-is-bare-paths.md) | 205 |
| [ux-eval-report-debug-flag-undocumented-in-error.md](./ux-eval-report-debug-flag-undocumented-in-error.md) | 206 |
| [ux-eval-unknown-command-suggests-lint-for-list.md](./ux-eval-unknown-command-suggests-lint-for-list.md) | 91 |
| [ux-experiment-install-already-exists-vs-pipeline-skip.md](./ux-experiment-install-already-exists-vs-pipeline-skip.md) | 20 |
| [ux-experiment-journal-wrong-doc-type-message.md](./ux-experiment-journal-wrong-doc-type-message.md) | 207 |
| [ux-experiment-ralph-no-doc-wrong-message.md](./ux-experiment-ralph-no-doc-wrong-message.md) | 21 |
| [ux-extra-npm-bins-confusing.md](./ux-extra-npm-bins-confusing.md) | 208 |
| [ux-failure-shown-as-success-markers.md](./ux-failure-shown-as-success-markers.md) | 22 |
| [ux-gaslight-archive-and-no-archive-both-accepted.md](./ux-gaslight-archive-and-no-archive-both-accepted.md) | 209 |
| [ux-gaslight-config-missing-enoent.md](./ux-gaslight-config-missing-enoent.md) | 92 |
| [ux-gaslight-ingest-failure-dumps-jsonl.md](./ux-gaslight-ingest-failure-dumps-jsonl.md) | 23 |
| [ux-gaslight-multi-plan-fails-fast-with-success-markers.md](./ux-gaslight-multi-plan-fails-fast-with-success-markers.md) | 93 |
| [ux-gaslight-no-activity-timeout-flag.md](./ux-gaslight-no-activity-timeout-flag.md) | 94 |
| [ux-gaslight-no-plan-autopicks-and-hits-stale-model.md](./ux-gaslight-no-plan-autopicks-and-hits-stale-model.md) | 24 |
| [ux-gaslight-opaque-naming.md](./ux-gaslight-opaque-naming.md) | 95 |
| [ux-gaslight-unknown-agent-says-service.md](./ux-gaslight-unknown-agent-says-service.md) | 96 |
| [ux-gemini-configure-dry-run-too-quiet.md](./ux-gemini-configure-dry-run-too-quiet.md) | 97 |
| [ux-gh-install-dry-run-lists-paths-without-panel.md](./ux-gh-install-dry-run-lists-paths-without-panel.md) | 98 |
| [ux-gh-install-eject-flag-opaque.md](./ux-gh-install-eject-flag-opaque.md) | 210 |
| [ux-github-cwd-clone-errors-still-raw-git.md](./ux-github-cwd-clone-errors-still-raw-git.md) | 25 |
| [ux-github-cwd-clone-errors-unframed.md](./ux-github-cwd-clone-errors-unframed.md) | 70 |
| [ux-global-flags-hidden-on-subcommand-help.md](./ux-global-flags-hidden-on-subcommand-help.md) | 99 |
| [ux-group-commands-print-help-only.md](./ux-group-commands-print-help-only.md) | 100 |
| [ux-hardcoded-stale-sonnet-5-in-product-defaults.md](./ux-hardcoded-stale-sonnet-5-in-product-defaults.md) | 4 |
| [ux-harness-missing-file-system-chrome.md](./ux-harness-missing-file-system-chrome.md) | 101 |
| [ux-harness-unknown-template-no-kinds.md](./ux-harness-unknown-template-no-kinds.md) | 246 |
| [ux-harness-unknown-template-still-omits-kind-list.md](./ux-harness-unknown-template-still-omits-kind-list.md) | 102 |
| [ux-help-command-not-registered.md](./ux-help-command-not-registered.md) | 103 |
| [ux-help-subcommand-inconsistency.md](./ux-help-subcommand-inconsistency.md) | 247 |
| [ux-hidden-and-orphan-commands.md](./ux-hidden-and-orphan-commands.md) | 104 |
| [ux-hooks-bridge-refuse-user-authored-file-opaque.md](./ux-hooks-bridge-refuse-user-authored-file-opaque.md) | 105 |
| [ux-hooks-from-spawn-poe-code-enoent.md](./ux-hooks-from-spawn-poe-code-enoent.md) | 26 |
| [ux-hooks-from-unsupported-system-chrome.md](./ux-hooks-from-unsupported-system-chrome.md) | 106 |
| [ux-hooks-strategy-transform-unsupported-opaque.md](./ux-hooks-strategy-transform-unsupported-opaque.md) | 27 |
| [ux-important-commands-absent-from-root-help.md](./ux-important-commands-absent-from-root-help.md) | 107 |
| [ux-inconsistent-agent-surface-across-commands.md](./ux-inconsistent-agent-surface-across-commands.md) | 28 |
| [ux-install-always-claims-success.md](./ux-install-always-claims-success.md) | 211 |
| [ux-install-skill-flags-inconsistent-across-commands.md](./ux-install-skill-flags-inconsistent-across-commands.md) | 29 |
| [ux-install-yes-defaults-agent-silently.md](./ux-install-yes-defaults-agent-silently.md) | 108 |
| [ux-json-flag-inconsistent-across-commands.md](./ux-json-flag-inconsistent-across-commands.md) | 109 |
| [ux-kimi-default-model-id-mismatches-catalog-namespace.md](./ux-kimi-default-model-id-mismatches-catalog-namespace.md) | 110 |
| [ux-launch-commands-trigger-full-turbo-rebuild.md](./ux-launch-commands-trigger-full-turbo-rebuild.md) | 111 |
| [ux-launch-start-opaque-failure.md](./ux-launch-start-opaque-failure.md) | 112 |
| [ux-launch-start-via-npm-run-dev-confuses-argv.md](./ux-launch-start-via-npm-run-dev-confuses-argv.md) | 113 |
| [ux-launch-status-crashes-on-tombstone-dirs.md](./ux-launch-status-crashes-on-tombstone-dirs.md) | 30 |
| [ux-launch-status-shows-dash-id-ghost-rows.md](./ux-launch-status-shows-dash-id-ghost-rows.md) | 31 |
| [ux-launch-status-shows-failed-experiment-leftovers.md](./ux-launch-status-shows-failed-experiment-leftovers.md) | 212 |
| [ux-log-content-flags-underwarn-sensitive-data.md](./ux-log-content-flags-underwarn-sensitive-data.md) | 114 |
| [ux-login-help-omits-interactive-and-yes.md](./ux-login-help-omits-interactive-and-yes.md) | 115 |
| [ux-login-help-omits-oauth-default.md](./ux-login-help-omits-oauth-default.md) | 116 |
| [ux-login-non-tty-hangs-on-oauth.md](./ux-login-non-tty-hangs-on-oauth.md) | 32 |
| [ux-login-rejected-no-recovery.md](./ux-login-rejected-no-recovery.md) | 117 |
| [ux-login-yes-message-good-but-worth-aligning.md](./ux-login-yes-message-good-but-worth-aligning.md) | 248 |
| [ux-logout-dry-run-multi-panel-noise.md](./ux-logout-dry-run-multi-panel-noise.md) | 33 |
| [ux-logout-help-no-danger-or-scope-detail.md](./ux-logout-help-no-danger-or-scope-detail.md) | 34 |
| [ux-logout-overclaims-scope.md](./ux-logout-overclaims-scope.md) | 7 |
| [ux-maestro-dry-run-hits-github-without-workflow.md](./ux-maestro-dry-run-hits-github-without-workflow.md) | 71 |
| [ux-maestro-dry-run-path-vs-flag-confusion.md](./ux-maestro-dry-run-path-vs-flag-confusion.md) | 35 |
| [ux-maestro-dual-invocation-shape.md](./ux-maestro-dual-invocation-shape.md) | 249 |
| [ux-maestro-duplicate-config-flags.md](./ux-maestro-duplicate-config-flags.md) | 250 |
| [ux-many-parent-groups-only-dump-help.md](./ux-many-parent-groups-only-dump-help.md) | 118 |
| [ux-mcp-servers-missing-file-almost-good.md](./ux-mcp-servers-missing-file-almost-good.md) | 213 |
| [ux-mcp-servers-validation-good.md](./ux-mcp-servers-validation-good.md) | 251 |
| [ux-memory-clear-help-still-no-force-or-yes.md](./ux-memory-clear-help-still-no-force-or-yes.md) | 119 |
| [ux-memory-clear-no-confirmation.md](./ux-memory-clear-no-confirmation.md) | 120 |
| [ux-memory-install-already-exists-system-chrome.md](./ux-memory-install-already-exists-system-chrome.md) | 121 |
| [ux-memory-mcp-print-config-raw-json.md](./ux-memory-mcp-print-config-raw-json.md) | 214 |
| [ux-memory-status-after-write-is-terse.md](./ux-memory-status-after-write-is-terse.md) | 215 |
| [ux-memory-write-requires-reason-before-path.md](./ux-memory-write-requires-reason-before-path.md) | 122 |
| [ux-memory-write-requires-reason-raw-commander.md](./ux-memory-write-requires-reason-raw-commander.md) | 123 |
| [ux-memory-write-success-is-raw-unframed.md](./ux-memory-write-success-is-raw-unframed.md) | 124 |
| [ux-model-id-namespace-stripping-surprises.md](./ux-model-id-namespace-stripping-surprises.md) | 125 |
| [ux-models-dumps-full-catalog.md](./ux-models-dumps-full-catalog.md) | 126 |
| [ux-models-exact-id-filter-rejects-namespaced-ids.md](./ux-models-exact-id-filter-rejects-namespaced-ids.md) | 36 |
| [ux-models-feature-bogus-silent-empty.md](./ux-models-feature-bogus-silent-empty.md) | 127 |
| [ux-models-feature-flag-not-repeatable.md](./ux-models-feature-flag-not-repeatable.md) | 128 |
| [ux-models-help-examples-are-excellent.md](./ux-models-help-examples-are-excellent.md) | 252 |
| [ux-models-input-bogus-silent-empty.md](./ux-models-input-bogus-silent-empty.md) | 129 |
| [ux-models-invalid-feature-silent-empty.md](./ux-models-invalid-feature-silent-empty.md) | 130 |
| [ux-models-invalid-modality-silent-empty.md](./ux-models-invalid-modality-silent-empty.md) | 131 |
| [ux-models-raw-view-bypasses-design-system.md](./ux-models-raw-view-bypasses-design-system.md) | 216 |
| [ux-models-search-confirms-sonnet-5-absent-from-catalog.md](./ux-models-search-confirms-sonnet-5-absent-from-catalog.md) | 37 |
| [ux-models-since-validation-still-prints-stack.md](./ux-models-since-validation-still-prints-stack.md) | 38 |
| [ux-models-tools-and-feature-filter-semantics-undocumented.md](./ux-models-tools-and-feature-filter-semantics-undocumented.md) | 217 |
| [ux-models-view-invalid-uses-raw-commander.md](./ux-models-view-invalid-uses-raw-commander.md) | 132 |
| [ux-no-doctor-or-health-overview-command.md](./ux-no-doctor-or-health-overview-command.md) | 133 |
| [ux-no-shell-completion-command.md](./ux-no-shell-completion-command.md) | 218 |
| [ux-non-tty-prompt-wrong-guidance.md](./ux-non-tty-prompt-wrong-guidance.md) | 39 |
| [ux-oauth-url-dumps-full-query-string.md](./ux-oauth-url-dumps-full-query-string.md) | 219 |
| [ux-opencode-model-triple-namespace.md](./ux-opencode-model-triple-namespace.md) | 134 |
| [ux-permission-mode-sets-differ-across-commands.md](./ux-permission-mode-sets-differ-across-commands.md) | 40 |
| [ux-pi-spawnable-but-not-configurable.md](./ux-pi-spawnable-but-not-configurable.md) | 41 |
| [ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md](./ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md) | 135 |
| [ux-pipeline-max-runs-zero-good-validation.md](./ux-pipeline-max-runs-zero-good-validation.md) | 253 |
| [ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md](./ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md) | 42 |
| [ux-pipeline-tui-flag-ignored-on-init-failure.md](./ux-pipeline-tui-flag-ignored-on-init-failure.md) | 136 |
| [ux-pipeline-validate-enoent-system-error.md](./ux-pipeline-validate-enoent-system-error.md) | 137 |
| [ux-pipeline-validate-success-still-problems-footer.md](./ux-pipeline-validate-success-still-problems-footer.md) | 220 |
| [ux-pipeline-validate-wrong-kind-system-chrome.md](./ux-pipeline-validate-wrong-kind-system-chrome.md) | 138 |
| [ux-plan-archive-allows-readme.md](./ux-plan-archive-allows-readme.md) | 139 |
| [ux-plan-archive-delete-yes-picks-arbitrary-plan.md](./ux-plan-archive-delete-yes-picks-arbitrary-plan.md) | 6 |
| [ux-plan-archive-help-omits-yes-behavior.md](./ux-plan-archive-help-omits-yes-behavior.md) | 43 |
| [ux-plan-browse-non-tty-dumps-first-plan.md](./ux-plan-browse-non-tty-dumps-first-plan.md) | 140 |
| [ux-plan-delete-allows-readme.md](./ux-plan-delete-allows-readme.md) | 44 |
| [ux-plan-docs-advertise-goal-and-chat-commands-missing.md](./ux-plan-docs-advertise-goal-and-chat-commands-missing.md) | 141 |
| [ux-plan-edit-hangs-without-editor.md](./ux-plan-edit-hangs-without-editor.md) | 45 |
| [ux-plan-install-success-good.md](./ux-plan-install-success-good.md) | 254 |
| [ux-plan-list-empty-table-no-message.md](./ux-plan-list-empty-table-no-message.md) | 221 |
| [ux-plan-list-includes-noise-files.md](./ux-plan-list-includes-noise-files.md) | 142 |
| [ux-plan-list-output-json-unframed.md](./ux-plan-list-output-json-unframed.md) | 222 |
| [ux-plan-markdown-read-raw-yaml-ish-output.md](./ux-plan-markdown-read-raw-yaml-ish-output.md) | 223 |
| [ux-plan-markdown-read-section-wrong-command-hint.md](./ux-plan-markdown-read-section-wrong-command-hint.md) | 143 |
| [ux-plan-markdown-read-system-chrome.md](./ux-plan-markdown-read-system-chrome.md) | 144 |
| [ux-plan-non-tty-unclear-failure.md](./ux-plan-non-tty-unclear-failure.md) | 145 |
| [ux-plan-output-invalid-validation-good.md](./ux-plan-output-invalid-validation-good.md) | 255 |
| [ux-plan-path-commands-bare-stdout-reconfirmed.md](./ux-plan-path-commands-bare-stdout-reconfirmed.md) | 256 |
| [ux-plan-path-commands-bare-stdout.md](./ux-plan-path-commands-bare-stdout.md) | 257 |
| [ux-plan-view-json-dumps-full-markdown-content.md](./ux-plan-view-json-dumps-full-markdown-content.md) | 224 |
| [ux-primary-commands-lack-examples-in-help.md](./ux-primary-commands-lack-examples-in-help.md) | 146 |
| [ux-primary-commands-still-lack-examples.md](./ux-primary-commands-still-lack-examples.md) | 147 |
| [ux-problems-footer-on-every-success.md](./ux-problems-footer-on-every-success.md) | 225 |
| [ux-provider-list-agents-column-incomplete.md](./ux-provider-list-agents-column-incomplete.md) | 148 |
| [ux-provider-login-missing-key-system-chrome.md](./ux-provider-login-missing-key-system-chrome.md) | 149 |
| [ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md](./ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md) | 46 |
| [ux-provider-logout-dry-run-unconfigures-agents.md](./ux-provider-logout-dry-run-unconfigures-agents.md) | 47 |
| [ux-ralph-experiment-wrong-kind-says-not-found.md](./ux-ralph-experiment-wrong-kind-says-not-found.md) | 150 |
| [ux-raw-commander-invalid-option-choices.md](./ux-raw-commander-invalid-option-choices.md) | 151 |
| [ux-raw-commander-missing-args.md](./ux-raw-commander-missing-args.md) | 152 |
| [ux-readme-features-wrap-but-cli-missing.md](./ux-readme-features-wrap-but-cli-missing.md) | 153 |
| [ux-readme-spawn-omits-mode-for-ci.md](./ux-readme-spawn-omits-mode-for-ci.md) | 48 |
| [ux-reasoning-effort-bogus-silently-ignored.md](./ux-reasoning-effort-bogus-silently-ignored.md) | 49 |
| [ux-reasoning-effort-flag-opaque.md](./ux-reasoning-effort-flag-opaque.md) | 154 |
| [ux-reasoning-effort-flag-silently-ignored-for-some-agents.md](./ux-reasoning-effort-flag-silently-ignored-for-some-agents.md) | 50 |
| [ux-resume-thread-errors-are-agent-raw.md](./ux-resume-thread-errors-are-agent-raw.md) | 155 |
| [ux-root-help-footer-npm-run-dev-for-options.md](./ux-root-help-footer-npm-run-dev-for-options.md) | 51 |
| [ux-root-help-usage-line-is-npm-run-dev.md](./ux-root-help-usage-line-is-npm-run-dev.md) | 52 |
| [ux-root-tagline-inconsistent.md](./ux-root-tagline-inconsistent.md) | 258 |
| [ux-runtime-jobs-list-unbounded-opaque-statuses.md](./ux-runtime-jobs-list-unbounded-opaque-statuses.md) | 156 |
| [ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md](./ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md) | 53 |
| [ux-runtime-jobs-show-unknown-suggests-stop.md](./ux-runtime-jobs-show-unknown-suggests-stop.md) | 157 |
| [ux-runtime-jobs-stale-running-zombies.md](./ux-runtime-jobs-stale-running-zombies.md) | 72 |
| [ux-runtime-missing-deps-good-message-system-chrome.md](./ux-runtime-missing-deps-good-message-system-chrome.md) | 158 |
| [ux-runtime-templates-ls-shows-empty-docker-row.md](./ux-runtime-templates-ls-shows-empty-docker-row.md) | 226 |
| [ux-runtime-templates-ls-unbounded-noise.md](./ux-runtime-templates-ls-unbounded-noise.md) | 227 |
| [ux-sdk-cli-mode-default-mismatch.md](./ux-sdk-cli-mode-default-mismatch.md) | 54 |
| [ux-sdk-getpoeapikey-throws-generic-error.md](./ux-sdk-getpoeapikey-throws-generic-error.md) | 159 |
| [ux-shape-base-url-error-good-message-system-prefix.md](./ux-shape-base-url-error-good-message-system-prefix.md) | 228 |
| [ux-shape-base-url-invalid-validation-good.md](./ux-shape-base-url-invalid-validation-good.md) | 259 |
| [ux-skill-and-skills-flags-undocumented-relationship.md](./ux-skill-and-skills-flags-undocumented-relationship.md) | 229 |
| [ux-skill-bridge-failure-system-chrome.md](./ux-skill-bridge-failure-system-chrome.md) | 160 |
| [ux-skill-configure-goose-writes-dot-agents-skills.md](./ux-skill-configure-goose-writes-dot-agents-skills.md) | 230 |
| [ux-skill-configure-kimi-unsupported-abrupt.md](./ux-skill-configure-kimi-unsupported-abrupt.md) | 161 |
| [ux-skill-configure-yes-defaults-agent-silently.md](./ux-skill-configure-yes-defaults-agent-silently.md) | 162 |
| [ux-skill-install-from-file-works-well.md](./ux-skill-install-from-file-works-well.md) | 260 |
| [ux-skill-install-name-and-file-both-required.md](./ux-skill-install-name-and-file-both-required.md) | 163 |
| [ux-skill-naming-collisions.md](./ux-skill-naming-collisions.md) | 164 |
| [ux-skill-parent-no-next-step-guidance.md](./ux-skill-parent-no-next-step-guidance.md) | 165 |
| [ux-skill-unconfigure-defaults-agent-and-soft-blocks.md](./ux-skill-unconfigure-defaults-agent-and-soft-blocks.md) | 166 |
| [ux-skills-flag-without-value-is-noop-or-unclear.md](./ux-skills-flag-without-value-is-noop-or-unclear.md) | 167 |
| [ux-skip-if-configured-shows-stale-default-model.md](./ux-skip-if-configured-shows-stale-default-model.md) | 55 |
| [ux-skip-if-configured-still-noises-dry-run.md](./ux-skip-if-configured-still-noises-dry-run.md) | 231 |
| [ux-skip-if-configured-still-writes-when-model-differs.md](./ux-skip-if-configured-still-writes-when-model-differs.md) | 168 |
| [ux-spawn-advanced-flags-undifferentiated.md](./ux-spawn-advanced-flags-undifferentiated.md) | 169 |
| [ux-spawn-codex-reads-stdin-message-on-tty-less-success.md](./ux-spawn-codex-reads-stdin-message-on-tty-less-success.md) | 170 |
| [ux-spawn-cwd-missing-system-chrome.md](./ux-spawn-cwd-missing-system-chrome.md) | 171 |
| [ux-spawn-detach-ignored-on-failure-path.md](./ux-spawn-detach-ignored-on-failure-path.md) | 172 |
| [ux-spawn-detach-silently-ignored-without-runtime.md](./ux-spawn-detach-silently-ignored-without-runtime.md) | 56 |
| [ux-spawn-gemini-provider-credential-opaque-error.md](./ux-spawn-gemini-provider-credential-opaque-error.md) | 57 |
| [ux-spawn-interactive-raw-agent-error.md](./ux-spawn-interactive-raw-agent-error.md) | 58 |
| [ux-spawn-interactive-still-uses-stale-model-bare-error.md](./ux-spawn-interactive-still-uses-stale-model-bare-error.md) | 59 |
| [ux-spawn-invalid-mode-validation-good.md](./ux-spawn-invalid-mode-validation-good.md) | 261 |
| [ux-spawn-mode-and-permission-copy.md](./ux-spawn-mode-and-permission-copy.md) | 60 |
| [ux-spawn-no-prompt-system-chrome.md](./ux-spawn-no-prompt-system-chrome.md) | 173 |
| [ux-spawn-poe-agent-crashes-fs-lstat.md](./ux-spawn-poe-agent-crashes-fs-lstat.md) | 5 |
| [ux-spawn-runtime-docker-error-good-install-hints.md](./ux-spawn-runtime-docker-error-good-install-hints.md) | 262 |
| [ux-spawn-success-still-problems-footer.md](./ux-spawn-success-still-problems-footer.md) | 232 |
| [ux-spawn-validates-mode-before-agent.md](./ux-spawn-validates-mode-before-agent.md) | 174 |
| [ux-stale-configured-model-fails-late.md](./ux-stale-configured-model-fails-late.md) | 61 |
| [ux-success-and-info-share-magenta-glyphs.md](./ux-success-and-info-share-magenta-glyphs.md) | 233 |
| [ux-successful-spawn-still-uses-checkmark-for-agent-text.md](./ux-successful-spawn-still-uses-checkmark-for-agent-text.md) | 175 |
| [ux-superintendent-missing-path-double-error.md](./ux-superintendent-missing-path-double-error.md) | 62 |
| [ux-superintendent-validate-unclosed-tag-opaque.md](./ux-superintendent-validate-unclosed-tag-opaque.md) | 176 |
| [ux-tables-ignore-terminal-width.md](./ux-tables-ignore-terminal-width.md) | 177 |
| [ux-tasks-github-auth-raw-error.md](./ux-tasks-github-auth-raw-error.md) | 178 |
| [ux-test-and-install-reject-spawn-only-agents-as-unknown.md](./ux-test-and-install-reject-spawn-only-agents-as-unknown.md) | 63 |
| [ux-test-failure-dumps-jsonl.md](./ux-test-failure-dumps-jsonl.md) | 64 |
| [ux-test-with-valid-model-succeeds.md](./ux-test-with-valid-model-succeeds.md) | 263 |
| [ux-timeout-errors-use-system-chrome.md](./ux-timeout-errors-use-system-chrome.md) | 179 |
| [ux-toolcraft-has-suggestions-poe-code-root-does-not.md](./ux-toolcraft-has-suggestions-poe-code-root-does-not.md) | 180 |
| [ux-toolcraft-heading-doubles-poe-code.md](./ux-toolcraft-heading-doubles-poe-code.md) | 181 |
| [ux-toolcraft-help-points-at-npm-run-dev.md](./ux-toolcraft-help-points-at-npm-run-dev.md) | 65 |
| [ux-toolcraft-suggests-options-but-still-npm-run-dev.md](./ux-toolcraft-suggests-options-but-still-npm-run-dev.md) | 66 |
| [ux-traces-cwd-only-flag-removed-or-renamed.md](./ux-traces-cwd-only-flag-removed-or-renamed.md) | 234 |
| [ux-traces-directory-path-eisdir.md](./ux-traces-directory-path-eisdir.md) | 182 |
| [ux-traces-missing-file-system-error.md](./ux-traces-missing-file-system-error.md) | 183 |
| [ux-traces-since-validation-cleaner-than-models.md](./ux-traces-since-validation-cleaner-than-models.md) | 67 |
| [ux-unconfigure-no-confirmation.md](./ux-unconfigure-no-confirmation.md) | 184 |
| [ux-unconfigure-nonconfigured-agent-still-plans-mutations.md](./ux-unconfigure-nonconfigured-agent-still-plans-mutations.md) | 185 |
| [ux-update-always-suggests-npm-install-g.md](./ux-update-always-suggests-npm-install-g.md) | 186 |
| [ux-update-package-manager-override-works.md](./ux-update-package-manager-override-works.md) | 264 |
| [ux-usage-balance-presentation-good.md](./ux-usage-balance-presentation-good.md) | 265 |
| [ux-usage-help-hides-default-balance.md](./ux-usage-help-hides-default-balance.md) | 235 |
| [ux-usage-list-no-json-flag.md](./ux-usage-list-no-json-flag.md) | 187 |
| [ux-user-errors-look-like-system-failures.md](./ux-user-errors-look-like-system-failures.md) | 68 |
| [ux-utils-config-init-already-exists-is-info.md](./ux-utils-config-init-already-exists-is-info.md) | 266 |
| [ux-utils-config-path-subcommand-missing.md](./ux-utils-config-path-subcommand-missing.md) | 188 |
| [ux-utils-config-show-dumps-large-json.md](./ux-utils-config-show-dumps-large-json.md) | 189 |
| [ux-utils-symlink-skills-scope-error-vs-agents.md](./ux-utils-symlink-skills-scope-error-vs-agents.md) | 236 |
| [ux-utils-symlink-skills-yes-local-dry-run-works.md](./ux-utils-symlink-skills-yes-local-dry-run-works.md) | 267 |
| [ux-validation-error-still-prints-stack.md](./ux-validation-error-still-prints-stack.md) | 69 |
| [ux-verbose-prefixes-every-log-line.md](./ux-verbose-prefixes-every-log-line.md) | 237 |
| [ux-version-nags-dev-to-major-jump.md](./ux-version-nags-dev-to-major-jump.md) | 190 |
| [ux-version-update-nag-on-dev-builds.md](./ux-version-update-nag-on-dev-builds.md) | 238 |
| [ux-wide-tables-truncate-critical-cells.md](./ux-wide-tables-truncate-critical-cells.md) | 191 |
| [ux-worktree-reconcile-requires-agent-not-in-error-order.md](./ux-worktree-reconcile-requires-agent-not-in-error-order.md) | 239 |
| [ux-worktree-remove-no-confirmation.md](./ux-worktree-remove-no-confirmation.md) | 192 |
| [ux-worktree-remove-not-found-system-chrome.md](./ux-worktree-remove-not-found-system-chrome.md) | 193 |
| [ux-wrap-dry-run-forwards-flag.md](./ux-wrap-dry-run-forwards-flag.md) | 194 |
| [ux-wrap-resolves-alias-but-dry-run-lies.md](./ux-wrap-resolves-alias-but-dry-run-lies.md) | 195 |

See [AUDIT_STATUS.md](./AUDIT_STATUS.md).
