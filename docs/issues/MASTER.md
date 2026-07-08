# UX issues — master priority list

**1 = fix first.** Count: **355**. Continuous audit 2026-07-07.

## Master list (1–N)

| # | Status | Severity | Area | Issue | One-line problem |
| ---: | --- | --- | --- | --- | --- |
| 1 | open | **Critical** | Security / dry-run | [ux-dry-run-diffs-print-secrets.md](./ux-dry-run-diffs-print-secrets.md) | Dry-run unconfigure/logout diffs print full API keys & bearer tokens |
| 2 | open | **Critical** | Auth / security | [ux-auth-api-key-prints-secret.md](./ux-auth-api-key-prints-secret.md) | `auth api-key` prints full secret to stdout with no mask/opt-in |
| 3 | open | **Critical** | Auth / dry-run | [ux-auth-api-key-dry-run-still-prints-secret.md](./ux-auth-api-key-dry-run-still-prints-secret.md) | `auth api-key --dry-run` still prints full secret |
| 4 | open | **Critical** | Config / models | [ux-hardcoded-stale-sonnet-5-in-product-defaults.md](./ux-hardcoded-stale-sonnet-5-in-product-defaults.md) | Product defaults hard-code dead `anthropic/claude-sonnet-5` model id |
| 5 | open | **Critical** | Configure / models | [ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md](./ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md) | `--skip-if-configured --yes` rewrote live config to dead sonnet-5 |
| 6 | open | **Critical** | Spawn / poe-agent | [ux-spawn-poe-agent-crashes-fs-lstat.md](./ux-spawn-poe-agent-crashes-fs-lstat.md) | Advertised `spawn poe-agent` crashes: `fs.lstat is not a function` |
| 7 | open | **Critical** | Plan / destructive | [ux-plan-archive-delete-yes-picks-arbitrary-plan.md](./ux-plan-archive-delete-yes-picks-arbitrary-plan.md) | `plan archive|delete --yes` without path mutates an arbitrary plan |
| 8 | open | **Critical** | Auth / destructive | [ux-logout-overclaims-scope.md](./ux-logout-overclaims-scope.md) | `logout` copy says credentials but factory-resets agents + config |
| 9 | open | **Critical** | Spawn / poe-agent | [ux-spawn-poe-agent-lstat-reconfirmed.md](./ux-spawn-poe-agent-lstat-reconfirmed.md) | Reconfirmed Critical: spawn poe-agent "hi" --mode read → fs.lstat is not a function + See logs. |
| 10 | open | **High** | Approvals / recovery | [ux-approval-copy-hardcodes-toolcraft-in-source.md](./ux-approval-copy-hardcodes-toolcraft-in-source.md) | Confirmed packages/toolcraft/src/cli.ts and mcp.ts hardcode toolcraft approvals. |
| 11 | open | **High** | Approvals / recovery | [ux-approval-queued-message-says-toolcraft.md](./ux-approval-queued-message-says-toolcraft.md) | Blocked-flow copy Track toolcraft approvals show id. |
| 12 | open | **High** | Approvals | [ux-approvals-show-missing-says-task-not-found.md](./ux-approvals-show-missing-says-task-not-found.md) | approvals show --approval-id missing returns Task "approvals/missing" not found — task terminology for appr… |
| 13 | open | **High** | Auth / dry-run | [ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md](./ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md) | Reconfirmed Critical: auth api-key --dry-run still emits the full API key (dry-run ignored). |
| 14 | open | **High** | Auth / security | [ux-auth-api-key-help-no-danger-warning.md](./ux-auth-api-key-help-no-danger-warning.md) | Help says only Display stored API key with no mention of masking, --reveal, or secret handling — even thoug… |
| 15 | open | **High** | Auth / destructive | [ux-auth-logout-same-as-logout-help.md](./ux-auth-logout-same-as-logout-help.md) | auth logout help says Remove all configuration and credentials same as root logout — if auth logout is alia… |
| 16 | open | **High** | Code-review / errors | [ux-code-review-drafts-missing-arg-double-error.md](./ux-code-review-drafts-missing-arg-double-error.md) | Missing prUrl shows raw error: missing required argument then design-system error with same text and npm ru… |
| 17 | open | **High** | Code-review | [ux-code-review-run-invalid-url-wrong-error.md](./ux-code-review-run-invalid-url-wrong-error.md) | code-review run "not-a-url" fails with No code-review agent resolved rather than invalid PR URL — validatio… |
| 18 | open | **High** | Configure / models | [ux-configure-accepts-invalid-model-without-validation.md](./ux-configure-accepts-invalid-model-without-validation.md) | configure --model totally-fake-model-xyz --yes --dry-run proceeds to plan writes without validating the mod… |
| 19 | open | **High** | Configure | [ux-configure-base-url-may-be-ignored.md](./ux-configure-base-url-may-be-ignored.md) | configure claude --base-url https://example.com --yes --dry-run still shows ANTHROPIC_BASE_URL api.poe.com … |
| 20 | open | **High** | Dry-run | [ux-configure-codex-dry-run-still-leaks-and-noise.md](./ux-configure-codex-dry-run-still-leaks-and-noise.md) | Reconfirmed: even with explicit --model openai/gpt-5.3-codex, dry-run still dumps large config rewrites (pr… |
| 21 | open | **High** | Dry-run / privacy | [ux-configure-dry-run-dumps-entire-existing-agent-config.md](./ux-configure-dry-run-dumps-entire-existing-agent-config.md) | configure codex --dry-run emits a full rewrite-style diff of the agent config that includes dozens of unrel… |
| 22 | open | **High** | Configure / models | [ux-configure-dry-run-writes-stale-model-id.md](./ux-configure-dry-run-writes-stale-model-id.md) | configure --yes --dry-run for claude shows default model anthropic/claude-sonnet-5 and would write model cl… |
| 23 | open | **High** | Help / identity | [ux-development-mode-usage-intentional-but-leaks.md](./ux-development-mode-usage-intentional-but-leaks.md) | execution-context maps development to npm run dev -- leaking into all help/errors. |
| 24 | open | **High** | Help | [ux-dual-help-systems.md](./ux-dual-help-systems.md) | Commander vs toolcraft help completely different UIs. |
| 25 | open | **High** | Auth / configure | [ux-empty-api-key-login-good-but-configure-ignores.md](./ux-empty-api-key-login-good-but-configure-ignores.md) | login --api-key "" / " " correctly rejects POE API key cannot be empty. configure --api-key "" --yes --dry-… |
| 26 | open | **High** | Models / flags | [ux-empty-model-flag-behavior-inconsistent.md](./ux-empty-model-flag-behavior-inconsistent.md) | --model "" on agent fails with Missing model (good-ish); on spawn falls through to stale configured model a… |
| 27 | open | **High** | Errors / design system | [ux-error-panel-closes-before-error.md](./ux-error-panel-closes-before-error.md) | finalize Problems? then detached error. |
| 28 | open | **High** | Eval / identity | [ux-eval-report-invalid-format-npm-run-dev.md](./ux-eval-report-invalid-format-npm-run-dev.md) | Invalid --format bogus returns Expected one of: json, md, table with Run npm run dev -- eval report --help … |
| 29 | open | **High** | Install / consistency | [ux-experiment-install-already-exists-vs-pipeline-skip.md](./ux-experiment-install-already-exists-vs-pipeline-skip.md) | experiment install when skill exists hard-errors Skill already exists; pipeline install --dry-run skips exi… |
| 30 | open | **High** | Experiment / install | [ux-experiment-install-force-does-not-overwrite.md](./ux-experiment-install-force-does-not-overwrite.md) | experiment install --local --force still fails Skill already exists — --force does not overwrite despite he… |
| 31 | open | **High** | Experiment | [ux-experiment-journal-wrong-kind-says-not-found.md](./ux-experiment-journal-wrong-kind-says-not-found.md) | experiment journal docs/plans/32-agent-goal.md (kind: plan) says Experiment doc not found rather than wrong… |
| 32 | open | **High** | Experiment / Ralph | [ux-experiment-ralph-no-doc-wrong-message.md](./ux-experiment-ralph-no-doc-wrong-message.md) | experiment validate/journal and ralph run without doc say No markdown doc found under docs/plans. Provide a… |
| 33 | open | **High** | Packaging | [ux-extra-npm-bins-still-shipped.md](./ux-extra-npm-bins-still-shipped.md) | Root package.json bin still includes poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth… |
| 34 | open | **High** | Pipeline / trust | [ux-failure-shown-as-success-markers.md](./ux-failure-shown-as-success-markers.md) | Pipeline/gaslight use ✓ next to API errors. |
| 35 | open | **High** | Gaslight | [ux-gaslight-ingest-failure-dumps-jsonl.md](./ux-gaslight-ingest-failure-dumps-jsonl.md) | Ingest analysis failure JSONL after Analyzed N prompts. |
| 36 | open | **High** | Gaslight | [ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md](./ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md) | gaslight ingest --dry-run is unknown (falls through to gaslight Interactive prompt requires TTY / POE_NO_PR… |
| 37 | open | **High** | Gaslight | [ux-gaslight-no-plan-autopicks-and-hits-stale-model.md](./ux-gaslight-no-plan-autopicks-and-hits-stale-model.md) | gaslight --yes without plan-path autopicks a plan (e.g. 15-spawn-hooks.md) and fails on dead default model … |
| 38 | open | **High** | Spawn / github | [ux-github-cwd-clone-errors-still-raw-git.md](./ux-github-cwd-clone-errors-still-raw-git.md) | Invalid github://owner/repo still dumps Cloning into… ERROR: Repository not found fatal… See logs — reconfi… |
| 39 | open | **High** | Hooks / spawn | [ux-hooks-from-spawn-poe-code-enoent.md](./ux-hooks-from-spawn-poe-code-enoent.md) | test/spawn with --hooks-from may exec poe-code not on PATH (tsx entry), opaque ENOENT. |
| 40 | open | **High** | Hooks / spawn | [ux-hooks-strategy-transform-unsupported-opaque.md](./ux-hooks-strategy-transform-unsupported-opaque.md) | Transforming hooks to claude-code is not supported yet is informative but still Error + See logs; help list… |
| 41 | open | **High** | Agents | [ux-inconsistent-agent-surface-across-commands.md](./ux-inconsistent-agent-surface-across-commands.md) | configure/wrap/spawn/skill different agent unions. |
| 42 | open | **High** | Skills / consistency | [ux-install-skill-flags-inconsistent-across-commands.md](./ux-install-skill-flags-inconsistent-across-commands.md) | Skill-related install commands use inconsistent flag sets: skill install has --local/--global/--yes; memory… |
| 43 | open | **High** | Launch | [ux-launch-start-triggers-turbo-noise-and-opaque-failure.md](./ux-launch-start-triggers-turbo-noise-and-opaque-failure.md) | launch start foo -- echo hi (and without --) prints full turbo monorepo build output then Managed process f… |
| 44 | open | **High** | Launch | [ux-launch-status-crashes-on-tombstone-dirs.md](./ux-launch-status-crashes-on-tombstone-dirs.md) | After launch rm, tombstone dirs named .state-removed-<id>-<uuid> can cause subsequent launch status/start/s… |
| 45 | open | **High** | Launch | [ux-launch-status-shows-dash-id-ghost-rows.md](./ux-launch-status-shows-dash-id-ghost-rows.md) | After failed/removed processes, launch status may show a table row with ID "-", STATUS stopped, empty metri… |
| 46 | open | **High** | Auth / CI | [ux-login-non-tty-hangs-on-oauth.md](./ux-login-non-tty-hangs-on-oauth.md) | Bare login starts OAuth wait forever without TTY. |
| 47 | open | **High** | Logout / dry-run | [ux-logout-dry-run-multi-panel-noise.md](./ux-logout-dry-run-multi-panel-noise.md) | Logout dry-run floods diffs, multiple footers, and can print secrets. |
| 48 | open | **High** | Logout / dry-run | [ux-logout-dry-run-still-multi-panel-unconfigure.md](./ux-logout-dry-run-still-multi-panel-unconfigure.md) | logout --dry-run still nests Poe - unconfigure goose panels and large config dumps — factory-reset dry-run … |
| 49 | open | **High** | Auth / destructive | [ux-logout-help-no-danger-or-scope-detail.md](./ux-logout-help-no-danger-or-scope-detail.md) | logout help only says Remove all configuration and credentials with no file list, agent impact, or confirma… |
| 50 | open | **High** | Maestro | [ux-maestro-dry-run-path-vs-flag-confusion.md](./ux-maestro-dry-run-path-vs-flag-confusion.md) | `maestro dry-run` treats dry-run as a WORKFLOW.md path (Missing workflow file …/dry-run). `maestro --dry-ru… |
| 51 | open | **High** | Maestro | [ux-maestro-run-dry-run-still-hits-github-401.md](./ux-maestro-run-dry-run-still-hits-github-401.md) | maestro run --dry-run --yes still performs GitHub GraphQL and dumps 401 Bad credentials JSON — dry-run is n… |
| 52 | open | **High** | Memory | [ux-memory-agent-commands-invalid-json-opaque.md](./ux-memory-agent-commands-invalid-json-opaque.md) | memory explain and memory query fail with Memory agent returned invalid JSON output + See logs — no agent s… |
| 53 | open | **High** | Models / errors | [ux-models-endpoint-invalid-good-list-but-stack.md](./ux-models-endpoint-invalid-good-list-but-stack.md) | Unsupported endpoint message lists Available endpoints (good) but still ERROR log + ValidationError stack —… |
| 54 | open | **High** | Models | [ux-models-exact-id-filter-rejects-namespaced-ids.md](./ux-models-exact-id-filter-rejects-namespaced-ids.md) | models --model anthropic/claude-opus-4.7 returns 0/341 while --model claude-opus-4.7 and --search opus-4.7 … |
| 55 | open | **High** | Config / models | [ux-models-search-confirms-sonnet-5-absent-from-catalog.md](./ux-models-search-confirms-sonnet-5-absent-from-catalog.md) | Live catalog has no sonnet-5 (`models --search sonnet-5` → 0/341) while product defaults still reference it… |
| 56 | open | **High** | Errors | [ux-models-since-validation-still-prints-stack.md](./ux-models-since-validation-still-prints-stack.md) | Invalid --since still dumps ERROR log + ValidationError stack + design-system error — reconfirm of validati… |
| 57 | open | **High** | Interactive / CI | [ux-non-tty-prompt-wrong-guidance.md](./ux-non-tty-prompt-wrong-guidance.md) | Error says POE_NO_PROMPT=1; product contract is --yes. |
| 58 | open | **High** | Safety copy | [ux-permission-mode-sets-differ-across-commands.md](./ux-permission-mode-sets-differ-across-commands.md) | spawn: yolo/auto/edit/read; gaslight: read/edit/yolo/auto with default auto; harness: read/edit/auto/yolo; … |
| 59 | open | **High** | Agents | [ux-pi-spawnable-but-not-configurable.md](./ux-pi-spawnable-but-not-configurable.md) | pi on spawn help; configure pi unknown; spawn works. |
| 60 | open | **High** | Pipeline / install | [ux-pipeline-install-force-skips-skill-still.md](./ux-pipeline-install-force-skips-skill-still.md) | pipeline install --local --force overwrites steps.yaml but Skip: skill already exists — --force partial; sk… |
| 61 | open | **High** | Pipeline | [ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md](./ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md) | --task foo --yes picks some plan, shows 21/21 done, then task not found. |
| 62 | open | **High** | Plan / destructive | [ux-plan-archive-help-omits-yes-behavior.md](./ux-plan-archive-help-omits-yes-behavior.md) | plan archive help shows optional path and --kind/--output but does not document non-TTY selection requiring… |
| 63 | open | **High** | Plan / non-TTY | [ux-plan-browse-non-tty-dumps-plan-body.md](./ux-plan-browse-non-tty-dumps-plan-body.md) | plan browse without TTY dumps a full plan markdown body (looks like plan view of first plan) rather than Va… |
| 64 | open | **High** | Plan / destructive | [ux-plan-delete-allows-readme.md](./ux-plan-delete-allows-readme.md) | plan delete dry-run accepts docs/plans/README.md. |
| 65 | open | **High** | Plan / editor | [ux-plan-edit-hangs-without-editor.md](./ux-plan-edit-hangs-without-editor.md) | plan edit without EDITOR/VISUAL can hang or fail to return a clear ValidationError within a short time (obs… |
| 66 | open | **High** | Plan / non-TTY | [ux-plan-question-non-tty-may-hang.md](./ux-plan-question-non-tty-may-hang.md) | poe-code plan "improve tests" --yes in non-TTY can hang past 60s rather than ValidationError requiring TTY … |
| 67 | open | **High** | Auth / providers | [ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md](./ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md) | auth status reports Logged in as … but provider login poe --yes says No API key found and points to --api-k… |
| 68 | open | **High** | Provider / dry-run | [ux-provider-logout-dry-run-unconfigures-agents.md](./ux-provider-logout-dry-run-unconfigures-agents.md) | provider logout dry-run walks agent unconfigure not just credentials. |
| 69 | open | **High** | Providers / dry-run | [ux-provider-logout-poe-dry-run-still-agent-diffs.md](./ux-provider-logout-poe-dry-run-still-agent-diffs.md) | provider logout poe --dry-run still emits large agent settings diffs (claude plugins, effortLevel, etc.) an… |
| 70 | open | **High** | Ralph | [ux-ralph-run-plan-kind-says-ralph-doc-not-found.md](./ux-ralph-run-plan-kind-says-ralph-doc-not-found.md) | ralph run docs/plans/32-agent-goal.md (kind: plan) says Ralph doc not found — same wrong-kind-as-missing pa… |
| 71 | open | **High** | Docs / CI | [ux-readme-spawn-omits-mode-for-ci.md](./ux-readme-spawn-omits-mode-for-ci.md) | README CI spawn one-liners omit --mode/--yes; fail non-interactively. |
| 72 | open | **High** | Configure | [ux-reasoning-effort-bogus-silently-ignored.md](./ux-reasoning-effort-bogus-silently-ignored.md) | configure claude --reasoning-effort bogus --yes --dry-run still plans effortLevel xhigh without rejecting u… |
| 73 | open | **High** | Configure | [ux-reasoning-effort-flag-silently-ignored-for-some-agents.md](./ux-reasoning-effort-flag-silently-ignored-for-some-agents.md) | configure claude --reasoning-effort low/medium/max --yes --dry-run still plans effortLevel xhigh (or does n… |
| 74 | open | **High** | Spawn / resume | [ux-resume-thread-invalid-id-agent-raw-error.md](./ux-resume-thread-invalid-id-agent-raw-error.md) | Invalid resume id fails with Claude Code spawn failed … Error: --resume requires a valid session ID… Usage:… |
| 75 | open | **High** | Help / identity | [ux-root-help-footer-npm-run-dev-for-options.md](./ux-root-help-footer-npm-run-dev-for-options.md) | Footer: Run npm run dev -- <command> --help. |
| 76 | open | **High** | Help / identity | [ux-root-help-usage-line-is-npm-run-dev.md](./ux-root-help-usage-line-is-npm-run-dev.md) | Root help Usage: npm run dev -- <command>. |
| 77 | open | **High** | Runtime / non-TTY | [ux-runtime-init-non-tty-poe-no-prompt.md](./ux-runtime-init-non-tty-poe-no-prompt.md) | runtime init without TTY says Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — obscure env vs stand… |
| 78 | open | **High** | Runtime jobs | [ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md](./ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md) | runtime jobs logs without jobId errors with More than one … Pass a job id and lists many jobs including run… |
| 79 | open | **High** | Runtime jobs | [ux-runtime-jobs-stop-lists-many-stale-running.md](./ux-runtime-jobs-stop-lists-many-stale-running.md) | runtime jobs stop/attach without job id lists dozens of "running" jobs dating back weeks — zombie job state… |
| 80 | open | **High** | SDK / safety | [ux-sdk-cli-mode-default-mismatch.md](./ux-sdk-cli-mode-default-mismatch.md) | SDK defaults mode to yolo; CLI spawn prompts/--yes yolo; gaslight defaults auto. |
| 81 | open | **High** | Help / discoverability | [ux-skill-memory-absent-from-root-help.md](./ux-skill-memory-absent-from-root-help.md) | Root --help does not list skill or memory though both exist as parent commands — reaffirm important-command… |
| 82 | open | **High** | Skills | [ux-skill-unconfigure-dry-run-path-inconsistent.md](./ux-skill-unconfigure-dry-run-path-inconsistent.md) | skill unconfigure claude-code --local --yes --dry-run says Would remove skills directory ~/.claude/skills A… |
| 83 | open | **High** | Configure / models | [ux-skip-if-configured-shows-stale-default-model.md](./ux-skip-if-configured-shows-stale-default-model.md) | Already-configured path prints anthropic/claude-sonnet-5 as default model though API rejects it. |
| 84 | open | **High** | Spawn / runtime | [ux-spawn-detach-silently-ignored-without-runtime.md](./ux-spawn-detach-silently-ignored-without-runtime.md) | spawn … --detach without --runtime still runs the agent inline and succeeds; no warning that detach require… |
| 85 | open | **High** | Spawn / gemini | [ux-spawn-gemini-provider-credential-opaque-error.md](./ux-spawn-gemini-provider-credential-opaque-error.md) | spawn gemini with an explicit model can fail with Cannot resolve "providerCredential": no active provider o… |
| 86 | open | **High** | Spawn / interactive | [ux-spawn-interactive-raw-agent-error.md](./ux-spawn-interactive-raw-agent-error.md) | Interactive spawn without prompt/TTY surfaces raw agent-native --print error outside design system. |
| 87 | open | **High** | Spawn / interactive | [ux-spawn-interactive-still-uses-stale-model-bare-error.md](./ux-spawn-interactive-still-uses-stale-model-bare-error.md) | Even with prompt and -i, non-TTY spawn can surface bare API Error: 400 Unsupported model without design-sys… |
| 88 | open | **High** | Safety copy | [ux-spawn-mode-and-permission-copy.md](./ux-spawn-mode-and-permission-copy.md) | Modes minimal definition; --yes uses yolo buried; order differs spawn vs gaslight. |
| 89 | open | **High** | Config / models | [ux-stale-configured-model-fails-late.md](./ux-stale-configured-model-fails-late.md) | Invalid configured model ids only fail mid gaslight/pipeline with API 400 and success checkmarks. |
| 90 | open | **High** | Superintendent / identity | [ux-superintendent-builder-inspector-toolcraft-help.md](./ux-superintendent-builder-inspector-toolcraft-help.md) | superintendent builder and inspector --help show Usage: npm run dev -- superintendent builder… — dual help … |
| 91 | open | **High** | Superintendent / install | [ux-superintendent-install-already-exists-debug-tease.md](./ux-superintendent-install-already-exists-debug-tease.md) | superintendent install when skill exists: Skill already exists … Use --debug for a stack trace — toolcraft … |
| 92 | open | **High** | Superintendent / errors | [ux-superintendent-missing-path-double-error.md](./ux-superintendent-missing-path-double-error.md) | superintendent validate and complete without path print raw Commander missing required argument then design… |
| 93 | open | **High** | Tasks | [ux-tasks-github-401-raw-json-reconfirmed.md](./ux-tasks-github-401-raw-json-reconfirmed.md) | tasks get/next without valid GitHub auth dump [error] GitHub GraphQL request failed with status 401: { json… |
| 94 | open | **High** | Agents | [ux-test-and-install-reject-spawn-only-agents-as-unknown.md](./ux-test-and-install-reject-spawn-only-agents-as-unknown.md) | poe-agent/pi fail test/install with Unknown agent (false). |
| 95 | open | **High** | Test / errors | [ux-test-failure-dumps-jsonl.md](./ux-test-failure-dumps-jsonl.md) | test failure inlines hook JSONL flood. |
| 96 | open | **High** | Help / identity | [ux-toolcraft-help-points-at-npm-run-dev.md](./ux-toolcraft-help-points-at-npm-run-dev.md) | Toolcraft groups bake monorepo invocation. |
| 97 | open | **High** | Help / identity | [ux-toolcraft-suggests-options-but-still-npm-run-dev.md](./ux-toolcraft-suggests-options-but-still-npm-run-dev.md) | Good option suggestions; wrong recovery footer. |
| 98 | open | **High** | Traces | [ux-traces-enoent-eisdir-still-system-errors.md](./ux-traces-enoent-eisdir-still-system-errors.md) | traces /tmp/no-such-trace.jsonl → ENOENT…; traces /tmp → EISDIR… + See logs — reconfirm of traces-missing-f… |
| 99 | open | **High** | Errors / consistency | [ux-traces-since-validation-cleaner-than-models.md](./ux-traces-since-validation-cleaner-than-models.md) | traces --since notaduration returns short Invalid duration for --since without stack; models --since notadu… |
| 100 | open | **High** | Agents | [ux-unknown-agent-no-allow-list-or-suggestions.md](./ux-unknown-agent-no-allow-list-or-suggestions.md) | install/test/configure/unconfigure unknown agent say Unknown agent "notanagent" (+ See logs) without listin… |
| 101 | open | **High** | Errors / trust | [ux-user-errors-look-like-system-failures.md](./ux-user-errors-look-like-system-failures.md) | Recoverable errors thrown as Error; bootstrap See logs + errors.log. |
| 102 | open | **High** | Errors | [ux-validation-error-still-prints-stack.md](./ux-validation-error-still-prints-stack.md) | ValidationError paths dump stack + double-render. |
| 103 | open | Medium–High | Spawn / workspaces | [ux-github-cwd-clone-errors-unframed.md](./ux-github-cwd-clone-errors-unframed.md) | Bad locator raw git stderr. |
| 104 | open | Medium–High | Maestro | [ux-maestro-dry-run-hits-github-without-workflow.md](./ux-maestro-dry-run-hits-github-without-workflow.md) | Dry-run hits GraphQL 401 JSON. |
| 105 | open | Medium–High | Runtime | [ux-runtime-jobs-stale-running-zombies.md](./ux-runtime-jobs-stale-running-zombies.md) | running since May. |
| 106 | open | Medium–High | Traces / privacy | [ux-traces-json-includes-full-prompt-titles.md](./ux-traces-json-includes-full-prompt-titles.md) | traces --json dumps title fields that can be entire memory-query prompts or long user messages — useful for… |
| 107 | open | Medium | Visual language | [ux-acp-stream-uses-success-glyph-for-partial-text.md](./ux-acp-stream-uses-success-glyph-for-partial-text.md) | Checkmark for partial text. |
| 108 | open | Medium | Agent | [ux-agent-invalid-model-system-chrome.md](./ux-agent-invalid-model-system-chrome.md) | 404 + logs. |
| 109 | open | Medium | Errors | [ux-agent-spawn-missing-args-raw-commander.md](./ux-agent-spawn-missing-args-raw-commander.md) | agent without prompt and spawn without agent print error: missing required argument without design-system f… |
| 110 | open | Medium | Auth / security | [ux-api-key-flags-encourage-shell-history-leaks.md](./ux-api-key-flags-encourage-shell-history-leaks.md) | Flags without history warning. |
| 111 | open | Medium | Approvals | [ux-approvals-invalid-state-silent-empty-reconfirmed.md](./ux-approvals-invalid-state-silent-empty-reconfirmed.md) | approvals list --state bogus returns No approvals found without invalid-state error — reconfirm. |
| 112 | open | Medium | Approvals | [ux-approvals-invalid-state-silent-empty.md](./ux-approvals-invalid-state-silent-empty.md) | nope looks empty queue. |
| 113 | open | Medium | IA / install | [ux-binary-wrappers-undocumented.md](./ux-binary-wrappers-undocumented.md) | dist/bin wrappers no help map. |
| 114 | open | Medium | Spawn / flags | [ux-capture-otel-content-without-capture-silent.md](./ux-capture-otel-content-without-capture-silent.md) | spawn with --capture-otel-content alone succeeds without enabling otel capture or warning that --capture-ot… |
| 115 | open | Medium | Errors | [ux-code-review-double-error-skin.md](./ux-code-review-double-error-skin.md) | Raw + toolcraft both. |
| 116 | open | Medium | Code-review | [ux-code-review-install-output-unframed-wrapped.md](./ux-code-review-install-output-unframed-wrapped.md) | code-review install prints Lists Created with hard-wrapped absolute paths mid-word without design-system pa… |
| 117 | open | Medium | Errors / recovery | [ux-command-not-found-no-suggestions.md](./ux-command-not-found-no-suggestions.md) | confgure/skills/pipelne no suggestion. |
| 118 | open | Medium | Dry-run | [ux-configure-cursor-dry-run-too-quiet.md](./ux-configure-cursor-dry-run-too-quiet.md) | configure cursor and cursor-agent --yes --dry-run only print would configure Cursor / # no filesystem chang… |
| 119 | open | Medium | Dry-run | [ux-configure-dry-run-floods-diff.md](./ux-configure-dry-run-floods-diff.md) | Huge settings diffs. |
| 120 | open | Medium | Configure | [ux-configure-provider-requires-model-without-listing-models.md](./ux-configure-provider-requires-model-without-listing-models.md) | When a provider requires an explicit model, configure errors Pass --model without listing available models,… |
| 121 | open | Medium | Configure | [ux-configure-yes-silent-default-agent.md](./ux-configure-yes-silent-default-agent.md) | Picks Claude without upfront line. |
| 122 | open | Medium | Dashboard / TUI | [ux-dashboard-keybindings-undocumented-on-cli-help.md](./ux-dashboard-keybindings-undocumented-on-cli-help.md) | Live dashboards support q quit and Ctrl+C forceQuit but --tui help only says Show a live dashboard without … |
| 123 | open | Medium | Editor | [ux-editor-error-still-system-chrome.md](./ux-editor-error-still-system-chrome.md) | Set $EDITOR + logs. |
| 124 | open | Medium | Auth | [ux-empty-api-key-flag-silently-ignored.md](./ux-empty-api-key-flag-silently-ignored.md) | --api-key '' falls back to stored key. |
| 125 | open | Medium | Plan list | [ux-empty-plan-kind-lists-still-draw-empty-tables.md](./ux-empty-plan-kind-lists-still-draw-empty-tables.md) | plan list --kind experiment/ralph/superintendent draws full empty table borders with no "No plans" message … |
| 126 | open | Medium | Eval | [ux-eval-empty-source-message-inconsistent-skins.md](./ux-eval-empty-source-message-inconsistent-skins.md) | eval check/lint print bare Eval source does not contain… lines; eval report uses design-system ■ Error for … |
| 127 | open | Medium | Eval | [ux-eval-init-name-validation-bare-text.md](./ux-eval-init-name-validation-bare-text.md) | eval init /tmp/ux-eval-test fails with bare Eval name must be kebab-case… without panel framing or examples… |
| 128 | open | Medium | Eval / suggestions | [ux-eval-unknown-command-suggests-lint-for-list.md](./ux-eval-unknown-command-suggests-lint-for-list.md) | eval list is not a command; error Did you mean: lint? which is a poor suggestion for list (distance match w… |
| 129 | open | Medium | Gaslight | [ux-gaslight-config-missing-enoent.md](./ux-gaslight-config-missing-enoent.md) | Raw ENOENT. |
| 130 | open | Medium | Gaslight | [ux-gaslight-install-force-dry-run-vs-already-exists.md](./ux-gaslight-install-force-dry-run-vs-already-exists.md) | gaslight install --local --force --dry-run says Would create gaslight.yaml; without --force dry-run says al… |
| 131 | open | Medium | Gaslight | [ux-gaslight-multi-plan-fails-fast-with-success-markers.md](./ux-gaslight-multi-plan-fails-fast-with-success-markers.md) | Multi-plan gaslight fails first plan with ✓ agent API error and message plan 1/2 … failed without summarizi… |
| 132 | open | Medium | Gaslight / safety | [ux-gaslight-no-activity-timeout-flag.md](./ux-gaslight-no-activity-timeout-flag.md) | Long gaslight runs cannot set activity timeout from CLI though spawn supports --activity-timeout-ms; users … |
| 133 | open | Medium | Naming | [ux-gaslight-opaque-naming.md](./ux-gaslight-opaque-naming.md) | Root gaslight no plain gloss. |
| 134 | open | Medium | Gaslight / Pipeline | [ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md](./ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md) | Both gaslight and pipeline have --archive and --no-archive but help does not state default archive behavior… |
| 135 | open | Medium | Gaslight / naming | [ux-gaslight-unknown-agent-says-service.md](./ux-gaslight-unknown-agent-says-service.md) | Says service not agent. |
| 136 | open | Medium | Dry-run | [ux-gemini-configure-dry-run-too-quiet.md](./ux-gemini-configure-dry-run-too-quiet.md) | configure gemini --yes --dry-run only shows Gemini model resolved line and would configure without listing … |
| 137 | open | Medium | GitHub workflows | [ux-gh-install-dry-run-lists-paths-without-panel.md](./ux-gh-install-dry-run-lists-paths-without-panel.md) | github-workflows install --dry-run prints bare workflow paths and would write messages without panel framin… |
| 138 | open | Medium | GitHub workflows | [ux-gh-prompt-preview-dumps-long-unframed-prompt.md](./ux-gh-prompt-preview-dumps-long-unframed-prompt.md) | github-workflows prompt-preview prints multi-section prompt body without design-system framing or --json op… |
| 139 | open | Medium | Help | [ux-global-flags-hidden-on-subcommand-help.md](./ux-global-flags-hidden-on-subcommand-help.md) | --yes/--dry-run/--verbose missing on most help. |
| 140 | open | Medium | First-run | [ux-group-commands-print-help-only.md](./ux-group-commands-print-help-only.md) | pipeline bare help only. |
| 141 | open | Medium | Harness | [ux-harness-list-only-cwd-not-created-dir.md](./ux-harness-list-only-cwd-not-created-dir.md) | harness new … --dir /tmp/h4 creates pair successfully; harness list still says No harness pairs found becau… |
| 142 | open | Medium | Harness | [ux-harness-missing-file-system-chrome.md](./ux-harness-missing-file-system-chrome.md) | Good message + See logs. |
| 143 | open | Medium | Harness | [ux-harness-run-missing-file-system-chrome.md](./ux-harness-run-missing-file-system-chrome.md) | Missing harness md file: path + See logs — good message, unnecessary logs. |
| 144 | open | Medium | Harness | [ux-harness-run-success-opaque-result-object.md](./ux-harness-run-success-opaque-result-object.md) | Successful harness run prints Result: object · kind, version, message, numbers, branches, +1 more — interna… |
| 145 | open | Medium | Harness | [ux-harness-unknown-template-still-omits-kind-list.md](./ux-harness-unknown-template-still-omits-kind-list.md) | Unknown harness template "notakind" still prints only that message without listing ralph-demo, coverage-dem… |
| 146 | open | Medium | Help | [ux-help-command-not-registered.md](./ux-help-command-not-registered.md) | help not registered. |
| 147 | open | Medium | IA | [ux-hidden-and-orphan-commands.md](./ux-hidden-and-orphan-commands.md) | memory-mcp top-level; agent vs spawn poe-agent. |
| 148 | open | Medium | Hooks / spawn | [ux-hooks-bridge-refuse-user-authored-file-opaque.md](./ux-hooks-bridge-refuse-user-authored-file-opaque.md) | spawn with --hooks-from/--hooks-scope can fail with Refuse to replace user-authored hook file at …/settings… |
| 149 | open | Medium | Spawn / hooks | [ux-hooks-from-unsupported-system-chrome.md](./ux-hooks-from-unsupported-system-chrome.md) | Allow-list + See logs. |
| 150 | open | Medium | Help / IA | [ux-important-commands-absent-from-root-help.md](./ux-important-commands-absent-from-root-help.md) | skill/memory/provider missing no show-all. |
| 151 | open | Medium | Install | [ux-install-always-success-reconfirmed.md](./ux-install-always-success-reconfirmed.md) | install claude-code when already installed still says Installed Claude Code without version/already-present… |
| 152 | open | Medium | Install | [ux-install-yes-defaults-agent-silently.md](./ux-install-yes-defaults-agent-silently.md) | install --yes without agent installs Claude Code without stating default selection policy in the first line. |
| 153 | open | Medium | Scripting | [ux-json-flag-inconsistent-across-commands.md](./ux-json-flag-inconsistent-across-commands.md) | Some commands only. |
| 154 | open | Medium | Configure / models | [ux-kimi-default-model-id-mismatches-catalog-namespace.md](./ux-kimi-default-model-id-mismatches-catalog-namespace.md) | configure kimi dry-run plans default_model = poe/kimi-k2.5 while models catalog lists novita ai/kimi-k2.5. … |
| 155 | open | Medium | Launch / dev UX | [ux-launch-commands-trigger-full-turbo-rebuild.md](./ux-launch-commands-trigger-full-turbo-rebuild.md) | Invoking launch through npm run dev / predev runs turbo build across 68 packages before the command, adding… |
| 156 | open | Medium | Launch | [ux-launch-missing-process-system-chrome.md](./ux-launch-missing-process-system-chrome.md) | Managed process "missing" was not found + See logs for launch logs/restart. |
| 157 | open | Medium | Launch | [ux-launch-start-opaque-failure.md](./ux-launch-start-opaque-failure.md) | Missing -- → failed to start. |
| 158 | open | Medium | Launch | [ux-launch-start-via-npm-run-dev-confuses-argv.md](./ux-launch-start-via-npm-run-dev-confuses-argv.md) | launch start can mis-parse process ids and commands when invoked through npm run dev (turbo predev noise, s… |
| 159 | open | Medium | Privacy | [ux-log-content-flags-underwarn-sensitive-data.md](./ux-log-content-flags-underwarn-sensitive-data.md) | --log-content no PII warning. |
| 160 | open | Medium | Spawn / security | [ux-log-content-help-underwarns-reconfirmed.md](./ux-log-content-help-underwarns-reconfirmed.md) | Help only says Include message and tool content in ACP JSONL spawn logs without security warning; default r… |
| 161 | open | Medium | Auth / help | [ux-login-help-omits-interactive-and-yes.md](./ux-login-help-omits-interactive-and-yes.md) | login help only lists --api-key and -h; does not document interactive OAuth browser flow, non-TTY requireme… |
| 162 | open | Medium | Auth / help | [ux-login-help-omits-oauth-default.md](./ux-login-help-omits-oauth-default.md) | Only --api-key documented. |
| 163 | open | Medium | Auth | [ux-login-rejected-no-recovery.md](./ux-login-rejected-no-recovery.md) | API key rejected only. |
| 164 | open | Medium | Maestro | [ux-maestro-config-vs-workflow-flags-duplicated.md](./ux-maestro-config-vs-workflow-flags-duplicated.md) | maestro tui accepts --config and --workflow for WORKFLOW.md and errors if both set — duplicate flags for on… |
| 165 | open | Medium | Maestro | [ux-maestro-tick-missing-transition-raw-commander.md](./ux-maestro-tick-missing-transition-raw-commander.md) | maestro tick --task foo fails error: required option --transition not specified without design-system framing. |
| 166 | open | Medium | First-run | [ux-many-parent-groups-only-dump-help.md](./ux-many-parent-groups-only-dump-help.md) | Beyond pipeline/experiment/ralph, bare invocations of skill, memory, provider, runtime, launch, worktree, u… |
| 167 | open | Medium | Destructive | [ux-memory-clear-help-still-no-force-or-yes.md](./ux-memory-clear-help-still-no-force-or-yes.md) | memory clear --help still only shows -h/--help despite being fully destructive when initialized. |
| 168 | open | Medium | Destructive | [ux-memory-clear-no-confirmation.md](./ux-memory-clear-no-confirmation.md) | Destructive no confirm. |
| 169 | open | Medium | Memory / install | [ux-memory-install-already-exists-system-chrome.md](./ux-memory-install-already-exists-system-chrome.md) | memory install when skill exists fails with Skill already exists: path and See logs, without --force guidan… |
| 170 | open | Medium | Memory | [ux-memory-ls-search-show-raw-unframed.md](./ux-memory-ls-search-show-raw-unframed.md) | memory ls/search/show/lint/write still dump raw text without design-system panels (except init) — reconfirm… |
| 171 | open | Medium | Memory | [ux-memory-write-requires-reason-before-path.md](./ux-memory-write-requires-reason-before-path.md) | memory write without args fails on required option --reason before missing path argument — wrong recovery o… |
| 172 | open | Medium | Memory | [ux-memory-write-requires-reason-raw-commander.md](./ux-memory-write-requires-reason-raw-commander.md) | memory write without --reason prints raw error: required option '--reason <text>' not specified instead of … |
| 173 | open | Medium | Memory | [ux-memory-write-success-is-raw-unframed.md](./ux-memory-write-success-is-raw-unframed.md) | After memory write, stdout dumps frontmatter/body and path:line snippets without design-system success pane… |
| 174 | open | Medium | Configure / models | [ux-model-id-namespace-stripping-surprises.md](./ux-model-id-namespace-stripping-surprises.md) | configure --model anthropic/claude-sonnet-4.6 dry-run writes model as claude-sonnet-4-6 (dots to hyphens / … |
| 175 | open | Medium | Models | [ux-models-dumps-full-catalog.md](./ux-models-dumps-full-catalog.md) | 300+ rows default. |
| 176 | open | Medium | Models | [ux-models-empty-search-returns-all.md](./ux-models-empty-search-returns-all.md) | Empty string filters are treated as no filter (341/341) rather than validation error — easy footgun in scri… |
| 177 | open | Medium | Models | [ux-models-feature-bogus-silent-empty.md](./ux-models-feature-bogus-silent-empty.md) | Invalid feature name returns 0 models / No models match rather than invalid feature error — reconfirm of si… |
| 178 | open | Medium | Models | [ux-models-feature-flag-not-repeatable.md](./ux-models-feature-flag-not-repeatable.md) | models --feature tools --feature reasoning does not AND features; Commander keeps a single string so the la… |
| 179 | open | Medium | Models | [ux-models-input-bogus-silent-empty.md](./ux-models-input-bogus-silent-empty.md) | Invalid input modality returns 0 models without listing valid modalities text/image/audio/video. |
| 180 | open | Medium | Models | [ux-models-invalid-feature-silent-empty.md](./ux-models-invalid-feature-silent-empty.md) | --feature notreal → 0/341. |
| 181 | open | Medium | Models | [ux-models-invalid-modality-silent-empty.md](./ux-models-invalid-modality-silent-empty.md) | --input smell → 0/341. |
| 182 | open | Medium | Models | [ux-models-view-invalid-uses-raw-commander.md](./ux-models-view-invalid-uses-raw-commander.md) | Invalid --view value uses Commander option argument is invalid. Allowed choices… while other models validat… |
| 183 | open | Medium | First-run / diagnostics | [ux-no-doctor-or-health-overview-command.md](./ux-no-doctor-or-health-overview-command.md) | There is no poe-code doctor (or similar) that summarizes auth status, configured agents, stale models, prov… |
| 184 | open | Medium | Configure / models | [ux-opencode-model-triple-namespace.md](./ux-opencode-model-triple-namespace.md) | configure opencode dry-run plans model poe/anthropic/claude-opus-4.7 — a third namespace style (poe/owner/m… |
| 185 | open | Medium | Pipeline | [ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md](./ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md) | Good validation Problems first. |
| 186 | open | Medium | Pipeline | [ux-pipeline-nothing-to-run-success-framing.md](./ux-pipeline-nothing-to-run-success-framing.md) | pipeline run on fully done plan prints Nothing to run, Pipeline run finished success, and Problems? footer … |
| 187 | open | Medium | Pipeline / TUI | [ux-pipeline-tui-flag-ignored-on-init-failure.md](./ux-pipeline-tui-flag-ignored-on-init-failure.md) | pipeline run --tui still shows non-dashboard failure path with success markers and Problems-before-error wh… |
| 188 | open | Medium | Pipeline | [ux-pipeline-validate-enoent-system-error.md](./ux-pipeline-validate-enoent-system-error.md) | System chrome. |
| 189 | open | Medium | Pipeline | [ux-pipeline-validate-wrong-kind-system-chrome.md](./ux-pipeline-validate-wrong-kind-system-chrome.md) | kind must be pipeline + See logs. |
| 190 | open | Medium | Plan browser | [ux-plan-archive-allows-readme.md](./ux-plan-archive-allows-readme.md) | Would archive README.md. |
| 191 | open | Medium | Plan browser | [ux-plan-browse-non-tty-dumps-first-plan.md](./ux-plan-browse-non-tty-dumps-first-plan.md) | plan browse without a TTY prints a full rendered plan (first/selected) rather than an error, list, or expli… |
| 192 | open | Medium | Docs / CLI sync | [ux-plan-docs-advertise-goal-and-chat-commands-missing.md](./ux-plan-docs-advertise-goal-and-chat-commands-missing.md) | Plan content (e.g. agent-goal plan) documents `poe-code goal …` and `poe-code chat` slash surfaces, but CLI… |
| 193 | open | Medium | Plan / editor | [ux-plan-edit-editor-true-claims-edited-without-change.md](./ux-plan-edit-editor-true-claims-edited-without-change.md) | EDITOR=true plan edit reports Edited path even when true is a no-op binary — success without change detection. |
| 194 | open | Medium | Plan / install | [ux-plan-install-no-force-flag.md](./ux-plan-install-no-force-flag.md) | plan install rejects --force as unknown option while experiment/pipeline have --force — inconsistent instal… |
| 195 | open | Medium | Plan browser | [ux-plan-list-includes-noise-files.md](./ux-plan-list-includes-noise-files.md) | README.md listed as plan. |
| 196 | open | Medium | Plan | [ux-plan-markdown-read-depth-zero-shows-no-sections.md](./ux-plan-markdown-read-depth-zero-shows-no-sections.md) | plan markdown-read with --depth 1 on a plan whose headings start at depth 2-style numbering may print secti… |
| 197 | open | Medium | Plan | [ux-plan-markdown-read-section-wrong-command-hint.md](./ux-plan-markdown-read-section-wrong-command-hint.md) | When section match fails, error says try read-markdown to see TOC, but the actual command is plan markdown-… |
| 198 | open | Medium | Plan | [ux-plan-markdown-read-system-chrome.md](./ux-plan-markdown-read-system-chrome.md) | file not found + logs. |
| 199 | open | Medium | Plan | [ux-plan-non-tty-unclear-failure.md](./ux-plan-non-tty-unclear-failure.md) | plan question bare 400. |
| 200 | open | Medium | Plan | [ux-plan-view-vs-markdown-read-not-found-inconsistent.md](./ux-plan-view-vs-markdown-read-not-found-inconsistent.md) | plan view missing.md → Plan not found: missing.md (clean, no logs). plan markdown-read missing.md → file no… |
| 201 | open | Medium | Help | [ux-primary-commands-lack-examples-in-help.md](./ux-primary-commands-lack-examples-in-help.md) | models has Examples; configure/spawn do not. |
| 202 | open | Medium | Help | [ux-primary-commands-still-lack-examples.md](./ux-primary-commands-still-lack-examples.md) | spawn, configure, and gaslight --help still have no Examples section while models --help is best-in-class w… |
| 203 | open | Medium | Providers | [ux-provider-list-agents-column-incomplete.md](./ux-provider-list-agents-column-incomplete.md) | Omits spawn-only agents. |
| 204 | open | Medium | Provider auth | [ux-provider-login-missing-key-system-chrome.md](./ux-provider-login-missing-key-system-chrome.md) | Good message + logs. |
| 205 | open | Medium | Workflows | [ux-ralph-experiment-wrong-kind-says-not-found.md](./ux-ralph-experiment-wrong-kind-says-not-found.md) | Existing plan wrong kind. |
| 206 | open | Medium | Errors | [ux-raw-commander-invalid-option-choices.md](./ux-raw-commander-invalid-option-choices.md) | --view nope raw. |
| 207 | open | Medium | Errors | [ux-raw-commander-missing-args.md](./ux-raw-commander-missing-args.md) | unconfigure/wrap missing agent raw error. |
| 208 | open | Medium | Docs / CLI sync | [ux-readme-features-wrap-but-cli-missing.md](./ux-readme-features-wrap-but-cli-missing.md) | README wrap quickstart removed; wrap CLI residual (muscle memory / external docs) |
| 209 | open | Medium | Configure | [ux-reasoning-effort-flag-opaque.md](./ux-reasoning-effort-flag-opaque.md) | No validation/examples. |
| 210 | open | Medium | Spawn | [ux-resume-thread-errors-are-agent-raw.md](./ux-resume-thread-errors-are-agent-raw.md) | Long agent usage text. |
| 211 | open | Medium | Spawn | [ux-runner-sync-and-runtime-invalid-raw-commander.md](./ux-runner-sync-and-runtime-invalid-raw-commander.md) | Invalid --runner-sync bogus and --runtime bogus print Commander option argument is invalid. Allowed choices… |
| 212 | open | Medium | Spawn / runtime | [ux-runner-sync-without-runtime-silently-accepted.md](./ux-runner-sync-without-runtime-silently-accepted.md) | spawn with --runner-sync both but no runtime/detach runs inline successfully — flag appears no-op without w… |
| 213 | open | Medium | Runtime | [ux-runtime-jobs-list-unbounded-opaque-statuses.md](./ux-runtime-jobs-list-unbounded-opaque-statuses.md) | History dump; lost unexplained. |
| 214 | open | Medium | Runtime jobs | [ux-runtime-jobs-show-unknown-suggests-stop.md](./ux-runtime-jobs-show-unknown-suggests-stop.md) | runtime jobs show is not a command; Commander Did you mean: stop? — users expect show/get for job details. |
| 215 | open | Medium | Runtime / errors | [ux-runtime-missing-deps-good-message-system-chrome.md](./ux-runtime-missing-deps-good-message-system-chrome.md) | spawn --runtime docker/e2b missing engine/API key messages include install links and config paths (excellen… |
| 216 | open | Medium | SDK | [ux-sdk-getpoeapikey-throws-generic-error.md](./ux-sdk-getpoeapikey-throws-generic-error.md) | SDK credential helper throws new Error("No API key found…") rather than a typed/user-facing error class, so… |
| 217 | open | Medium | Spawn / skills | [ux-skill-bridge-failure-system-chrome.md](./ux-skill-bridge-failure-system-chrome.md) | Paths listed + See logs. |
| 218 | open | Medium | Skills / agents | [ux-skill-configure-kimi-unsupported-abrupt.md](./ux-skill-configure-kimi-unsupported-abrupt.md) | Skills not supported for kimi. |
| 219 | open | Medium | Skills | [ux-skill-configure-yes-defaults-agent-silently.md](./ux-skill-configure-yes-defaults-agent-silently.md) | skill configure --yes --local without agent configures claude-code without stating default selection policy… |
| 220 | open | Medium | Skills | [ux-skill-install-missing-file-enoent.md](./ux-skill-install-missing-file-enoent.md) | skill install --file /tmp/no-skill.md fails ENOENT: no such file… + See logs. |
| 221 | open | Medium | Skills | [ux-skill-install-name-and-file-both-required.md](./ux-skill-install-name-and-file-both-required.md) | Serial required options opaque. |
| 222 | open | Medium | Naming | [ux-skill-naming-collisions.md](./ux-skill-naming-collisions.md) | skills≠skill; dual /plan. |
| 223 | open | Medium | Skills / first-run | [ux-skill-parent-no-next-step-guidance.md](./ux-skill-parent-no-next-step-guidance.md) | poe-code skill with no subcommand prints a bare subcommand list without suggesting the common onboarding pa… |
| 224 | open | Medium | Skills | [ux-skill-unconfigure-defaults-agent-and-soft-blocks.md](./ux-skill-unconfigure-defaults-agent-and-soft-blocks.md) | skill unconfigure without agent defaults to claude-code and refuses non-empty skill dirs unless --force, bu… |
| 225 | open | Medium | Spawn / skills | [ux-skills-flag-without-value-is-noop-or-unclear.md](./ux-skills-flag-without-value-is-noop-or-unclear.md) | spawn … --skills with no value still runs the agent successfully (boolean presence?) without error or warni… |
| 226 | open | Medium | Configure | [ux-skip-if-configured-still-writes-when-model-differs.md](./ux-skip-if-configured-still-writes-when-model-differs.md) | Passing --skip-if-configured with an explicit --model that differs from stored config still runs a full con… |
| 227 | open | Medium | Spawn help | [ux-spawn-advanced-flags-undifferentiated.md](./ux-spawn-advanced-flags-undifferentiated.md) | ~20 options ungrouped. |
| 228 | open | Medium | Spawn / codex | [ux-spawn-codex-reads-stdin-message-on-tty-less-success.md](./ux-spawn-codex-reads-stdin-message-on-tty-less-success.md) | Even when prompt is provided as an argument, successful codex spawn emits Reading additional input from std… |
| 229 | open | Medium | Spawn / paths | [ux-spawn-cwd-missing-system-chrome.md](./ux-spawn-cwd-missing-system-chrome.md) | spawn -C /missing says Workspace path does not exist (good) but still attaches errors.log system-failure fo… |
| 230 | open | Medium | Spawn / runtime | [ux-spawn-detach-ignored-on-failure-path.md](./ux-spawn-detach-ignored-on-failure-path.md) | With --detach, spawn still appears to run the agent path that fails on stale model in-foreground with succe… |
| 231 | open | Medium | Spawn / interactive | [ux-spawn-interactive-non-tty-still-runs.md](./ux-spawn-interactive-non-tty-still-runs.md) | spawn … --interactive without TTY still produces agent output (not a clear "requires TTY" failure) — flag i… |
| 232 | open | Medium | Spawn | [ux-spawn-no-prompt-system-chrome.md](./ux-spawn-no-prompt-system-chrome.md) | No prompt provided via argument or stdin is correct message but still See logs system chrome. |
| 233 | open | Medium | Spawn / errors | [ux-spawn-validates-mode-before-agent.md](./ux-spawn-validates-mode-before-agent.md) | Invalid agent fails missing --mode first. |
| 234 | open | Medium | Visual language | [ux-successful-spawn-still-uses-checkmark-for-agent-text.md](./ux-successful-spawn-still-uses-checkmark-for-agent-text.md) | Even successful spawn pi output prefixes agent thinking/answer lines with ✓, same glyph as success status —… |
| 235 | open | Medium | Superintendent | [ux-superintendent-validate-unclosed-tag-opaque.md](./ux-superintendent-validate-unclosed-tag-opaque.md) | No location. |
| 236 | open | Medium | Tables | [ux-tables-ignore-terminal-width.md](./ux-tables-ignore-terminal-width.md) | Wide at COLUMNS=40. |
| 237 | open | Medium | Tasks / auth | [ux-tasks-github-auth-raw-error.md](./ux-tasks-github-auth-raw-error.md) | tasks get raw GraphQL 401. |
| 238 | open | Medium | Spawn / timeouts | [ux-timeout-errors-use-system-chrome.md](./ux-timeout-errors-use-system-chrome.md) | 0.001s + See logs. |
| 239 | open | Medium | Errors / recovery | [ux-toolcraft-has-suggestions-poe-code-root-does-not.md](./ux-toolcraft-has-suggestions-poe-code-root-does-not.md) | suggest.ts exists; root unused. |
| 240 | open | Medium | Help / visual | [ux-toolcraft-heading-doubles-poe-code.md](./ux-toolcraft-heading-doubles-poe-code.md) | Double name heading. |
| 241 | open | Medium | Traces | [ux-traces-directory-path-eisdir.md](./ux-traces-directory-path-eisdir.md) | traces docs EISDIR. |
| 242 | open | Medium | Traces | [ux-traces-missing-file-system-error.md](./ux-traces-missing-file-system-error.md) | System chrome. |
| 243 | open | Medium | Unconfigure | [ux-unconfigure-help-no-dry-run-or-yes.md](./ux-unconfigure-help-no-dry-run-or-yes.md) | unconfigure --help only lists agent and -h — no mention of global --dry-run, confirmation, or files affected. |
| 244 | open | Medium | Destructive | [ux-unconfigure-no-confirmation.md](./ux-unconfigure-no-confirmation.md) | Immediate rewrite no --yes gate. |
| 245 | open | Medium | Unconfigure | [ux-unconfigure-nonconfigured-agent-still-plans-mutations.md](./ux-unconfigure-nonconfigured-agent-still-plans-mutations.md) | unconfigure gemini --dry-run still emits large settings diffs and backup deletes even when user mental mode… |
| 246 | open | Medium | Update | [ux-update-always-suggests-npm-install-g.md](./ux-update-always-suggests-npm-install-g.md) | Ignores install method. |
| 247 | open | Medium | Usage | [ux-usage-list-no-json-flag.md](./ux-usage-list-no-json-flag.md) | usage list lacks --json/--output; scripts cannot machine-parse usage history without scraping tables. trace… |
| 248 | open | Medium | Usage | [ux-usage-pages-invalid-raw-commander.md](./ux-usage-pages-invalid-raw-commander.md) | --pages 0/-1 prints error: option argument is invalid. Expected a positive integer without design-system fr… |
| 249 | open | Medium | Utils / editor | [ux-utils-config-edit-missing-editor-system-chrome.md](./ux-utils-config-edit-missing-editor-system-chrome.md) | utils config edit without EDITOR says Set $EDITOR to use this command + See logs — good message, unnecessar… |
| 250 | open | Medium | Utils / config | [ux-utils-config-path-subcommand-missing.md](./ux-utils-config-path-subcommand-missing.md) | utils config path fails with too many arguments; only show/init/edit exist. Users often need the path witho… |
| 251 | open | Medium | Utils / config | [ux-utils-config-show-dumps-large-json.md](./ux-utils-config-show-dumps-large-json.md) | utils config show prints full global config JSON including configured_services detail — useful but noisy; n… |
| 252 | open | Medium | Version | [ux-version-nags-dev-to-major-jump.md](./ux-version-nags-dev-to-major-jump.md) | Local 0.0.0-dev build reports Update available to 4.0.0 and suggests npm install -g, which is noise for con… |
| 253 | open | Medium | Version | [ux-version-subcommand-missing-use-flag.md](./ux-version-subcommand-missing-use-flag.md) | poe-code version is Unknown command; version works via -V/--version. Users typing version as subcommand (co… |
| 254 | open | Medium | Tables | [ux-wide-tables-truncate-critical-cells.md](./ux-wide-tables-truncate-critical-cells.md) | Agents column ellipsis. |
| 255 | open | Medium | Worktree | [ux-worktree-reconcile-not-found-system-chrome.md](./ux-worktree-reconcile-not-found-system-chrome.md) | Worktree "missing" not found in registry + See logs — same as remove not-found. |
| 256 | open | Medium | Worktree | [ux-worktree-remove-no-confirmation.md](./ux-worktree-remove-no-confirmation.md) | Destructive no confirm. |
| 257 | open | Medium | Worktree | [ux-worktree-remove-not-found-system-chrome.md](./ux-worktree-remove-not-found-system-chrome.md) | worktree remove no-such → Worktree not found in registry + See logs. |
| 258 | open | Medium | Dry-run | [ux-wrap-dry-run-forwards-flag.md](./ux-wrap-dry-run-forwards-flag.md) | would run goose --dry-run. |
| 259 | open | Medium | Dry-run | [ux-wrap-resolves-alias-but-dry-run-lies.md](./ux-wrap-resolves-alias-but-dry-run-lies.md) | kimi-cli --dry-run invented. |
| 260 | open | Low–Medium | Agent defaults | [ux-agent-default-model-hardcoded.md](./ux-agent-default-model-hardcoded.md) | default anthropic/claude-opus-4.7. |
| 261 | open | Low–Medium | Auth | [ux-auth-whoami-raw-json-vs-status-panel.md](./ux-auth-whoami-raw-json-vs-status-panel.md) | auth whoami dumps raw JSON identity; auth status uses design-system Logged in as. Dual presentation for sam… |
| 262 | open | Low–Medium | Auth polish | [ux-auth-whoami-raw-json.md](./ux-auth-whoami-raw-json.md) | JSON vs status design-system. |
| 263 | open | Low–Medium | Braintrust | [ux-braintrust-status-minimal-disabled.md](./ux-braintrust-status-minimal-disabled.md) | braintrust status prints disabled with Problems footer — no how to enable, env vars, or docs link (reaffirm… |
| 264 | open | Low–Medium | Code-review | [ux-code-review-profiles-raw-table.md](./ux-code-review-profiles-raw-table.md) | code-review profiles dumps a minimal ascii table of name/source without Poe panel framing used elsewhere. |
| 265 | open | Low–Medium | Code-review / visual | [ux-code-review-profiles-table-outside-design-system.md](./ux-code-review-profiles-table-outside-design-system.md) | No Poe framing. |
| 266 | open | Low–Medium | Help | [ux-command-aliases-undocumented-on-root-help.md](./ux-command-aliases-undocumented-on-root-help.md) | Work but not shown. |
| 267 | open | Low–Medium | Configure help | [ux-configure-shape-base-url-opaque.md](./ux-configure-shape-base-url-opaque.md) | Jargon no examples. |
| 268 | open | Low–Medium | Editor | [ux-editor-missing-raw-error.md](./ux-editor-missing-raw-error.md) | throw new Error Set $EDITOR. |
| 269 | open | Low–Medium | Eval | [ux-eval-errors-outside-design-system.md](./ux-eval-errors-outside-design-system.md) | Some eval plain text. |
| 270 | open | Low–Medium | Eval | [ux-eval-init-success-is-bare-paths.md](./ux-eval-init-success-is-bare-paths.md) | eval init prints folder name and next: poe-code eval check … as bare lines; also next command may still be … |
| 271 | open | Low–Medium | Eval | [ux-eval-report-debug-flag-undocumented-in-error.md](./ux-eval-report-debug-flag-undocumented-in-error.md) | eval report with no eval folders says Use --debug for a stack trace while primary help may not surface --de… |
| 272 | open | Low–Medium | Experiment | [ux-experiment-journal-wrong-doc-type-message.md](./ux-experiment-journal-wrong-doc-type-message.md) | Doc not found for existing. |
| 273 | open | Low–Medium | Install / IA | [ux-extra-npm-bins-confusing.md](./ux-extra-npm-bins-confusing.md) | poe-code-configure + test servers. |
| 274 | open | Low–Medium | Gaslight | [ux-gaslight-archive-and-no-archive-both-accepted.md](./ux-gaslight-archive-and-no-archive-both-accepted.md) | Passing both --archive and --no-archive does not error; one silently wins (Commander negate) while help lis… |
| 275 | open | Low–Medium | GH workflows | [ux-gh-install-eject-flag-opaque.md](./ux-gh-install-eject-flag-opaque.md) | Description eject. |
| 276 | open | Low–Medium | Install | [ux-install-always-claims-success.md](./ux-install-always-claims-success.md) | No already-present state. |
| 277 | open | Low–Medium | Launch | [ux-launch-status-shows-failed-experiment-leftovers.md](./ux-launch-status-shows-failed-experiment-leftovers.md) | stopped leftovers no cleanup hint. |
| 278 | open | Low–Medium | Errors / consistency | [ux-mcp-servers-missing-file-almost-good.md](./ux-mcp-servers-missing-file-almost-good.md) | Good message class vary. |
| 279 | open | Low–Medium | Memory / MCP | [ux-memory-mcp-print-config-raw-json.md](./ux-memory-mcp-print-config-raw-json.md) | Bare JSON no guidance. |
| 280 | open | Low–Medium | Memory | [ux-memory-status-after-write-is-terse.md](./ux-memory-status-after-write-is-terse.md) | memory status prints Pages/Bytes/Last write/Tokens as bare lines without panel framing or interpretation (h… |
| 281 | open | Low–Medium | Models | [ux-models-raw-view-bypasses-design-system.md](./ux-models-raw-view-bypasses-design-system.md) | No framing. |
| 282 | open | Low–Medium | Models | [ux-models-tools-and-feature-filter-semantics-undocumented.md](./ux-models-tools-and-feature-filter-semantics-undocumented.md) | --tools is documented as shorthand for --feature tools, but combining --tools with --feature web_search ret… |
| 283 | open | Low–Medium | Help / completion | [ux-no-shell-completion-command.md](./ux-no-shell-completion-command.md) | No poe-code completion (bash/zsh/fish) command to install tab completion, despite a large command surface w… |
| 284 | open | Low–Medium | Auth polish | [ux-oauth-url-dumps-full-query-string.md](./ux-oauth-url-dumps-full-query-string.md) | Long authorize URL line. |
| 285 | open | Low–Medium | Pipeline | [ux-pipeline-validate-success-still-problems-footer.md](./ux-pipeline-validate-success-still-problems-footer.md) | Valid pipeline validation ends with Problems? GitHub link after Plan is valid success. |
| 286 | open | Low–Medium | Plan list | [ux-plan-list-empty-table-no-message.md](./ux-plan-list-empty-table-no-message.md) | No no-plans message. |
| 287 | open | Low–Medium | Plan list | [ux-plan-list-output-json-unframed.md](./ux-plan-list-output-json-unframed.md) | plan list --output json prints a raw JSON array to stdout with no design-system intro; --output md prints a… |
| 288 | open | Low–Medium | Plan | [ux-plan-markdown-read-raw-yaml-ish-output.md](./ux-plan-markdown-read-raw-yaml-ish-output.md) | plan markdown-read prints raw file:/frontmatter:/sections: blocks without design-system framing used by pla… |
| 289 | open | Low–Medium | Plan view | [ux-plan-view-json-dumps-full-markdown-content.md](./ux-plan-view-json-dumps-full-markdown-content.md) | plan view --output json includes a huge content string of the full plan body, which is useful for tooling b… |
| 290 | open | Low–Medium | Design system | [ux-problems-footer-on-every-success.md](./ux-problems-footer-on-every-success.md) | finalize always. |
| 291 | open | Low–Medium | Runtime | [ux-runtime-templates-ls-shows-empty-docker-row.md](./ux-runtime-templates-ls-shows-empty-docker-row.md) | runtime templates ls includes a docker row with (empty) hash and dashes, plus many old e2b artifacts — nois… |
| 292 | open | Low–Medium | Runtime | [ux-runtime-templates-ls-unbounded-noise.md](./ux-runtime-templates-ls-unbounded-noise.md) | Old e2b /tmp rows. |
| 293 | open | Low–Medium | Configure | [ux-shape-base-url-error-good-message-system-prefix.md](./ux-shape-base-url-error-good-message-system-prefix.md) | Good text system prefix. |
| 294 | open | Low–Medium | Spawn / skills | [ux-skill-and-skills-flags-undocumented-relationship.md](./ux-skill-and-skills-flags-undocumented-relationship.md) | Both merge; help silent. |
| 295 | open | Low–Medium | Skills | [ux-skill-configure-goose-writes-dot-agents-skills.md](./ux-skill-configure-goose-writes-dot-agents-skills.md) | skill configure goose --yes --local succeeds at ./.agents/skills while claude uses ./.claude/skills — path … |
| 296 | open | Low–Medium | Configure | [ux-skip-if-configured-still-noises-dry-run.md](./ux-skip-if-configured-still-noises-dry-run.md) | Still full would-configure. |
| 297 | open | Low–Medium | Design system | [ux-spawn-success-still-problems-footer.md](./ux-spawn-success-still-problems-footer.md) | Even successful spawn pi/claude/goose runs end with Problems? GitHub issues link, training users to ignore … |
| 298 | open | Low–Medium | Visual language | [ux-success-and-info-share-magenta-glyphs.md](./ux-success-and-info-share-magenta-glyphs.md) | logger ◆ and ● magenta. |
| 299 | open | Low–Medium | Traces | [ux-traces-cwd-only-flag-removed-or-renamed.md](./ux-traces-cwd-only-flag-removed-or-renamed.md) | traces defaults to cwd-only listing; expansion is via --all-workspaces. The flag --cwd-only is unknown. Ear… |
| 300 | open | Low–Medium | Usage | [ux-usage-help-hides-default-balance.md](./ux-usage-help-hides-default-balance.md) | Bare usage balance; help omits. |
| 301 | open | Low–Medium | Utils | [ux-utils-symlink-skills-scope-error-vs-agents.md](./ux-utils-symlink-skills-scope-error-vs-agents.md) | skills dry-run needs flags. |
| 302 | open | Low–Medium | Logging / verbose | [ux-verbose-prefixes-every-log-line.md](./ux-verbose-prefixes-every-log-line.md) | [models] on tables. |
| 303 | open | Low–Medium | Version | [ux-version-update-nag-on-dev-builds.md](./ux-version-update-nag-on-dev-builds.md) | Always update available. |
| 304 | open | Low–Medium | Worktree | [ux-worktree-reconcile-requires-agent-not-in-error-order.md](./ux-worktree-reconcile-requires-agent-not-in-error-order.md) | worktree reconcile without args hits required option --agent before missing name, similar to spawn mode-bef… |
| 305 | open | Low | Errors / positive pattern | [ux-activity-timeout-zero-good-validation.md](./ux-activity-timeout-zero-good-validation.md) | Invalid --activity-timeout-ms "0" returns a clear ValidationError-style message without raw Commander text … |
| 306 | open | Low | Spawn / positive pattern | [ux-activity-timeout-zero-validation-good.md](./ux-activity-timeout-zero-validation-good.md) | Invalid activity timeout returns Expected a positive integer without stack. |
| 307 | open | Low | Agent / positive pattern | [ux-agent-default-model-works-when-opus-valid.md](./ux-agent-default-model-works-when-opus-valid.md) | agent "say only: ok" without --model succeeds using default anthropic/claude-opus-4.7 — positive that DEFAU… |
| 308 | open | Low | Braintrust | [ux-braintrust-status-opaque.md](./ux-braintrust-status-opaque.md) | disabled only. |
| 309 | open | Low | Configure / positive pattern | [ux-configure-success-vscode-next-steps-good.md](./ux-configure-success-vscode-next-steps-good.md) | After configuring Claude Code, a Next steps note with vscode://settings/claudeCode.disableLoginPrompt deep … |
| 310 | open | Low | Configure / positive pattern | [ux-configure-unknown-provider-good-message.md](./ux-configure-unknown-provider-good-message.md) | configure --provider notaprovider returns Unknown provider "notaprovider" cleanly (could still list known p… |
| 311 | open | Low | Agents / positive pattern | [ux-cursor-and-cursor-agent-aliases-both-work.md](./ux-cursor-and-cursor-agent-aliases-both-work.md) | spawn cursor and spawn cursor-agent both succeed; configure aliases map to same Cursor surface. Positive al… |
| 312 | open | Low | Spawn / positive pattern | [ux-cwd-missing-path-good-message.md](./ux-cwd-missing-path-good-message.md) | spawn --cwd /no/such/dir returns Workspace path does not exist clearly (still See logs). |
| 313 | open | Low | Spawn / positive pattern | [ux-e2b-missing-key-error-good.md](./ux-e2b-missing-key-error-good.md) | No E2B API key message points to E2B_API_KEY and config.json paths — good recovery (still See logs). |
| 314 | open | Low | Harness / positive pattern | [ux-harness-new-success-good.md](./ux-harness-new-success-good.md) | harness new with --yes creates pair with clear Created harness pair at path success framing. |
| 315 | open | Low | Harness | [ux-harness-unknown-template-no-kinds.md](./ux-harness-unknown-template-no-kinds.md) | No allow-list. |
| 316 | open | Low | Polish | [ux-help-subcommand-inconsistency.md](./ux-help-subcommand-inconsistency.md) | Some groups help [command]. |
| 317 | open | Low | Hooks / positive pattern | [ux-hooks-from-unknown-lists-supported-good.md](./ux-hooks-from-unknown-lists-supported-good.md) | Unsupported source hook agent lists Supported hook agents: claude-code, codex — good allow-list (still See … |
| 318 | open | Low | Auth | [ux-login-yes-message-good-but-worth-aligning.md](./ux-login-yes-message-good-but-worth-aligning.md) | --yes fail-fast good; bare hangs. |
| 319 | open | Low | Maestro | [ux-maestro-dual-invocation-shape.md](./ux-maestro-dual-invocation-shape.md) | Parent + run unclear. |
| 320 | open | Low | Maestro | [ux-maestro-duplicate-config-flags.md](./ux-maestro-duplicate-config-flags.md) | --config and --workflow same. |
| 321 | open | Low | Maestro / positive pattern | [ux-maestro-tui-mutual-exclusion-validation-good.md](./ux-maestro-tui-mutual-exclusion-validation-good.md) | Specifying both --config and --workflow fails with clear mutual exclusion message. |
| 322 | open | Low | Spawn / positive pattern | [ux-mcp-servers-file-and-json-validation-good.md](./ux-mcp-servers-file-and-json-validation-good.md) | Missing @file reports could not read file with path; invalid JSON reports required shape — good ValidationE… |
| 323 | open | Low | Spawn / positive pattern | [ux-mcp-servers-validation-good.md](./ux-mcp-servers-validation-good.md) | Invalid MCP server JSON without command returns a clear field-level ValidationError without system chrome. |
| 324 | open | Low | Memory / positive pattern | [ux-memory-cache-clear-requires-yes-good.md](./ux-memory-cache-clear-requires-yes-good.md) | memory cache clear without --yes refuses with Refusing to clear cache without --yes — good guard (still See… |
| 325 | open | Low | Memory / positive pattern | [ux-memory-ingest-not-init-good.md](./ux-memory-ingest-not-init-good.md) | Memory is not initialized. Run poe-code memory init — clear recovery. |
| 326 | open | Low | Models / positive pattern | [ux-models-help-examples-are-excellent.md](./ux-models-help-examples-are-excellent.md) | models --help includes Filters, Views, and Examples sections — best-in-class help in the CLI; other primary… |
| 327 | open | Low | Models / positive pattern | [ux-models-parameters-view-good-for-filtered.md](./ux-models-parameters-view-good-for-filtered.md) | parameters view for anthropic shows output_effort enums including xhigh — useful for configuring reasoning-… |
| 328 | open | Low | Spawn / positive pattern | [ux-pi-agent-alias-works.md](./ux-pi-agent-alias-works.md) | spawn pi-agent resolves to pi and succeeds — positive alias behavior (title shows spawn pi). |
| 329 | open | Low | Pipeline / positive pattern | [ux-pipeline-init-yes-requires-source-good.md](./ux-pipeline-init-yes-requires-source-good.md) | Provide --source or --sources when using --yes is clear non-TTY guidance. |
| 330 | open | Low | Pipeline / positive pattern | [ux-pipeline-max-runs-zero-good-validation.md](./ux-pipeline-max-runs-zero-good-validation.md) | Invalid max-runs "0" returns clear positive-integer validation without raw Commander text — positive patter… |
| 331 | open | Low | Plan / positive pattern | [ux-plan-install-success-good.md](./ux-plan-install-success-good.md) | plan install shows Create path and Installed plan skill with design-system framing — positive pattern. |
| 332 | open | Low | Plan / positive pattern | [ux-plan-kind-invalid-validation-good.md](./ux-plan-kind-invalid-validation-good.md) | Invalid --kind bogus lists Expected plan, pipeline, experiment, ralph, superintendent, superintendent-base. |
| 333 | open | Low | Plan / positive pattern | [ux-plan-output-invalid-validation-good.md](./ux-plan-output-invalid-validation-good.md) | Invalid --output value "bad" returns Expected one of: terminal, md, json without raw Commander skin. |
| 334 | open | Low | Plan path | [ux-plan-path-commands-bare-stdout-reconfirmed.md](./ux-plan-path-commands-bare-stdout-reconfirmed.md) | pipeline/experiment/superintendent plan-path print absolute path as bare stdout — good for scripting, incon… |
| 335 | open | Low | Plan paths | [ux-plan-path-commands-bare-stdout.md](./ux-plan-path-commands-bare-stdout.md) | Path only. |
| 336 | open | Low | Providers / positive pattern | [ux-provider-login-anthropic-dry-run-good.md](./ux-provider-login-anthropic-dry-run-good.md) | provider login anthropic --api-key test --yes --dry-run says would save credential without dumping secrets … |
| 337 | open | Low | Brand | [ux-root-tagline-inconsistent.md](./ux-root-tagline-inconsistent.md) | Different one-liners. |
| 338 | open | Low | Runtime / positive pattern | [ux-runtime-build-host-message-good.md](./ux-runtime-build-host-message-good.md) | Host runtime has no template to build with pass --runtime e2b/docker or config hint — clear recovery. |
| 339 | open | Low | Configure / positive pattern | [ux-shape-base-url-invalid-validation-good.md](./ux-shape-base-url-invalid-validation-good.md) | Invalid --shape-base-url value returns Use <shape-id>=<url> clearly. |
| 340 | open | Low | Configure / positive pattern | [ux-shape-base-url-unknown-shape-lists-exposed-good.md](./ux-shape-base-url-unknown-shape-lists-exposed-good.md) | Unknown API shape "messages" lists Exposed shapes: openai-chat-completions, openai-responses, anthropic-mes… |
| 341 | open | Low | Spawn / positive pattern | [ux-skill-bridge-failure-lists-paths-good.md](./ux-skill-bridge-failure-lists-paths-good.md) | Failed to bridge active skills lists Not found skill references and searched paths — good recovery content … |
| 342 | open | Low | Skills / positive pattern | [ux-skill-install-from-file-works-well.md](./ux-skill-install-from-file-works-well.md) | skill install with --file/--name/--yes/--local produces a clear design-system success naming agent and path… |
| 343 | open | Low | Spawn / positive pattern | [ux-spawn-invalid-mode-validation-good.md](./ux-spawn-invalid-mode-validation-good.md) | Invalid --mode "bogus" returns Expected yolo, auto, edit, or read without Commander raw skin. |
| 344 | open | Low | Spawn / positive pattern | [ux-spawn-log-default-redacts-agent-message-good.md](./ux-spawn-log-default-redacts-agent-message-good.md) | Default ACP JSONL log writes agent_message text as [redacted] — good privacy default. --log-content include… |
| 345 | open | Low | Spawn / positive pattern | [ux-spawn-runtime-docker-error-good-install-hints.md](./ux-spawn-runtime-docker-error-good-install-hints.md) | No container engine found includes Docker Desktop / Colima / Podman install hints — good recovery copy (sti… |
| 346 | open | Low | Tasks / positive pattern | [ux-tasks-verify-format-error-good.md](./ux-tasks-verify-format-error-good.md) | Expected project to use owner/number format is clear (still [error] prefix odd). |
| 347 | open | Low | Test / positive pattern | [ux-test-with-valid-model-succeeds.md](./ux-test-with-valid-model-succeeds.md) | test claude --model anthropic/claude-haiku-4.5 succeeds with Tested Claude Code framing when model is valid… |
| 348 | open | Low | Traces / positive pattern | [ux-traces-source-invalid-validation-good.md](./ux-traces-source-invalid-validation-good.md) | Unsupported trace source lists Expected one of: claude, codex, poe-code without stack. |
| 349 | open | Low | Update / positive pattern | [ux-update-package-manager-override-works.md](./ux-update-package-manager-override-works.md) | update --package-manager bun --dry-run correctly plans bun install -g poe-code@latest — positive package-ma… |
| 350 | open | Low | Usage / positive pattern | [ux-usage-balance-presentation-good.md](./ux-usage-balance-presentation-good.md) | usage balance shows Balance, Plan, Add-on, next grant with design-system framing and helpful next-points link. |
| 351 | open | Low | Usage / positive pattern | [ux-usage-list-filter-works-well.md](./ux-usage-list-filter-works-well.md) | usage list --filter Claude-Haiku returns filtered table with clear costs — good list UX (still no --json). |
| 352 | open | Low | Utils / positive pattern | [ux-utils-config-init-already-exists-is-info.md](./ux-utils-config-init-already-exists-is-info.md) | config init when project config exists prints Project config already exists at path without error exit dram… |
| 353 | open | Low | Utils / positive pattern | [ux-utils-symlink-agents-already-linked-good.md](./ux-utils-symlink-agents-already-linked-good.md) | utils symlink agents --dry-run prints already linked without error — good idempotent message. |
| 354 | open | Low | Utils / positive pattern | [ux-utils-symlink-skills-both-exist-good-guidance.md](./ux-utils-symlink-skills-both-exist-good-guidance.md) | When both .claude/skills and .agents/skills exist, message explains resolve manually steps — good conflict … |
| 355 | open | Low | Utils / positive pattern | [ux-utils-symlink-skills-yes-local-dry-run-works.md](./ux-utils-symlink-skills-yes-local-dry-run-works.md) | With explicit scope flags, dry-run shows rename+symlink plan — positive once scope is provided (still subje… |

## Platform fixes

1. Secret redaction (dry-run diffs + auth) + danger help  
2. Remove/replace dead `claude-sonnet-5` defaults  
3. Never write on --skip-if-configured when configured; never write dead defaults  
4. Intentional-only dry-run diffs  
5. models `--model` accept namespaced ids  
6. Reject empty/invalid explicit flags  
7. Unified permission mode enum  
8. Unified skill-install scope flags + real --force overwrite policy  
9. UserError classification  
10. displayBinaryName vs npm run dev / toolcraft  
11. Agent capability matrix  
12. Destructive policy + model catalog validation  
13. Doctor overview  
14. Runtime/launch job GC  
15. Parent-group next-step defaults  
16. Detach/runner-sync require runtime context  
17. Slim published npm bins  
18. Non-TTY fail-fast for plan browse/login/configure prompts  
19. Kind-aware plan doc errors (not "not found")  
20. Split auth logout vs full factory reset  

## Alphabetical index

| File | # |
| --- | ---: |
| [ux-acp-stream-uses-success-glyph-for-partial-text.md](./ux-acp-stream-uses-success-glyph-for-partial-text.md) | 107 |
| [ux-activity-timeout-zero-good-validation.md](./ux-activity-timeout-zero-good-validation.md) | 305 |
| [ux-activity-timeout-zero-validation-good.md](./ux-activity-timeout-zero-validation-good.md) | 306 |
| [ux-agent-default-model-hardcoded.md](./ux-agent-default-model-hardcoded.md) | 260 |
| [ux-agent-default-model-works-when-opus-valid.md](./ux-agent-default-model-works-when-opus-valid.md) | 307 |
| [ux-agent-invalid-model-system-chrome.md](./ux-agent-invalid-model-system-chrome.md) | 108 |
| [ux-agent-spawn-missing-args-raw-commander.md](./ux-agent-spawn-missing-args-raw-commander.md) | 109 |
| [ux-api-key-flags-encourage-shell-history-leaks.md](./ux-api-key-flags-encourage-shell-history-leaks.md) | 110 |
| [ux-approval-copy-hardcodes-toolcraft-in-source.md](./ux-approval-copy-hardcodes-toolcraft-in-source.md) | 10 |
| [ux-approval-queued-message-says-toolcraft.md](./ux-approval-queued-message-says-toolcraft.md) | 11 |
| [ux-approvals-invalid-state-silent-empty-reconfirmed.md](./ux-approvals-invalid-state-silent-empty-reconfirmed.md) | 111 |
| [ux-approvals-invalid-state-silent-empty.md](./ux-approvals-invalid-state-silent-empty.md) | 112 |
| [ux-approvals-show-missing-says-task-not-found.md](./ux-approvals-show-missing-says-task-not-found.md) | 12 |
| [ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md](./ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md) | 13 |
| [ux-auth-api-key-dry-run-still-prints-secret.md](./ux-auth-api-key-dry-run-still-prints-secret.md) | 3 |
| [ux-auth-api-key-help-no-danger-warning.md](./ux-auth-api-key-help-no-danger-warning.md) | 14 |
| [ux-auth-api-key-prints-secret.md](./ux-auth-api-key-prints-secret.md) | 2 |
| [ux-auth-logout-same-as-logout-help.md](./ux-auth-logout-same-as-logout-help.md) | 15 |
| [ux-auth-whoami-raw-json-vs-status-panel.md](./ux-auth-whoami-raw-json-vs-status-panel.md) | 261 |
| [ux-auth-whoami-raw-json.md](./ux-auth-whoami-raw-json.md) | 262 |
| [ux-binary-wrappers-undocumented.md](./ux-binary-wrappers-undocumented.md) | 113 |
| [ux-braintrust-status-minimal-disabled.md](./ux-braintrust-status-minimal-disabled.md) | 263 |
| [ux-braintrust-status-opaque.md](./ux-braintrust-status-opaque.md) | 308 |
| [ux-capture-otel-content-without-capture-silent.md](./ux-capture-otel-content-without-capture-silent.md) | 114 |
| [ux-code-review-double-error-skin.md](./ux-code-review-double-error-skin.md) | 115 |
| [ux-code-review-drafts-missing-arg-double-error.md](./ux-code-review-drafts-missing-arg-double-error.md) | 16 |
| [ux-code-review-install-output-unframed-wrapped.md](./ux-code-review-install-output-unframed-wrapped.md) | 116 |
| [ux-code-review-profiles-raw-table.md](./ux-code-review-profiles-raw-table.md) | 264 |
| [ux-code-review-profiles-table-outside-design-system.md](./ux-code-review-profiles-table-outside-design-system.md) | 265 |
| [ux-code-review-run-invalid-url-wrong-error.md](./ux-code-review-run-invalid-url-wrong-error.md) | 17 |
| [ux-command-aliases-undocumented-on-root-help.md](./ux-command-aliases-undocumented-on-root-help.md) | 266 |
| [ux-command-not-found-no-suggestions.md](./ux-command-not-found-no-suggestions.md) | 117 |
| [ux-configure-accepts-invalid-model-without-validation.md](./ux-configure-accepts-invalid-model-without-validation.md) | 18 |
| [ux-configure-base-url-may-be-ignored.md](./ux-configure-base-url-may-be-ignored.md) | 19 |
| [ux-configure-codex-dry-run-still-leaks-and-noise.md](./ux-configure-codex-dry-run-still-leaks-and-noise.md) | 20 |
| [ux-configure-cursor-dry-run-too-quiet.md](./ux-configure-cursor-dry-run-too-quiet.md) | 118 |
| [ux-configure-dry-run-dumps-entire-existing-agent-config.md](./ux-configure-dry-run-dumps-entire-existing-agent-config.md) | 21 |
| [ux-configure-dry-run-floods-diff.md](./ux-configure-dry-run-floods-diff.md) | 119 |
| [ux-configure-dry-run-writes-stale-model-id.md](./ux-configure-dry-run-writes-stale-model-id.md) | 22 |
| [ux-configure-provider-requires-model-without-listing-models.md](./ux-configure-provider-requires-model-without-listing-models.md) | 120 |
| [ux-configure-shape-base-url-opaque.md](./ux-configure-shape-base-url-opaque.md) | 267 |
| [ux-configure-success-vscode-next-steps-good.md](./ux-configure-success-vscode-next-steps-good.md) | 309 |
| [ux-configure-unknown-provider-good-message.md](./ux-configure-unknown-provider-good-message.md) | 310 |
| [ux-configure-yes-silent-default-agent.md](./ux-configure-yes-silent-default-agent.md) | 121 |
| [ux-cursor-and-cursor-agent-aliases-both-work.md](./ux-cursor-and-cursor-agent-aliases-both-work.md) | 311 |
| [ux-cwd-missing-path-good-message.md](./ux-cwd-missing-path-good-message.md) | 312 |
| [ux-dashboard-keybindings-undocumented-on-cli-help.md](./ux-dashboard-keybindings-undocumented-on-cli-help.md) | 122 |
| [ux-development-mode-usage-intentional-but-leaks.md](./ux-development-mode-usage-intentional-but-leaks.md) | 23 |
| [ux-dry-run-diffs-print-secrets.md](./ux-dry-run-diffs-print-secrets.md) | 1 |
| [ux-dual-help-systems.md](./ux-dual-help-systems.md) | 24 |
| [ux-e2b-missing-key-error-good.md](./ux-e2b-missing-key-error-good.md) | 313 |
| [ux-editor-error-still-system-chrome.md](./ux-editor-error-still-system-chrome.md) | 123 |
| [ux-editor-missing-raw-error.md](./ux-editor-missing-raw-error.md) | 268 |
| [ux-empty-api-key-flag-silently-ignored.md](./ux-empty-api-key-flag-silently-ignored.md) | 124 |
| [ux-empty-api-key-login-good-but-configure-ignores.md](./ux-empty-api-key-login-good-but-configure-ignores.md) | 25 |
| [ux-empty-model-flag-behavior-inconsistent.md](./ux-empty-model-flag-behavior-inconsistent.md) | 26 |
| [ux-empty-plan-kind-lists-still-draw-empty-tables.md](./ux-empty-plan-kind-lists-still-draw-empty-tables.md) | 125 |
| [ux-error-panel-closes-before-error.md](./ux-error-panel-closes-before-error.md) | 27 |
| [ux-eval-empty-source-message-inconsistent-skins.md](./ux-eval-empty-source-message-inconsistent-skins.md) | 126 |
| [ux-eval-errors-outside-design-system.md](./ux-eval-errors-outside-design-system.md) | 269 |
| [ux-eval-init-name-validation-bare-text.md](./ux-eval-init-name-validation-bare-text.md) | 127 |
| [ux-eval-init-success-is-bare-paths.md](./ux-eval-init-success-is-bare-paths.md) | 270 |
| [ux-eval-report-debug-flag-undocumented-in-error.md](./ux-eval-report-debug-flag-undocumented-in-error.md) | 271 |
| [ux-eval-report-invalid-format-npm-run-dev.md](./ux-eval-report-invalid-format-npm-run-dev.md) | 28 |
| [ux-eval-unknown-command-suggests-lint-for-list.md](./ux-eval-unknown-command-suggests-lint-for-list.md) | 128 |
| [ux-experiment-install-already-exists-vs-pipeline-skip.md](./ux-experiment-install-already-exists-vs-pipeline-skip.md) | 29 |
| [ux-experiment-install-force-does-not-overwrite.md](./ux-experiment-install-force-does-not-overwrite.md) | 30 |
| [ux-experiment-journal-wrong-doc-type-message.md](./ux-experiment-journal-wrong-doc-type-message.md) | 272 |
| [ux-experiment-journal-wrong-kind-says-not-found.md](./ux-experiment-journal-wrong-kind-says-not-found.md) | 31 |
| [ux-experiment-ralph-no-doc-wrong-message.md](./ux-experiment-ralph-no-doc-wrong-message.md) | 32 |
| [ux-extra-npm-bins-confusing.md](./ux-extra-npm-bins-confusing.md) | 273 |
| [ux-extra-npm-bins-still-shipped.md](./ux-extra-npm-bins-still-shipped.md) | 33 |
| [ux-failure-shown-as-success-markers.md](./ux-failure-shown-as-success-markers.md) | 34 |
| [ux-gaslight-archive-and-no-archive-both-accepted.md](./ux-gaslight-archive-and-no-archive-both-accepted.md) | 274 |
| [ux-gaslight-config-missing-enoent.md](./ux-gaslight-config-missing-enoent.md) | 129 |
| [ux-gaslight-ingest-failure-dumps-jsonl.md](./ux-gaslight-ingest-failure-dumps-jsonl.md) | 35 |
| [ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md](./ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md) | 36 |
| [ux-gaslight-install-force-dry-run-vs-already-exists.md](./ux-gaslight-install-force-dry-run-vs-already-exists.md) | 130 |
| [ux-gaslight-multi-plan-fails-fast-with-success-markers.md](./ux-gaslight-multi-plan-fails-fast-with-success-markers.md) | 131 |
| [ux-gaslight-no-activity-timeout-flag.md](./ux-gaslight-no-activity-timeout-flag.md) | 132 |
| [ux-gaslight-no-plan-autopicks-and-hits-stale-model.md](./ux-gaslight-no-plan-autopicks-and-hits-stale-model.md) | 37 |
| [ux-gaslight-opaque-naming.md](./ux-gaslight-opaque-naming.md) | 133 |
| [ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md](./ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md) | 134 |
| [ux-gaslight-unknown-agent-says-service.md](./ux-gaslight-unknown-agent-says-service.md) | 135 |
| [ux-gemini-configure-dry-run-too-quiet.md](./ux-gemini-configure-dry-run-too-quiet.md) | 136 |
| [ux-gh-install-dry-run-lists-paths-without-panel.md](./ux-gh-install-dry-run-lists-paths-without-panel.md) | 137 |
| [ux-gh-install-eject-flag-opaque.md](./ux-gh-install-eject-flag-opaque.md) | 275 |
| [ux-gh-prompt-preview-dumps-long-unframed-prompt.md](./ux-gh-prompt-preview-dumps-long-unframed-prompt.md) | 138 |
| [ux-github-cwd-clone-errors-still-raw-git.md](./ux-github-cwd-clone-errors-still-raw-git.md) | 38 |
| [ux-github-cwd-clone-errors-unframed.md](./ux-github-cwd-clone-errors-unframed.md) | 103 |
| [ux-global-flags-hidden-on-subcommand-help.md](./ux-global-flags-hidden-on-subcommand-help.md) | 139 |
| [ux-group-commands-print-help-only.md](./ux-group-commands-print-help-only.md) | 140 |
| [ux-hardcoded-stale-sonnet-5-in-product-defaults.md](./ux-hardcoded-stale-sonnet-5-in-product-defaults.md) | 4 |
| [ux-harness-list-only-cwd-not-created-dir.md](./ux-harness-list-only-cwd-not-created-dir.md) | 141 |
| [ux-harness-missing-file-system-chrome.md](./ux-harness-missing-file-system-chrome.md) | 142 |
| [ux-harness-new-success-good.md](./ux-harness-new-success-good.md) | 314 |
| [ux-harness-run-missing-file-system-chrome.md](./ux-harness-run-missing-file-system-chrome.md) | 143 |
| [ux-harness-run-success-opaque-result-object.md](./ux-harness-run-success-opaque-result-object.md) | 144 |
| [ux-harness-unknown-template-no-kinds.md](./ux-harness-unknown-template-no-kinds.md) | 315 |
| [ux-harness-unknown-template-still-omits-kind-list.md](./ux-harness-unknown-template-still-omits-kind-list.md) | 145 |
| [ux-help-command-not-registered.md](./ux-help-command-not-registered.md) | 146 |
| [ux-help-subcommand-inconsistency.md](./ux-help-subcommand-inconsistency.md) | 316 |
| [ux-hidden-and-orphan-commands.md](./ux-hidden-and-orphan-commands.md) | 147 |
| [ux-hooks-bridge-refuse-user-authored-file-opaque.md](./ux-hooks-bridge-refuse-user-authored-file-opaque.md) | 148 |
| [ux-hooks-from-spawn-poe-code-enoent.md](./ux-hooks-from-spawn-poe-code-enoent.md) | 39 |
| [ux-hooks-from-unknown-lists-supported-good.md](./ux-hooks-from-unknown-lists-supported-good.md) | 317 |
| [ux-hooks-from-unsupported-system-chrome.md](./ux-hooks-from-unsupported-system-chrome.md) | 149 |
| [ux-hooks-strategy-transform-unsupported-opaque.md](./ux-hooks-strategy-transform-unsupported-opaque.md) | 40 |
| [ux-important-commands-absent-from-root-help.md](./ux-important-commands-absent-from-root-help.md) | 150 |
| [ux-inconsistent-agent-surface-across-commands.md](./ux-inconsistent-agent-surface-across-commands.md) | 41 |
| [ux-install-always-claims-success.md](./ux-install-always-claims-success.md) | 276 |
| [ux-install-always-success-reconfirmed.md](./ux-install-always-success-reconfirmed.md) | 151 |
| [ux-install-skill-flags-inconsistent-across-commands.md](./ux-install-skill-flags-inconsistent-across-commands.md) | 42 |
| [ux-install-yes-defaults-agent-silently.md](./ux-install-yes-defaults-agent-silently.md) | 152 |
| [ux-json-flag-inconsistent-across-commands.md](./ux-json-flag-inconsistent-across-commands.md) | 153 |
| [ux-kimi-default-model-id-mismatches-catalog-namespace.md](./ux-kimi-default-model-id-mismatches-catalog-namespace.md) | 154 |
| [ux-launch-commands-trigger-full-turbo-rebuild.md](./ux-launch-commands-trigger-full-turbo-rebuild.md) | 155 |
| [ux-launch-missing-process-system-chrome.md](./ux-launch-missing-process-system-chrome.md) | 156 |
| [ux-launch-start-opaque-failure.md](./ux-launch-start-opaque-failure.md) | 157 |
| [ux-launch-start-triggers-turbo-noise-and-opaque-failure.md](./ux-launch-start-triggers-turbo-noise-and-opaque-failure.md) | 43 |
| [ux-launch-start-via-npm-run-dev-confuses-argv.md](./ux-launch-start-via-npm-run-dev-confuses-argv.md) | 158 |
| [ux-launch-status-crashes-on-tombstone-dirs.md](./ux-launch-status-crashes-on-tombstone-dirs.md) | 44 |
| [ux-launch-status-shows-dash-id-ghost-rows.md](./ux-launch-status-shows-dash-id-ghost-rows.md) | 45 |
| [ux-launch-status-shows-failed-experiment-leftovers.md](./ux-launch-status-shows-failed-experiment-leftovers.md) | 277 |
| [ux-log-content-flags-underwarn-sensitive-data.md](./ux-log-content-flags-underwarn-sensitive-data.md) | 159 |
| [ux-log-content-help-underwarns-reconfirmed.md](./ux-log-content-help-underwarns-reconfirmed.md) | 160 |
| [ux-login-help-omits-interactive-and-yes.md](./ux-login-help-omits-interactive-and-yes.md) | 161 |
| [ux-login-help-omits-oauth-default.md](./ux-login-help-omits-oauth-default.md) | 162 |
| [ux-login-non-tty-hangs-on-oauth.md](./ux-login-non-tty-hangs-on-oauth.md) | 46 |
| [ux-login-rejected-no-recovery.md](./ux-login-rejected-no-recovery.md) | 163 |
| [ux-login-yes-message-good-but-worth-aligning.md](./ux-login-yes-message-good-but-worth-aligning.md) | 318 |
| [ux-logout-dry-run-multi-panel-noise.md](./ux-logout-dry-run-multi-panel-noise.md) | 47 |
| [ux-logout-dry-run-still-multi-panel-unconfigure.md](./ux-logout-dry-run-still-multi-panel-unconfigure.md) | 48 |
| [ux-logout-help-no-danger-or-scope-detail.md](./ux-logout-help-no-danger-or-scope-detail.md) | 49 |
| [ux-logout-overclaims-scope.md](./ux-logout-overclaims-scope.md) | 8 |
| [ux-maestro-config-vs-workflow-flags-duplicated.md](./ux-maestro-config-vs-workflow-flags-duplicated.md) | 164 |
| [ux-maestro-dry-run-hits-github-without-workflow.md](./ux-maestro-dry-run-hits-github-without-workflow.md) | 104 |
| [ux-maestro-dry-run-path-vs-flag-confusion.md](./ux-maestro-dry-run-path-vs-flag-confusion.md) | 50 |
| [ux-maestro-dual-invocation-shape.md](./ux-maestro-dual-invocation-shape.md) | 319 |
| [ux-maestro-duplicate-config-flags.md](./ux-maestro-duplicate-config-flags.md) | 320 |
| [ux-maestro-run-dry-run-still-hits-github-401.md](./ux-maestro-run-dry-run-still-hits-github-401.md) | 51 |
| [ux-maestro-tick-missing-transition-raw-commander.md](./ux-maestro-tick-missing-transition-raw-commander.md) | 165 |
| [ux-maestro-tui-mutual-exclusion-validation-good.md](./ux-maestro-tui-mutual-exclusion-validation-good.md) | 321 |
| [ux-many-parent-groups-only-dump-help.md](./ux-many-parent-groups-only-dump-help.md) | 166 |
| [ux-mcp-servers-file-and-json-validation-good.md](./ux-mcp-servers-file-and-json-validation-good.md) | 322 |
| [ux-mcp-servers-missing-file-almost-good.md](./ux-mcp-servers-missing-file-almost-good.md) | 278 |
| [ux-mcp-servers-validation-good.md](./ux-mcp-servers-validation-good.md) | 323 |
| [ux-memory-agent-commands-invalid-json-opaque.md](./ux-memory-agent-commands-invalid-json-opaque.md) | 52 |
| [ux-memory-cache-clear-requires-yes-good.md](./ux-memory-cache-clear-requires-yes-good.md) | 324 |
| [ux-memory-clear-help-still-no-force-or-yes.md](./ux-memory-clear-help-still-no-force-or-yes.md) | 167 |
| [ux-memory-clear-no-confirmation.md](./ux-memory-clear-no-confirmation.md) | 168 |
| [ux-memory-ingest-not-init-good.md](./ux-memory-ingest-not-init-good.md) | 325 |
| [ux-memory-install-already-exists-system-chrome.md](./ux-memory-install-already-exists-system-chrome.md) | 169 |
| [ux-memory-ls-search-show-raw-unframed.md](./ux-memory-ls-search-show-raw-unframed.md) | 170 |
| [ux-memory-mcp-print-config-raw-json.md](./ux-memory-mcp-print-config-raw-json.md) | 279 |
| [ux-memory-status-after-write-is-terse.md](./ux-memory-status-after-write-is-terse.md) | 280 |
| [ux-memory-write-requires-reason-before-path.md](./ux-memory-write-requires-reason-before-path.md) | 171 |
| [ux-memory-write-requires-reason-raw-commander.md](./ux-memory-write-requires-reason-raw-commander.md) | 172 |
| [ux-memory-write-success-is-raw-unframed.md](./ux-memory-write-success-is-raw-unframed.md) | 173 |
| [ux-model-id-namespace-stripping-surprises.md](./ux-model-id-namespace-stripping-surprises.md) | 174 |
| [ux-models-dumps-full-catalog.md](./ux-models-dumps-full-catalog.md) | 175 |
| [ux-models-empty-search-returns-all.md](./ux-models-empty-search-returns-all.md) | 176 |
| [ux-models-endpoint-invalid-good-list-but-stack.md](./ux-models-endpoint-invalid-good-list-but-stack.md) | 53 |
| [ux-models-exact-id-filter-rejects-namespaced-ids.md](./ux-models-exact-id-filter-rejects-namespaced-ids.md) | 54 |
| [ux-models-feature-bogus-silent-empty.md](./ux-models-feature-bogus-silent-empty.md) | 177 |
| [ux-models-feature-flag-not-repeatable.md](./ux-models-feature-flag-not-repeatable.md) | 178 |
| [ux-models-help-examples-are-excellent.md](./ux-models-help-examples-are-excellent.md) | 326 |
| [ux-models-input-bogus-silent-empty.md](./ux-models-input-bogus-silent-empty.md) | 179 |
| [ux-models-invalid-feature-silent-empty.md](./ux-models-invalid-feature-silent-empty.md) | 180 |
| [ux-models-invalid-modality-silent-empty.md](./ux-models-invalid-modality-silent-empty.md) | 181 |
| [ux-models-parameters-view-good-for-filtered.md](./ux-models-parameters-view-good-for-filtered.md) | 327 |
| [ux-models-raw-view-bypasses-design-system.md](./ux-models-raw-view-bypasses-design-system.md) | 281 |
| [ux-models-search-confirms-sonnet-5-absent-from-catalog.md](./ux-models-search-confirms-sonnet-5-absent-from-catalog.md) | 55 |
| [ux-models-since-validation-still-prints-stack.md](./ux-models-since-validation-still-prints-stack.md) | 56 |
| [ux-models-tools-and-feature-filter-semantics-undocumented.md](./ux-models-tools-and-feature-filter-semantics-undocumented.md) | 282 |
| [ux-models-view-invalid-uses-raw-commander.md](./ux-models-view-invalid-uses-raw-commander.md) | 182 |
| [ux-no-doctor-or-health-overview-command.md](./ux-no-doctor-or-health-overview-command.md) | 183 |
| [ux-no-shell-completion-command.md](./ux-no-shell-completion-command.md) | 283 |
| [ux-non-tty-prompt-wrong-guidance.md](./ux-non-tty-prompt-wrong-guidance.md) | 57 |
| [ux-oauth-url-dumps-full-query-string.md](./ux-oauth-url-dumps-full-query-string.md) | 284 |
| [ux-opencode-model-triple-namespace.md](./ux-opencode-model-triple-namespace.md) | 184 |
| [ux-permission-mode-sets-differ-across-commands.md](./ux-permission-mode-sets-differ-across-commands.md) | 58 |
| [ux-pi-agent-alias-works.md](./ux-pi-agent-alias-works.md) | 328 |
| [ux-pi-spawnable-but-not-configurable.md](./ux-pi-spawnable-but-not-configurable.md) | 59 |
| [ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md](./ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md) | 185 |
| [ux-pipeline-init-yes-requires-source-good.md](./ux-pipeline-init-yes-requires-source-good.md) | 329 |
| [ux-pipeline-install-force-skips-skill-still.md](./ux-pipeline-install-force-skips-skill-still.md) | 60 |
| [ux-pipeline-max-runs-zero-good-validation.md](./ux-pipeline-max-runs-zero-good-validation.md) | 330 |
| [ux-pipeline-nothing-to-run-success-framing.md](./ux-pipeline-nothing-to-run-success-framing.md) | 186 |
| [ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md](./ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md) | 61 |
| [ux-pipeline-tui-flag-ignored-on-init-failure.md](./ux-pipeline-tui-flag-ignored-on-init-failure.md) | 187 |
| [ux-pipeline-validate-enoent-system-error.md](./ux-pipeline-validate-enoent-system-error.md) | 188 |
| [ux-pipeline-validate-success-still-problems-footer.md](./ux-pipeline-validate-success-still-problems-footer.md) | 285 |
| [ux-pipeline-validate-wrong-kind-system-chrome.md](./ux-pipeline-validate-wrong-kind-system-chrome.md) | 189 |
| [ux-plan-archive-allows-readme.md](./ux-plan-archive-allows-readme.md) | 190 |
| [ux-plan-archive-delete-yes-picks-arbitrary-plan.md](./ux-plan-archive-delete-yes-picks-arbitrary-plan.md) | 7 |
| [ux-plan-archive-help-omits-yes-behavior.md](./ux-plan-archive-help-omits-yes-behavior.md) | 62 |
| [ux-plan-browse-non-tty-dumps-first-plan.md](./ux-plan-browse-non-tty-dumps-first-plan.md) | 191 |
| [ux-plan-browse-non-tty-dumps-plan-body.md](./ux-plan-browse-non-tty-dumps-plan-body.md) | 63 |
| [ux-plan-delete-allows-readme.md](./ux-plan-delete-allows-readme.md) | 64 |
| [ux-plan-docs-advertise-goal-and-chat-commands-missing.md](./ux-plan-docs-advertise-goal-and-chat-commands-missing.md) | 192 |
| [ux-plan-edit-editor-true-claims-edited-without-change.md](./ux-plan-edit-editor-true-claims-edited-without-change.md) | 193 |
| [ux-plan-edit-hangs-without-editor.md](./ux-plan-edit-hangs-without-editor.md) | 65 |
| [ux-plan-install-no-force-flag.md](./ux-plan-install-no-force-flag.md) | 194 |
| [ux-plan-install-success-good.md](./ux-plan-install-success-good.md) | 331 |
| [ux-plan-kind-invalid-validation-good.md](./ux-plan-kind-invalid-validation-good.md) | 332 |
| [ux-plan-list-empty-table-no-message.md](./ux-plan-list-empty-table-no-message.md) | 286 |
| [ux-plan-list-includes-noise-files.md](./ux-plan-list-includes-noise-files.md) | 195 |
| [ux-plan-list-output-json-unframed.md](./ux-plan-list-output-json-unframed.md) | 287 |
| [ux-plan-markdown-read-depth-zero-shows-no-sections.md](./ux-plan-markdown-read-depth-zero-shows-no-sections.md) | 196 |
| [ux-plan-markdown-read-raw-yaml-ish-output.md](./ux-plan-markdown-read-raw-yaml-ish-output.md) | 288 |
| [ux-plan-markdown-read-section-wrong-command-hint.md](./ux-plan-markdown-read-section-wrong-command-hint.md) | 197 |
| [ux-plan-markdown-read-system-chrome.md](./ux-plan-markdown-read-system-chrome.md) | 198 |
| [ux-plan-non-tty-unclear-failure.md](./ux-plan-non-tty-unclear-failure.md) | 199 |
| [ux-plan-output-invalid-validation-good.md](./ux-plan-output-invalid-validation-good.md) | 333 |
| [ux-plan-path-commands-bare-stdout-reconfirmed.md](./ux-plan-path-commands-bare-stdout-reconfirmed.md) | 334 |
| [ux-plan-path-commands-bare-stdout.md](./ux-plan-path-commands-bare-stdout.md) | 335 |
| [ux-plan-question-non-tty-may-hang.md](./ux-plan-question-non-tty-may-hang.md) | 66 |
| [ux-plan-view-json-dumps-full-markdown-content.md](./ux-plan-view-json-dumps-full-markdown-content.md) | 289 |
| [ux-plan-view-vs-markdown-read-not-found-inconsistent.md](./ux-plan-view-vs-markdown-read-not-found-inconsistent.md) | 200 |
| [ux-primary-commands-lack-examples-in-help.md](./ux-primary-commands-lack-examples-in-help.md) | 201 |
| [ux-primary-commands-still-lack-examples.md](./ux-primary-commands-still-lack-examples.md) | 202 |
| [ux-problems-footer-on-every-success.md](./ux-problems-footer-on-every-success.md) | 290 |
| [ux-provider-list-agents-column-incomplete.md](./ux-provider-list-agents-column-incomplete.md) | 203 |
| [ux-provider-login-anthropic-dry-run-good.md](./ux-provider-login-anthropic-dry-run-good.md) | 336 |
| [ux-provider-login-missing-key-system-chrome.md](./ux-provider-login-missing-key-system-chrome.md) | 204 |
| [ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md](./ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md) | 67 |
| [ux-provider-logout-dry-run-unconfigures-agents.md](./ux-provider-logout-dry-run-unconfigures-agents.md) | 68 |
| [ux-provider-logout-poe-dry-run-still-agent-diffs.md](./ux-provider-logout-poe-dry-run-still-agent-diffs.md) | 69 |
| [ux-ralph-experiment-wrong-kind-says-not-found.md](./ux-ralph-experiment-wrong-kind-says-not-found.md) | 205 |
| [ux-ralph-run-plan-kind-says-ralph-doc-not-found.md](./ux-ralph-run-plan-kind-says-ralph-doc-not-found.md) | 70 |
| [ux-raw-commander-invalid-option-choices.md](./ux-raw-commander-invalid-option-choices.md) | 206 |
| [ux-raw-commander-missing-args.md](./ux-raw-commander-missing-args.md) | 207 |
| [ux-readme-features-wrap-but-cli-missing.md](./ux-readme-features-wrap-but-cli-missing.md) | 208 |
| [ux-readme-spawn-omits-mode-for-ci.md](./ux-readme-spawn-omits-mode-for-ci.md) | 71 |
| [ux-reasoning-effort-bogus-silently-ignored.md](./ux-reasoning-effort-bogus-silently-ignored.md) | 72 |
| [ux-reasoning-effort-flag-opaque.md](./ux-reasoning-effort-flag-opaque.md) | 209 |
| [ux-reasoning-effort-flag-silently-ignored-for-some-agents.md](./ux-reasoning-effort-flag-silently-ignored-for-some-agents.md) | 73 |
| [ux-resume-thread-errors-are-agent-raw.md](./ux-resume-thread-errors-are-agent-raw.md) | 210 |
| [ux-resume-thread-invalid-id-agent-raw-error.md](./ux-resume-thread-invalid-id-agent-raw-error.md) | 74 |
| [ux-root-help-footer-npm-run-dev-for-options.md](./ux-root-help-footer-npm-run-dev-for-options.md) | 75 |
| [ux-root-help-usage-line-is-npm-run-dev.md](./ux-root-help-usage-line-is-npm-run-dev.md) | 76 |
| [ux-root-tagline-inconsistent.md](./ux-root-tagline-inconsistent.md) | 337 |
| [ux-runner-sync-and-runtime-invalid-raw-commander.md](./ux-runner-sync-and-runtime-invalid-raw-commander.md) | 211 |
| [ux-runner-sync-without-runtime-silently-accepted.md](./ux-runner-sync-without-runtime-silently-accepted.md) | 212 |
| [ux-runtime-build-host-message-good.md](./ux-runtime-build-host-message-good.md) | 338 |
| [ux-runtime-init-non-tty-poe-no-prompt.md](./ux-runtime-init-non-tty-poe-no-prompt.md) | 77 |
| [ux-runtime-jobs-list-unbounded-opaque-statuses.md](./ux-runtime-jobs-list-unbounded-opaque-statuses.md) | 213 |
| [ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md](./ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md) | 78 |
| [ux-runtime-jobs-show-unknown-suggests-stop.md](./ux-runtime-jobs-show-unknown-suggests-stop.md) | 214 |
| [ux-runtime-jobs-stale-running-zombies.md](./ux-runtime-jobs-stale-running-zombies.md) | 105 |
| [ux-runtime-jobs-stop-lists-many-stale-running.md](./ux-runtime-jobs-stop-lists-many-stale-running.md) | 79 |
| [ux-runtime-missing-deps-good-message-system-chrome.md](./ux-runtime-missing-deps-good-message-system-chrome.md) | 215 |
| [ux-runtime-templates-ls-shows-empty-docker-row.md](./ux-runtime-templates-ls-shows-empty-docker-row.md) | 291 |
| [ux-runtime-templates-ls-unbounded-noise.md](./ux-runtime-templates-ls-unbounded-noise.md) | 292 |
| [ux-sdk-cli-mode-default-mismatch.md](./ux-sdk-cli-mode-default-mismatch.md) | 80 |
| [ux-sdk-getpoeapikey-throws-generic-error.md](./ux-sdk-getpoeapikey-throws-generic-error.md) | 216 |
| [ux-shape-base-url-error-good-message-system-prefix.md](./ux-shape-base-url-error-good-message-system-prefix.md) | 293 |
| [ux-shape-base-url-invalid-validation-good.md](./ux-shape-base-url-invalid-validation-good.md) | 339 |
| [ux-shape-base-url-unknown-shape-lists-exposed-good.md](./ux-shape-base-url-unknown-shape-lists-exposed-good.md) | 340 |
| [ux-skill-and-skills-flags-undocumented-relationship.md](./ux-skill-and-skills-flags-undocumented-relationship.md) | 294 |
| [ux-skill-bridge-failure-lists-paths-good.md](./ux-skill-bridge-failure-lists-paths-good.md) | 341 |
| [ux-skill-bridge-failure-system-chrome.md](./ux-skill-bridge-failure-system-chrome.md) | 217 |
| [ux-skill-configure-goose-writes-dot-agents-skills.md](./ux-skill-configure-goose-writes-dot-agents-skills.md) | 295 |
| [ux-skill-configure-kimi-unsupported-abrupt.md](./ux-skill-configure-kimi-unsupported-abrupt.md) | 218 |
| [ux-skill-configure-yes-defaults-agent-silently.md](./ux-skill-configure-yes-defaults-agent-silently.md) | 219 |
| [ux-skill-install-from-file-works-well.md](./ux-skill-install-from-file-works-well.md) | 342 |
| [ux-skill-install-missing-file-enoent.md](./ux-skill-install-missing-file-enoent.md) | 220 |
| [ux-skill-install-name-and-file-both-required.md](./ux-skill-install-name-and-file-both-required.md) | 221 |
| [ux-skill-memory-absent-from-root-help.md](./ux-skill-memory-absent-from-root-help.md) | 81 |
| [ux-skill-naming-collisions.md](./ux-skill-naming-collisions.md) | 222 |
| [ux-skill-parent-no-next-step-guidance.md](./ux-skill-parent-no-next-step-guidance.md) | 223 |
| [ux-skill-unconfigure-defaults-agent-and-soft-blocks.md](./ux-skill-unconfigure-defaults-agent-and-soft-blocks.md) | 224 |
| [ux-skill-unconfigure-dry-run-path-inconsistent.md](./ux-skill-unconfigure-dry-run-path-inconsistent.md) | 82 |
| [ux-skills-flag-without-value-is-noop-or-unclear.md](./ux-skills-flag-without-value-is-noop-or-unclear.md) | 225 |
| [ux-skip-if-configured-shows-stale-default-model.md](./ux-skip-if-configured-shows-stale-default-model.md) | 83 |
| [ux-skip-if-configured-still-noises-dry-run.md](./ux-skip-if-configured-still-noises-dry-run.md) | 296 |
| [ux-skip-if-configured-still-writes-when-model-differs.md](./ux-skip-if-configured-still-writes-when-model-differs.md) | 226 |
| [ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md](./ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md) | 5 |
| [ux-spawn-advanced-flags-undifferentiated.md](./ux-spawn-advanced-flags-undifferentiated.md) | 227 |
| [ux-spawn-codex-reads-stdin-message-on-tty-less-success.md](./ux-spawn-codex-reads-stdin-message-on-tty-less-success.md) | 228 |
| [ux-spawn-cwd-missing-system-chrome.md](./ux-spawn-cwd-missing-system-chrome.md) | 229 |
| [ux-spawn-detach-ignored-on-failure-path.md](./ux-spawn-detach-ignored-on-failure-path.md) | 230 |
| [ux-spawn-detach-silently-ignored-without-runtime.md](./ux-spawn-detach-silently-ignored-without-runtime.md) | 84 |
| [ux-spawn-gemini-provider-credential-opaque-error.md](./ux-spawn-gemini-provider-credential-opaque-error.md) | 85 |
| [ux-spawn-interactive-non-tty-still-runs.md](./ux-spawn-interactive-non-tty-still-runs.md) | 231 |
| [ux-spawn-interactive-raw-agent-error.md](./ux-spawn-interactive-raw-agent-error.md) | 86 |
| [ux-spawn-interactive-still-uses-stale-model-bare-error.md](./ux-spawn-interactive-still-uses-stale-model-bare-error.md) | 87 |
| [ux-spawn-invalid-mode-validation-good.md](./ux-spawn-invalid-mode-validation-good.md) | 343 |
| [ux-spawn-log-default-redacts-agent-message-good.md](./ux-spawn-log-default-redacts-agent-message-good.md) | 344 |
| [ux-spawn-mode-and-permission-copy.md](./ux-spawn-mode-and-permission-copy.md) | 88 |
| [ux-spawn-no-prompt-system-chrome.md](./ux-spawn-no-prompt-system-chrome.md) | 232 |
| [ux-spawn-poe-agent-crashes-fs-lstat.md](./ux-spawn-poe-agent-crashes-fs-lstat.md) | 6 |
| [ux-spawn-poe-agent-lstat-reconfirmed.md](./ux-spawn-poe-agent-lstat-reconfirmed.md) | 9 |
| [ux-spawn-runtime-docker-error-good-install-hints.md](./ux-spawn-runtime-docker-error-good-install-hints.md) | 345 |
| [ux-spawn-success-still-problems-footer.md](./ux-spawn-success-still-problems-footer.md) | 297 |
| [ux-spawn-validates-mode-before-agent.md](./ux-spawn-validates-mode-before-agent.md) | 233 |
| [ux-stale-configured-model-fails-late.md](./ux-stale-configured-model-fails-late.md) | 89 |
| [ux-success-and-info-share-magenta-glyphs.md](./ux-success-and-info-share-magenta-glyphs.md) | 298 |
| [ux-successful-spawn-still-uses-checkmark-for-agent-text.md](./ux-successful-spawn-still-uses-checkmark-for-agent-text.md) | 234 |
| [ux-superintendent-builder-inspector-toolcraft-help.md](./ux-superintendent-builder-inspector-toolcraft-help.md) | 90 |
| [ux-superintendent-install-already-exists-debug-tease.md](./ux-superintendent-install-already-exists-debug-tease.md) | 91 |
| [ux-superintendent-missing-path-double-error.md](./ux-superintendent-missing-path-double-error.md) | 92 |
| [ux-superintendent-validate-unclosed-tag-opaque.md](./ux-superintendent-validate-unclosed-tag-opaque.md) | 235 |
| [ux-tables-ignore-terminal-width.md](./ux-tables-ignore-terminal-width.md) | 236 |
| [ux-tasks-github-401-raw-json-reconfirmed.md](./ux-tasks-github-401-raw-json-reconfirmed.md) | 93 |
| [ux-tasks-github-auth-raw-error.md](./ux-tasks-github-auth-raw-error.md) | 237 |
| [ux-tasks-verify-format-error-good.md](./ux-tasks-verify-format-error-good.md) | 346 |
| [ux-test-and-install-reject-spawn-only-agents-as-unknown.md](./ux-test-and-install-reject-spawn-only-agents-as-unknown.md) | 94 |
| [ux-test-failure-dumps-jsonl.md](./ux-test-failure-dumps-jsonl.md) | 95 |
| [ux-test-with-valid-model-succeeds.md](./ux-test-with-valid-model-succeeds.md) | 347 |
| [ux-timeout-errors-use-system-chrome.md](./ux-timeout-errors-use-system-chrome.md) | 238 |
| [ux-toolcraft-has-suggestions-poe-code-root-does-not.md](./ux-toolcraft-has-suggestions-poe-code-root-does-not.md) | 239 |
| [ux-toolcraft-heading-doubles-poe-code.md](./ux-toolcraft-heading-doubles-poe-code.md) | 240 |
| [ux-toolcraft-help-points-at-npm-run-dev.md](./ux-toolcraft-help-points-at-npm-run-dev.md) | 96 |
| [ux-toolcraft-suggests-options-but-still-npm-run-dev.md](./ux-toolcraft-suggests-options-but-still-npm-run-dev.md) | 97 |
| [ux-traces-cwd-only-flag-removed-or-renamed.md](./ux-traces-cwd-only-flag-removed-or-renamed.md) | 299 |
| [ux-traces-directory-path-eisdir.md](./ux-traces-directory-path-eisdir.md) | 241 |
| [ux-traces-enoent-eisdir-still-system-errors.md](./ux-traces-enoent-eisdir-still-system-errors.md) | 98 |
| [ux-traces-json-includes-full-prompt-titles.md](./ux-traces-json-includes-full-prompt-titles.md) | 106 |
| [ux-traces-missing-file-system-error.md](./ux-traces-missing-file-system-error.md) | 242 |
| [ux-traces-since-validation-cleaner-than-models.md](./ux-traces-since-validation-cleaner-than-models.md) | 99 |
| [ux-traces-source-invalid-validation-good.md](./ux-traces-source-invalid-validation-good.md) | 348 |
| [ux-unconfigure-help-no-dry-run-or-yes.md](./ux-unconfigure-help-no-dry-run-or-yes.md) | 243 |
| [ux-unconfigure-no-confirmation.md](./ux-unconfigure-no-confirmation.md) | 244 |
| [ux-unconfigure-nonconfigured-agent-still-plans-mutations.md](./ux-unconfigure-nonconfigured-agent-still-plans-mutations.md) | 245 |
| [ux-unknown-agent-no-allow-list-or-suggestions.md](./ux-unknown-agent-no-allow-list-or-suggestions.md) | 100 |
| [ux-update-always-suggests-npm-install-g.md](./ux-update-always-suggests-npm-install-g.md) | 246 |
| [ux-update-package-manager-override-works.md](./ux-update-package-manager-override-works.md) | 349 |
| [ux-usage-balance-presentation-good.md](./ux-usage-balance-presentation-good.md) | 350 |
| [ux-usage-help-hides-default-balance.md](./ux-usage-help-hides-default-balance.md) | 300 |
| [ux-usage-list-filter-works-well.md](./ux-usage-list-filter-works-well.md) | 351 |
| [ux-usage-list-no-json-flag.md](./ux-usage-list-no-json-flag.md) | 247 |
| [ux-usage-pages-invalid-raw-commander.md](./ux-usage-pages-invalid-raw-commander.md) | 248 |
| [ux-user-errors-look-like-system-failures.md](./ux-user-errors-look-like-system-failures.md) | 101 |
| [ux-utils-config-edit-missing-editor-system-chrome.md](./ux-utils-config-edit-missing-editor-system-chrome.md) | 249 |
| [ux-utils-config-init-already-exists-is-info.md](./ux-utils-config-init-already-exists-is-info.md) | 352 |
| [ux-utils-config-path-subcommand-missing.md](./ux-utils-config-path-subcommand-missing.md) | 250 |
| [ux-utils-config-show-dumps-large-json.md](./ux-utils-config-show-dumps-large-json.md) | 251 |
| [ux-utils-symlink-agents-already-linked-good.md](./ux-utils-symlink-agents-already-linked-good.md) | 353 |
| [ux-utils-symlink-skills-both-exist-good-guidance.md](./ux-utils-symlink-skills-both-exist-good-guidance.md) | 354 |
| [ux-utils-symlink-skills-scope-error-vs-agents.md](./ux-utils-symlink-skills-scope-error-vs-agents.md) | 301 |
| [ux-utils-symlink-skills-yes-local-dry-run-works.md](./ux-utils-symlink-skills-yes-local-dry-run-works.md) | 355 |
| [ux-validation-error-still-prints-stack.md](./ux-validation-error-still-prints-stack.md) | 102 |
| [ux-verbose-prefixes-every-log-line.md](./ux-verbose-prefixes-every-log-line.md) | 302 |
| [ux-version-nags-dev-to-major-jump.md](./ux-version-nags-dev-to-major-jump.md) | 252 |
| [ux-version-subcommand-missing-use-flag.md](./ux-version-subcommand-missing-use-flag.md) | 253 |
| [ux-version-update-nag-on-dev-builds.md](./ux-version-update-nag-on-dev-builds.md) | 303 |
| [ux-wide-tables-truncate-critical-cells.md](./ux-wide-tables-truncate-critical-cells.md) | 254 |
| [ux-worktree-reconcile-not-found-system-chrome.md](./ux-worktree-reconcile-not-found-system-chrome.md) | 255 |
| [ux-worktree-reconcile-requires-agent-not-in-error-order.md](./ux-worktree-reconcile-requires-agent-not-in-error-order.md) | 304 |
| [ux-worktree-remove-no-confirmation.md](./ux-worktree-remove-no-confirmation.md) | 256 |
| [ux-worktree-remove-not-found-system-chrome.md](./ux-worktree-remove-not-found-system-chrome.md) | 257 |
| [ux-wrap-dry-run-forwards-flag.md](./ux-wrap-dry-run-forwards-flag.md) | 258 |
| [ux-wrap-resolves-alias-but-dry-run-lies.md](./ux-wrap-resolves-alias-but-dry-run-lies.md) | 259 |

See [AUDIT_STATUS.md](./AUDIT_STATUS.md).
