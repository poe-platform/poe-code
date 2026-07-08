# UX issues — master priority list

**1 = fix first.** Count: **575**. Continuous audit 2026-07-07.

## Master list (1–N)

| # | Status | Severity | Area | Issue | One-line problem |
| ---: | --- | --- | --- | --- | --- |
| 1 | open | **Critical** | Security / dry-run | [ux-dry-run-diffs-print-secrets.md](./ux-dry-run-diffs-print-secrets.md) | Dry-run unconfigure/logout diffs print full API keys & bearer tokens |
| 2 | open | **Critical** | Security / dry-run | [ux-logout-dry-run-still-prints-secrets-reconfirmed.md](./ux-logout-dry-run-still-prints-secrets-reconfirmed.md) | logout --dry-run still prints full API keys and bearer tokens (reconfirmed) |
| 3 | open | **Critical** | Auth / security | [ux-auth-api-key-prints-secret.md](./ux-auth-api-key-prints-secret.md) | `auth api-key` prints full secret to stdout with no mask/opt-in |
| 4 | open | **Critical** | Auth / dry-run | [ux-auth-api-key-dry-run-still-prints-secret.md](./ux-auth-api-key-dry-run-still-prints-secret.md) | `auth api-key --dry-run` still prints full secret |
| 5 | open | **Critical** | Config / models | [ux-constants-source-of-dead-sonnet-5.md](./ux-constants-source-of-dead-sonnet-5.md) | src/cli/constants.ts is the source of dead sonnet-5 defaults |
| 6 | open | **Critical** | Config / models | [ux-frontier-models-only-sonnet-5-is-dead.md](./ux-frontier-models-only-sonnet-5-is-dead.md) | FRONTIER_MODELS only sonnet-5 is dead; others resolve — fix is sonnet-5→4.6 |
| 7 | open | **Critical** | Config / models | [ux-hardcoded-stale-sonnet-5-in-product-defaults.md](./ux-hardcoded-stale-sonnet-5-in-product-defaults.md) | Product defaults hard-code dead `anthropic/claude-sonnet-5` model id |
| 8 | open | **Critical** | Config / models | [ux-configure-yes-dry-run-always-defaults-dead-sonnet-5.md](./ux-configure-yes-dry-run-always-defaults-dead-sonnet-5.md) | configure --yes --dry-run always defaults to dead sonnet-5 |
| 9 | open | **Critical** | Configure / models | [ux-configure-accepts-any-string-as-model-no-catalog-check.md](./ux-configure-accepts-any-string-as-model-no-catalog-check.md) | configure --model accepts any string without catalog validation |
| 10 | open | **Critical** | Config / models | [ux-goose-configure-still-embeds-sonnet-5-in-models-list.md](./ux-goose-configure-still-embeds-sonnet-5-in-models-list.md) | configure goose still embeds dead sonnet-5 in models list even with haiku default |
| 11 | open | **Critical** | Configure / models | [ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md](./ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md) | `--skip-if-configured --yes` rewrote live config to dead sonnet-5 |
| 12 | open | **Critical** | Configure / help | [ux-skip-if-configured-help-text-lies.md](./ux-skip-if-configured-help-text-lies.md) | `--skip-if-configured` help promises no writes but behavior differs |
| 13 | open | **Critical** | Configure / models | [ux-skip-if-configured-dry-run-shows-dead-sonnet-5-default.md](./ux-skip-if-configured-dry-run-shows-dead-sonnet-5-default.md) | skip-if-configured dry-run still shows default model sonnet-5 and full rewrite |
| 14 | open | **Critical** | Spawn / poe-agent | [ux-spawn-poe-agent-crashes-fs-lstat.md](./ux-spawn-poe-agent-crashes-fs-lstat.md) | Advertised `spawn poe-agent` crashes: `fs.lstat is not a function` |
| 15 | open | **Critical** | Plan / destructive | [ux-plan-archive-delete-yes-picks-arbitrary-plan.md](./ux-plan-archive-delete-yes-picks-arbitrary-plan.md) | `plan archive|delete --yes` without path mutates an arbitrary plan |
| 16 | open | **Critical** | Auth / destructive | [ux-logout-overclaims-scope.md](./ux-logout-overclaims-scope.md) | `logout` copy says credentials but factory-resets agents + config |
| 17 | open | **Critical** | Memory | [ux-memory-show-cannot-open-root-index-file.md](./ux-memory-show-cannot-open-root-index-file.md) | memory init creates INDEX.md but show/ls cannot open it |
| 18 | open | **High** | Approvals / recovery | [ux-approval-copy-hardcodes-toolcraft-in-source.md](./ux-approval-copy-hardcodes-toolcraft-in-source.md) | Confirmed packages/toolcraft/src/cli.ts and mcp.ts hardcode toolcraft approvals. |
| 19 | open | **High** | Approvals / recovery | [ux-approval-queued-message-says-toolcraft.md](./ux-approval-queued-message-says-toolcraft.md) | Blocked-flow copy Track toolcraft approvals show id. |
| 20 | open | **High** | Approvals | [ux-approvals-show-missing-says-task-not-found.md](./ux-approvals-show-missing-says-task-not-found.md) | approvals show --approval-id missing returns Task "approvals/missing" not found — task terminology for appr… |
| 21 | open | **High** | Auth / dry-run | [ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md](./ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md) | Reconfirmed Critical: auth api-key --dry-run still emits the full API key (dry-run ignored). |
| 22 | open | **High** | Auth / security | [ux-auth-api-key-help-no-danger-warning.md](./ux-auth-api-key-help-no-danger-warning.md) | Help says only Display stored API key with no mention of masking, --reveal, or secret handling — even thoug… |
| 23 | open | **High** | Auth / security | [ux-auth-api-key-help-still-no-danger-reconfirmed.md](./ux-auth-api-key-help-still-no-danger-reconfirmed.md) | auth api-key --help still only Display stored API key with -h — reconfirm no secret warning. |
| 24 | open | **High** | Auth / destructive | [ux-auth-logout-same-as-logout-help.md](./ux-auth-logout-same-as-logout-help.md) | auth logout help says Remove all configuration and credentials same as root logout — if auth logout is alia… |
| 25 | open | **High** | Code-review / errors | [ux-code-review-drafts-missing-arg-double-error.md](./ux-code-review-drafts-missing-arg-double-error.md) | Missing prUrl shows raw error: missing required argument then design-system error with same text and npm ru… |
| 26 | open | **High** | Code-review | [ux-code-review-run-invalid-url-wrong-error.md](./ux-code-review-run-invalid-url-wrong-error.md) | code-review run "not-a-url" fails with No code-review agent resolved rather than invalid PR URL — validatio… |
| 27 | open | **High** | Configure / models | [ux-configure-accepts-invalid-model-without-validation.md](./ux-configure-accepts-invalid-model-without-validation.md) | configure --model totally-fake-model-xyz --yes --dry-run proceeds to plan writes without validating the mod… |
| 28 | open | **High** | Configure | [ux-configure-base-url-may-be-ignored.md](./ux-configure-base-url-may-be-ignored.md) | configure claude --base-url https://example.com --yes --dry-run still shows ANTHROPIC_BASE_URL api.poe.com … |
| 29 | open | **High** | Dry-run | [ux-configure-codex-dry-run-still-leaks-and-noise.md](./ux-configure-codex-dry-run-still-leaks-and-noise.md) | Reconfirmed: even with explicit --model openai/gpt-5.3-codex, dry-run still dumps large config rewrites (pr… |
| 30 | open | **High** | Dry-run / privacy | [ux-configure-dry-run-dumps-entire-existing-agent-config.md](./ux-configure-dry-run-dumps-entire-existing-agent-config.md) | configure codex --dry-run emits a full rewrite-style diff of the agent config that includes dozens of unrel… |
| 31 | open | **High** | Dry-run | [ux-configure-dry-run-shows-full-existing-settings-as-create.md](./ux-configure-dry-run-shows-full-existing-settings-as-create.md) | configure claude dry-run often shows --- /dev/null +++ settings.json with full 145-line content including e… |
| 32 | open | **High** | Configure / models | [ux-configure-dry-run-writes-stale-model-id.md](./ux-configure-dry-run-writes-stale-model-id.md) | configure --yes --dry-run for claude shows default model anthropic/claude-sonnet-5 and would write model cl… |
| 33 | open | **High** | Help / configure | [ux-configure-help-missing-examples.md](./ux-configure-help-missing-examples.md) | configure --help lists options including skip-if-configured but no Examples (contrast models). |
| 34 | open | **High** | Configure / models | [ux-configure-model-alias-sonnet-haiku-written-literally.md](./ux-configure-model-alias-sonnet-haiku-written-literally.md) | configure claude --model sonnet or haiku dry-run writes model: "sonnet" / "haiku" instead of resolving CLAU… |
| 35 | open | **High** | Configure / non-TTY | [ux-configure-non-tty-demands-poe-no-prompt-not-yes.md](./ux-configure-non-tty-demands-poe-no-prompt-not-yes.md) | configure claude without --yes in non-TTY: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — --yes w… |
| 36 | open | **High** | Configure / models | [ux-configure-reasoning-effort-ignored-for-claude.md](./ux-configure-reasoning-effort-ignored-for-claude.md) | configure claude --model opus-4.7 --reasoning-effort low --yes --dry-run still plans effortLevel xhigh — fl… |
| 37 | open | **High** | Spawn / runtime | [ux-detach-runtime-host-still-inline.md](./ux-detach-runtime-host-still-inline.md) | spawn … --detach --runtime host still prints ✓ agent and Resume line like normal spawn — no detached job id… |
| 38 | open | **High** | Spawn / runtime | [ux-detach-without-runtime-still-inline-reconfirmed.md](./ux-detach-without-runtime-still-inline-reconfirmed.md) | spawn … --detach without --runtime host/docker/e2b still runs inline with ✓ agent and Resume — no job id (r… |
| 39 | open | **High** | Help / identity | [ux-development-mode-usage-intentional-but-leaks.md](./ux-development-mode-usage-intentional-but-leaks.md) | execution-context maps development to npm run dev -- leaking into all help/errors. |
| 40 | open | **High** | Help | [ux-dual-help-systems.md](./ux-dual-help-systems.md) | Commander vs toolcraft help completely different UIs. |
| 41 | open | **High** | Configure / models | [ux-effort-xhigh-valid-for-opus-not-sonnet.md](./ux-effort-xhigh-valid-for-opus-not-sonnet.md) | Catalog: opus-4.7 output_effort includes xhigh; sonnet-4.6 does not. configure always writes xhigh regardle… |
| 42 | open | **High** | Configure / flags | [ux-empty-api-key-flag-still-silently-ignored.md](./ux-empty-api-key-flag-still-silently-ignored.md) | configure … --api-key "" --yes --dry-run still plans config with existing Bearer (redacted) — empty explici… |
| 43 | open | **High** | Auth / configure | [ux-empty-api-key-login-good-but-configure-ignores.md](./ux-empty-api-key-login-good-but-configure-ignores.md) | login --api-key "" / " " correctly rejects POE API key cannot be empty. configure --api-key "" --yes --dry-… |
| 44 | open | **High** | Models / flags | [ux-empty-model-flag-behavior-inconsistent.md](./ux-empty-model-flag-behavior-inconsistent.md) | --model "" on agent fails with Missing model (good-ish); on spawn falls through to stale configured model a… |
| 45 | open | **High** | Errors / design system | [ux-error-panel-closes-before-error.md](./ux-error-panel-closes-before-error.md) | finalize Problems? then detached error. |
| 46 | open | **High** | Eval | [ux-eval-check-fails-on-placeholder-target-git-remote.md](./ux-eval-check-fails-on-placeholder-target-git-remote.md) | eval init then eval check clones a placeholder target and fails: git: remote-helper git+https aborted — sca… |
| 47 | open | **High** | Eval / identity | [ux-eval-report-invalid-format-npm-run-dev.md](./ux-eval-report-invalid-format-npm-run-dev.md) | Invalid --format bogus returns Expected one of: json, md, table with Run npm run dev -- eval report --help … |
| 48 | open | **High** | Install / consistency | [ux-experiment-install-already-exists-vs-pipeline-skip.md](./ux-experiment-install-already-exists-vs-pipeline-skip.md) | experiment install when skill exists hard-errors Skill already exists; pipeline install --dry-run skips exi… |
| 49 | open | **High** | Experiment / install | [ux-experiment-install-force-does-not-overwrite-skill.md](./ux-experiment-install-force-does-not-overwrite-skill.md) | experiment install --agent claude --local --force still: Skill already exists … See logs — --force document… |
| 50 | open | **High** | Experiment / install | [ux-experiment-install-force-does-not-overwrite.md](./ux-experiment-install-force-does-not-overwrite.md) | experiment install --local --force still fails Skill already exists — --force does not overwrite despite he… |
| 51 | open | **High** | Experiment | [ux-experiment-journal-wrong-kind-says-not-found.md](./ux-experiment-journal-wrong-kind-says-not-found.md) | experiment journal docs/plans/32-agent-goal.md (kind: plan) says Experiment doc not found rather than wrong… |
| 52 | open | **High** | Experiment / Ralph | [ux-experiment-ralph-no-doc-wrong-message.md](./ux-experiment-ralph-no-doc-wrong-message.md) | experiment validate/journal and ralph run without doc say No markdown doc found under docs/plans. Provide a… |
| 53 | open | **High** | Experiment / kind errors | [ux-experiment-validate-wrong-kind-says-not-found.md](./ux-experiment-validate-wrong-kind-says-not-found.md) | experiment validate on agent-goal plan and pipeline plan both: Experiment doc not found — wrong kind, not m… |
| 54 | open | **High** | Package / bins | [ux-extra-npm-bins-still-published-reconfirmed.md](./ux-extra-npm-bins-still-published-reconfirmed.md) | package.json bin still includes poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test… |
| 55 | open | **High** | Packaging | [ux-extra-npm-bins-still-shipped.md](./ux-extra-npm-bins-still-shipped.md) | Root package.json bin still includes poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth… |
| 56 | open | **High** | Pipeline / trust | [ux-failure-shown-as-success-markers.md](./ux-failure-shown-as-success-markers.md) | Pipeline/gaslight use ✓ next to API errors. |
| 57 | open | **High** | Gaslight | [ux-gaslight-ingest-failure-dumps-jsonl.md](./ux-gaslight-ingest-failure-dumps-jsonl.md) | Ingest analysis failure JSONL after Analyzed N prompts. |
| 58 | open | **High** | Gaslight | [ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md](./ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md) | gaslight ingest --dry-run is unknown (falls through to gaslight Interactive prompt requires TTY / POE_NO_PR… |
| 59 | open | **High** | Gaslight | [ux-gaslight-no-plan-autopicks-and-hits-stale-model.md](./ux-gaslight-no-plan-autopicks-and-hits-stale-model.md) | gaslight --yes without plan-path autopicks a plan (e.g. 15-spawn-hooks.md) and fails on dead default model … |
| 60 | open | **High** | Gaslight | [ux-gaslight-plan-path-starts-implement-without-confirm.md](./ux-gaslight-plan-path-starts-implement-without-confirm.md) | gaslight docs/plans/32-agent-goal.md --mode read --yes begins Prompt: Implement <path> and agent starts exp… |
| 61 | open | **High** | Spawn / gemini | [ux-gemini-still-provider-credential-after-configure-dry-run.md](./ux-gemini-still-provider-credential-after-configure-dry-run.md) | configure gemini --dry-run plans quiet success; spawn gemini still Cannot resolve providerCredential — reco… |
| 62 | open | **High** | Spawn / github | [ux-github-cwd-clone-errors-still-raw-git.md](./ux-github-cwd-clone-errors-still-raw-git.md) | Invalid github://owner/repo still dumps Cloning into… ERROR: Repository not found fatal… See logs — reconfi… |
| 63 | open | **High** | Hooks / spawn | [ux-hooks-auto-strategy-still-refuses-user-settings.md](./ux-hooks-auto-strategy-still-refuses-user-settings.md) | --hooks-from claude-code --hooks-strategy auto fails same Refuse to replace user-authored hook file — auto … |
| 64 | open | **High** | Hooks / spawn | [ux-hooks-from-codex-to-claude-transform-unsupported.md](./ux-hooks-from-codex-to-claude-transform-unsupported.md) | spawn --hooks-from codex fails Transforming hooks from "codex" is not supported yet — help allows --hooks-f… |
| 65 | open | **High** | Hooks / spawn | [ux-hooks-from-spawn-poe-code-enoent.md](./ux-hooks-from-spawn-poe-code-enoent.md) | test/spawn with --hooks-from may exec poe-code not on PATH (tsx entry), opaque ENOENT. |
| 66 | open | **High** | Hooks / spawn | [ux-hooks-strategy-symlink-refuses-user-settings.md](./ux-hooks-strategy-symlink-refuses-user-settings.md) | spawn with --hooks-from claude-code --hooks-strategy symlink fails Refuse to replace user-authored hook fil… |
| 67 | open | **High** | Hooks / spawn | [ux-hooks-strategy-transform-unsupported-opaque.md](./ux-hooks-strategy-transform-unsupported-opaque.md) | Transforming hooks to claude-code is not supported yet is informative but still Error + See logs; help list… |
| 68 | open | **High** | Agents | [ux-inconsistent-agent-surface-across-commands.md](./ux-inconsistent-agent-surface-across-commands.md) | configure/wrap/spawn/skill different agent unions. |
| 69 | open | **High** | Install / non-TTY | [ux-install-non-tty-demands-poe-no-prompt-not-yes.md](./ux-install-non-tty-demands-poe-no-prompt-not-yes.md) | install without agent in non-TTY: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — --yes should sel… |
| 70 | open | **High** | Install / capability matrix | [ux-install-pi-unknown-not-in-installable-list.md](./ux-install-pi-unknown-not-in-installable-list.md) | install pi → Unknown agent; pi is spawnable but not in install agent list — capability matrix gap (related … |
| 71 | open | **High** | Skills / consistency | [ux-install-skill-flags-inconsistent-across-commands.md](./ux-install-skill-flags-inconsistent-across-commands.md) | Skill-related install commands use inconsistent flag sets: skill install has --local/--global/--yes; memory… |
| 72 | open | **High** | Install | [ux-install-yes-silently-defaults-to-claude.md](./ux-install-yes-silently-defaults-to-claude.md) | install without agent non-TTY fails POE_NO_PROMPT; install --yes without agent installs Claude Code with su… |
| 73 | open | **High** | Launch | [ux-launch-start-claims-running-then-status-stopped.md](./ux-launch-start-claims-running-then-status-stopped.md) | launch start sleepjob -- sleep 30 prints Managed process sleepjob is running. Immediately launch status sho… |
| 74 | open | **High** | Launch / identity | [ux-launch-start-dumps-turbo-build.md](./ux-launch-start-dumps-turbo-build.md) | launch start prints full turbo Packages in scope … FULL TURBO before Managed process is running — monorepo … |
| 75 | open | **High** | Launch | [ux-launch-start-success-then-status-shows-stopped.md](./ux-launch-start-success-then-status-shows-stopped.md) | launch start uxsleep2 -- sleep 30 prints Managed process uxsleep2 is running then turbo noise; immediate la… |
| 76 | open | **High** | Launch | [ux-launch-start-triggers-turbo-noise-and-opaque-failure.md](./ux-launch-start-triggers-turbo-noise-and-opaque-failure.md) | launch start foo -- echo hi (and without --) prints full turbo monorepo build output then Managed process f… |
| 77 | open | **High** | Launch | [ux-launch-status-blank-id-zombie-rows.md](./ux-launch-status-blank-id-zombie-rows.md) | After launch rm, status still lists rows with ID - STATUS stopped — registry not cleaned; table fills with … |
| 78 | open | **High** | Launch | [ux-launch-status-crashes-on-tombstone-dirs.md](./ux-launch-status-crashes-on-tombstone-dirs.md) | After launch rm, tombstone dirs named .state-removed-<id>-<uuid> can cause subsequent launch status/start/s… |
| 79 | open | **High** | Launch | [ux-launch-status-shows-dash-id-ghost-rows.md](./ux-launch-status-shows-dash-id-ghost-rows.md) | After failed/removed processes, launch status may show a table row with ID "-", STATUS stopped, empty metri… |
| 80 | open | **High** | Spawn / logging | [ux-log-dir-unwritable-silently-ignored.md](./ux-log-dir-unwritable-silently-ignored.md) | spawn with --log-dir /no/perm/dir still succeeds without warning that logs were not written. |
| 81 | open | **High** | Auth / CI | [ux-login-non-tty-hangs-on-oauth.md](./ux-login-non-tty-hangs-on-oauth.md) | Bare login starts OAuth wait forever without TTY. |
| 82 | open | **High** | Auth / non-TTY | [ux-login-non-tty-hangs-reconfirmed.md](./ux-login-non-tty-hangs-reconfirmed.md) | login without --api-key in non-TTY hung past 45s — reconfirm login-non-tty-hangs-on-oauth rather than fail-… |
| 83 | open | **High** | Logout / dry-run | [ux-logout-dry-run-multi-panel-noise.md](./ux-logout-dry-run-multi-panel-noise.md) | Logout dry-run floods diffs, multiple footers, and can print secrets. |
| 84 | open | **High** | Logout / dry-run | [ux-logout-dry-run-still-multi-panel-unconfigure.md](./ux-logout-dry-run-still-multi-panel-unconfigure.md) | logout --dry-run still nests Poe - unconfigure goose panels and large config dumps — factory-reset dry-run … |
| 85 | open | **High** | Auth / destructive | [ux-logout-help-no-danger-or-scope-detail.md](./ux-logout-help-no-danger-or-scope-detail.md) | logout help only says Remove all configuration and credentials with no file list, agent impact, or confirma… |
| 86 | open | **High** | Maestro | [ux-maestro-dry-run-hits-github-401-reconfirmed.md](./ux-maestro-dry-run-hits-github-401-reconfirmed.md) | maestro --dry-run without valid WORKFLOW/auth: GitHub GraphQL 401 raw JSON — dry-run still network-calls Gi… |
| 87 | open | **High** | Maestro | [ux-maestro-dry-run-path-vs-flag-confusion.md](./ux-maestro-dry-run-path-vs-flag-confusion.md) | `maestro dry-run` treats dry-run as a WORKFLOW.md path (Missing workflow file …/dry-run). `maestro --dry-ru… |
| 88 | open | **High** | Maestro | [ux-maestro-run-dry-run-still-hits-github-401.md](./ux-maestro-run-dry-run-still-hits-github-401.md) | maestro run --dry-run --yes still performs GitHub GraphQL and dumps 401 Bad credentials JSON — dry-run is n… |
| 89 | open | **High** | Memory | [ux-memory-agent-commands-invalid-json-opaque.md](./ux-memory-agent-commands-invalid-json-opaque.md) | memory explain and memory query fail with Memory agent returned invalid JSON output + See logs — no agent s… |
| 90 | open | **High** | Memory | [ux-memory-explain-invalid-json-system-chrome.md](./ux-memory-explain-invalid-json-system-chrome.md) | memory explain pages/hello.md: Memory agent returned invalid JSON output + See logs — agent failure unframed. |
| 91 | open | **High** | Memory | [ux-memory-show-index-not-found-after-init.md](./ux-memory-show-index-not-found-after-init.md) | memory init succeeds; memory show INDEX.md → Page not found: INDEX.md — init claims INDEX.md/LOG.md but sho… |
| 92 | open | **High** | Models / errors | [ux-models-endpoint-invalid-good-list-but-stack.md](./ux-models-endpoint-invalid-good-list-but-stack.md) | Unsupported endpoint message lists Available endpoints (good) but still ERROR log + ValidationError stack —… |
| 93 | open | **High** | Models | [ux-models-exact-id-filter-rejects-namespaced-ids.md](./ux-models-exact-id-filter-rejects-namespaced-ids.md) | models --model anthropic/claude-opus-4.7 returns 0/341 while --model claude-opus-4.7 and --search opus-4.7 … |
| 94 | open | **High** | Models | [ux-models-model-flag-rejects-namespaced-ids.md](./ux-models-model-flag-rejects-namespaced-ids.md) | models --model anthropic/claude-haiku-4.5 → 0/341; models --model claude-haiku-4.5 → 1 hit. Help says exact… |
| 95 | open | **High** | Models | [ux-models-output-json-search-returns-empty-inconsistently.md](./ux-models-output-json-search-returns-empty-inconsistently.md) | models --output json silently empties results (invalid modality, not format) |
| 96 | open | **High** | Config / models | [ux-models-search-confirms-sonnet-5-absent-from-catalog.md](./ux-models-search-confirms-sonnet-5-absent-from-catalog.md) | Live catalog has no sonnet-5 (`models --search sonnet-5` → 0/341) while product defaults still reference it… |
| 97 | open | **High** | Errors | [ux-models-since-validation-still-prints-stack.md](./ux-models-since-validation-still-prints-stack.md) | Invalid --since still dumps ERROR log + ValidationError stack + design-system error — reconfirm of validati… |
| 98 | open | **High** | Interactive / CI | [ux-non-tty-prompt-wrong-guidance.md](./ux-non-tty-prompt-wrong-guidance.md) | Error says POE_NO_PROMPT=1; product contract is --yes. |
| 99 | open | **High** | Safety copy | [ux-permission-mode-sets-differ-across-commands.md](./ux-permission-mode-sets-differ-across-commands.md) | spawn: yolo/auto/edit/read; gaslight: read/edit/yolo/auto with default auto; harness: read/edit/auto/yolo; … |
| 100 | open | **High** | Agents | [ux-pi-spawnable-but-not-configurable.md](./ux-pi-spawnable-but-not-configurable.md) | pi on spawn help; configure pi unknown; spawn works. |
| 101 | open | **High** | Pipeline / install | [ux-pipeline-install-force-skips-skill-overwrites-steps.md](./ux-pipeline-install-force-skips-skill-overwrites-steps.md) | pipeline install --agent claude --local --force: Overwrite steps.yaml; Skip skill already exists — --force … |
| 102 | open | **High** | Pipeline / install | [ux-pipeline-install-force-skips-skill-still.md](./ux-pipeline-install-force-skips-skill-still.md) | pipeline install --local --force overwrites steps.yaml but Skip: skill already exists — --force partial; sk… |
| 103 | open | **High** | Pipeline | [ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md](./ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md) | --task foo --yes picks some plan, shows 21/21 done, then task not found. |
| 104 | open | **High** | Plan / destructive | [ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md](./ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md) | plan archive and delete --help still only path, --kind, --output, -h — no --yes, no warning that --yes with… |
| 105 | open | **High** | Plan / destructive | [ux-plan-archive-help-omits-yes-behavior.md](./ux-plan-archive-help-omits-yes-behavior.md) | plan archive help shows optional path and --kind/--output but does not document non-TTY selection requiring… |
| 106 | open | **High** | Plan / destructive | [ux-plan-archive-json-skips-without-explaining-why.md](./ux-plan-archive-json-skips-without-explaining-why.md) | plan archive docs/plans/README.md --output json returns skipped:true, confirmationRequired:true without exp… |
| 107 | open | **High** | Plan / non-TTY | [ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md](./ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md) | plan browse without TTY dumps full body of some plan (toolcraft human-in-loop…) without path or picker — no… |
| 108 | open | **High** | Plan / non-TTY | [ux-plan-browse-non-tty-dumps-plan-body.md](./ux-plan-browse-non-tty-dumps-plan-body.md) | plan browse without TTY dumps a full plan markdown body (looks like plan view of first plan) rather than Va… |
| 109 | open | **High** | Plan / destructive | [ux-plan-delete-allows-readme.md](./ux-plan-delete-allows-readme.md) | plan delete dry-run accepts docs/plans/README.md. |
| 110 | open | **High** | Plan / destructive | [ux-plan-delete-json-skips-without-reason.md](./ux-plan-delete-json-skips-without-reason.md) | plan delete docs/plans/README.md --output json returns skipped:true without reason field — same opacity as … |
| 111 | open | **High** | Plan / editor | [ux-plan-edit-hangs-without-editor.md](./ux-plan-edit-hangs-without-editor.md) | plan edit without EDITOR/VISUAL can hang or fail to return a clear ValidationError within a short time (obs… |
| 112 | open | **High** | Plan / non-TTY | [ux-plan-question-non-tty-may-hang.md](./ux-plan-question-non-tty-may-hang.md) | poe-code plan "improve tests" --yes in non-TTY can hang past 60s rather than ValidationError requiring TTY … |
| 113 | open | **High** | Plan / non-TTY | [ux-plan-root-non-tty-dumps-arbitrary-body.md](./ux-plan-root-non-tty-dumps-arbitrary-body.md) | poe-code plan without question/subcommand in non-TTY dumps full body of some plan (same as browse) — not a … |
| 114 | open | **High** | Auth / providers | [ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md](./ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md) | auth status reports Logged in as … but provider login poe --yes says No API key found and points to --api-k… |
| 115 | open | **High** | Provider / dry-run | [ux-provider-logout-dry-run-unconfigures-agents.md](./ux-provider-logout-dry-run-unconfigures-agents.md) | provider logout dry-run walks agent unconfigure not just credentials. |
| 116 | open | **High** | Providers / dry-run | [ux-provider-logout-poe-dry-run-still-agent-diffs.md](./ux-provider-logout-poe-dry-run-still-agent-diffs.md) | provider logout poe --dry-run still emits large agent settings diffs (claude plugins, effortLevel, etc.) an… |
| 117 | open | **High** | Ralph | [ux-ralph-init-plan-says-not-found.md](./ux-ralph-init-plan-says-not-found.md) | ralph init docs/plans/32-agent-goal.md --dry-run: Ralph doc not found — file exists; ralph requires prior r… |
| 118 | open | **High** | Ralph | [ux-ralph-init-requires-existing-ralph-doc-circular.md](./ux-ralph-init-requires-existing-ralph-doc-circular.md) | ralph init docs/plans/32-agent-goal.md says Ralph doc not found — init cannot bootstrap a plan into ralph k… |
| 119 | open | **High** | Ralph | [ux-ralph-run-plan-kind-says-ralph-doc-not-found.md](./ux-ralph-run-plan-kind-says-ralph-doc-not-found.md) | ralph run docs/plans/32-agent-goal.md (kind: plan) says Ralph doc not found — same wrong-kind-as-missing pa… |
| 120 | open | **High** | Ralph | [ux-ralph-run-plan-says-not-found-reconfirmed.md](./ux-ralph-run-plan-says-not-found-reconfirmed.md) | ralph run docs/plans/32-agent-goal.md --yes: Ralph doc not found — same wrong-kind class as ralph init. |
| 121 | open | **High** | Docs / CI | [ux-readme-spawn-omits-mode-for-ci.md](./ux-readme-spawn-omits-mode-for-ci.md) | README CI spawn one-liners omit --mode/--yes; fail non-interactively. |
| 122 | open | **High** | Configure | [ux-reasoning-effort-bogus-silently-ignored.md](./ux-reasoning-effort-bogus-silently-ignored.md) | configure claude --reasoning-effort bogus --yes --dry-run still plans effortLevel xhigh without rejecting u… |
| 123 | open | **High** | Configure | [ux-reasoning-effort-flag-silently-ignored-for-some-agents.md](./ux-reasoning-effort-flag-silently-ignored-for-some-agents.md) | configure claude --reasoning-effort low/medium/max --yes --dry-run still plans effortLevel xhigh (or does n… |
| 124 | open | **High** | Configure | [ux-reasoning-effort-high-still-writes-xhigh.md](./ux-reasoning-effort-high-still-writes-xhigh.md) | configure claude --reasoning-effort high --model sonnet-4.6 --yes --dry-run still shows effortLevel xhigh —… |
| 125 | open | **High** | Spawn / resume | [ux-resume-thread-invalid-id-agent-raw-error.md](./ux-resume-thread-invalid-id-agent-raw-error.md) | Invalid resume id fails with Claude Code spawn failed … Error: --resume requires a valid session ID… Usage:… |
| 126 | open | **High** | Help / identity | [ux-root-help-footer-npm-run-dev-for-options.md](./ux-root-help-footer-npm-run-dev-for-options.md) | Footer: Run npm run dev -- <command> --help. |
| 127 | open | **High** | Help / identity | [ux-root-help-footer-still-npm-run-dev.md](./ux-root-help-footer-still-npm-run-dev.md) | Root help ends with Run npm run dev -- <command> --help for command options — reconfirm development-mode id… |
| 128 | open | **High** | Help / discoverability | [ux-root-help-lists-19-commands-hides-more.md](./ux-root-help-lists-19-commands-hides-more.md) | Root help shows ~19 top-level commands; skill, memory, provider, runtime, launch, worktree, utils, braintru… |
| 129 | open | **High** | Help / discoverability | [ux-root-help-still-hides-skill-memory.md](./ux-root-help-still-hides-skill-memory.md) | Root help includes plan and gaslight but skill and memory remain absent — reconfirm discoverability gap. |
| 130 | open | **High** | Help / identity | [ux-root-help-usage-line-is-npm-run-dev.md](./ux-root-help-usage-line-is-npm-run-dev.md) | Root help Usage: npm run dev -- <command>. |
| 131 | open | **High** | Help / identity | [ux-root-help-usage-still-npm-run-dev-reconfirmed.md](./ux-root-help-usage-still-npm-run-dev-reconfirmed.md) | Root help Usage: npm run dev -- <command> [...args] — reconfirm development-mode identity when run via tsx. |
| 132 | open | **High** | Help / discoverability | [ux-root-typo-still-no-suggestions-reconfirmed.md](./ux-root-typo-still-no-suggestions-reconfirmed.md) | confgure and spaen → Unknown command with npm run dev help — no Did you mean configure/spawn. |
| 133 | open | **High** | Help / suggestions | [ux-root-typos-no-did-you-mean-configure-spawn.md](./ux-root-typos-no-did-you-mean-configure-spawn.md) | Unknown command confgure and spwn show only Run npm run dev -- --help without Did you mean configure/spawn … |
| 134 | open | **High** | Runtime / non-TTY | [ux-runtime-init-non-tty-poe-no-prompt.md](./ux-runtime-init-non-tty-poe-no-prompt.md) | runtime init without TTY says Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — obscure env vs stand… |
| 135 | open | **High** | Runtime jobs | [ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md](./ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md) | runtime jobs logs without jobId errors with More than one … Pass a job id and lists many jobs including run… |
| 136 | open | **High** | Runtime jobs | [ux-runtime-jobs-ls-unbounded-stale-from-may.md](./ux-runtime-jobs-ls-unbounded-stale-from-may.md) | runtime jobs ls shows huge table including pending e2b jobs and exited host jobs from 2026-05-04 with no --… |
| 137 | open | **High** | Runtime jobs | [ux-runtime-jobs-stop-lists-many-stale-running.md](./ux-runtime-jobs-stop-lists-many-stale-running.md) | runtime jobs stop/attach without job id lists dozens of "running" jobs dating back weeks — zombie job state… |
| 138 | open | **High** | Runtime | [ux-runtime-templates-clear-no-yes-or-dry-run.md](./ux-runtime-templates-clear-no-yes-or-dry-run.md) | runtime templates clear --help only -h; non-TTY requires POE_NO_PROMPT; no dry-run of what will be deleted … |
| 139 | open | **High** | Runtime / non-TTY | [ux-runtime-templates-clear-poe-no-prompt-not-yes.md](./ux-runtime-templates-clear-poe-no-prompt-not-yes.md) | runtime templates clear without --yes: Interactive prompt requires TTY. Set POE_NO_PROMPT=1 — --yes works w… |
| 140 | open | **High** | Runtime | [ux-runtime-templates-ls-unbounded-stale.md](./ux-runtime-templates-ls-unbounded-stale.md) | runtime templates ls shows many e2b template cache rows from 2026-05-04 with no --limit — same unbounded hi… |
| 141 | open | **High** | SDK / safety | [ux-sdk-cli-mode-default-mismatch.md](./ux-sdk-cli-mode-default-mismatch.md) | SDK defaults mode to yolo; CLI spawn prompts/--yes yolo; gaslight defaults auto. |
| 142 | open | **High** | Skills | [ux-skill-configure-exists-system-chrome.md](./ux-skill-configure-exists-system-chrome.md) | skill configure claude-code --yes (global default) fails Skill already exists: ~/.claude/skills/poe-generat… |
| 143 | open | **High** | Help / discoverability | [ux-skill-help-hides-from-root-reconfirmed.md](./ux-skill-help-hides-from-root-reconfirmed.md) | Skill group works when invoked but remains absent from root help command list — reconfirm discoverability. |
| 144 | open | **High** | Help / discoverability | [ux-skill-memory-absent-from-root-help.md](./ux-skill-memory-absent-from-root-help.md) | Root --help does not list skill or memory though both exist as parent commands — reaffirm important-command… |
| 145 | open | **High** | Skills / discoverability | [ux-skill-no-list-or-bridge-subcommands.md](./ux-skill-no-list-or-bridge-subcommands.md) | skill list and skill bridge are Unknown command — skill only install/configure/unconfigure. Users cannot li… |
| 146 | open | **High** | Skills | [ux-skill-unconfigure-dry-run-path-inconsistent.md](./ux-skill-unconfigure-dry-run-path-inconsistent.md) | skill unconfigure claude-code --local --yes --dry-run says Would remove skills directory ~/.claude/skills A… |
| 147 | open | **High** | Configure | [ux-skip-if-configured-dry-run-still-plans-full-rewrite.md](./ux-skip-if-configured-dry-run-still-plans-full-rewrite.md) | Even with matching model and --skip-if-configured --dry-run, configure still emits full create settings.jso… |
| 148 | open | **High** | Configure / models | [ux-skip-if-configured-shows-stale-default-model.md](./ux-skip-if-configured-shows-stale-default-model.md) | Already-configured path prints anthropic/claude-sonnet-5 as default model though API rejects it. |
| 149 | open | **High** | Configure / models | [ux-sonnet-4-6-output-effort-has-no-xhigh.md](./ux-sonnet-4-6-output-effort-has-no-xhigh.md) | models --view parameters --model claude-sonnet-4.6 shows output_effort enum max, high, medium, low, none (d… |
| 150 | open | **High** | Config / models | [ux-sonnet-5-still-absent-from-catalog.md](./ux-sonnet-5-still-absent-from-catalog.md) | Reconfirmed: models --search sonnet-5 → 0/341 while product defaults still reference it. |
| 151 | open | **High** | Spawn / runtime | [ux-spawn-detach-silently-ignored-without-runtime.md](./ux-spawn-detach-silently-ignored-without-runtime.md) | spawn … --detach without --runtime still runs the agent inline and succeeds; no warning that detach require… |
| 152 | open | **High** | Spawn / gemini | [ux-spawn-gemini-provider-credential-opaque-error.md](./ux-spawn-gemini-provider-credential-opaque-error.md) | spawn gemini with an explicit model can fail with Cannot resolve "providerCredential": no active provider o… |
| 153 | open | **High** | Help / spawn | [ux-spawn-help-still-no-examples.md](./ux-spawn-help-still-no-examples.md) | spawn --help lists many advanced flags but no Examples for common flows (read mode one-shot, @file, --yes). |
| 154 | open | **High** | Spawn / interactive | [ux-spawn-interactive-raw-agent-error.md](./ux-spawn-interactive-raw-agent-error.md) | Interactive spawn without prompt/TTY surfaces raw agent-native --print error outside design system. |
| 155 | open | **High** | Spawn / interactive | [ux-spawn-interactive-still-uses-stale-model-bare-error.md](./ux-spawn-interactive-still-uses-stale-model-bare-error.md) | Even with prompt and -i, non-TTY spawn can surface bare API Error: 400 Unsupported model without design-sys… |
| 156 | open | **High** | Spawn / errors | [ux-spawn-invalid-model-shows-success-then-failure.md](./ux-spawn-invalid-model-shows-success-then-failure.md) | spawn with --model does-not-exist-xyz prints ✓ agent: API Error: 400 Unsupported model and ✓ tokens then Er… |
| 157 | open | **High** | Spawn / kimi | [ux-spawn-kimi-not-configured-yes-message.md](./ux-spawn-kimi-not-configured-yes-message.md) | spawn kimi without configure: Kimi is not configured via poe. Pass --yes to proceed without prompting — unc… |
| 158 | open | **High** | Safety copy | [ux-spawn-mode-and-permission-copy.md](./ux-spawn-mode-and-permission-copy.md) | Modes minimal definition; --yes uses yolo buried; order differs spawn vs gaslight. |
| 159 | open | **High** | Spawn / poe-agent | [ux-spawn-poe-agent-lstat-reconfirmed.md](./ux-spawn-poe-agent-lstat-reconfirmed.md) | Live reconfirm: spawn poe-agent "hi" --mode read → fs.lstat is not a function + See logs. |
| 160 | open | **High** | Spawn / safety | [ux-spawn-yes-defaults-to-yolo-mode.md](./ux-spawn-yes-defaults-to-yolo-mode.md) | spawn --yes without --mode runs successfully (uses yolo per help). Help documents --yes uses yolo — good if… |
| 161 | open | **High** | Config / models | [ux-stale-configured-model-fails-late.md](./ux-stale-configured-model-fails-late.md) | Invalid configured model ids only fail mid gaslight/pipeline with API 400 and success checkmarks. |
| 162 | open | **High** | Superintendent / identity | [ux-superintendent-builder-inspector-toolcraft-help.md](./ux-superintendent-builder-inspector-toolcraft-help.md) | superintendent builder and inspector --help show Usage: npm run dev -- superintendent builder… — dual help … |
| 163 | open | **High** | Superintendent / install | [ux-superintendent-install-already-exists-debug-tease.md](./ux-superintendent-install-already-exists-debug-tease.md) | superintendent install when skill exists: Skill already exists … Use --debug for a stack trace — toolcraft … |
| 164 | open | **High** | Install / flags | [ux-superintendent-install-scope-vs-local-global.md](./ux-superintendent-install-scope-vs-local-global.md) | superintendent install --scope local/global (npm run dev help); experiment/pipeline use --local/--global — … |
| 165 | open | **High** | Superintendent / errors | [ux-superintendent-missing-path-double-error.md](./ux-superintendent-missing-path-double-error.md) | superintendent validate and complete without path print raw Commander missing required argument then design… |
| 166 | open | **High** | Superintendent / kind errors | [ux-superintendent-validate-unclosed-tag.md](./ux-superintendent-validate-unclosed-tag.md) | superintendent validate docs/plans/32-agent-goal.md → Superintendent document is invalid (1 error): Unclose… |
| 167 | open | **High** | Tasks / GitHub | [ux-tasks-get-github-401-raw-json.md](./ux-tasks-get-github-401-raw-json.md) | tasks get missing-id fails with raw GitHub GraphQL 401 JSON Bad credentials — unframed auth error. |
| 168 | open | **High** | Tasks | [ux-tasks-github-401-raw-json-reconfirmed.md](./ux-tasks-github-401-raw-json-reconfirmed.md) | tasks get/next without valid GitHub auth dump [error] GitHub GraphQL request failed with status 401: { json… |
| 169 | open | **High** | Tasks / destructive | [ux-tasks-import-delete-source-dangerous.md](./ux-tasks-import-delete-source-dangerous.md) | tasks import has --delete-source to delete markdown after import and --keep — help does not emphasize irrev… |
| 170 | open | **High** | Tasks / destructive | [ux-tasks-move-delete-source-dangerous.md](./ux-tasks-move-delete-source-dangerous.md) | tasks move has --delete-source without documenting --yes requirement or irreversibility (same class as impo… |
| 171 | open | **High** | Agents | [ux-test-and-install-reject-spawn-only-agents-as-unknown.md](./ux-test-and-install-reject-spawn-only-agents-as-unknown.md) | poe-agent/pi fail test/install with Unknown agent (false). |
| 172 | open | **High** | Test / errors | [ux-test-failure-dumps-jsonl.md](./ux-test-failure-dumps-jsonl.md) | test failure inlines hook JSONL flood. |
| 173 | open | **High** | Test / kimi | [ux-test-kimi-invalid-config-provider-poe-not-found.md](./ux-test-kimi-invalid-config-provider-poe-not-found.md) | test kimi --model novitaai/kimi-k2.5 fails: Invalid configuration file … Provider poe not found in provider… |
| 174 | open | **High** | Test / opencode | [ux-test-opencode-model-not-found-dumps-stack.md](./ux-test-opencode-model-not-found-dumps-stack.md) | test opencode --model anthropic/claude-haiku-4.5 fails: Model not found: poe/anthropic/claude-haiku-4.5 wit… |
| 175 | open | **High** | Test | [ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md](./ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md) | test --yes without agent defaults to claude-code; failure dumps long hook JSONL stdout and See logs — healt… |
| 176 | open | **High** | Help / identity | [ux-toolcraft-help-points-at-npm-run-dev.md](./ux-toolcraft-help-points-at-npm-run-dev.md) | Toolcraft groups bake monorepo invocation. |
| 177 | open | **High** | Help / identity | [ux-toolcraft-suggests-options-but-still-npm-run-dev.md](./ux-toolcraft-suggests-options-but-still-npm-run-dev.md) | Good option suggestions; wrong recovery footer. |
| 178 | open | **High** | Traces | [ux-traces-enoent-eisdir-still-system-errors.md](./ux-traces-enoent-eisdir-still-system-errors.md) | traces /tmp/no-such-trace.jsonl → ENOENT…; traces /tmp → EISDIR… + See logs — reconfirm of traces-missing-f… |
| 179 | open | **High** | Errors / consistency | [ux-traces-since-validation-cleaner-than-models.md](./ux-traces-since-validation-cleaner-than-models.md) | traces --since notaduration returns short Invalid duration for --since without stack; models --since notadu… |
| 180 | open | **High** | Dry-run | [ux-unconfigure-claude-dry-run-full-settings-dump.md](./ux-unconfigure-claude-dry-run-full-settings-dump.md) | unconfigure claude-code --dry-run shows full settings.json rewrite with hooks, permissions, plugins — not j… |
| 181 | open | **High** | Agents | [ux-unknown-agent-no-allow-list-or-suggestions.md](./ux-unknown-agent-no-allow-list-or-suggestions.md) | install/test/configure/unconfigure unknown agent say Unknown agent "notanagent" (+ See logs) without listin… |
| 182 | open | **High** | Errors / trust | [ux-user-errors-look-like-system-failures.md](./ux-user-errors-look-like-system-failures.md) | Recoverable errors thrown as Error; bootstrap See logs + errors.log. |
| 183 | open | **High** | Errors | [ux-validation-error-still-prints-stack.md](./ux-validation-error-still-prints-stack.md) | ValidationError paths dump stack + double-render. |
| 184 | open | Medium–High | Spawn / workspaces | [ux-github-cwd-clone-errors-unframed.md](./ux-github-cwd-clone-errors-unframed.md) | Bad locator raw git stderr. |
| 185 | open | Medium–High | Maestro | [ux-maestro-dry-run-hits-github-without-workflow.md](./ux-maestro-dry-run-hits-github-without-workflow.md) | Dry-run hits GraphQL 401 JSON. |
| 186 | open | Medium–High | Install / postinstall | [ux-postinstall-sync-skills-can-run-on-user-install.md](./ux-postinstall-sync-skills-can-run-on-user-install.md) | package.json postinstall: node scripts/postinstall-sync-skills.mjs — runs skill sync on every install unles… |
| 187 | open | Medium–High | Runtime | [ux-runtime-jobs-stale-running-zombies.md](./ux-runtime-jobs-stale-running-zombies.md) | running since May. |
| 188 | open | Medium–High | Traces / privacy | [ux-traces-json-includes-full-prompt-titles.md](./ux-traces-json-includes-full-prompt-titles.md) | traces --json dumps title fields that can be entire memory-query prompts or long user messages — useful for… |
| 189 | open | Medium | Visual language | [ux-acp-stream-uses-success-glyph-for-partial-text.md](./ux-acp-stream-uses-success-glyph-for-partial-text.md) | Checkmark for partial text. |
| 190 | open | Medium | Spawn / timeouts | [ux-activity-timeout-ms-uses-system-chrome.md](./ux-activity-timeout-ms-uses-system-chrome.md) | spawn … --activity-timeout-ms 1 fails Agent spawn timed out after 0.001s of inactivity with See logs — time… |
| 191 | open | Medium | Agent | [ux-agent-empty-api-key-silently-uses-stored.md](./ux-agent-empty-api-key-silently-uses-stored.md) | agent "…" --api-key "" succeeds with tokens — empty api-key ignored, uses stored auth (same empty-flag class). |
| 192 | open | Medium | Agent | [ux-agent-empty-prompt-see-logs.md](./ux-agent-empty-prompt-see-logs.md) | agent "" → Prompt must not be empty + See logs — message good, chrome wrong. |
| 193 | open | Medium | Agent | [ux-agent-invalid-model-system-chrome.md](./ux-agent-invalid-model-system-chrome.md) | 404 + logs. |
| 194 | open | Medium | Errors | [ux-agent-spawn-missing-args-raw-commander.md](./ux-agent-spawn-missing-args-raw-commander.md) | agent without prompt and spawn without agent print error: missing required argument without design-system f… |
| 195 | open | Medium | Auth / security | [ux-api-key-flags-encourage-shell-history-leaks.md](./ux-api-key-flags-encourage-shell-history-leaks.md) | Flags without history warning. |
| 196 | open | Medium | Approvals | [ux-approvals-invalid-state-silent-empty-reconfirmed.md](./ux-approvals-invalid-state-silent-empty-reconfirmed.md) | approvals list --state bogus returns No approvals found without invalid-state error — reconfirm. |
| 197 | open | Medium | Approvals | [ux-approvals-invalid-state-silent-empty.md](./ux-approvals-invalid-state-silent-empty.md) | nope looks empty queue. |
| 198 | open | Medium | Approvals | [ux-approvals-show-missing-task-debug-tease-reconfirmed.md](./ux-approvals-show-missing-task-debug-tease-reconfirmed.md) | approvals show --approval-id missing: Task "approvals/missing" not found. Use --debug for a stack trace — r… |
| 199 | open | Medium | IA / install | [ux-binary-wrappers-undocumented.md](./ux-binary-wrappers-undocumented.md) | dist/bin wrappers no help map. |
| 200 | open | Medium | Braintrust | [ux-braintrust-only-status-no-enable.md](./ux-braintrust-only-status-no-enable.md) | braintrust --help only status; braintrust enable falls back to same help — no enable/disable surface despit… |
| 201 | open | Medium | Spawn / otel | [ux-capture-otel-alone-silent-success.md](./ux-capture-otel-alone-silent-success.md) | spawn --capture-otel succeeds without confirming otel capture started or where data went — silent success f… |
| 202 | open | Medium | Spawn / flags | [ux-capture-otel-content-without-capture-silent.md](./ux-capture-otel-content-without-capture-silent.md) | spawn with --capture-otel-content alone succeeds without enabling otel capture or warning that --capture-ot… |
| 203 | open | Medium | Errors | [ux-code-review-double-error-skin.md](./ux-code-review-double-error-skin.md) | Raw + toolcraft both. |
| 204 | open | Medium | Code-review | [ux-code-review-drafts-not-found-debug-tease.md](./ux-code-review-drafts-not-found-debug-tease.md) | No active code review draft found for URL. Use --debug for a stack trace — not-found should not suggest deb… |
| 205 | open | Medium | Code-review | [ux-code-review-install-no-dry-run-force-writes.md](./ux-code-review-install-no-dry-run-force-writes.md) | code-review install --force creates profiles/prompts under .poe-code/code-review with word-wrapped path lis… |
| 206 | open | Medium | Code-review | [ux-code-review-install-output-unframed-wrapped.md](./ux-code-review-install-output-unframed-wrapped.md) | code-review install prints Lists Created with hard-wrapped absolute paths mid-word without design-system pa… |
| 207 | open | Medium | Code-review | [ux-code-review-profiles-bare-table.md](./ux-code-review-profiles-bare-table.md) | code-review profiles prints bare name/source table (generic built-in) without Poe - code-review panel frami… |
| 208 | open | Medium | Code-review | [ux-code-review-prompt-preview-unframed.md](./ux-code-review-prompt-preview-unframed.md) | code-review prompt-preview dumps long prompt with Prompt preview header and toolcraft identity on help — sa… |
| 209 | open | Medium | Errors / recovery | [ux-command-not-found-no-suggestions.md](./ux-command-not-found-no-suggestions.md) | confgure/skills/pipelne no suggestion. |
| 210 | open | Medium | Configure / codex | [ux-configure-codex-reasoning-effort-medium-partial.md](./ux-configure-codex-reasoning-effort-medium-partial.md) | configure codex --reasoning-effort medium dry-run shows mixed model_reasoning_effort high and medium across… |
| 211 | open | Medium | Dry-run | [ux-configure-cursor-dry-run-too-quiet.md](./ux-configure-cursor-dry-run-too-quiet.md) | configure cursor and cursor-agent --yes --dry-run only print would configure Cursor / # no filesystem chang… |
| 212 | open | Medium | Configure | [ux-configure-cursor-model-flag-silent-noop.md](./ux-configure-cursor-model-flag-silent-noop.md) | configure cursor --model anthropic/claude-opus-4.7 --yes --dry-run still only says would configure / no fil… |
| 213 | open | Medium | Dry-run | [ux-configure-dry-run-floods-diff.md](./ux-configure-dry-run-floods-diff.md) | Huge settings diffs. |
| 214 | open | Medium | Configure / models | [ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md](./ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md) | configure with full catalog id rewrites via stripModelNamespace + replace dots with hyphens to claude-haiku… |
| 215 | open | Medium | Configure / models | [ux-configure-kimi-ignores-explicit-novita-namespace.md](./ux-configure-kimi-ignores-explicit-novita-namespace.md) | Passing --model novitaai/kimi-k2.5 still dry-runs default_model = poe/kimi-k2.5 — explicit catalog-style id… |
| 216 | open | Medium | Configure | [ux-configure-provider-requires-model-without-listing-models.md](./ux-configure-provider-requires-model-without-listing-models.md) | When a provider requires an explicit model, configure errors Pass --model without listing available models,… |
| 217 | open | Medium | Configure | [ux-configure-yes-silent-default-agent.md](./ux-configure-yes-silent-default-agent.md) | Picks Claude without upfront line. |
| 218 | open | Medium | Dashboard / TUI | [ux-dashboard-keybindings-undocumented-on-cli-help.md](./ux-dashboard-keybindings-undocumented-on-cli-help.md) | Live dashboards support q quit and Ctrl+C forceQuit but --tui help only says Show a live dashboard without … |
| 219 | open | Medium | Help | [ux-doctor-and-completion-still-missing.md](./ux-doctor-and-completion-still-missing.md) | doctor and completion remain Unknown command — reconfirm doctor gap and completion gap. |
| 220 | open | Medium | Editor | [ux-editor-error-still-system-chrome.md](./ux-editor-error-still-system-chrome.md) | Set $EDITOR + logs. |
| 221 | open | Medium | Auth | [ux-empty-api-key-flag-silently-ignored.md](./ux-empty-api-key-flag-silently-ignored.md) | --api-key '' falls back to stored key. |
| 222 | open | Medium | Plan list | [ux-empty-plan-kind-lists-still-draw-empty-tables.md](./ux-empty-plan-kind-lists-still-draw-empty-tables.md) | plan list --kind experiment/ralph/superintendent draws full empty table borders with no "No plans" message … |
| 223 | open | Medium | Spawn / flags | [ux-empty-resume-thread-id-silently-ignored.md](./ux-empty-resume-thread-id-silently-ignored.md) | spawn … --resume-thread-id "" succeeds as a fresh session — empty resume id not rejected (related empty-mod… |
| 224 | open | Medium | Eval | [ux-eval-empty-source-message-inconsistent-skins.md](./ux-eval-empty-source-message-inconsistent-skins.md) | eval check/lint print bare Eval source does not contain… lines; eval report uses design-system ■ Error for … |
| 225 | open | Medium | Eval | [ux-eval-init-bare-stdout-no-design-system.md](./ux-eval-init-bare-stdout-no-design-system.md) | eval init demo -C /tmp prints only: demo / next: poe-code eval check demo — no panel, no success glyph fram… |
| 226 | open | Medium | Eval | [ux-eval-init-name-validation-bare-text.md](./ux-eval-init-name-validation-bare-text.md) | eval init /tmp/ux-eval-test fails with bare Eval name must be kebab-case… without panel framing or examples… |
| 227 | open | Medium | Eval / identity | [ux-eval-run-missing-params-npm-run-dev.md](./ux-eval-run-missing-params-npm-run-dev.md) | eval run without agent/model: 2 parameter errors … Run npm run dev -- eval run --help — toolcraft-style hel… |
| 228 | open | Medium | Eval / suggestions | [ux-eval-unknown-command-suggests-lint-for-list.md](./ux-eval-unknown-command-suggests-lint-for-list.md) | eval list is not a command; error Did you mean: lint? which is a poor suggestion for list (distance match w… |
| 229 | open | Medium | Gaslight | [ux-gaslight-config-missing-enoent.md](./ux-gaslight-config-missing-enoent.md) | Raw ENOENT. |
| 230 | open | Medium | Gaslight | [ux-gaslight-install-force-dry-run-vs-already-exists.md](./ux-gaslight-install-force-dry-run-vs-already-exists.md) | gaslight install --local --force --dry-run says Would create gaslight.yaml; without --force dry-run says al… |
| 231 | open | Medium | Gaslight | [ux-gaslight-install-force-overwrites-without-diff.md](./ux-gaslight-install-force-overwrites-without-diff.md) | gaslight install --local --force overwrites gaslight.yaml and says Installed without dry-run of content cha… |
| 232 | open | Medium | Gaslight | [ux-gaslight-missing-plan-system-chrome-reconfirmed.md](./ux-gaslight-missing-plan-system-chrome-reconfirmed.md) | gaslight /tmp/missing.yaml: Plan file not found + See logs — reconfirm ValidationError gap. |
| 233 | open | Medium | Gaslight | [ux-gaslight-multi-plan-fails-fast-with-success-markers.md](./ux-gaslight-multi-plan-fails-fast-with-success-markers.md) | Multi-plan gaslight fails first plan with ✓ agent API error and message plan 1/2 … failed without summarizi… |
| 234 | open | Medium | Gaslight / safety | [ux-gaslight-no-activity-timeout-flag.md](./ux-gaslight-no-activity-timeout-flag.md) | Long gaslight runs cannot set activity timeout from CLI though spawn supports --activity-timeout-ms; users … |
| 235 | open | Medium | Naming | [ux-gaslight-opaque-naming.md](./ux-gaslight-opaque-naming.md) | Root gaslight no plain gloss. |
| 236 | open | Medium | Gaslight / Pipeline | [ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md](./ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md) | Both gaslight and pipeline have --archive and --no-archive but help does not state default archive behavior… |
| 237 | open | Medium | Gaslight / naming | [ux-gaslight-unknown-agent-says-service.md](./ux-gaslight-unknown-agent-says-service.md) | Says service not agent. |
| 238 | open | Medium | Dry-run | [ux-gemini-configure-dry-run-too-quiet.md](./ux-gemini-configure-dry-run-too-quiet.md) | configure gemini --yes --dry-run only shows Gemini model resolved line and would configure without listing … |
| 239 | open | Medium | GitHub workflows | [ux-gh-install-dry-run-lists-paths-without-panel.md](./ux-gh-install-dry-run-lists-paths-without-panel.md) | github-workflows install --dry-run prints bare workflow paths and would write messages without panel framin… |
| 240 | open | Medium | GitHub workflows | [ux-gh-install-preview-without-dry-run-flag.md](./ux-gh-install-preview-without-dry-run-flag.md) | gh install fix-vulnerabilities (with --dry-run passed) showed would be written paths and eject tip — previe… |
| 241 | open | Medium | GitHub workflows | [ux-gh-prompt-preview-dumps-long-unframed-prompt.md](./ux-gh-prompt-preview-dumps-long-unframed-prompt.md) | github-workflows prompt-preview prints multi-section prompt body without design-system framing or --json op… |
| 242 | open | Medium | Help | [ux-global-flags-hidden-on-subcommand-help.md](./ux-global-flags-hidden-on-subcommand-help.md) | --yes/--dry-run/--verbose missing on most help. |
| 243 | open | Medium | Help / product gaps | [ux-goal-chat-acp-commands-missing.md](./ux-goal-chat-acp-commands-missing.md) | goal, chat, acp are Unknown command — agent-goal plan documents goal CLI but commands not registered; chat/… |
| 244 | open | Medium | First-run | [ux-group-commands-print-help-only.md](./ux-group-commands-print-help-only.md) | pipeline bare help only. |
| 245 | open | Medium | Harness | [ux-harness-list-only-cwd-not-created-dir.md](./ux-harness-list-only-cwd-not-created-dir.md) | harness new … --dir /tmp/h4 creates pair successfully; harness list still says No harness pairs found becau… |
| 246 | open | Medium | Harness | [ux-harness-missing-file-system-chrome.md](./ux-harness-missing-file-system-chrome.md) | Good message + See logs. |
| 247 | open | Medium | Harness | [ux-harness-new-unknown-template-no-kinds-reconfirmed.md](./ux-harness-new-unknown-template-no-kinds-reconfirmed.md) | harness new bogus-kind x: Unknown harness template "bogus-kind" — no list of valid kinds; help says Built-i… |
| 248 | open | Medium | Harness | [ux-harness-run-missing-file-system-chrome.md](./ux-harness-run-missing-file-system-chrome.md) | Missing harness md file: path + See logs — good message, unnecessary logs. |
| 249 | open | Medium | Harness | [ux-harness-run-success-opaque-result-object.md](./ux-harness-run-success-opaque-result-object.md) | Successful harness run prints Result: object · kind, version, message, numbers, branches, +1 more — interna… |
| 250 | open | Medium | Harness | [ux-harness-unknown-template-still-omits-kind-list.md](./ux-harness-unknown-template-still-omits-kind-list.md) | Unknown harness template "notakind" still prints only that message without listing ralph-demo, coverage-dem… |
| 251 | open | Medium | Help | [ux-help-command-not-registered.md](./ux-help-command-not-registered.md) | help not registered. |
| 252 | open | Medium | IA | [ux-hidden-and-orphan-commands.md](./ux-hidden-and-orphan-commands.md) | memory-mcp top-level; agent vs spawn poe-agent. |
| 253 | open | Medium | Hooks / spawn | [ux-hooks-bridge-refuse-user-authored-file-opaque.md](./ux-hooks-bridge-refuse-user-authored-file-opaque.md) | spawn with --hooks-from/--hooks-scope can fail with Refuse to replace user-authored hook file at …/settings… |
| 254 | open | Medium | Spawn / hooks | [ux-hooks-from-unsupported-system-chrome.md](./ux-hooks-from-unsupported-system-chrome.md) | Allow-list + See logs. |
| 255 | open | Medium | Hooks | [ux-hooks-scope-project-same-refuse-as-symlink.md](./ux-hooks-scope-project-same-refuse-as-symlink.md) | --hooks-from claude-code --hooks-scope project fails same Refuse to replace user-authored hook file — scope… |
| 256 | open | Medium | Help / IA | [ux-important-commands-absent-from-root-help.md](./ux-important-commands-absent-from-root-help.md) | skill/memory/provider missing no show-all. |
| 257 | open | Medium | Install | [ux-install-always-success-reconfirmed.md](./ux-install-always-success-reconfirmed.md) | install claude-code when already installed still says Installed Claude Code without version/already-present… |
| 258 | open | Medium | Install | [ux-install-help-missing-yes-and-list.md](./ux-install-help-missing-yes-and-list.md) | install --help only -h; no --yes documented though it works; --list unknown. Agent list only in argument de… |
| 259 | open | Medium | Install | [ux-install-yes-defaults-agent-silently.md](./ux-install-yes-defaults-agent-silently.md) | install --yes without agent installs Claude Code without stating default selection policy in the first line. |
| 260 | open | Medium | Scripting | [ux-json-flag-inconsistent-across-commands.md](./ux-json-flag-inconsistent-across-commands.md) | Some commands only. |
| 261 | open | Medium | Configure / models | [ux-kimi-default-model-id-mismatches-catalog-namespace.md](./ux-kimi-default-model-id-mismatches-catalog-namespace.md) | configure kimi dry-run plans default_model = poe/kimi-k2.5 while models catalog lists novita ai/kimi-k2.5. … |
| 262 | open | Medium | Launch / dev UX | [ux-launch-commands-trigger-full-turbo-rebuild.md](./ux-launch-commands-trigger-full-turbo-rebuild.md) | Invoking launch through npm run dev / predev runs turbo build across 68 packages before the command, adding… |
| 263 | open | Medium | Launch | [ux-launch-missing-process-system-chrome.md](./ux-launch-missing-process-system-chrome.md) | Managed process "missing" was not found + See logs for launch logs/restart. |
| 264 | open | Medium | Launch | [ux-launch-start-opaque-failure.md](./ux-launch-start-opaque-failure.md) | Missing -- → failed to start. |
| 265 | open | Medium | Launch | [ux-launch-start-via-npm-run-dev-confuses-argv.md](./ux-launch-start-via-npm-run-dev-confuses-argv.md) | launch start can mis-parse process ids and commands when invoked through npm run dev (turbo predev noise, s… |
| 266 | open | Medium | Spawn / logging | [ux-log-content-flag-no-danger-warning.md](./ux-log-content-flag-no-danger-warning.md) | spawn --log-content help only says Include message and tool content in ACP JSONL spawn logs — no warning th… |
| 267 | open | Medium | Privacy | [ux-log-content-flags-underwarn-sensitive-data.md](./ux-log-content-flags-underwarn-sensitive-data.md) | --log-content no PII warning. |
| 268 | open | Medium | Spawn / security | [ux-log-content-help-underwarns-reconfirmed.md](./ux-log-content-help-underwarns-reconfirmed.md) | Help only says Include message and tool content in ACP JSONL spawn logs without security warning; default r… |
| 269 | open | Medium | Auth / help | [ux-login-help-omits-interactive-and-yes.md](./ux-login-help-omits-interactive-and-yes.md) | login help only lists --api-key and -h; does not document interactive OAuth browser flow, non-TTY requireme… |
| 270 | open | Medium | Auth / help | [ux-login-help-omits-oauth-default.md](./ux-login-help-omits-oauth-default.md) | Only --api-key documented. |
| 271 | open | Medium | Auth | [ux-login-help-still-minimal.md](./ux-login-help-still-minimal.md) | login --help only --api-key and -h — no --yes, no note that non-TTY without key hangs/OAuth, no env POE_API… |
| 272 | open | Medium | Auth | [ux-login-rejected-no-recovery.md](./ux-login-rejected-no-recovery.md) | API key rejected only. |
| 273 | open | Medium | Maestro | [ux-maestro-config-vs-workflow-flags-duplicated.md](./ux-maestro-config-vs-workflow-flags-duplicated.md) | maestro tui accepts --config and --workflow for WORKFLOW.md and errors if both set — duplicate flags for on… |
| 274 | open | Medium | Maestro | [ux-maestro-tick-missing-transition-raw-commander.md](./ux-maestro-tick-missing-transition-raw-commander.md) | maestro tick --task foo fails error: required option --transition not specified without design-system framing. |
| 275 | open | Medium | First-run | [ux-many-parent-groups-only-dump-help.md](./ux-many-parent-groups-only-dump-help.md) | Beyond pipeline/experiment/ralph, bare invocations of skill, memory, provider, runtime, launch, worktree, u… |
| 276 | open | Medium | Destructive | [ux-memory-clear-help-still-no-force-or-yes.md](./ux-memory-clear-help-still-no-force-or-yes.md) | memory clear --help still only shows -h/--help despite being fully destructive when initialized. |
| 277 | open | Medium | Destructive | [ux-memory-clear-no-confirmation.md](./ux-memory-clear-no-confirmation.md) | Destructive no confirm. |
| 278 | open | Medium | Memory / install | [ux-memory-install-already-exists-system-chrome.md](./ux-memory-install-already-exists-system-chrome.md) | memory install when skill exists fails with Skill already exists: path and See logs, without --force guidan… |
| 279 | open | Medium | Memory | [ux-memory-install-no-force-already-exists.md](./ux-memory-install-no-force-already-exists.md) | memory install --agent claude --skill-only fails Skill already exists … See logs; no --force on help; reins… |
| 280 | open | Medium | Memory | [ux-memory-install-requires-agent-raw-commander.md](./ux-memory-install-requires-agent-raw-commander.md) | memory install without --agent: error: required option '--agent <agent>' not specified — raw commander, not… |
| 281 | open | Medium | Memory | [ux-memory-ls-search-show-raw-unframed.md](./ux-memory-ls-search-show-raw-unframed.md) | memory ls/search/show/lint/write still dump raw text without design-system panels (except init) — reconfirm… |
| 282 | open | Medium | Memory | [ux-memory-mcp-print-config-command-missing.md](./ux-memory-mcp-print-config-command-missing.md) | memory mcp, mcp-print, print-config are unknown; if docs/README mention them they are stale. memory install… |
| 283 | open | Medium | Memory | [ux-memory-query-no-model-flag.md](./ux-memory-query-no-model-flag.md) | memory query --help has --budget and --agent but no --model — cannot fix stale default model for memory age… |
| 284 | open | Medium | Memory | [ux-memory-write-requires-reason-before-path.md](./ux-memory-write-requires-reason-before-path.md) | memory write without args fails on required option --reason before missing path argument — wrong recovery o… |
| 285 | open | Medium | Memory | [ux-memory-write-requires-reason-raw-commander.md](./ux-memory-write-requires-reason-raw-commander.md) | memory write without --reason prints raw error: required option '--reason <text>' not specified instead of … |
| 286 | open | Medium | Memory | [ux-memory-write-success-is-raw-unframed.md](./ux-memory-write-success-is-raw-unframed.md) | After memory write, stdout dumps frontmatter/body and path:line snippets without design-system success pane… |
| 287 | open | Medium | Configure / models | [ux-model-id-namespace-stripping-surprises.md](./ux-model-id-namespace-stripping-surprises.md) | configure --model anthropic/claude-sonnet-4.6 dry-run writes model as claude-sonnet-4-6 (dots to hyphens / … |
| 288 | open | Medium | Models | [ux-models-dumps-full-catalog.md](./ux-models-dumps-full-catalog.md) | 300+ rows default. |
| 289 | open | Medium | Models | [ux-models-empty-search-returns-all.md](./ux-models-empty-search-returns-all.md) | Empty string filters are treated as no filter (341/341) rather than validation error — easy footgun in scri… |
| 290 | open | Medium | Models | [ux-models-feature-bogus-silent-empty.md](./ux-models-feature-bogus-silent-empty.md) | Invalid feature name returns 0 models / No models match rather than invalid feature error — reconfirm of si… |
| 291 | open | Medium | Models | [ux-models-feature-flag-not-repeatable.md](./ux-models-feature-flag-not-repeatable.md) | models --feature tools --feature reasoning does not AND features; Commander keeps a single string so the la… |
| 292 | open | Medium | Models | [ux-models-input-bogus-silent-empty.md](./ux-models-input-bogus-silent-empty.md) | Invalid input modality returns 0 models without listing valid modalities text/image/audio/video. |
| 293 | open | Medium | Models | [ux-models-invalid-feature-silent-empty-reconfirmed.md](./ux-models-invalid-feature-silent-empty-reconfirmed.md) | models --feature bogus → 0/341 No models match — no error that feature is invalid (related invalid modality… |
| 294 | open | Medium | Models | [ux-models-invalid-feature-silent-empty.md](./ux-models-invalid-feature-silent-empty.md) | --feature notreal → 0/341. |
| 295 | open | Medium | Models | [ux-models-invalid-modality-silent-empty.md](./ux-models-invalid-modality-silent-empty.md) | --input smell → 0/341. |
| 296 | open | Medium | Models | [ux-models-view-invalid-uses-raw-commander.md](./ux-models-view-invalid-uses-raw-commander.md) | Invalid --view value uses Commander option argument is invalid. Allowed choices… while other models validat… |
| 297 | open | Medium | First-run / diagnostics | [ux-no-doctor-or-health-overview-command.md](./ux-no-doctor-or-health-overview-command.md) | There is no poe-code doctor (or similar) that summarizes auth status, configured agents, stale models, prov… |
| 298 | open | Medium | Configure / models | [ux-opencode-model-flag-still-triple-namespace.md](./ux-opencode-model-flag-still-triple-namespace.md) | configure opencode --model anthropic/claude-opus-4.7 still plans poe/anthropic/claude-opus-4.7 — reconfirm … |
| 299 | open | Medium | Configure / models | [ux-opencode-model-triple-namespace.md](./ux-opencode-model-triple-namespace.md) | configure opencode dry-run plans model poe/anthropic/claude-opus-4.7 — a third namespace style (poe/owner/m… |
| 300 | open | Medium | Pipeline | [ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md](./ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md) | Good validation Problems first. |
| 301 | open | Medium | Pipeline | [ux-pipeline-nothing-to-run-success-framing.md](./ux-pipeline-nothing-to-run-success-framing.md) | pipeline run on fully done plan prints Nothing to run, Pipeline run finished success, and Problems? footer … |
| 302 | open | Medium | Pipeline / TUI | [ux-pipeline-tui-flag-ignored-on-init-failure.md](./ux-pipeline-tui-flag-ignored-on-init-failure.md) | pipeline run --tui still shows non-dashboard failure path with success markers and Problems-before-error wh… |
| 303 | open | Medium | Pipeline | [ux-pipeline-validate-enoent-system-error.md](./ux-pipeline-validate-enoent-system-error.md) | System chrome. |
| 304 | open | Medium | Pipeline | [ux-pipeline-validate-no-json-flag.md](./ux-pipeline-validate-no-json-flag.md) | pipeline validate --json is unknown option — cannot machine-parse validation results. |
| 305 | open | Medium | Pipeline | [ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md](./ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md) | pipeline validate on agent-goal plan: Invalid plan YAML: "kind" must be "pipeline" + See logs — kind-aware … |
| 306 | open | Medium | Pipeline | [ux-pipeline-validate-wrong-kind-system-chrome.md](./ux-pipeline-validate-wrong-kind-system-chrome.md) | kind must be pipeline + See logs. |
| 307 | open | Medium | Plan browser | [ux-plan-archive-allows-readme.md](./ux-plan-archive-allows-readme.md) | Would archive README.md. |
| 308 | open | Medium | Plan browser | [ux-plan-browse-non-tty-dumps-first-plan.md](./ux-plan-browse-non-tty-dumps-first-plan.md) | plan browse without a TTY prints a full rendered plan (first/selected) rather than an error, list, or expli… |
| 309 | open | Medium | Plan | [ux-plan-browse-rejects-path-argument.md](./ux-plan-browse-rejects-path-argument.md) | plan browse docs/plans/32-agent-goal.md fails error: too many arguments for browse. Expected 0 — users expe… |
| 310 | open | Medium | Docs / CLI sync | [ux-plan-docs-advertise-goal-and-chat-commands-missing.md](./ux-plan-docs-advertise-goal-and-chat-commands-missing.md) | Plan content (e.g. agent-goal plan) documents `poe-code goal …` and `poe-code chat` slash surfaces, but CLI… |
| 311 | open | Medium | Plan / editor | [ux-plan-edit-editor-true-claims-edited-without-change.md](./ux-plan-edit-editor-true-claims-edited-without-change.md) | EDITOR=true plan edit reports Edited path even when true is a no-op binary — success without change detection. |
| 312 | open | Medium | Plan / install | [ux-plan-install-no-force-flag.md](./ux-plan-install-no-force-flag.md) | plan install rejects --force as unknown option while experiment/pipeline have --force — inconsistent instal… |
| 313 | open | Medium | Plan / install | [ux-plan-install-yes-defaults-claude-writes-skill.md](./ux-plan-install-yes-defaults-claude-writes-skill.md) | plan install --yes (no agent) defaults to claude-code local and Creates SKILL.md — silent default; no --for… |
| 314 | open | Medium | Plan list | [ux-plan-list-empty-kind-table-reconfirmed.md](./ux-plan-list-empty-kind-table-reconfirmed.md) | plan list --kind superintendent draws empty table chrome without No plans message — reconfirm. |
| 315 | open | Medium | Plan list | [ux-plan-list-includes-exactly-one-readme.md](./ux-plan-list-includes-exactly-one-readme.md) | plan list --output json has 11 plans including 1 README.md — reconfirm noise file in list. |
| 316 | open | Medium | Plan browser | [ux-plan-list-includes-noise-files.md](./ux-plan-list-includes-noise-files.md) | README.md listed as plan. |
| 317 | open | Medium | Plan list | [ux-plan-list-md-includes-readme-noise.md](./ux-plan-list-md-includes-readme-noise.md) | plan list --kind plan --output md includes README.md Active Plans row — reconfirm plan-list-includes-noise-… |
| 318 | open | Medium | Plan | [ux-plan-markdown-read-depth-zero-shows-no-sections.md](./ux-plan-markdown-read-depth-zero-shows-no-sections.md) | plan markdown-read with --depth 1 on a plan whose headings start at depth 2-style numbering may print secti… |
| 319 | open | Medium | Plan | [ux-plan-markdown-read-section-wrong-command-hint.md](./ux-plan-markdown-read-section-wrong-command-hint.md) | When section match fails, error says try read-markdown to see TOC, but the actual command is plan markdown-… |
| 320 | open | Medium | Plan | [ux-plan-markdown-read-section-wrong-hint-reconfirmed.md](./ux-plan-markdown-read-section-wrong-hint-reconfirmed.md) | Reconfirmed: no section matching still says try read-markdown (wrong command name). |
| 321 | open | Medium | Plan | [ux-plan-markdown-read-system-chrome.md](./ux-plan-markdown-read-system-chrome.md) | file not found + logs. |
| 322 | open | Medium | Plan | [ux-plan-non-tty-unclear-failure.md](./ux-plan-non-tty-unclear-failure.md) | plan question bare 400. |
| 323 | open | Medium | Plan | [ux-plan-question-starts-session-without-mode.md](./ux-plan-question-starts-session-without-mode.md) | plan "test plan question only" --yes printed What do you want to build? and began session — multi-word with… |
| 324 | open | Medium | Plan | [ux-plan-view-vs-markdown-read-not-found-inconsistent.md](./ux-plan-view-vs-markdown-read-not-found-inconsistent.md) | plan view missing.md → Plan not found: missing.md (clean, no logs). plan markdown-read missing.md → file no… |
| 325 | open | Medium | Help | [ux-primary-commands-lack-examples-in-help.md](./ux-primary-commands-lack-examples-in-help.md) | models has Examples; configure/spawn do not. |
| 326 | open | Medium | Help | [ux-primary-commands-still-lack-examples.md](./ux-primary-commands-still-lack-examples.md) | spawn, configure, and gaslight --help still have no Examples section while models --help is best-in-class w… |
| 327 | open | Medium | Providers | [ux-provider-list-agents-column-incomplete.md](./ux-provider-list-agents-column-incomplete.md) | Omits spawn-only agents. |
| 328 | open | Medium | Providers | [ux-provider-list-no-json-flag.md](./ux-provider-list-no-json-flag.md) | provider list --json is unknown; only design-system table available for scripting. |
| 329 | open | Medium | Provider auth | [ux-provider-login-missing-key-system-chrome.md](./ux-provider-login-missing-key-system-chrome.md) | Good message + logs. |
| 330 | open | Medium | Workflows | [ux-ralph-experiment-wrong-kind-says-not-found.md](./ux-ralph-experiment-wrong-kind-says-not-found.md) | Existing plan wrong kind. |
| 331 | open | Medium | Errors | [ux-raw-commander-invalid-option-choices.md](./ux-raw-commander-invalid-option-choices.md) | --view nope raw. |
| 332 | open | Medium | Errors | [ux-raw-commander-missing-args.md](./ux-raw-commander-missing-args.md) | unconfigure/wrap missing agent raw error. |
| 333 | open | Medium | Docs / CLI sync | [ux-readme-features-wrap-but-cli-missing.md](./ux-readme-features-wrap-but-cli-missing.md) | README wrap quickstart removed; wrap CLI residual (muscle memory / external docs) |
| 334 | open | Medium | Configure | [ux-reasoning-effort-flag-opaque.md](./ux-reasoning-effort-flag-opaque.md) | No validation/examples. |
| 335 | open | Medium | Spawn | [ux-resume-thread-errors-are-agent-raw.md](./ux-resume-thread-errors-are-agent-raw.md) | Long agent usage text. |
| 336 | open | Medium | Spawn | [ux-runner-sync-and-runtime-invalid-raw-commander.md](./ux-runner-sync-and-runtime-invalid-raw-commander.md) | Invalid --runner-sync bogus and --runtime bogus print Commander option argument is invalid. Allowed choices… |
| 337 | open | Medium | Spawn / runtime | [ux-runner-sync-without-runtime-silently-accepted.md](./ux-runner-sync-without-runtime-silently-accepted.md) | spawn with --runner-sync both but no runtime/detach runs inline successfully — flag appears no-op without w… |
| 338 | open | Medium | Runtime jobs | [ux-runtime-job-missing-see-logs.md](./ux-runtime-job-missing-see-logs.md) | runtime jobs stop/logs missing-id: No runtime job found + See logs — clear message, system chrome. |
| 339 | open | Medium | Runtime | [ux-runtime-jobs-list-unbounded-opaque-statuses.md](./ux-runtime-jobs-list-unbounded-opaque-statuses.md) | History dump; lost unexplained. |
| 340 | open | Medium | Runtime jobs | [ux-runtime-jobs-ls-help-no-limit-reconfirmed.md](./ux-runtime-jobs-ls-help-no-limit-reconfirmed.md) | runtime jobs ls --help only -h — no --limit, --since, --status despite unbounded May-era list. |
| 341 | open | Medium | Runtime jobs | [ux-runtime-jobs-show-unknown-suggests-stop.md](./ux-runtime-jobs-show-unknown-suggests-stop.md) | runtime jobs show is not a command; Commander Did you mean: stop? — users expect show/get for job details. |
| 342 | open | Medium | Runtime / errors | [ux-runtime-missing-deps-good-message-system-chrome.md](./ux-runtime-missing-deps-good-message-system-chrome.md) | spawn --runtime docker/e2b missing engine/API key messages include install links and config paths (excellen… |
| 343 | open | Medium | SDK | [ux-sdk-getpoeapikey-throws-generic-error.md](./ux-sdk-getpoeapikey-throws-generic-error.md) | SDK credential helper throws new Error("No API key found…") rather than a typed/user-facing error class, so… |
| 344 | open | Medium | Spawn / skills | [ux-skill-bridge-failure-system-chrome.md](./ux-skill-bridge-failure-system-chrome.md) | Paths listed + See logs. |
| 345 | open | Medium | Skills / agents | [ux-skill-configure-kimi-unsupported-abrupt.md](./ux-skill-configure-kimi-unsupported-abrupt.md) | Skills not supported for kimi. |
| 346 | open | Medium | Skills | [ux-skill-configure-yes-defaults-agent-silently.md](./ux-skill-configure-yes-defaults-agent-silently.md) | skill configure --yes --local without agent configures claude-code without stating default selection policy… |
| 347 | open | Medium | Skills | [ux-skill-configure-yes-defaults-to-claude-already-exists.md](./ux-skill-configure-yes-defaults-to-claude-already-exists.md) | skill configure --yes without agent targets claude-code and fails Skill already exists … See logs — silent … |
| 348 | open | Medium | Skills | [ux-skill-install-file-required-before-name.md](./ux-skill-install-file-required-before-name.md) | skill install claude-code --name onlyname fails required option --file first — both name and file required;… |
| 349 | open | Medium | Skills | [ux-skill-install-missing-file-enoent.md](./ux-skill-install-missing-file-enoent.md) | skill install --file /tmp/no-skill.md fails ENOENT: no such file… + See logs. |
| 350 | open | Medium | Skills | [ux-skill-install-name-and-file-both-required.md](./ux-skill-install-name-and-file-both-required.md) | Serial required options opaque. |
| 351 | open | Medium | Naming | [ux-skill-naming-collisions.md](./ux-skill-naming-collisions.md) | skills≠skill; dual /plan. |
| 352 | open | Medium | Skills / first-run | [ux-skill-parent-no-next-step-guidance.md](./ux-skill-parent-no-next-step-guidance.md) | poe-code skill with no subcommand prints a bare subcommand list without suggesting the common onboarding pa… |
| 353 | open | Medium | Skills | [ux-skill-unconfigure-defaults-agent-and-soft-blocks.md](./ux-skill-unconfigure-defaults-agent-and-soft-blocks.md) | skill unconfigure without agent defaults to claude-code and refuses non-empty skill dirs unless --force, bu… |
| 354 | open | Medium | Spawn / skills | [ux-skills-empty-string-silently-ignored.md](./ux-skills-empty-string-silently-ignored.md) | spawn with --skills "" succeeds without warning — empty skills flag ignored unlike --skill "" which fails m… |
| 355 | open | Medium | Spawn / skills | [ux-skills-flag-without-value-is-noop-or-unclear.md](./ux-skills-flag-without-value-is-noop-or-unclear.md) | spawn … --skills with no value still runs the agent successfully (boolean presence?) without error or warni… |
| 356 | open | Medium | Configure | [ux-skip-if-configured-still-writes-when-model-differs.md](./ux-skip-if-configured-still-writes-when-model-differs.md) | Passing --skip-if-configured with an explicit --model that differs from stored config still runs a full con… |
| 357 | open | Medium | Spawn help | [ux-spawn-advanced-flags-undifferentiated.md](./ux-spawn-advanced-flags-undifferentiated.md) | ~20 options ungrouped. |
| 358 | open | Medium | Spawn / codex | [ux-spawn-codex-reads-stdin-message-on-tty-less-success.md](./ux-spawn-codex-reads-stdin-message-on-tty-less-success.md) | Even when prompt is provided as an argument, successful codex spawn emits Reading additional input from std… |
| 359 | open | Medium | Spawn | [ux-spawn-cwd-missing-see-logs.md](./ux-spawn-cwd-missing-see-logs.md) | spawn --cwd /tmp/does-not-exist: Workspace path does not exist + See logs — clear message, system chrome. |
| 360 | open | Medium | Spawn / paths | [ux-spawn-cwd-missing-system-chrome.md](./ux-spawn-cwd-missing-system-chrome.md) | spawn -C /missing says Workspace path does not exist (good) but still attaches errors.log system-failure fo… |
| 361 | open | Medium | Spawn / runtime | [ux-spawn-detach-ignored-on-failure-path.md](./ux-spawn-detach-ignored-on-failure-path.md) | With --detach, spawn still appears to run the agent path that fails on stale model in-foreground with succe… |
| 362 | open | Medium | Spawn | [ux-spawn-interactive-bypasses-design-system-panel.md](./ux-spawn-interactive-bypasses-design-system-panel.md) | spawn … --interactive / -i in non-TTY still runs and prints bare agent text (ok / Hey!) without Poe - spawn… |
| 363 | open | Medium | Spawn / interactive | [ux-spawn-interactive-non-tty-still-runs.md](./ux-spawn-interactive-non-tty-still-runs.md) | spawn … --interactive without TTY still produces agent output (not a clear "requires TTY" failure) — flag i… |
| 364 | open | Medium | Spawn | [ux-spawn-no-prompt-system-chrome.md](./ux-spawn-no-prompt-system-chrome.md) | No prompt provided via argument or stdin is correct message but still See logs system chrome. |
| 365 | open | Medium | Spawn | [ux-spawn-stdin-empty-see-logs.md](./ux-spawn-stdin-empty-see-logs.md) | spawn --stdin with empty stdin: No prompt provided via argument or stdin + See logs — good message, system … |
| 366 | open | Medium | Spawn | [ux-spawn-validates-mode-before-agent-reconfirmed.md](./ux-spawn-validates-mode-before-agent-reconfirmed.md) | spawn unknown-agent --mode foobar fails mode first; spawn unknown-agent --mode read fails Unknown agent wit… |
| 367 | open | Medium | Spawn / errors | [ux-spawn-validates-mode-before-agent.md](./ux-spawn-validates-mode-before-agent.md) | Invalid agent fails missing --mode first. |
| 368 | open | Medium | Visual language | [ux-successful-spawn-still-uses-checkmark-for-agent-text.md](./ux-successful-spawn-still-uses-checkmark-for-agent-text.md) | Even successful spawn pi output prefixes agent thinking/answer lines with ✓, same glyph as success status —… |
| 369 | open | Medium | Superintendent | [ux-superintendent-complete-wrong-kind-debug-tease.md](./ux-superintendent-complete-wrong-kind-debug-tease.md) | superintendent complete on plan-kind file: frontmatter kind must be superintendent Use --debug for a stack … |
| 370 | open | Medium | Superintendent | [ux-superintendent-validate-unclosed-tag-opaque.md](./ux-superintendent-validate-unclosed-tag-opaque.md) | No location. |
| 371 | open | Medium | Tables | [ux-tables-ignore-terminal-width.md](./ux-tables-ignore-terminal-width.md) | Wide at COLUMNS=40. |
| 372 | open | Medium | Tasks / auth | [ux-tasks-github-auth-raw-error.md](./ux-tasks-github-auth-raw-error.md) | tasks get raw GraphQL 401. |
| 373 | open | Medium | Tasks | [ux-tasks-import-dry-run-still-requires-to.md](./ux-tasks-import-dry-run-still-requires-to.md) | tasks import --dry-run --from /tmp fails tasks import requires --to <workflow.md> — dry-run cannot preview … |
| 374 | open | Medium | Spawn / timeouts | [ux-timeout-errors-use-system-chrome.md](./ux-timeout-errors-use-system-chrome.md) | 0.001s + See logs. |
| 375 | open | Medium | Errors / recovery | [ux-toolcraft-has-suggestions-poe-code-root-does-not.md](./ux-toolcraft-has-suggestions-poe-code-root-does-not.md) | suggest.ts exists; root unused. |
| 376 | open | Medium | Help / visual | [ux-toolcraft-heading-doubles-poe-code.md](./ux-toolcraft-heading-doubles-poe-code.md) | Double name heading. |
| 377 | open | Medium | Traces | [ux-traces-directory-path-eisdir.md](./ux-traces-directory-path-eisdir.md) | traces docs EISDIR. |
| 378 | open | Medium | Traces | [ux-traces-missing-file-system-error.md](./ux-traces-missing-file-system-error.md) | System chrome. |
| 379 | open | Medium | Traces | [ux-traces-poe-code-source-titles-are-agent-names.md](./ux-traces-poe-code-source-titles-are-agent-names.md) | poe-code source traces show title pi / claude-code / cursor without user prompt — less useful than claude s… |
| 380 | open | Medium | Dry-run | [ux-unconfigure-goose-dry-run-full-config-dump.md](./ux-unconfigure-goose-dry-run-full-config-dump.md) | unconfigure goose --dry-run creates large full config.yaml + dump rather than intentional-only removal summ… |
| 381 | open | Medium | Unconfigure | [ux-unconfigure-help-missing-dry-run-and-yes.md](./ux-unconfigure-help-missing-dry-run-and-yes.md) | unconfigure help only -h; no --dry-run/--yes though global flags may apply — destructive command underdocum… |
| 382 | open | Medium | Unconfigure | [ux-unconfigure-help-no-dry-run-or-yes.md](./ux-unconfigure-help-no-dry-run-or-yes.md) | unconfigure --help only lists agent and -h — no mention of global --dry-run, confirmation, or files affected. |
| 383 | open | Medium | Unconfigure | [ux-unconfigure-missing-agent-raw-commander.md](./ux-unconfigure-missing-agent-raw-commander.md) | unconfigure without agent: error: missing required argument agent — raw commander; unconfigure not-an-agent… |
| 384 | open | Medium | Destructive | [ux-unconfigure-no-confirmation.md](./ux-unconfigure-no-confirmation.md) | Immediate rewrite no --yes gate. |
| 385 | open | Medium | Unconfigure | [ux-unconfigure-nonconfigured-agent-still-plans-mutations.md](./ux-unconfigure-nonconfigured-agent-still-plans-mutations.md) | unconfigure gemini --dry-run still emits large settings diffs and backup deletes even when user mental mode… |
| 386 | open | Medium | Unconfigure | [ux-unconfigure-rejects-spawn-only-agents.md](./ux-unconfigure-rejects-spawn-only-agents.md) | unconfigure pi and unconfigure poe-agent: Unknown agent — correct that they are not configurable, but error… |
| 387 | open | Medium | Update | [ux-update-always-suggests-npm-install-g.md](./ux-update-always-suggests-npm-install-g.md) | Ignores install method. |
| 388 | open | Medium | Usage | [ux-usage-list-no-json-flag.md](./ux-usage-list-no-json-flag.md) | usage list lacks --json/--output; scripts cannot machine-parse usage history without scraping tables. trace… |
| 389 | open | Medium | Usage | [ux-usage-pages-1-still-shows-20-entries.md](./ux-usage-pages-1-still-shows-20-entries.md) | usage list --pages 1 still fetches/displays 20 usage entries — --pages means number of pages not page size,… |
| 390 | open | Medium | Usage | [ux-usage-pages-invalid-raw-commander.md](./ux-usage-pages-invalid-raw-commander.md) | --pages 0/-1 prints error: option argument is invalid. Expected a positive integer without design-system fr… |
| 391 | open | Medium | Utils / editor | [ux-utils-config-edit-missing-editor-system-chrome.md](./ux-utils-config-edit-missing-editor-system-chrome.md) | utils config edit without EDITOR says Set $EDITOR to use this command + See logs — good message, unnecessar… |
| 392 | open | Medium | Utils / config | [ux-utils-config-path-subcommand-missing.md](./ux-utils-config-path-subcommand-missing.md) | utils config path fails with too many arguments; only show/init/edit exist. Users often need the path witho… |
| 393 | open | Medium | Utils / config | [ux-utils-config-show-dumps-large-json.md](./ux-utils-config-show-dumps-large-json.md) | utils config show prints full global config JSON including configured_services detail — useful but noisy; n… |
| 394 | open | Medium | Version | [ux-version-nags-dev-to-major-jump.md](./ux-version-nags-dev-to-major-jump.md) | Local 0.0.0-dev build reports Update available to 4.0.0 and suggests npm install -g, which is noise for con… |
| 395 | open | Medium | Version | [ux-version-still-nags-dev-to-4.0.0.md](./ux-version-still-nags-dev-to-4.0.0.md) | Reconfirmed: --version shows Update available: 0.0.0-dev -> 4.0.0 and npm install -g suggestion. |
| 396 | open | Medium | Version | [ux-version-subcommand-missing-use-flag.md](./ux-version-subcommand-missing-use-flag.md) | poe-code version is Unknown command; version works via -V/--version. Users typing version as subcommand (co… |
| 397 | open | Medium | Tables | [ux-wide-tables-truncate-critical-cells.md](./ux-wide-tables-truncate-critical-cells.md) | Agents column ellipsis. |
| 398 | open | Medium | Worktree | [ux-worktree-reconcile-not-found-system-chrome.md](./ux-worktree-reconcile-not-found-system-chrome.md) | Worktree "missing" not found in registry + See logs — same as remove not-found. |
| 399 | open | Medium | Worktree | [ux-worktree-remove-help-no-yes.md](./ux-worktree-remove-help-no-yes.md) | worktree remove --help has --delete-branch but no --yes / confirmation notes for destructive remove. |
| 400 | open | Medium | Worktree | [ux-worktree-remove-help-omits-yes.md](./ux-worktree-remove-help-omits-yes.md) | worktree remove --help shows only --delete-branch; no --yes. worktree remove ghost-name --yes fails Worktre… |
| 401 | open | Medium | Worktree | [ux-worktree-remove-no-confirmation.md](./ux-worktree-remove-no-confirmation.md) | Destructive no confirm. |
| 402 | open | Medium | Worktree | [ux-worktree-remove-not-found-system-chrome.md](./ux-worktree-remove-not-found-system-chrome.md) | worktree remove no-such → Worktree not found in registry + See logs. |
| 403 | open | Medium | Docs / CLI sync | [ux-wrap-command-still-missing.md](./ux-wrap-command-still-missing.md) | wrap remains Unknown command — residual after README wrap removal; muscle memory / external docs. |
| 404 | open | Medium | Dry-run | [ux-wrap-dry-run-forwards-flag.md](./ux-wrap-dry-run-forwards-flag.md) | would run goose --dry-run. |
| 405 | open | Medium | Dry-run | [ux-wrap-resolves-alias-but-dry-run-lies.md](./ux-wrap-resolves-alias-but-dry-run-lies.md) | kimi-cli --dry-run invented. |
| 406 | open | Low–Medium | Agent defaults | [ux-agent-default-model-hardcoded.md](./ux-agent-default-model-hardcoded.md) | default anthropic/claude-opus-4.7. |
| 407 | open | Low–Medium | Config / models | [ux-agent-default-opus-4-7-not-latest-opus-4-8.md](./ux-agent-default-opus-4-7-not-latest-opus-4-8.md) | agent --model default is anthropic/claude-opus-4.7; catalog has anthropic/claude-opus-4.8 (Date Added 2026-… |
| 408 | open | Low–Medium | Auth | [ux-auth-status-no-json-flag.md](./ux-auth-status-no-json-flag.md) | auth status --json unknown; whoami is JSON. Split is OK if documented; status --help does not mention whoam… |
| 409 | open | Low–Medium | Auth | [ux-auth-whoami-raw-json-vs-status-panel.md](./ux-auth-whoami-raw-json-vs-status-panel.md) | auth whoami dumps raw JSON identity; auth status uses design-system Logged in as. Dual presentation for sam… |
| 410 | open | Low–Medium | Auth polish | [ux-auth-whoami-raw-json.md](./ux-auth-whoami-raw-json.md) | JSON vs status design-system. |
| 411 | open | Low–Medium | Braintrust | [ux-braintrust-status-minimal-disabled.md](./ux-braintrust-status-minimal-disabled.md) | braintrust status prints disabled with Problems footer — no how to enable, env vars, or docs link (reaffirm… |
| 412 | open | Low–Medium | Code-review | [ux-code-review-profiles-raw-table.md](./ux-code-review-profiles-raw-table.md) | code-review profiles dumps a minimal ascii table of name/source without Poe panel framing used elsewhere. |
| 413 | open | Low–Medium | Code-review / visual | [ux-code-review-profiles-table-outside-design-system.md](./ux-code-review-profiles-table-outside-design-system.md) | No Poe framing. |
| 414 | open | Low–Medium | Help | [ux-command-aliases-undocumented-on-root-help.md](./ux-command-aliases-undocumented-on-root-help.md) | Work but not shown. |
| 415 | open | Low–Medium | Configure help | [ux-configure-shape-base-url-opaque.md](./ux-configure-shape-base-url-opaque.md) | Jargon no examples. |
| 416 | open | Low–Medium | Help / discoverability | [ux-dashboard-ui-tui-missing.md](./ux-dashboard-ui-tui-missing.md) | dashboard, ui, tui are Unknown command with npm run dev help — no interactive dashboard entrypoint in CLI. |
| 417 | open | Low–Medium | Editor | [ux-editor-missing-raw-error.md](./ux-editor-missing-raw-error.md) | throw new Error Set $EDITOR. |
| 418 | open | Low–Medium | Eval | [ux-eval-errors-outside-design-system.md](./ux-eval-errors-outside-design-system.md) | Some eval plain text. |
| 419 | open | Low–Medium | Eval | [ux-eval-init-creates-in-cwd-with-bare-success.md](./ux-eval-init-creates-in-cwd-with-bare-success.md) | eval init ux-audit-eval-two creates files with bare name/next lines — reconfirm eval init success framing; … |
| 420 | open | Low–Medium | Eval | [ux-eval-init-success-is-bare-paths.md](./ux-eval-init-success-is-bare-paths.md) | eval init prints folder name and next: poe-code eval check … as bare lines; also next command may still be … |
| 421 | open | Low–Medium | Eval | [ux-eval-report-debug-flag-undocumented-in-error.md](./ux-eval-report-debug-flag-undocumented-in-error.md) | eval report with no eval folders says Use --debug for a stack trace while primary help may not surface --de… |
| 422 | open | Low–Medium | Experiment | [ux-experiment-journal-wrong-doc-type-message.md](./ux-experiment-journal-wrong-doc-type-message.md) | Doc not found for existing. |
| 423 | open | Low–Medium | Install / IA | [ux-extra-npm-bins-confusing.md](./ux-extra-npm-bins-confusing.md) | poe-code-configure + test servers. |
| 424 | open | Low–Medium | Gaslight | [ux-gaslight-archive-and-no-archive-both-accepted.md](./ux-gaslight-archive-and-no-archive-both-accepted.md) | Passing both --archive and --no-archive does not error; one silently wins (Commander negate) while help lis… |
| 425 | open | Low–Medium | GH workflows | [ux-gh-install-eject-flag-opaque.md](./ux-gh-install-eject-flag-opaque.md) | Description eject. |
| 426 | open | Low–Medium | Harness | [ux-harness-run-no-path-says-no-pairs.md](./ux-harness-run-no-path-says-no-pairs.md) | harness run --yes without md-path: No harness pairs found — OK if empty, but does not prompt to pick or sug… |
| 427 | open | Low–Medium | Install | [ux-install-always-claims-success.md](./ux-install-always-claims-success.md) | No already-present state. |
| 428 | open | Low–Medium | Launch | [ux-launch-status-shows-failed-experiment-leftovers.md](./ux-launch-status-shows-failed-experiment-leftovers.md) | stopped leftovers no cleanup hint. |
| 429 | open | Low–Medium | Spawn | [ux-mcp-servers-empty-object-accepted.md](./ux-mcp-servers-empty-object-accepted.md) | spawn with --mcp-servers {} succeeds without warning that no servers were configured — empty object is vali… |
| 430 | open | Low–Medium | Errors / consistency | [ux-mcp-servers-missing-file-almost-good.md](./ux-mcp-servers-missing-file-almost-good.md) | Good message class vary. |
| 431 | open | Low–Medium | Memory / MCP | [ux-memory-mcp-print-config-raw-json.md](./ux-memory-mcp-print-config-raw-json.md) | Bare JSON no guidance. |
| 432 | open | Low–Medium | Memory | [ux-memory-status-after-write-is-terse.md](./ux-memory-status-after-write-is-terse.md) | memory status prints Pages/Bytes/Last write/Tokens as bare lines without panel framing or interpretation (h… |
| 433 | open | Low–Medium | Memory | [ux-memory-write-bare-stdout-path.md](./ux-memory-write-bare-stdout-path.md) | memory write pages/hello.md prints bare hello.md without design-system success panel — inconsistent with me… |
| 434 | open | Low–Medium | Models | [ux-models-raw-view-bypasses-design-system-reconfirmed.md](./ux-models-raw-view-bypasses-design-system-reconfirmed.md) | models --model claude-haiku-4.5 --view raw prints raw YAML without design-system panel — reconfirm models-r… |
| 435 | open | Low–Medium | Models | [ux-models-raw-view-bypasses-design-system.md](./ux-models-raw-view-bypasses-design-system.md) | No framing. |
| 436 | open | Low–Medium | Models | [ux-models-since-1d-empty-today.md](./ux-models-since-1d-empty-today.md) | models --since 1d returns 0/341 No models match — correct if no adds in 24h but message looks like filter f… |
| 437 | open | Low–Medium | Models | [ux-models-tools-and-feature-filter-semantics-undocumented.md](./ux-models-tools-and-feature-filter-semantics-undocumented.md) | --tools is documented as shorthand for --feature tools, but combining --tools with --feature web_search ret… |
| 438 | open | Low–Medium | Help / completion | [ux-no-shell-completion-command.md](./ux-no-shell-completion-command.md) | No poe-code completion (bash/zsh/fish) command to install tab completion, despite a large command surface w… |
| 439 | open | Low–Medium | Auth polish | [ux-oauth-url-dumps-full-query-string.md](./ux-oauth-url-dumps-full-query-string.md) | Long authorize URL line. |
| 440 | open | Low–Medium | Pipeline | [ux-pipeline-validate-success-still-problems-footer.md](./ux-pipeline-validate-success-still-problems-footer.md) | Valid pipeline validation ends with Problems? GitHub link after Plan is valid success. |
| 441 | open | Low–Medium | Plan list | [ux-plan-list-empty-table-no-message.md](./ux-plan-list-empty-table-no-message.md) | No no-plans message. |
| 442 | open | Low–Medium | Plan list | [ux-plan-list-output-json-unframed.md](./ux-plan-list-output-json-unframed.md) | plan list --output json prints a raw JSON array to stdout with no design-system intro; --output md prints a… |
| 443 | open | Low–Medium | Plan | [ux-plan-markdown-read-raw-yaml-ish-output.md](./ux-plan-markdown-read-raw-yaml-ish-output.md) | plan markdown-read prints raw file:/frontmatter:/sections: blocks without design-system framing used by pla… |
| 444 | open | Low–Medium | Plan view | [ux-plan-view-json-dumps-full-markdown-content.md](./ux-plan-view-json-dumps-full-markdown-content.md) | plan view --output json includes a huge content string of the full plan body, which is useful for tooling b… |
| 445 | open | Low–Medium | Design system | [ux-problems-footer-on-every-success.md](./ux-problems-footer-on-every-success.md) | finalize always. |
| 446 | open | Low–Medium | Providers | [ux-provider-login-unknown-has-list-hint-and-see-logs.md](./ux-provider-login-unknown-has-list-hint-and-see-logs.md) | provider login not-a-provider: Unknown provider … Run provider list — good next step; still See logs system… |
| 447 | open | Low–Medium | Runtime | [ux-runtime-templates-ls-shows-empty-docker-row.md](./ux-runtime-templates-ls-shows-empty-docker-row.md) | runtime templates ls includes a docker row with (empty) hash and dashes, plus many old e2b artifacts — nois… |
| 448 | open | Low–Medium | Runtime | [ux-runtime-templates-ls-unbounded-noise.md](./ux-runtime-templates-ls-unbounded-noise.md) | Old e2b /tmp rows. |
| 449 | open | Low–Medium | Configure | [ux-shape-base-url-error-good-message-system-prefix.md](./ux-shape-base-url-error-good-message-system-prefix.md) | Good text system prefix. |
| 450 | open | Low–Medium | Spawn / skills | [ux-skill-and-skills-flags-undocumented-relationship.md](./ux-skill-and-skills-flags-undocumented-relationship.md) | Both merge; help silent. |
| 451 | open | Low–Medium | Skills | [ux-skill-configure-goose-writes-dot-agents-skills.md](./ux-skill-configure-goose-writes-dot-agents-skills.md) | skill configure goose --yes --local succeeds at ./.agents/skills while claude uses ./.claude/skills — path … |
| 452 | open | Low–Medium | Spawn / skills | [ux-skill-empty-string-malformed-reference.md](./ux-skill-empty-string-malformed-reference.md) | spawn --skill "" fails Malformed skill references: - (empty) Expected syntax name or agentId/name — empty s… |
| 453 | open | Low–Medium | Configure | [ux-skip-if-configured-still-noises-dry-run.md](./ux-skip-if-configured-still-noises-dry-run.md) | Still full would-configure. |
| 454 | open | Low–Medium | Design system | [ux-spawn-success-still-problems-footer.md](./ux-spawn-success-still-problems-footer.md) | Even successful spawn pi/claude/goose runs end with Problems? GitHub issues link, training users to ignore … |
| 455 | open | Low–Medium | Visual language | [ux-success-and-info-share-magenta-glyphs.md](./ux-success-and-info-share-magenta-glyphs.md) | logger ◆ and ● magenta. |
| 456 | open | Low–Medium | Traces | [ux-traces-cwd-only-flag-removed-or-renamed.md](./ux-traces-cwd-only-flag-removed-or-renamed.md) | traces defaults to cwd-only listing; expansion is via --all-workspaces. The flag --cwd-only is unknown. Ear… |
| 457 | open | Low–Medium | Update | [ux-update-help-omits-dry-run.md](./ux-update-help-omits-dry-run.md) | update help lists --force, --no-version-check, --package-manager but not --dry-run though dry-run works via… |
| 458 | open | Low–Medium | Usage | [ux-usage-help-hides-default-balance.md](./ux-usage-help-hides-default-balance.md) | Bare usage balance; help omits. |
| 459 | open | Low–Medium | Utils | [ux-utils-config-no-path-subcommand.md](./ux-utils-config-no-path-subcommand.md) | utils config path fails too many arguments; only show/init/edit — users cannot print config file paths alone. |
| 460 | open | Low–Medium | Utils | [ux-utils-symlink-skills-scope-error-vs-agents.md](./ux-utils-symlink-skills-scope-error-vs-agents.md) | skills dry-run needs flags. |
| 461 | open | Low–Medium | Logging / verbose | [ux-verbose-prefixes-every-log-line.md](./ux-verbose-prefixes-every-log-line.md) | [models] on tables. |
| 462 | open | Low–Medium | Version | [ux-version-update-nag-on-dev-builds.md](./ux-version-update-nag-on-dev-builds.md) | Always update available. |
| 463 | open | Low–Medium | Worktree | [ux-worktree-reconcile-requires-agent-not-in-error-order.md](./ux-worktree-reconcile-requires-agent-not-in-error-order.md) | worktree reconcile without args hits required option --agent before missing name, similar to spawn mode-bef… |
| 464 | open | Low | Spawn / positive pattern | [ux-activity-timeout-1ms-works-but-chrome.md](./ux-activity-timeout-1ms-works-but-chrome.md) | Agent spawn timed out after 0.001s of inactivity — correct behavior for extreme timeout; still See logs. |
| 465 | open | Low | Errors / positive pattern | [ux-activity-timeout-zero-good-validation.md](./ux-activity-timeout-zero-good-validation.md) | Invalid --activity-timeout-ms "0" returns a clear ValidationError-style message without raw Commander text … |
| 466 | open | Low | Spawn / positive pattern | [ux-activity-timeout-zero-validation-good.md](./ux-activity-timeout-zero-validation-good.md) | Invalid activity timeout returns Expected a positive integer without stack. |
| 467 | open | Low | Agent / positive pattern | [ux-agent-default-model-works-when-opus-valid.md](./ux-agent-default-model-works-when-opus-valid.md) | agent "say only: ok" without --model succeeds using default anthropic/claude-opus-4.7 — positive that DEFAU… |
| 468 | open | Low | Auth / positive pattern | [ux-auth-whoami-fields-documented-by-shape.md](./ux-auth-whoami-fields-documented-by-shape.md) | auth whoami JSON keys: handle, name, profile_picture, user_id — stable machine shape. |
| 469 | open | Low | Auth / positive pattern | [ux-auth-whoami-help-documents-json-good.md](./ux-auth-whoami-help-documents-json-good.md) | auth whoami help says Print Poe account identity as JSON (uses POE_API_KEY if set) — clear machine mode vs … |
| 470 | open | Low | Braintrust | [ux-braintrust-status-opaque.md](./ux-braintrust-status-opaque.md) | disabled only. |
| 471 | open | Low | Code-review / positive pattern | [ux-code-review-prompt-preview-good.md](./ux-code-review-prompt-preview-good.md) | code-review prompt-preview --spawn orchestrator prints Spawn/Profile/Prompt preview without side effects — … |
| 472 | open | Low | Configure / positive pattern | [ux-configure-api-key-dry-run-redacts-bearer.md](./ux-configure-api-key-dry-run-redacts-bearer.md) | configure dry-run shows Authorization: Bearer <redacted> — good redaction in at least this path (contrast u… |
| 473 | open | Low | Configure / positive pattern | [ux-configure-success-vscode-next-steps-good.md](./ux-configure-success-vscode-next-steps-good.md) | After configuring Claude Code, a Next steps note with vscode://settings/claudeCode.disableLoginPrompt deep … |
| 474 | open | Low | Configure / positive pattern | [ux-configure-unknown-provider-good-message.md](./ux-configure-unknown-provider-good-message.md) | configure --provider notaprovider returns Unknown provider "notaprovider" cleanly (could still list known p… |
| 475 | open | Low | Configure / positive pattern | [ux-configure-unknown-provider-validation-good.md](./ux-configure-unknown-provider-validation-good.md) | configure --provider not-a-provider → Unknown provider "not-a-provider" without See logs — good ValidationE… |
| 476 | open | Low | Agents / positive pattern | [ux-cursor-and-cursor-agent-aliases-both-work.md](./ux-cursor-and-cursor-agent-aliases-both-work.md) | spawn cursor and spawn cursor-agent both succeed; configure aliases map to same Cursor surface. Positive al… |
| 477 | open | Low | Spawn / positive pattern | [ux-cwd-file-path-not-directory-good.md](./ux-cwd-file-path-not-directory-good.md) | spawn --cwd package.json returns Workspace path … is not a directory clearly. |
| 478 | open | Low | Spawn / positive pattern | [ux-cwd-missing-path-good-message.md](./ux-cwd-missing-path-good-message.md) | spawn --cwd /no/such/dir returns Workspace path does not exist clearly (still See logs). |
| 479 | open | Low | Spawn / positive pattern | [ux-e2b-missing-key-error-good.md](./ux-e2b-missing-key-error-good.md) | No E2B API key message points to E2B_API_KEY and config.json paths — good recovery (still See logs). |
| 480 | open | Low | Spawn / positive pattern | [ux-empty-prompt-string-rejected.md](./ux-empty-prompt-string-rejected.md) | spawn claude "" and agent "" both reject empty prompts — good. spawn: No prompt provided; agent: Prompt mus… |
| 481 | open | Low | Eval / positive pattern | [ux-eval-lint-table-good.md](./ux-eval-lint-table-good.md) | eval lint shows Warnings table with Code W004, path, message about pinning target.ref to SHA — scannable. |
| 482 | open | Low | Gaslight / positive pattern | [ux-gaslight-ingest-limit-zero-validation-good.md](./ux-gaslight-ingest-limit-zero-validation-good.md) | --limit must be a positive integer for limit 0 — good ValidationError. |
| 483 | open | Low | Gaslight / positive pattern | [ux-gaslight-install-global-dry-run-clean.md](./ux-gaslight-install-global-dry-run-clean.md) | gaslight install --global --dry-run: Would create path; Would install; no filesystem changes — intentional … |
| 484 | open | Low | GitHub workflows / positive pattern | [ux-gh-uninstall-invalid-name-lists-choices-good.md](./ux-gh-uninstall-invalid-name-lists-choices-good.md) | Invalid uninstall name lists Expected one of: fix-vulnerabilities, … — good allow-list (still npm run dev h… |
| 485 | open | Low | GitHub workflows / positive pattern | [ux-gh-variables-list-good.md](./ux-gh-variables-list-good.md) | gh variables shows Name/Status/Source table for shared prompt variables — clear inventory. |
| 486 | open | Low | Harness / positive pattern | [ux-harness-list-empty-message-good.md](./ux-harness-list-empty-message-good.md) | harness list: No harness pairs found — clear empty state (no empty table). |
| 487 | open | Low | Harness / positive pattern | [ux-harness-new-all-builtin-kinds-work.md](./ux-harness-new-all-builtin-kinds-work.md) | ralph-demo, experiment-demo, superintendent-demo, coverage-demo, pipeline-demo all scaffold successfully wi… |
| 488 | open | Low | Harness / positive pattern | [ux-harness-new-success-good.md](./ux-harness-new-success-good.md) | harness new with --yes creates pair with clear Created harness pair at path success framing. |
| 489 | open | Low | Harness | [ux-harness-unknown-template-no-kinds.md](./ux-harness-unknown-template-no-kinds.md) | No allow-list. |
| 490 | open | Low | Polish | [ux-help-subcommand-inconsistency.md](./ux-help-subcommand-inconsistency.md) | Some groups help [command]. |
| 491 | open | Low | Hooks / positive pattern | [ux-hooks-from-unknown-lists-supported-good.md](./ux-hooks-from-unknown-lists-supported-good.md) | Unsupported source hook agent lists Supported hook agents: claude-code, codex — good allow-list (still See … |
| 492 | open | Low | Auth / positive pattern | [ux-login-api-key-rejected-good.md](./ux-login-api-key-rejected-good.md) | login --api-key sk-fake-not-real → API key rejected without overwriting session; auth status still logged in. |
| 493 | open | Low | Auth | [ux-login-yes-message-good-but-worth-aligning.md](./ux-login-yes-message-good-but-worth-aligning.md) | --yes fail-fast good; bare hangs. |
| 494 | open | Low | Maestro | [ux-maestro-dual-invocation-shape.md](./ux-maestro-dual-invocation-shape.md) | Parent + run unclear. |
| 495 | open | Low | Maestro | [ux-maestro-duplicate-config-flags.md](./ux-maestro-duplicate-config-flags.md) | --config and --workflow same. |
| 496 | open | Low | Maestro / positive pattern | [ux-maestro-tui-mutual-exclusion-validation-good.md](./ux-maestro-tui-mutual-exclusion-validation-good.md) | Specifying both --config and --workflow fails with clear mutual exclusion message. |
| 497 | open | Low | Plan / positive pattern | [ux-markdown-read-depth-2-works-well.md](./ux-markdown-read-depth-2-works-well.md) | plan markdown-read --depth 2 prints numbered sections 1–6 for agent-goal plan; --output json includes depth… |
| 498 | open | Low | Spawn / positive pattern | [ux-mcp-servers-file-and-json-validation-good.md](./ux-mcp-servers-file-and-json-validation-good.md) | Missing @file reports could not read file with path; invalid JSON reports required shape — good ValidationE… |
| 499 | open | Low | Spawn / positive pattern | [ux-mcp-servers-validation-good.md](./ux-mcp-servers-validation-good.md) | Invalid MCP server JSON without command returns a clear field-level ValidationError without system chrome. |
| 500 | open | Low | Memory / positive pattern | [ux-memory-cache-clear-requires-yes-good.md](./ux-memory-cache-clear-requires-yes-good.md) | memory cache clear without --yes refuses with Refusing to clear cache without --yes — good guard (still See… |
| 501 | open | Low | Memory / positive pattern | [ux-memory-clear-requires-yes-non-tty-good.md](./ux-memory-clear-requires-yes-non-tty-good.md) | memory clear without --yes: memory clear requires --yes when running without an interactive TTY — clear des… |
| 502 | open | Low | Memory / positive pattern | [ux-memory-clear-yes-works-when-initialized.md](./ux-memory-clear-yes-works-when-initialized.md) | memory clear --yes after init succeeds with Cleared memory design-system framing; without init points to me… |
| 503 | open | Low | Memory / positive pattern | [ux-memory-ingest-not-init-good.md](./ux-memory-ingest-not-init-good.md) | Memory is not initialized. Run poe-code memory init — clear recovery. |
| 504 | open | Low | Memory / positive pattern | [ux-memory-ls-empty-message-good.md](./ux-memory-ls-empty-message-good.md) | memory ls after init: No memory pages yet — clear empty state. |
| 505 | open | Low | Models / positive pattern | [ux-models-endpoint-pricing-combo-works.md](./ux-models-endpoint-pricing-combo-works.md) | models --endpoint /v1/messages --view pricing returns multi-provider pricing table for messages-capable mod… |
| 506 | open | Low | Models / positive pattern | [ux-models-feature-reasoning-filter-works.md](./ux-models-feature-reasoning-filter-works.md) | models --feature reasoning --provider anthropic returns reasoning-capable models with ✓ in Reasoning column. |
| 507 | open | Low | Models / positive pattern | [ux-models-feature-web-search-works.md](./ux-models-feature-web-search-works.md) | models --provider anthropic --feature web_search returns models with web_search ✓. |
| 508 | open | Low | Models / positive pattern | [ux-models-help-examples-are-excellent.md](./ux-models-help-examples-are-excellent.md) | models --help includes Filters, Views, and Examples sections — best-in-class help in the CLI; other primary… |
| 509 | open | Low | Help / positive pattern | [ux-models-help-examples-still-best-in-class.md](./ux-models-help-examples-still-best-in-class.md) | models --help Examples block shows provider, feature, endpoint, view, search, model, since — reconfirm best… |
| 510 | open | Low | Models / positive pattern | [ux-models-openai-tools-filter-works.md](./ux-models-openai-tools-filter-works.md) | models --provider openai --tools returns tool-capable openai models cleanly. |
| 511 | open | Low | Models / positive pattern | [ux-models-parameters-view-good-for-filtered.md](./ux-models-parameters-view-good-for-filtered.md) | parameters view for anthropic shows output_effort enums including xhigh — useful for configuring reasoning-… |
| 512 | open | Low | Models / positive pattern | [ux-models-pricing-search-combo-good.md](./ux-models-pricing-search-combo-good.md) | models --search haiku --view pricing shows clean single-model pricing row. |
| 513 | open | Low | Models / positive pattern | [ux-models-pricing-sonnet-4-6-good.md](./ux-models-pricing-sonnet-4-6-good.md) | models --view pricing --model claude-sonnet-4.6 shows $2.58/$12.88 per MTok cleanly. |
| 514 | open | Low | Models / positive pattern | [ux-models-provider-xai-works.md](./ux-models-provider-xai-works.md) | models --provider xai lists grok models cleanly. |
| 515 | open | Low | Models / positive pattern | [ux-models-tools-and-feature-tools-redundant-ok.md](./ux-models-tools-and-feature-tools-redundant-ok.md) | models --tools --feature tools --provider anthropic returns same tool-capable set — redundant flags compose… |
| 516 | open | Low | Models | [ux-models-view-raw-bypasses-design-system-reconfirmed.md](./ux-models-view-raw-bypasses-design-system-reconfirmed.md) | models --view raw --search haiku prints bare YAML without design-system panel — reconfirm raw view escape h… |
| 517 | open | Low | Spawn / positive pattern | [ux-pi-agent-alias-works.md](./ux-pi-agent-alias-works.md) | spawn pi-agent resolves to pi and succeeds — positive alias behavior (title shows spawn pi). |
| 518 | open | Low | Pipeline / positive pattern | [ux-pipeline-init-yes-requires-source-good.md](./ux-pipeline-init-yes-requires-source-good.md) | Provide --source or --sources when using --yes is clear non-TTY guidance. |
| 519 | open | Low | Pipeline / positive pattern | [ux-pipeline-max-runs-zero-good-validation.md](./ux-pipeline-max-runs-zero-good-validation.md) | Invalid max-runs "0" returns clear positive-integer validation without raw Commander text — positive patter… |
| 520 | open | Low | Pipeline / positive pattern | [ux-pipeline-run-model-override-shown-on-nothing-to-run.md](./ux-pipeline-run-model-override-shown-on-nothing-to-run.md) | pipeline run with --model shows Model: anthropic/claude-haiku-4.5 in Config even when 21/21 done and Nothin… |
| 521 | open | Low | Pipeline / positive pattern | [ux-pipeline-validate-valid-pipeline-good.md](./ux-pipeline-validate-valid-pipeline-good.md) | pipeline validate on valid pipeline shows Plan, Tasks 21 done, Steps, Plan is valid — clear success framing. |
| 522 | open | Low | Pipeline / positive pattern | [ux-pipeline-validate-wrong-kind-good-message.md](./ux-pipeline-validate-wrong-kind-good-message.md) | pipeline validate on plan-kind file: Invalid plan YAML: "kind" must be "pipeline" — clear kind check (still… |
| 523 | open | Low | Plan / positive pattern | [ux-plan-archive-requires-yes-non-tty-good.md](./ux-plan-archive-requires-yes-non-tty-good.md) | plan archive docs/plans/32-agent-goal.md --output md without --yes: plan archive requires --yes when runnin… |
| 524 | open | Low | Plan / positive pattern | [ux-plan-install-success-good.md](./ux-plan-install-success-good.md) | plan install shows Create path and Installed plan skill with design-system framing — positive pattern. |
| 525 | open | Low | Plan / positive pattern | [ux-plan-kind-invalid-validation-good.md](./ux-plan-kind-invalid-validation-good.md) | Invalid --kind bogus lists Expected plan, pipeline, experiment, ralph, superintendent, superintendent-base. |
| 526 | open | Low | Plan list | [ux-plan-list-json-empty-is-bare-array.md](./ux-plan-list-json-empty-is-bare-array.md) | Empty plan list as JSON is bare [] without envelope — fine for scripts but inconsistent with design-system … |
| 527 | open | Low | Plan list / positive pattern | [ux-plan-list-output-md-is-markdown-table-good.md](./ux-plan-list-output-md-is-markdown-table-good.md) | plan list --output md prints GFM table with Kind/Type/Name/Detail/Updated — good export (still includes REA… |
| 528 | open | Low | Plan list / positive pattern | [ux-plan-list-pipeline-json-good.md](./ux-plan-list-pipeline-json-good.md) | JSON array with kind, path, detail 21/21 done — good machine-readable pipeline list. |
| 529 | open | Low | Plan / positive pattern | [ux-plan-markdown-read-section-by-number-works.md](./ux-plan-markdown-read-section-by-number-works.md) | plan markdown-read-section … "2" returns section 2 User-facing shape content correctly. |
| 530 | open | Low | Plan / positive pattern | [ux-plan-output-invalid-validation-good.md](./ux-plan-output-invalid-validation-good.md) | Invalid --output value "bad" returns Expected one of: terminal, md, json without raw Commander skin. |
| 531 | open | Low | Plan path | [ux-plan-path-commands-bare-stdout-reconfirmed.md](./ux-plan-path-commands-bare-stdout-reconfirmed.md) | pipeline/experiment/superintendent plan-path print absolute path as bare stdout — good for scripting, incon… |
| 532 | open | Low | Plan paths | [ux-plan-path-commands-bare-stdout.md](./ux-plan-path-commands-bare-stdout.md) | Path only. |
| 533 | open | Low | Plan / positive pattern | [ux-plan-view-non-tty-requires-path-good.md](./ux-plan-view-non-tty-requires-path-good.md) | plan view without path: Plan selection requires a path or --yes when running without an interactive TTY — c… |
| 534 | open | Low | Plan / positive pattern | [ux-plan-view-pipeline-md-output-good.md](./ux-plan-view-pipeline-md-output-good.md) | plan view on pipeline plan with --output md produces markdown checklist Status 21/21 done with tasks — good… |
| 535 | open | Low | Providers / positive pattern | [ux-provider-login-anthropic-dry-run-good.md](./ux-provider-login-anthropic-dry-run-good.md) | provider login anthropic --api-key test --yes --dry-run says would save credential without dumping secrets … |
| 536 | open | Low | Providers / positive pattern | [ux-provider-login-cloudflare-requires-base-url-good.md](./ux-provider-login-cloudflare-requires-base-url-good.md) | Provider "cloudflare" requires a base URL. Pass --base-url or set CF_AIG_BASE_URL — clear recovery (still S… |
| 537 | open | Low | Providers / positive pattern | [ux-provider-logout-anthropic-dry-run-good.md](./ux-provider-logout-anthropic-dry-run-good.md) | provider logout anthropic --dry-run only shows would log out + rm credentials.anthropic.enc — good contrast… |
| 538 | open | Low | Providers / positive pattern | [ux-provider-logout-openai-dry-run-clean.md](./ux-provider-logout-openai-dry-run-clean.md) | provider logout openai --dry-run only would log out + rm credentials.openai.enc — clean credential-only dry… |
| 539 | open | Low | Brand | [ux-root-tagline-inconsistent.md](./ux-root-tagline-inconsistent.md) | Different one-liners. |
| 540 | open | Low | Runtime / positive pattern | [ux-runtime-build-host-message-good.md](./ux-runtime-build-host-message-good.md) | Host runtime has no template to build with pass --runtime e2b/docker or config hint — clear recovery. |
| 541 | open | Low | Runtime / positive pattern | [ux-runtime-init-dry-run-clean.md](./ux-runtime-init-dry-run-clean.md) | runtime init --type host --yes --dry-run: would set runtime.type; would create Dockerfile if missing — inte… |
| 542 | open | Low | Configure / positive pattern | [ux-shape-base-url-invalid-validation-good.md](./ux-shape-base-url-invalid-validation-good.md) | Invalid --shape-base-url value returns Use <shape-id>=<url> clearly. |
| 543 | open | Low | Configure / positive pattern | [ux-shape-base-url-unknown-shape-lists-exposed-good.md](./ux-shape-base-url-unknown-shape-lists-exposed-good.md) | Unknown API shape "messages" lists Exposed shapes: openai-chat-completions, openai-responses, anthropic-mes… |
| 544 | open | Low | Spawn / positive pattern | [ux-skill-bridge-failure-lists-paths-good.md](./ux-skill-bridge-failure-lists-paths-good.md) | Failed to bridge active skills lists Not found skill references and searched paths — good recovery content … |
| 545 | open | Low | Skills / positive pattern | [ux-skill-configure-goose-local-success.md](./ux-skill-configure-goose-local-success.md) | skill configure goose --yes --local succeeds at ./.agents/skills with clear path. |
| 546 | open | Low | Skills / positive pattern | [ux-skill-install-from-file-works-well.md](./ux-skill-install-from-file-works-well.md) | skill install with --file/--name/--yes/--local produces a clear design-system success naming agent and path… |
| 547 | open | Low | Spawn / positive pattern | [ux-spawn-at-file-missing-validation-good.md](./ux-spawn-at-file-missing-validation-good.md) | spawn @/tmp/no-prompt.txt reports prompt could not read file with path and ENOENT — clear ValidationError s… |
| 548 | open | Low | Spawn / positive pattern | [ux-spawn-at-file-works.md](./ux-spawn-at-file-works.md) | spawn claude @/tmp/file with content succeeds — reconfirm @file prompt form works. |
| 549 | open | Low | Spawn / positive pattern | [ux-spawn-cursor-with-model-works.md](./ux-spawn-cursor-with-model-works.md) | spawn cursor "say only: ok" --mode read --model anthropic/claude-haiku-4.5 succeeds. |
| 550 | open | Low | Spawn / positive pattern | [ux-spawn-cwd-tmp-works.md](./ux-spawn-cwd-tmp-works.md) | spawn with -C /tmp succeeds; Resume line shows cd /tmp && claude --resume — cwd override works. |
| 551 | open | Low | Spawn / positive pattern | [ux-spawn-invalid-mode-validation-good.md](./ux-spawn-invalid-mode-validation-good.md) | Invalid --mode "bogus" returns Expected yolo, auto, edit, or read without Commander raw skin. |
| 552 | open | Low | Spawn / positive pattern | [ux-spawn-log-default-redacts-agent-message-good.md](./ux-spawn-log-default-redacts-agent-message-good.md) | Default ACP JSONL log writes agent_message text as [redacted] — good privacy default. --log-content include… |
| 553 | open | Low | Spawn / positive pattern | [ux-spawn-pi-yes-works.md](./ux-spawn-pi-yes-works.md) | spawn pi "say only: ok" --yes succeeds without --mode (pi may not require mode like claude). |
| 554 | open | Low | Spawn / positive pattern | [ux-spawn-runtime-docker-error-good-install-hints.md](./ux-spawn-runtime-docker-error-good-install-hints.md) | No container engine found includes Docker Desktop / Colima / Podman install hints — good recovery copy (sti… |
| 555 | open | Low | Spawn / positive pattern | [ux-spawn-runtime-host-works.md](./ux-spawn-runtime-host-works.md) | spawn … --runtime host succeeds for claude with valid model — host runtime path works. |
| 556 | open | Low | Configure / positive pattern | [ux-spawn-test-sonnet-4-6-works.md](./ux-spawn-test-sonnet-4-6-works.md) | spawn and test claude with anthropic/claude-sonnet-4.6 succeed — live model works when explicitly passed; d… |
| 557 | open | Low | Spawn / positive pattern | [ux-spawn-yes-with-explicit-mode-read-works.md](./ux-spawn-yes-with-explicit-mode-read-works.md) | spawn … --yes --mode read succeeds — explicit --mode overrides --yes yolo default as help implies. |
| 558 | open | Low | Tasks / positive pattern | [ux-tasks-verify-format-error-good.md](./ux-tasks-verify-format-error-good.md) | Expected project to use owner/number format is clear (still [error] prefix odd). |
| 559 | open | Low | Test / positive pattern | [ux-test-codex-with-valid-model-succeeds.md](./ux-test-codex-with-valid-model-succeeds.md) | test codex --model openai/gpt-5.3-codex succeeds with design-system Tested Codex framing. |
| 560 | open | Low | Test / positive pattern | [ux-test-goose-with-valid-model-succeeds.md](./ux-test-goose-with-valid-model-succeeds.md) | test goose --model anthropic/claude-haiku-4.5 succeeds with Tested Goose framing. |
| 561 | open | Low | Test / positive pattern | [ux-test-with-valid-model-succeeds.md](./ux-test-with-valid-model-succeeds.md) | test claude --model anthropic/claude-haiku-4.5 succeeds with Tested Claude Code framing when model is valid… |
| 562 | open | Low | Traces / positive pattern | [ux-traces-invalid-source-validation-good.md](./ux-traces-invalid-source-validation-good.md) | traces --source bogus: Unsupported trace source "bogus". Expected one of: claude, codex, poe-code — clear V… |
| 563 | open | Low | Traces / positive pattern | [ux-traces-since-limit-works.md](./ux-traces-since-limit-works.md) | traces --since 1h --limit 3 returns 3 recent traces with sources — filters work. |
| 564 | open | Low | Traces / positive pattern | [ux-traces-source-invalid-validation-good.md](./ux-traces-source-invalid-validation-good.md) | Unsupported trace source lists Expected one of: claude, codex, poe-code without stack. |
| 565 | open | Low | Update / positive pattern | [ux-update-dry-run-always-global-npm.md](./ux-update-dry-run-always-global-npm.md) | update --dry-run plans npm install -g poe-code@latest — clear dry-run (always -g; package-manager override … |
| 566 | open | Low | Update / positive pattern | [ux-update-package-manager-override-works.md](./ux-update-package-manager-override-works.md) | update --package-manager bun --dry-run correctly plans bun install -g poe-code@latest — positive package-ma… |
| 567 | open | Low | Update / positive pattern | [ux-update-pnpm-package-manager-works.md](./ux-update-pnpm-package-manager-works.md) | update --package-manager pnpm --dry-run plans pnpm add -g poe-code@latest — positive package manager overri… |
| 568 | open | Low | Usage / positive pattern | [ux-usage-balance-default-good.md](./ux-usage-balance-default-good.md) | usage with no subcommand shows balance card with plan/add-on and next grant — strong positive. |
| 569 | open | Low | Usage / positive pattern | [ux-usage-balance-presentation-good.md](./ux-usage-balance-presentation-good.md) | usage balance shows Balance, Plan, Add-on, next grant with design-system framing and helpful next-points link. |
| 570 | open | Low | Usage / positive pattern | [ux-usage-list-filter-works-well.md](./ux-usage-list-filter-works-well.md) | usage list --filter Claude-Haiku returns filtered table with clear costs — good list UX (still no --json). |
| 571 | open | Low | Usage / positive pattern | [ux-usage-list-no-match-message-good.md](./ux-usage-list-no-match-message-good.md) | usage list --filter nonexistent-model-xyz → No entries match "…" — clear empty filter message. |
| 572 | open | Low | Utils / positive pattern | [ux-utils-config-init-already-exists-is-info.md](./ux-utils-config-init-already-exists-is-info.md) | config init when project config exists prints Project config already exists at path without error exit dram… |
| 573 | open | Low | Utils / positive pattern | [ux-utils-symlink-agents-already-linked-good.md](./ux-utils-symlink-agents-already-linked-good.md) | utils symlink agents --dry-run prints already linked without error — good idempotent message. |
| 574 | open | Low | Utils / positive pattern | [ux-utils-symlink-skills-both-exist-good-guidance.md](./ux-utils-symlink-skills-both-exist-good-guidance.md) | When both .claude/skills and .agents/skills exist, message explains resolve manually steps — good conflict … |
| 575 | open | Low | Utils / positive pattern | [ux-utils-symlink-skills-yes-local-dry-run-works.md](./ux-utils-symlink-skills-yes-local-dry-run-works.md) | With explicit scope flags, dry-run shows rename+symlink plan — positive once scope is provided (still subje… |

## Platform fixes

1. **Secret redaction** (dry-run diffs + auth + logout) + danger help  
2. **One-line fix: sonnet-5 → sonnet-4.6 in constants.ts + goose map**  
3. Make `--skip-if-configured` truthful  
4. **Validate configure --model against catalog** (reject any-string)  
5. Intentional-only dry-run diffs  
6. Model-aware effortLevel; **honor --reasoning-effort for claude**  
7. Resolve model aliases (sonnet/haiku) to full ids; show resolved id  
8. models `--model` accept namespaced ids; reject invalid modalities/features  
9. Reject empty/invalid explicit flags  
10. Unified permission mode enum; safer --yes defaults  
11. **Unified skill-install scope flags + real --force overwrite policy**  
12. UserError classification; no success glyphs on failure; no JSONL flood on test  
13. displayBinaryName vs npm run dev / toolcraft  
14. Agent capability matrix (spawnable / configurable / installable)  
15. Destructive policy + model catalog validation  
16. Doctor overview  
17. Runtime/launch job GC + fix false "running" success + blank-ID rows  
18. Parent-group next-step defaults  
19. Detach/runner-sync require runtime context  
20. Slim published npm bins  
21. Non-TTY fail-fast: honor **--yes** over POE_NO_PROMPT  
22. Kind-aware plan/experiment/ralph/superintendent doc errors  
23. Split auth logout vs full factory reset  
24. Ralph init bootstrap any markdown  
25. Root command typo suggestions  
26. Fail/warn on unwritable --log-dir  
27. Eval scaffold runnable defaults  
28. **Fix memory INDEX/LOG path contract** (init vs show/ls)  
29. Surface skill/memory on root help  
30. Fix opencode/kimi/gemini credential paths  
31. Hooks source→target capability matrix  
32. Launch without turbo monorepo noise  
33. Opt-in postinstall skill sync  
34. plan browse / plan root non-TTY path/list contract  
35. Primary command Examples (spawn/configure)  
36. Gaslight default prompt should not auto-Implement plans  

## Alphabetical index

| File | # |
| --- | ---: |
| [ux-acp-stream-uses-success-glyph-for-partial-text.md](./ux-acp-stream-uses-success-glyph-for-partial-text.md) | 189 |
| [ux-activity-timeout-1ms-works-but-chrome.md](./ux-activity-timeout-1ms-works-but-chrome.md) | 464 |
| [ux-activity-timeout-ms-uses-system-chrome.md](./ux-activity-timeout-ms-uses-system-chrome.md) | 190 |
| [ux-activity-timeout-zero-good-validation.md](./ux-activity-timeout-zero-good-validation.md) | 465 |
| [ux-activity-timeout-zero-validation-good.md](./ux-activity-timeout-zero-validation-good.md) | 466 |
| [ux-agent-default-model-hardcoded.md](./ux-agent-default-model-hardcoded.md) | 406 |
| [ux-agent-default-model-works-when-opus-valid.md](./ux-agent-default-model-works-when-opus-valid.md) | 467 |
| [ux-agent-default-opus-4-7-not-latest-opus-4-8.md](./ux-agent-default-opus-4-7-not-latest-opus-4-8.md) | 407 |
| [ux-agent-empty-api-key-silently-uses-stored.md](./ux-agent-empty-api-key-silently-uses-stored.md) | 191 |
| [ux-agent-empty-prompt-see-logs.md](./ux-agent-empty-prompt-see-logs.md) | 192 |
| [ux-agent-invalid-model-system-chrome.md](./ux-agent-invalid-model-system-chrome.md) | 193 |
| [ux-agent-spawn-missing-args-raw-commander.md](./ux-agent-spawn-missing-args-raw-commander.md) | 194 |
| [ux-api-key-flags-encourage-shell-history-leaks.md](./ux-api-key-flags-encourage-shell-history-leaks.md) | 195 |
| [ux-approval-copy-hardcodes-toolcraft-in-source.md](./ux-approval-copy-hardcodes-toolcraft-in-source.md) | 18 |
| [ux-approval-queued-message-says-toolcraft.md](./ux-approval-queued-message-says-toolcraft.md) | 19 |
| [ux-approvals-invalid-state-silent-empty-reconfirmed.md](./ux-approvals-invalid-state-silent-empty-reconfirmed.md) | 196 |
| [ux-approvals-invalid-state-silent-empty.md](./ux-approvals-invalid-state-silent-empty.md) | 197 |
| [ux-approvals-show-missing-says-task-not-found.md](./ux-approvals-show-missing-says-task-not-found.md) | 20 |
| [ux-approvals-show-missing-task-debug-tease-reconfirmed.md](./ux-approvals-show-missing-task-debug-tease-reconfirmed.md) | 198 |
| [ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md](./ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md) | 21 |
| [ux-auth-api-key-dry-run-still-prints-secret.md](./ux-auth-api-key-dry-run-still-prints-secret.md) | 4 |
| [ux-auth-api-key-help-no-danger-warning.md](./ux-auth-api-key-help-no-danger-warning.md) | 22 |
| [ux-auth-api-key-help-still-no-danger-reconfirmed.md](./ux-auth-api-key-help-still-no-danger-reconfirmed.md) | 23 |
| [ux-auth-api-key-prints-secret.md](./ux-auth-api-key-prints-secret.md) | 3 |
| [ux-auth-logout-same-as-logout-help.md](./ux-auth-logout-same-as-logout-help.md) | 24 |
| [ux-auth-status-no-json-flag.md](./ux-auth-status-no-json-flag.md) | 408 |
| [ux-auth-whoami-fields-documented-by-shape.md](./ux-auth-whoami-fields-documented-by-shape.md) | 468 |
| [ux-auth-whoami-help-documents-json-good.md](./ux-auth-whoami-help-documents-json-good.md) | 469 |
| [ux-auth-whoami-raw-json-vs-status-panel.md](./ux-auth-whoami-raw-json-vs-status-panel.md) | 409 |
| [ux-auth-whoami-raw-json.md](./ux-auth-whoami-raw-json.md) | 410 |
| [ux-binary-wrappers-undocumented.md](./ux-binary-wrappers-undocumented.md) | 199 |
| [ux-braintrust-only-status-no-enable.md](./ux-braintrust-only-status-no-enable.md) | 200 |
| [ux-braintrust-status-minimal-disabled.md](./ux-braintrust-status-minimal-disabled.md) | 411 |
| [ux-braintrust-status-opaque.md](./ux-braintrust-status-opaque.md) | 470 |
| [ux-capture-otel-alone-silent-success.md](./ux-capture-otel-alone-silent-success.md) | 201 |
| [ux-capture-otel-content-without-capture-silent.md](./ux-capture-otel-content-without-capture-silent.md) | 202 |
| [ux-code-review-double-error-skin.md](./ux-code-review-double-error-skin.md) | 203 |
| [ux-code-review-drafts-missing-arg-double-error.md](./ux-code-review-drafts-missing-arg-double-error.md) | 25 |
| [ux-code-review-drafts-not-found-debug-tease.md](./ux-code-review-drafts-not-found-debug-tease.md) | 204 |
| [ux-code-review-install-no-dry-run-force-writes.md](./ux-code-review-install-no-dry-run-force-writes.md) | 205 |
| [ux-code-review-install-output-unframed-wrapped.md](./ux-code-review-install-output-unframed-wrapped.md) | 206 |
| [ux-code-review-profiles-bare-table.md](./ux-code-review-profiles-bare-table.md) | 207 |
| [ux-code-review-profiles-raw-table.md](./ux-code-review-profiles-raw-table.md) | 412 |
| [ux-code-review-profiles-table-outside-design-system.md](./ux-code-review-profiles-table-outside-design-system.md) | 413 |
| [ux-code-review-prompt-preview-good.md](./ux-code-review-prompt-preview-good.md) | 471 |
| [ux-code-review-prompt-preview-unframed.md](./ux-code-review-prompt-preview-unframed.md) | 208 |
| [ux-code-review-run-invalid-url-wrong-error.md](./ux-code-review-run-invalid-url-wrong-error.md) | 26 |
| [ux-command-aliases-undocumented-on-root-help.md](./ux-command-aliases-undocumented-on-root-help.md) | 414 |
| [ux-command-not-found-no-suggestions.md](./ux-command-not-found-no-suggestions.md) | 209 |
| [ux-configure-accepts-any-string-as-model-no-catalog-check.md](./ux-configure-accepts-any-string-as-model-no-catalog-check.md) | 9 |
| [ux-configure-accepts-invalid-model-without-validation.md](./ux-configure-accepts-invalid-model-without-validation.md) | 27 |
| [ux-configure-api-key-dry-run-redacts-bearer.md](./ux-configure-api-key-dry-run-redacts-bearer.md) | 472 |
| [ux-configure-base-url-may-be-ignored.md](./ux-configure-base-url-may-be-ignored.md) | 28 |
| [ux-configure-codex-dry-run-still-leaks-and-noise.md](./ux-configure-codex-dry-run-still-leaks-and-noise.md) | 29 |
| [ux-configure-codex-reasoning-effort-medium-partial.md](./ux-configure-codex-reasoning-effort-medium-partial.md) | 210 |
| [ux-configure-cursor-dry-run-too-quiet.md](./ux-configure-cursor-dry-run-too-quiet.md) | 211 |
| [ux-configure-cursor-model-flag-silent-noop.md](./ux-configure-cursor-model-flag-silent-noop.md) | 212 |
| [ux-configure-dry-run-dumps-entire-existing-agent-config.md](./ux-configure-dry-run-dumps-entire-existing-agent-config.md) | 30 |
| [ux-configure-dry-run-floods-diff.md](./ux-configure-dry-run-floods-diff.md) | 213 |
| [ux-configure-dry-run-shows-full-existing-settings-as-create.md](./ux-configure-dry-run-shows-full-existing-settings-as-create.md) | 31 |
| [ux-configure-dry-run-writes-stale-model-id.md](./ux-configure-dry-run-writes-stale-model-id.md) | 32 |
| [ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md](./ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md) | 214 |
| [ux-configure-help-missing-examples.md](./ux-configure-help-missing-examples.md) | 33 |
| [ux-configure-kimi-ignores-explicit-novita-namespace.md](./ux-configure-kimi-ignores-explicit-novita-namespace.md) | 215 |
| [ux-configure-model-alias-sonnet-haiku-written-literally.md](./ux-configure-model-alias-sonnet-haiku-written-literally.md) | 34 |
| [ux-configure-non-tty-demands-poe-no-prompt-not-yes.md](./ux-configure-non-tty-demands-poe-no-prompt-not-yes.md) | 35 |
| [ux-configure-provider-requires-model-without-listing-models.md](./ux-configure-provider-requires-model-without-listing-models.md) | 216 |
| [ux-configure-reasoning-effort-ignored-for-claude.md](./ux-configure-reasoning-effort-ignored-for-claude.md) | 36 |
| [ux-configure-shape-base-url-opaque.md](./ux-configure-shape-base-url-opaque.md) | 415 |
| [ux-configure-success-vscode-next-steps-good.md](./ux-configure-success-vscode-next-steps-good.md) | 473 |
| [ux-configure-unknown-provider-good-message.md](./ux-configure-unknown-provider-good-message.md) | 474 |
| [ux-configure-unknown-provider-validation-good.md](./ux-configure-unknown-provider-validation-good.md) | 475 |
| [ux-configure-yes-dry-run-always-defaults-dead-sonnet-5.md](./ux-configure-yes-dry-run-always-defaults-dead-sonnet-5.md) | 8 |
| [ux-configure-yes-silent-default-agent.md](./ux-configure-yes-silent-default-agent.md) | 217 |
| [ux-constants-source-of-dead-sonnet-5.md](./ux-constants-source-of-dead-sonnet-5.md) | 5 |
| [ux-cursor-and-cursor-agent-aliases-both-work.md](./ux-cursor-and-cursor-agent-aliases-both-work.md) | 476 |
| [ux-cwd-file-path-not-directory-good.md](./ux-cwd-file-path-not-directory-good.md) | 477 |
| [ux-cwd-missing-path-good-message.md](./ux-cwd-missing-path-good-message.md) | 478 |
| [ux-dashboard-keybindings-undocumented-on-cli-help.md](./ux-dashboard-keybindings-undocumented-on-cli-help.md) | 218 |
| [ux-dashboard-ui-tui-missing.md](./ux-dashboard-ui-tui-missing.md) | 416 |
| [ux-detach-runtime-host-still-inline.md](./ux-detach-runtime-host-still-inline.md) | 37 |
| [ux-detach-without-runtime-still-inline-reconfirmed.md](./ux-detach-without-runtime-still-inline-reconfirmed.md) | 38 |
| [ux-development-mode-usage-intentional-but-leaks.md](./ux-development-mode-usage-intentional-but-leaks.md) | 39 |
| [ux-doctor-and-completion-still-missing.md](./ux-doctor-and-completion-still-missing.md) | 219 |
| [ux-dry-run-diffs-print-secrets.md](./ux-dry-run-diffs-print-secrets.md) | 1 |
| [ux-dual-help-systems.md](./ux-dual-help-systems.md) | 40 |
| [ux-e2b-missing-key-error-good.md](./ux-e2b-missing-key-error-good.md) | 479 |
| [ux-editor-error-still-system-chrome.md](./ux-editor-error-still-system-chrome.md) | 220 |
| [ux-editor-missing-raw-error.md](./ux-editor-missing-raw-error.md) | 417 |
| [ux-effort-xhigh-valid-for-opus-not-sonnet.md](./ux-effort-xhigh-valid-for-opus-not-sonnet.md) | 41 |
| [ux-empty-api-key-flag-silently-ignored.md](./ux-empty-api-key-flag-silently-ignored.md) | 221 |
| [ux-empty-api-key-flag-still-silently-ignored.md](./ux-empty-api-key-flag-still-silently-ignored.md) | 42 |
| [ux-empty-api-key-login-good-but-configure-ignores.md](./ux-empty-api-key-login-good-but-configure-ignores.md) | 43 |
| [ux-empty-model-flag-behavior-inconsistent.md](./ux-empty-model-flag-behavior-inconsistent.md) | 44 |
| [ux-empty-plan-kind-lists-still-draw-empty-tables.md](./ux-empty-plan-kind-lists-still-draw-empty-tables.md) | 222 |
| [ux-empty-prompt-string-rejected.md](./ux-empty-prompt-string-rejected.md) | 480 |
| [ux-empty-resume-thread-id-silently-ignored.md](./ux-empty-resume-thread-id-silently-ignored.md) | 223 |
| [ux-error-panel-closes-before-error.md](./ux-error-panel-closes-before-error.md) | 45 |
| [ux-eval-check-fails-on-placeholder-target-git-remote.md](./ux-eval-check-fails-on-placeholder-target-git-remote.md) | 46 |
| [ux-eval-empty-source-message-inconsistent-skins.md](./ux-eval-empty-source-message-inconsistent-skins.md) | 224 |
| [ux-eval-errors-outside-design-system.md](./ux-eval-errors-outside-design-system.md) | 418 |
| [ux-eval-init-bare-stdout-no-design-system.md](./ux-eval-init-bare-stdout-no-design-system.md) | 225 |
| [ux-eval-init-creates-in-cwd-with-bare-success.md](./ux-eval-init-creates-in-cwd-with-bare-success.md) | 419 |
| [ux-eval-init-name-validation-bare-text.md](./ux-eval-init-name-validation-bare-text.md) | 226 |
| [ux-eval-init-success-is-bare-paths.md](./ux-eval-init-success-is-bare-paths.md) | 420 |
| [ux-eval-lint-table-good.md](./ux-eval-lint-table-good.md) | 481 |
| [ux-eval-report-debug-flag-undocumented-in-error.md](./ux-eval-report-debug-flag-undocumented-in-error.md) | 421 |
| [ux-eval-report-invalid-format-npm-run-dev.md](./ux-eval-report-invalid-format-npm-run-dev.md) | 47 |
| [ux-eval-run-missing-params-npm-run-dev.md](./ux-eval-run-missing-params-npm-run-dev.md) | 227 |
| [ux-eval-unknown-command-suggests-lint-for-list.md](./ux-eval-unknown-command-suggests-lint-for-list.md) | 228 |
| [ux-experiment-install-already-exists-vs-pipeline-skip.md](./ux-experiment-install-already-exists-vs-pipeline-skip.md) | 48 |
| [ux-experiment-install-force-does-not-overwrite-skill.md](./ux-experiment-install-force-does-not-overwrite-skill.md) | 49 |
| [ux-experiment-install-force-does-not-overwrite.md](./ux-experiment-install-force-does-not-overwrite.md) | 50 |
| [ux-experiment-journal-wrong-doc-type-message.md](./ux-experiment-journal-wrong-doc-type-message.md) | 422 |
| [ux-experiment-journal-wrong-kind-says-not-found.md](./ux-experiment-journal-wrong-kind-says-not-found.md) | 51 |
| [ux-experiment-ralph-no-doc-wrong-message.md](./ux-experiment-ralph-no-doc-wrong-message.md) | 52 |
| [ux-experiment-validate-wrong-kind-says-not-found.md](./ux-experiment-validate-wrong-kind-says-not-found.md) | 53 |
| [ux-extra-npm-bins-confusing.md](./ux-extra-npm-bins-confusing.md) | 423 |
| [ux-extra-npm-bins-still-published-reconfirmed.md](./ux-extra-npm-bins-still-published-reconfirmed.md) | 54 |
| [ux-extra-npm-bins-still-shipped.md](./ux-extra-npm-bins-still-shipped.md) | 55 |
| [ux-failure-shown-as-success-markers.md](./ux-failure-shown-as-success-markers.md) | 56 |
| [ux-frontier-models-only-sonnet-5-is-dead.md](./ux-frontier-models-only-sonnet-5-is-dead.md) | 6 |
| [ux-gaslight-archive-and-no-archive-both-accepted.md](./ux-gaslight-archive-and-no-archive-both-accepted.md) | 424 |
| [ux-gaslight-config-missing-enoent.md](./ux-gaslight-config-missing-enoent.md) | 229 |
| [ux-gaslight-ingest-failure-dumps-jsonl.md](./ux-gaslight-ingest-failure-dumps-jsonl.md) | 57 |
| [ux-gaslight-ingest-limit-zero-validation-good.md](./ux-gaslight-ingest-limit-zero-validation-good.md) | 482 |
| [ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md](./ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md) | 58 |
| [ux-gaslight-install-force-dry-run-vs-already-exists.md](./ux-gaslight-install-force-dry-run-vs-already-exists.md) | 230 |
| [ux-gaslight-install-force-overwrites-without-diff.md](./ux-gaslight-install-force-overwrites-without-diff.md) | 231 |
| [ux-gaslight-install-global-dry-run-clean.md](./ux-gaslight-install-global-dry-run-clean.md) | 483 |
| [ux-gaslight-missing-plan-system-chrome-reconfirmed.md](./ux-gaslight-missing-plan-system-chrome-reconfirmed.md) | 232 |
| [ux-gaslight-multi-plan-fails-fast-with-success-markers.md](./ux-gaslight-multi-plan-fails-fast-with-success-markers.md) | 233 |
| [ux-gaslight-no-activity-timeout-flag.md](./ux-gaslight-no-activity-timeout-flag.md) | 234 |
| [ux-gaslight-no-plan-autopicks-and-hits-stale-model.md](./ux-gaslight-no-plan-autopicks-and-hits-stale-model.md) | 59 |
| [ux-gaslight-opaque-naming.md](./ux-gaslight-opaque-naming.md) | 235 |
| [ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md](./ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md) | 236 |
| [ux-gaslight-plan-path-starts-implement-without-confirm.md](./ux-gaslight-plan-path-starts-implement-without-confirm.md) | 60 |
| [ux-gaslight-unknown-agent-says-service.md](./ux-gaslight-unknown-agent-says-service.md) | 237 |
| [ux-gemini-configure-dry-run-too-quiet.md](./ux-gemini-configure-dry-run-too-quiet.md) | 238 |
| [ux-gemini-still-provider-credential-after-configure-dry-run.md](./ux-gemini-still-provider-credential-after-configure-dry-run.md) | 61 |
| [ux-gh-install-dry-run-lists-paths-without-panel.md](./ux-gh-install-dry-run-lists-paths-without-panel.md) | 239 |
| [ux-gh-install-eject-flag-opaque.md](./ux-gh-install-eject-flag-opaque.md) | 425 |
| [ux-gh-install-preview-without-dry-run-flag.md](./ux-gh-install-preview-without-dry-run-flag.md) | 240 |
| [ux-gh-prompt-preview-dumps-long-unframed-prompt.md](./ux-gh-prompt-preview-dumps-long-unframed-prompt.md) | 241 |
| [ux-gh-uninstall-invalid-name-lists-choices-good.md](./ux-gh-uninstall-invalid-name-lists-choices-good.md) | 484 |
| [ux-gh-variables-list-good.md](./ux-gh-variables-list-good.md) | 485 |
| [ux-github-cwd-clone-errors-still-raw-git.md](./ux-github-cwd-clone-errors-still-raw-git.md) | 62 |
| [ux-github-cwd-clone-errors-unframed.md](./ux-github-cwd-clone-errors-unframed.md) | 184 |
| [ux-global-flags-hidden-on-subcommand-help.md](./ux-global-flags-hidden-on-subcommand-help.md) | 242 |
| [ux-goal-chat-acp-commands-missing.md](./ux-goal-chat-acp-commands-missing.md) | 243 |
| [ux-goose-configure-still-embeds-sonnet-5-in-models-list.md](./ux-goose-configure-still-embeds-sonnet-5-in-models-list.md) | 10 |
| [ux-group-commands-print-help-only.md](./ux-group-commands-print-help-only.md) | 244 |
| [ux-hardcoded-stale-sonnet-5-in-product-defaults.md](./ux-hardcoded-stale-sonnet-5-in-product-defaults.md) | 7 |
| [ux-harness-list-empty-message-good.md](./ux-harness-list-empty-message-good.md) | 486 |
| [ux-harness-list-only-cwd-not-created-dir.md](./ux-harness-list-only-cwd-not-created-dir.md) | 245 |
| [ux-harness-missing-file-system-chrome.md](./ux-harness-missing-file-system-chrome.md) | 246 |
| [ux-harness-new-all-builtin-kinds-work.md](./ux-harness-new-all-builtin-kinds-work.md) | 487 |
| [ux-harness-new-success-good.md](./ux-harness-new-success-good.md) | 488 |
| [ux-harness-new-unknown-template-no-kinds-reconfirmed.md](./ux-harness-new-unknown-template-no-kinds-reconfirmed.md) | 247 |
| [ux-harness-run-missing-file-system-chrome.md](./ux-harness-run-missing-file-system-chrome.md) | 248 |
| [ux-harness-run-no-path-says-no-pairs.md](./ux-harness-run-no-path-says-no-pairs.md) | 426 |
| [ux-harness-run-success-opaque-result-object.md](./ux-harness-run-success-opaque-result-object.md) | 249 |
| [ux-harness-unknown-template-no-kinds.md](./ux-harness-unknown-template-no-kinds.md) | 489 |
| [ux-harness-unknown-template-still-omits-kind-list.md](./ux-harness-unknown-template-still-omits-kind-list.md) | 250 |
| [ux-help-command-not-registered.md](./ux-help-command-not-registered.md) | 251 |
| [ux-help-subcommand-inconsistency.md](./ux-help-subcommand-inconsistency.md) | 490 |
| [ux-hidden-and-orphan-commands.md](./ux-hidden-and-orphan-commands.md) | 252 |
| [ux-hooks-auto-strategy-still-refuses-user-settings.md](./ux-hooks-auto-strategy-still-refuses-user-settings.md) | 63 |
| [ux-hooks-bridge-refuse-user-authored-file-opaque.md](./ux-hooks-bridge-refuse-user-authored-file-opaque.md) | 253 |
| [ux-hooks-from-codex-to-claude-transform-unsupported.md](./ux-hooks-from-codex-to-claude-transform-unsupported.md) | 64 |
| [ux-hooks-from-spawn-poe-code-enoent.md](./ux-hooks-from-spawn-poe-code-enoent.md) | 65 |
| [ux-hooks-from-unknown-lists-supported-good.md](./ux-hooks-from-unknown-lists-supported-good.md) | 491 |
| [ux-hooks-from-unsupported-system-chrome.md](./ux-hooks-from-unsupported-system-chrome.md) | 254 |
| [ux-hooks-scope-project-same-refuse-as-symlink.md](./ux-hooks-scope-project-same-refuse-as-symlink.md) | 255 |
| [ux-hooks-strategy-symlink-refuses-user-settings.md](./ux-hooks-strategy-symlink-refuses-user-settings.md) | 66 |
| [ux-hooks-strategy-transform-unsupported-opaque.md](./ux-hooks-strategy-transform-unsupported-opaque.md) | 67 |
| [ux-important-commands-absent-from-root-help.md](./ux-important-commands-absent-from-root-help.md) | 256 |
| [ux-inconsistent-agent-surface-across-commands.md](./ux-inconsistent-agent-surface-across-commands.md) | 68 |
| [ux-install-always-claims-success.md](./ux-install-always-claims-success.md) | 427 |
| [ux-install-always-success-reconfirmed.md](./ux-install-always-success-reconfirmed.md) | 257 |
| [ux-install-help-missing-yes-and-list.md](./ux-install-help-missing-yes-and-list.md) | 258 |
| [ux-install-non-tty-demands-poe-no-prompt-not-yes.md](./ux-install-non-tty-demands-poe-no-prompt-not-yes.md) | 69 |
| [ux-install-pi-unknown-not-in-installable-list.md](./ux-install-pi-unknown-not-in-installable-list.md) | 70 |
| [ux-install-skill-flags-inconsistent-across-commands.md](./ux-install-skill-flags-inconsistent-across-commands.md) | 71 |
| [ux-install-yes-defaults-agent-silently.md](./ux-install-yes-defaults-agent-silently.md) | 259 |
| [ux-install-yes-silently-defaults-to-claude.md](./ux-install-yes-silently-defaults-to-claude.md) | 72 |
| [ux-json-flag-inconsistent-across-commands.md](./ux-json-flag-inconsistent-across-commands.md) | 260 |
| [ux-kimi-default-model-id-mismatches-catalog-namespace.md](./ux-kimi-default-model-id-mismatches-catalog-namespace.md) | 261 |
| [ux-launch-commands-trigger-full-turbo-rebuild.md](./ux-launch-commands-trigger-full-turbo-rebuild.md) | 262 |
| [ux-launch-missing-process-system-chrome.md](./ux-launch-missing-process-system-chrome.md) | 263 |
| [ux-launch-start-claims-running-then-status-stopped.md](./ux-launch-start-claims-running-then-status-stopped.md) | 73 |
| [ux-launch-start-dumps-turbo-build.md](./ux-launch-start-dumps-turbo-build.md) | 74 |
| [ux-launch-start-opaque-failure.md](./ux-launch-start-opaque-failure.md) | 264 |
| [ux-launch-start-success-then-status-shows-stopped.md](./ux-launch-start-success-then-status-shows-stopped.md) | 75 |
| [ux-launch-start-triggers-turbo-noise-and-opaque-failure.md](./ux-launch-start-triggers-turbo-noise-and-opaque-failure.md) | 76 |
| [ux-launch-start-via-npm-run-dev-confuses-argv.md](./ux-launch-start-via-npm-run-dev-confuses-argv.md) | 265 |
| [ux-launch-status-blank-id-zombie-rows.md](./ux-launch-status-blank-id-zombie-rows.md) | 77 |
| [ux-launch-status-crashes-on-tombstone-dirs.md](./ux-launch-status-crashes-on-tombstone-dirs.md) | 78 |
| [ux-launch-status-shows-dash-id-ghost-rows.md](./ux-launch-status-shows-dash-id-ghost-rows.md) | 79 |
| [ux-launch-status-shows-failed-experiment-leftovers.md](./ux-launch-status-shows-failed-experiment-leftovers.md) | 428 |
| [ux-log-content-flag-no-danger-warning.md](./ux-log-content-flag-no-danger-warning.md) | 266 |
| [ux-log-content-flags-underwarn-sensitive-data.md](./ux-log-content-flags-underwarn-sensitive-data.md) | 267 |
| [ux-log-content-help-underwarns-reconfirmed.md](./ux-log-content-help-underwarns-reconfirmed.md) | 268 |
| [ux-log-dir-unwritable-silently-ignored.md](./ux-log-dir-unwritable-silently-ignored.md) | 80 |
| [ux-login-api-key-rejected-good.md](./ux-login-api-key-rejected-good.md) | 492 |
| [ux-login-help-omits-interactive-and-yes.md](./ux-login-help-omits-interactive-and-yes.md) | 269 |
| [ux-login-help-omits-oauth-default.md](./ux-login-help-omits-oauth-default.md) | 270 |
| [ux-login-help-still-minimal.md](./ux-login-help-still-minimal.md) | 271 |
| [ux-login-non-tty-hangs-on-oauth.md](./ux-login-non-tty-hangs-on-oauth.md) | 81 |
| [ux-login-non-tty-hangs-reconfirmed.md](./ux-login-non-tty-hangs-reconfirmed.md) | 82 |
| [ux-login-rejected-no-recovery.md](./ux-login-rejected-no-recovery.md) | 272 |
| [ux-login-yes-message-good-but-worth-aligning.md](./ux-login-yes-message-good-but-worth-aligning.md) | 493 |
| [ux-logout-dry-run-multi-panel-noise.md](./ux-logout-dry-run-multi-panel-noise.md) | 83 |
| [ux-logout-dry-run-still-multi-panel-unconfigure.md](./ux-logout-dry-run-still-multi-panel-unconfigure.md) | 84 |
| [ux-logout-dry-run-still-prints-secrets-reconfirmed.md](./ux-logout-dry-run-still-prints-secrets-reconfirmed.md) | 2 |
| [ux-logout-help-no-danger-or-scope-detail.md](./ux-logout-help-no-danger-or-scope-detail.md) | 85 |
| [ux-logout-overclaims-scope.md](./ux-logout-overclaims-scope.md) | 16 |
| [ux-maestro-config-vs-workflow-flags-duplicated.md](./ux-maestro-config-vs-workflow-flags-duplicated.md) | 273 |
| [ux-maestro-dry-run-hits-github-401-reconfirmed.md](./ux-maestro-dry-run-hits-github-401-reconfirmed.md) | 86 |
| [ux-maestro-dry-run-hits-github-without-workflow.md](./ux-maestro-dry-run-hits-github-without-workflow.md) | 185 |
| [ux-maestro-dry-run-path-vs-flag-confusion.md](./ux-maestro-dry-run-path-vs-flag-confusion.md) | 87 |
| [ux-maestro-dual-invocation-shape.md](./ux-maestro-dual-invocation-shape.md) | 494 |
| [ux-maestro-duplicate-config-flags.md](./ux-maestro-duplicate-config-flags.md) | 495 |
| [ux-maestro-run-dry-run-still-hits-github-401.md](./ux-maestro-run-dry-run-still-hits-github-401.md) | 88 |
| [ux-maestro-tick-missing-transition-raw-commander.md](./ux-maestro-tick-missing-transition-raw-commander.md) | 274 |
| [ux-maestro-tui-mutual-exclusion-validation-good.md](./ux-maestro-tui-mutual-exclusion-validation-good.md) | 496 |
| [ux-many-parent-groups-only-dump-help.md](./ux-many-parent-groups-only-dump-help.md) | 275 |
| [ux-markdown-read-depth-2-works-well.md](./ux-markdown-read-depth-2-works-well.md) | 497 |
| [ux-mcp-servers-empty-object-accepted.md](./ux-mcp-servers-empty-object-accepted.md) | 429 |
| [ux-mcp-servers-file-and-json-validation-good.md](./ux-mcp-servers-file-and-json-validation-good.md) | 498 |
| [ux-mcp-servers-missing-file-almost-good.md](./ux-mcp-servers-missing-file-almost-good.md) | 430 |
| [ux-mcp-servers-validation-good.md](./ux-mcp-servers-validation-good.md) | 499 |
| [ux-memory-agent-commands-invalid-json-opaque.md](./ux-memory-agent-commands-invalid-json-opaque.md) | 89 |
| [ux-memory-cache-clear-requires-yes-good.md](./ux-memory-cache-clear-requires-yes-good.md) | 500 |
| [ux-memory-clear-help-still-no-force-or-yes.md](./ux-memory-clear-help-still-no-force-or-yes.md) | 276 |
| [ux-memory-clear-no-confirmation.md](./ux-memory-clear-no-confirmation.md) | 277 |
| [ux-memory-clear-requires-yes-non-tty-good.md](./ux-memory-clear-requires-yes-non-tty-good.md) | 501 |
| [ux-memory-clear-yes-works-when-initialized.md](./ux-memory-clear-yes-works-when-initialized.md) | 502 |
| [ux-memory-explain-invalid-json-system-chrome.md](./ux-memory-explain-invalid-json-system-chrome.md) | 90 |
| [ux-memory-ingest-not-init-good.md](./ux-memory-ingest-not-init-good.md) | 503 |
| [ux-memory-install-already-exists-system-chrome.md](./ux-memory-install-already-exists-system-chrome.md) | 278 |
| [ux-memory-install-no-force-already-exists.md](./ux-memory-install-no-force-already-exists.md) | 279 |
| [ux-memory-install-requires-agent-raw-commander.md](./ux-memory-install-requires-agent-raw-commander.md) | 280 |
| [ux-memory-ls-empty-message-good.md](./ux-memory-ls-empty-message-good.md) | 504 |
| [ux-memory-ls-search-show-raw-unframed.md](./ux-memory-ls-search-show-raw-unframed.md) | 281 |
| [ux-memory-mcp-print-config-command-missing.md](./ux-memory-mcp-print-config-command-missing.md) | 282 |
| [ux-memory-mcp-print-config-raw-json.md](./ux-memory-mcp-print-config-raw-json.md) | 431 |
| [ux-memory-query-no-model-flag.md](./ux-memory-query-no-model-flag.md) | 283 |
| [ux-memory-show-cannot-open-root-index-file.md](./ux-memory-show-cannot-open-root-index-file.md) | 17 |
| [ux-memory-show-index-not-found-after-init.md](./ux-memory-show-index-not-found-after-init.md) | 91 |
| [ux-memory-status-after-write-is-terse.md](./ux-memory-status-after-write-is-terse.md) | 432 |
| [ux-memory-write-bare-stdout-path.md](./ux-memory-write-bare-stdout-path.md) | 433 |
| [ux-memory-write-requires-reason-before-path.md](./ux-memory-write-requires-reason-before-path.md) | 284 |
| [ux-memory-write-requires-reason-raw-commander.md](./ux-memory-write-requires-reason-raw-commander.md) | 285 |
| [ux-memory-write-success-is-raw-unframed.md](./ux-memory-write-success-is-raw-unframed.md) | 286 |
| [ux-model-id-namespace-stripping-surprises.md](./ux-model-id-namespace-stripping-surprises.md) | 287 |
| [ux-models-dumps-full-catalog.md](./ux-models-dumps-full-catalog.md) | 288 |
| [ux-models-empty-search-returns-all.md](./ux-models-empty-search-returns-all.md) | 289 |
| [ux-models-endpoint-invalid-good-list-but-stack.md](./ux-models-endpoint-invalid-good-list-but-stack.md) | 92 |
| [ux-models-endpoint-pricing-combo-works.md](./ux-models-endpoint-pricing-combo-works.md) | 505 |
| [ux-models-exact-id-filter-rejects-namespaced-ids.md](./ux-models-exact-id-filter-rejects-namespaced-ids.md) | 93 |
| [ux-models-feature-bogus-silent-empty.md](./ux-models-feature-bogus-silent-empty.md) | 290 |
| [ux-models-feature-flag-not-repeatable.md](./ux-models-feature-flag-not-repeatable.md) | 291 |
| [ux-models-feature-reasoning-filter-works.md](./ux-models-feature-reasoning-filter-works.md) | 506 |
| [ux-models-feature-web-search-works.md](./ux-models-feature-web-search-works.md) | 507 |
| [ux-models-help-examples-are-excellent.md](./ux-models-help-examples-are-excellent.md) | 508 |
| [ux-models-help-examples-still-best-in-class.md](./ux-models-help-examples-still-best-in-class.md) | 509 |
| [ux-models-input-bogus-silent-empty.md](./ux-models-input-bogus-silent-empty.md) | 292 |
| [ux-models-invalid-feature-silent-empty-reconfirmed.md](./ux-models-invalid-feature-silent-empty-reconfirmed.md) | 293 |
| [ux-models-invalid-feature-silent-empty.md](./ux-models-invalid-feature-silent-empty.md) | 294 |
| [ux-models-invalid-modality-silent-empty.md](./ux-models-invalid-modality-silent-empty.md) | 295 |
| [ux-models-model-flag-rejects-namespaced-ids.md](./ux-models-model-flag-rejects-namespaced-ids.md) | 94 |
| [ux-models-openai-tools-filter-works.md](./ux-models-openai-tools-filter-works.md) | 510 |
| [ux-models-output-json-search-returns-empty-inconsistently.md](./ux-models-output-json-search-returns-empty-inconsistently.md) | 95 |
| [ux-models-parameters-view-good-for-filtered.md](./ux-models-parameters-view-good-for-filtered.md) | 511 |
| [ux-models-pricing-search-combo-good.md](./ux-models-pricing-search-combo-good.md) | 512 |
| [ux-models-pricing-sonnet-4-6-good.md](./ux-models-pricing-sonnet-4-6-good.md) | 513 |
| [ux-models-provider-xai-works.md](./ux-models-provider-xai-works.md) | 514 |
| [ux-models-raw-view-bypasses-design-system-reconfirmed.md](./ux-models-raw-view-bypasses-design-system-reconfirmed.md) | 434 |
| [ux-models-raw-view-bypasses-design-system.md](./ux-models-raw-view-bypasses-design-system.md) | 435 |
| [ux-models-search-confirms-sonnet-5-absent-from-catalog.md](./ux-models-search-confirms-sonnet-5-absent-from-catalog.md) | 96 |
| [ux-models-since-1d-empty-today.md](./ux-models-since-1d-empty-today.md) | 436 |
| [ux-models-since-validation-still-prints-stack.md](./ux-models-since-validation-still-prints-stack.md) | 97 |
| [ux-models-tools-and-feature-filter-semantics-undocumented.md](./ux-models-tools-and-feature-filter-semantics-undocumented.md) | 437 |
| [ux-models-tools-and-feature-tools-redundant-ok.md](./ux-models-tools-and-feature-tools-redundant-ok.md) | 515 |
| [ux-models-view-invalid-uses-raw-commander.md](./ux-models-view-invalid-uses-raw-commander.md) | 296 |
| [ux-models-view-raw-bypasses-design-system-reconfirmed.md](./ux-models-view-raw-bypasses-design-system-reconfirmed.md) | 516 |
| [ux-no-doctor-or-health-overview-command.md](./ux-no-doctor-or-health-overview-command.md) | 297 |
| [ux-no-shell-completion-command.md](./ux-no-shell-completion-command.md) | 438 |
| [ux-non-tty-prompt-wrong-guidance.md](./ux-non-tty-prompt-wrong-guidance.md) | 98 |
| [ux-oauth-url-dumps-full-query-string.md](./ux-oauth-url-dumps-full-query-string.md) | 439 |
| [ux-opencode-model-flag-still-triple-namespace.md](./ux-opencode-model-flag-still-triple-namespace.md) | 298 |
| [ux-opencode-model-triple-namespace.md](./ux-opencode-model-triple-namespace.md) | 299 |
| [ux-permission-mode-sets-differ-across-commands.md](./ux-permission-mode-sets-differ-across-commands.md) | 99 |
| [ux-pi-agent-alias-works.md](./ux-pi-agent-alias-works.md) | 517 |
| [ux-pi-spawnable-but-not-configurable.md](./ux-pi-spawnable-but-not-configurable.md) | 100 |
| [ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md](./ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md) | 300 |
| [ux-pipeline-init-yes-requires-source-good.md](./ux-pipeline-init-yes-requires-source-good.md) | 518 |
| [ux-pipeline-install-force-skips-skill-overwrites-steps.md](./ux-pipeline-install-force-skips-skill-overwrites-steps.md) | 101 |
| [ux-pipeline-install-force-skips-skill-still.md](./ux-pipeline-install-force-skips-skill-still.md) | 102 |
| [ux-pipeline-max-runs-zero-good-validation.md](./ux-pipeline-max-runs-zero-good-validation.md) | 519 |
| [ux-pipeline-nothing-to-run-success-framing.md](./ux-pipeline-nothing-to-run-success-framing.md) | 301 |
| [ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md](./ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md) | 103 |
| [ux-pipeline-run-model-override-shown-on-nothing-to-run.md](./ux-pipeline-run-model-override-shown-on-nothing-to-run.md) | 520 |
| [ux-pipeline-tui-flag-ignored-on-init-failure.md](./ux-pipeline-tui-flag-ignored-on-init-failure.md) | 302 |
| [ux-pipeline-validate-enoent-system-error.md](./ux-pipeline-validate-enoent-system-error.md) | 303 |
| [ux-pipeline-validate-no-json-flag.md](./ux-pipeline-validate-no-json-flag.md) | 304 |
| [ux-pipeline-validate-success-still-problems-footer.md](./ux-pipeline-validate-success-still-problems-footer.md) | 440 |
| [ux-pipeline-validate-valid-pipeline-good.md](./ux-pipeline-validate-valid-pipeline-good.md) | 521 |
| [ux-pipeline-validate-wrong-kind-good-message.md](./ux-pipeline-validate-wrong-kind-good-message.md) | 522 |
| [ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md](./ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md) | 305 |
| [ux-pipeline-validate-wrong-kind-system-chrome.md](./ux-pipeline-validate-wrong-kind-system-chrome.md) | 306 |
| [ux-plan-archive-allows-readme.md](./ux-plan-archive-allows-readme.md) | 307 |
| [ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md](./ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md) | 104 |
| [ux-plan-archive-delete-yes-picks-arbitrary-plan.md](./ux-plan-archive-delete-yes-picks-arbitrary-plan.md) | 15 |
| [ux-plan-archive-help-omits-yes-behavior.md](./ux-plan-archive-help-omits-yes-behavior.md) | 105 |
| [ux-plan-archive-json-skips-without-explaining-why.md](./ux-plan-archive-json-skips-without-explaining-why.md) | 106 |
| [ux-plan-archive-requires-yes-non-tty-good.md](./ux-plan-archive-requires-yes-non-tty-good.md) | 523 |
| [ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md](./ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md) | 107 |
| [ux-plan-browse-non-tty-dumps-first-plan.md](./ux-plan-browse-non-tty-dumps-first-plan.md) | 308 |
| [ux-plan-browse-non-tty-dumps-plan-body.md](./ux-plan-browse-non-tty-dumps-plan-body.md) | 108 |
| [ux-plan-browse-rejects-path-argument.md](./ux-plan-browse-rejects-path-argument.md) | 309 |
| [ux-plan-delete-allows-readme.md](./ux-plan-delete-allows-readme.md) | 109 |
| [ux-plan-delete-json-skips-without-reason.md](./ux-plan-delete-json-skips-without-reason.md) | 110 |
| [ux-plan-docs-advertise-goal-and-chat-commands-missing.md](./ux-plan-docs-advertise-goal-and-chat-commands-missing.md) | 310 |
| [ux-plan-edit-editor-true-claims-edited-without-change.md](./ux-plan-edit-editor-true-claims-edited-without-change.md) | 311 |
| [ux-plan-edit-hangs-without-editor.md](./ux-plan-edit-hangs-without-editor.md) | 111 |
| [ux-plan-install-no-force-flag.md](./ux-plan-install-no-force-flag.md) | 312 |
| [ux-plan-install-success-good.md](./ux-plan-install-success-good.md) | 524 |
| [ux-plan-install-yes-defaults-claude-writes-skill.md](./ux-plan-install-yes-defaults-claude-writes-skill.md) | 313 |
| [ux-plan-kind-invalid-validation-good.md](./ux-plan-kind-invalid-validation-good.md) | 525 |
| [ux-plan-list-empty-kind-table-reconfirmed.md](./ux-plan-list-empty-kind-table-reconfirmed.md) | 314 |
| [ux-plan-list-empty-table-no-message.md](./ux-plan-list-empty-table-no-message.md) | 441 |
| [ux-plan-list-includes-exactly-one-readme.md](./ux-plan-list-includes-exactly-one-readme.md) | 315 |
| [ux-plan-list-includes-noise-files.md](./ux-plan-list-includes-noise-files.md) | 316 |
| [ux-plan-list-json-empty-is-bare-array.md](./ux-plan-list-json-empty-is-bare-array.md) | 526 |
| [ux-plan-list-md-includes-readme-noise.md](./ux-plan-list-md-includes-readme-noise.md) | 317 |
| [ux-plan-list-output-json-unframed.md](./ux-plan-list-output-json-unframed.md) | 442 |
| [ux-plan-list-output-md-is-markdown-table-good.md](./ux-plan-list-output-md-is-markdown-table-good.md) | 527 |
| [ux-plan-list-pipeline-json-good.md](./ux-plan-list-pipeline-json-good.md) | 528 |
| [ux-plan-markdown-read-depth-zero-shows-no-sections.md](./ux-plan-markdown-read-depth-zero-shows-no-sections.md) | 318 |
| [ux-plan-markdown-read-raw-yaml-ish-output.md](./ux-plan-markdown-read-raw-yaml-ish-output.md) | 443 |
| [ux-plan-markdown-read-section-by-number-works.md](./ux-plan-markdown-read-section-by-number-works.md) | 529 |
| [ux-plan-markdown-read-section-wrong-command-hint.md](./ux-plan-markdown-read-section-wrong-command-hint.md) | 319 |
| [ux-plan-markdown-read-section-wrong-hint-reconfirmed.md](./ux-plan-markdown-read-section-wrong-hint-reconfirmed.md) | 320 |
| [ux-plan-markdown-read-system-chrome.md](./ux-plan-markdown-read-system-chrome.md) | 321 |
| [ux-plan-non-tty-unclear-failure.md](./ux-plan-non-tty-unclear-failure.md) | 322 |
| [ux-plan-output-invalid-validation-good.md](./ux-plan-output-invalid-validation-good.md) | 530 |
| [ux-plan-path-commands-bare-stdout-reconfirmed.md](./ux-plan-path-commands-bare-stdout-reconfirmed.md) | 531 |
| [ux-plan-path-commands-bare-stdout.md](./ux-plan-path-commands-bare-stdout.md) | 532 |
| [ux-plan-question-non-tty-may-hang.md](./ux-plan-question-non-tty-may-hang.md) | 112 |
| [ux-plan-question-starts-session-without-mode.md](./ux-plan-question-starts-session-without-mode.md) | 323 |
| [ux-plan-root-non-tty-dumps-arbitrary-body.md](./ux-plan-root-non-tty-dumps-arbitrary-body.md) | 113 |
| [ux-plan-view-json-dumps-full-markdown-content.md](./ux-plan-view-json-dumps-full-markdown-content.md) | 444 |
| [ux-plan-view-non-tty-requires-path-good.md](./ux-plan-view-non-tty-requires-path-good.md) | 533 |
| [ux-plan-view-pipeline-md-output-good.md](./ux-plan-view-pipeline-md-output-good.md) | 534 |
| [ux-plan-view-vs-markdown-read-not-found-inconsistent.md](./ux-plan-view-vs-markdown-read-not-found-inconsistent.md) | 324 |
| [ux-postinstall-sync-skills-can-run-on-user-install.md](./ux-postinstall-sync-skills-can-run-on-user-install.md) | 186 |
| [ux-primary-commands-lack-examples-in-help.md](./ux-primary-commands-lack-examples-in-help.md) | 325 |
| [ux-primary-commands-still-lack-examples.md](./ux-primary-commands-still-lack-examples.md) | 326 |
| [ux-problems-footer-on-every-success.md](./ux-problems-footer-on-every-success.md) | 445 |
| [ux-provider-list-agents-column-incomplete.md](./ux-provider-list-agents-column-incomplete.md) | 327 |
| [ux-provider-list-no-json-flag.md](./ux-provider-list-no-json-flag.md) | 328 |
| [ux-provider-login-anthropic-dry-run-good.md](./ux-provider-login-anthropic-dry-run-good.md) | 535 |
| [ux-provider-login-cloudflare-requires-base-url-good.md](./ux-provider-login-cloudflare-requires-base-url-good.md) | 536 |
| [ux-provider-login-missing-key-system-chrome.md](./ux-provider-login-missing-key-system-chrome.md) | 329 |
| [ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md](./ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md) | 114 |
| [ux-provider-login-unknown-has-list-hint-and-see-logs.md](./ux-provider-login-unknown-has-list-hint-and-see-logs.md) | 446 |
| [ux-provider-logout-anthropic-dry-run-good.md](./ux-provider-logout-anthropic-dry-run-good.md) | 537 |
| [ux-provider-logout-dry-run-unconfigures-agents.md](./ux-provider-logout-dry-run-unconfigures-agents.md) | 115 |
| [ux-provider-logout-openai-dry-run-clean.md](./ux-provider-logout-openai-dry-run-clean.md) | 538 |
| [ux-provider-logout-poe-dry-run-still-agent-diffs.md](./ux-provider-logout-poe-dry-run-still-agent-diffs.md) | 116 |
| [ux-ralph-experiment-wrong-kind-says-not-found.md](./ux-ralph-experiment-wrong-kind-says-not-found.md) | 330 |
| [ux-ralph-init-plan-says-not-found.md](./ux-ralph-init-plan-says-not-found.md) | 117 |
| [ux-ralph-init-requires-existing-ralph-doc-circular.md](./ux-ralph-init-requires-existing-ralph-doc-circular.md) | 118 |
| [ux-ralph-run-plan-kind-says-ralph-doc-not-found.md](./ux-ralph-run-plan-kind-says-ralph-doc-not-found.md) | 119 |
| [ux-ralph-run-plan-says-not-found-reconfirmed.md](./ux-ralph-run-plan-says-not-found-reconfirmed.md) | 120 |
| [ux-raw-commander-invalid-option-choices.md](./ux-raw-commander-invalid-option-choices.md) | 331 |
| [ux-raw-commander-missing-args.md](./ux-raw-commander-missing-args.md) | 332 |
| [ux-readme-features-wrap-but-cli-missing.md](./ux-readme-features-wrap-but-cli-missing.md) | 333 |
| [ux-readme-spawn-omits-mode-for-ci.md](./ux-readme-spawn-omits-mode-for-ci.md) | 121 |
| [ux-reasoning-effort-bogus-silently-ignored.md](./ux-reasoning-effort-bogus-silently-ignored.md) | 122 |
| [ux-reasoning-effort-flag-opaque.md](./ux-reasoning-effort-flag-opaque.md) | 334 |
| [ux-reasoning-effort-flag-silently-ignored-for-some-agents.md](./ux-reasoning-effort-flag-silently-ignored-for-some-agents.md) | 123 |
| [ux-reasoning-effort-high-still-writes-xhigh.md](./ux-reasoning-effort-high-still-writes-xhigh.md) | 124 |
| [ux-resume-thread-errors-are-agent-raw.md](./ux-resume-thread-errors-are-agent-raw.md) | 335 |
| [ux-resume-thread-invalid-id-agent-raw-error.md](./ux-resume-thread-invalid-id-agent-raw-error.md) | 125 |
| [ux-root-help-footer-npm-run-dev-for-options.md](./ux-root-help-footer-npm-run-dev-for-options.md) | 126 |
| [ux-root-help-footer-still-npm-run-dev.md](./ux-root-help-footer-still-npm-run-dev.md) | 127 |
| [ux-root-help-lists-19-commands-hides-more.md](./ux-root-help-lists-19-commands-hides-more.md) | 128 |
| [ux-root-help-still-hides-skill-memory.md](./ux-root-help-still-hides-skill-memory.md) | 129 |
| [ux-root-help-usage-line-is-npm-run-dev.md](./ux-root-help-usage-line-is-npm-run-dev.md) | 130 |
| [ux-root-help-usage-still-npm-run-dev-reconfirmed.md](./ux-root-help-usage-still-npm-run-dev-reconfirmed.md) | 131 |
| [ux-root-tagline-inconsistent.md](./ux-root-tagline-inconsistent.md) | 539 |
| [ux-root-typo-still-no-suggestions-reconfirmed.md](./ux-root-typo-still-no-suggestions-reconfirmed.md) | 132 |
| [ux-root-typos-no-did-you-mean-configure-spawn.md](./ux-root-typos-no-did-you-mean-configure-spawn.md) | 133 |
| [ux-runner-sync-and-runtime-invalid-raw-commander.md](./ux-runner-sync-and-runtime-invalid-raw-commander.md) | 336 |
| [ux-runner-sync-without-runtime-silently-accepted.md](./ux-runner-sync-without-runtime-silently-accepted.md) | 337 |
| [ux-runtime-build-host-message-good.md](./ux-runtime-build-host-message-good.md) | 540 |
| [ux-runtime-init-dry-run-clean.md](./ux-runtime-init-dry-run-clean.md) | 541 |
| [ux-runtime-init-non-tty-poe-no-prompt.md](./ux-runtime-init-non-tty-poe-no-prompt.md) | 134 |
| [ux-runtime-job-missing-see-logs.md](./ux-runtime-job-missing-see-logs.md) | 338 |
| [ux-runtime-jobs-list-unbounded-opaque-statuses.md](./ux-runtime-jobs-list-unbounded-opaque-statuses.md) | 339 |
| [ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md](./ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md) | 135 |
| [ux-runtime-jobs-ls-help-no-limit-reconfirmed.md](./ux-runtime-jobs-ls-help-no-limit-reconfirmed.md) | 340 |
| [ux-runtime-jobs-ls-unbounded-stale-from-may.md](./ux-runtime-jobs-ls-unbounded-stale-from-may.md) | 136 |
| [ux-runtime-jobs-show-unknown-suggests-stop.md](./ux-runtime-jobs-show-unknown-suggests-stop.md) | 341 |
| [ux-runtime-jobs-stale-running-zombies.md](./ux-runtime-jobs-stale-running-zombies.md) | 187 |
| [ux-runtime-jobs-stop-lists-many-stale-running.md](./ux-runtime-jobs-stop-lists-many-stale-running.md) | 137 |
| [ux-runtime-missing-deps-good-message-system-chrome.md](./ux-runtime-missing-deps-good-message-system-chrome.md) | 342 |
| [ux-runtime-templates-clear-no-yes-or-dry-run.md](./ux-runtime-templates-clear-no-yes-or-dry-run.md) | 138 |
| [ux-runtime-templates-clear-poe-no-prompt-not-yes.md](./ux-runtime-templates-clear-poe-no-prompt-not-yes.md) | 139 |
| [ux-runtime-templates-ls-shows-empty-docker-row.md](./ux-runtime-templates-ls-shows-empty-docker-row.md) | 447 |
| [ux-runtime-templates-ls-unbounded-noise.md](./ux-runtime-templates-ls-unbounded-noise.md) | 448 |
| [ux-runtime-templates-ls-unbounded-stale.md](./ux-runtime-templates-ls-unbounded-stale.md) | 140 |
| [ux-sdk-cli-mode-default-mismatch.md](./ux-sdk-cli-mode-default-mismatch.md) | 141 |
| [ux-sdk-getpoeapikey-throws-generic-error.md](./ux-sdk-getpoeapikey-throws-generic-error.md) | 343 |
| [ux-shape-base-url-error-good-message-system-prefix.md](./ux-shape-base-url-error-good-message-system-prefix.md) | 449 |
| [ux-shape-base-url-invalid-validation-good.md](./ux-shape-base-url-invalid-validation-good.md) | 542 |
| [ux-shape-base-url-unknown-shape-lists-exposed-good.md](./ux-shape-base-url-unknown-shape-lists-exposed-good.md) | 543 |
| [ux-skill-and-skills-flags-undocumented-relationship.md](./ux-skill-and-skills-flags-undocumented-relationship.md) | 450 |
| [ux-skill-bridge-failure-lists-paths-good.md](./ux-skill-bridge-failure-lists-paths-good.md) | 544 |
| [ux-skill-bridge-failure-system-chrome.md](./ux-skill-bridge-failure-system-chrome.md) | 344 |
| [ux-skill-configure-exists-system-chrome.md](./ux-skill-configure-exists-system-chrome.md) | 142 |
| [ux-skill-configure-goose-local-success.md](./ux-skill-configure-goose-local-success.md) | 545 |
| [ux-skill-configure-goose-writes-dot-agents-skills.md](./ux-skill-configure-goose-writes-dot-agents-skills.md) | 451 |
| [ux-skill-configure-kimi-unsupported-abrupt.md](./ux-skill-configure-kimi-unsupported-abrupt.md) | 345 |
| [ux-skill-configure-yes-defaults-agent-silently.md](./ux-skill-configure-yes-defaults-agent-silently.md) | 346 |
| [ux-skill-configure-yes-defaults-to-claude-already-exists.md](./ux-skill-configure-yes-defaults-to-claude-already-exists.md) | 347 |
| [ux-skill-empty-string-malformed-reference.md](./ux-skill-empty-string-malformed-reference.md) | 452 |
| [ux-skill-help-hides-from-root-reconfirmed.md](./ux-skill-help-hides-from-root-reconfirmed.md) | 143 |
| [ux-skill-install-file-required-before-name.md](./ux-skill-install-file-required-before-name.md) | 348 |
| [ux-skill-install-from-file-works-well.md](./ux-skill-install-from-file-works-well.md) | 546 |
| [ux-skill-install-missing-file-enoent.md](./ux-skill-install-missing-file-enoent.md) | 349 |
| [ux-skill-install-name-and-file-both-required.md](./ux-skill-install-name-and-file-both-required.md) | 350 |
| [ux-skill-memory-absent-from-root-help.md](./ux-skill-memory-absent-from-root-help.md) | 144 |
| [ux-skill-naming-collisions.md](./ux-skill-naming-collisions.md) | 351 |
| [ux-skill-no-list-or-bridge-subcommands.md](./ux-skill-no-list-or-bridge-subcommands.md) | 145 |
| [ux-skill-parent-no-next-step-guidance.md](./ux-skill-parent-no-next-step-guidance.md) | 352 |
| [ux-skill-unconfigure-defaults-agent-and-soft-blocks.md](./ux-skill-unconfigure-defaults-agent-and-soft-blocks.md) | 353 |
| [ux-skill-unconfigure-dry-run-path-inconsistent.md](./ux-skill-unconfigure-dry-run-path-inconsistent.md) | 146 |
| [ux-skills-empty-string-silently-ignored.md](./ux-skills-empty-string-silently-ignored.md) | 354 |
| [ux-skills-flag-without-value-is-noop-or-unclear.md](./ux-skills-flag-without-value-is-noop-or-unclear.md) | 355 |
| [ux-skip-if-configured-dry-run-shows-dead-sonnet-5-default.md](./ux-skip-if-configured-dry-run-shows-dead-sonnet-5-default.md) | 13 |
| [ux-skip-if-configured-dry-run-still-plans-full-rewrite.md](./ux-skip-if-configured-dry-run-still-plans-full-rewrite.md) | 147 |
| [ux-skip-if-configured-help-text-lies.md](./ux-skip-if-configured-help-text-lies.md) | 12 |
| [ux-skip-if-configured-shows-stale-default-model.md](./ux-skip-if-configured-shows-stale-default-model.md) | 148 |
| [ux-skip-if-configured-still-noises-dry-run.md](./ux-skip-if-configured-still-noises-dry-run.md) | 453 |
| [ux-skip-if-configured-still-writes-when-model-differs.md](./ux-skip-if-configured-still-writes-when-model-differs.md) | 356 |
| [ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md](./ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md) | 11 |
| [ux-sonnet-4-6-output-effort-has-no-xhigh.md](./ux-sonnet-4-6-output-effort-has-no-xhigh.md) | 149 |
| [ux-sonnet-5-still-absent-from-catalog.md](./ux-sonnet-5-still-absent-from-catalog.md) | 150 |
| [ux-spawn-advanced-flags-undifferentiated.md](./ux-spawn-advanced-flags-undifferentiated.md) | 357 |
| [ux-spawn-at-file-missing-validation-good.md](./ux-spawn-at-file-missing-validation-good.md) | 547 |
| [ux-spawn-at-file-works.md](./ux-spawn-at-file-works.md) | 548 |
| [ux-spawn-codex-reads-stdin-message-on-tty-less-success.md](./ux-spawn-codex-reads-stdin-message-on-tty-less-success.md) | 358 |
| [ux-spawn-cursor-with-model-works.md](./ux-spawn-cursor-with-model-works.md) | 549 |
| [ux-spawn-cwd-missing-see-logs.md](./ux-spawn-cwd-missing-see-logs.md) | 359 |
| [ux-spawn-cwd-missing-system-chrome.md](./ux-spawn-cwd-missing-system-chrome.md) | 360 |
| [ux-spawn-cwd-tmp-works.md](./ux-spawn-cwd-tmp-works.md) | 550 |
| [ux-spawn-detach-ignored-on-failure-path.md](./ux-spawn-detach-ignored-on-failure-path.md) | 361 |
| [ux-spawn-detach-silently-ignored-without-runtime.md](./ux-spawn-detach-silently-ignored-without-runtime.md) | 151 |
| [ux-spawn-gemini-provider-credential-opaque-error.md](./ux-spawn-gemini-provider-credential-opaque-error.md) | 152 |
| [ux-spawn-help-still-no-examples.md](./ux-spawn-help-still-no-examples.md) | 153 |
| [ux-spawn-interactive-bypasses-design-system-panel.md](./ux-spawn-interactive-bypasses-design-system-panel.md) | 362 |
| [ux-spawn-interactive-non-tty-still-runs.md](./ux-spawn-interactive-non-tty-still-runs.md) | 363 |
| [ux-spawn-interactive-raw-agent-error.md](./ux-spawn-interactive-raw-agent-error.md) | 154 |
| [ux-spawn-interactive-still-uses-stale-model-bare-error.md](./ux-spawn-interactive-still-uses-stale-model-bare-error.md) | 155 |
| [ux-spawn-invalid-mode-validation-good.md](./ux-spawn-invalid-mode-validation-good.md) | 551 |
| [ux-spawn-invalid-model-shows-success-then-failure.md](./ux-spawn-invalid-model-shows-success-then-failure.md) | 156 |
| [ux-spawn-kimi-not-configured-yes-message.md](./ux-spawn-kimi-not-configured-yes-message.md) | 157 |
| [ux-spawn-log-default-redacts-agent-message-good.md](./ux-spawn-log-default-redacts-agent-message-good.md) | 552 |
| [ux-spawn-mode-and-permission-copy.md](./ux-spawn-mode-and-permission-copy.md) | 158 |
| [ux-spawn-no-prompt-system-chrome.md](./ux-spawn-no-prompt-system-chrome.md) | 364 |
| [ux-spawn-pi-yes-works.md](./ux-spawn-pi-yes-works.md) | 553 |
| [ux-spawn-poe-agent-crashes-fs-lstat.md](./ux-spawn-poe-agent-crashes-fs-lstat.md) | 14 |
| [ux-spawn-poe-agent-lstat-reconfirmed.md](./ux-spawn-poe-agent-lstat-reconfirmed.md) | 159 |
| [ux-spawn-runtime-docker-error-good-install-hints.md](./ux-spawn-runtime-docker-error-good-install-hints.md) | 554 |
| [ux-spawn-runtime-host-works.md](./ux-spawn-runtime-host-works.md) | 555 |
| [ux-spawn-stdin-empty-see-logs.md](./ux-spawn-stdin-empty-see-logs.md) | 365 |
| [ux-spawn-success-still-problems-footer.md](./ux-spawn-success-still-problems-footer.md) | 454 |
| [ux-spawn-test-sonnet-4-6-works.md](./ux-spawn-test-sonnet-4-6-works.md) | 556 |
| [ux-spawn-validates-mode-before-agent-reconfirmed.md](./ux-spawn-validates-mode-before-agent-reconfirmed.md) | 366 |
| [ux-spawn-validates-mode-before-agent.md](./ux-spawn-validates-mode-before-agent.md) | 367 |
| [ux-spawn-yes-defaults-to-yolo-mode.md](./ux-spawn-yes-defaults-to-yolo-mode.md) | 160 |
| [ux-spawn-yes-with-explicit-mode-read-works.md](./ux-spawn-yes-with-explicit-mode-read-works.md) | 557 |
| [ux-stale-configured-model-fails-late.md](./ux-stale-configured-model-fails-late.md) | 161 |
| [ux-success-and-info-share-magenta-glyphs.md](./ux-success-and-info-share-magenta-glyphs.md) | 455 |
| [ux-successful-spawn-still-uses-checkmark-for-agent-text.md](./ux-successful-spawn-still-uses-checkmark-for-agent-text.md) | 368 |
| [ux-superintendent-builder-inspector-toolcraft-help.md](./ux-superintendent-builder-inspector-toolcraft-help.md) | 162 |
| [ux-superintendent-complete-wrong-kind-debug-tease.md](./ux-superintendent-complete-wrong-kind-debug-tease.md) | 369 |
| [ux-superintendent-install-already-exists-debug-tease.md](./ux-superintendent-install-already-exists-debug-tease.md) | 163 |
| [ux-superintendent-install-scope-vs-local-global.md](./ux-superintendent-install-scope-vs-local-global.md) | 164 |
| [ux-superintendent-missing-path-double-error.md](./ux-superintendent-missing-path-double-error.md) | 165 |
| [ux-superintendent-validate-unclosed-tag-opaque.md](./ux-superintendent-validate-unclosed-tag-opaque.md) | 370 |
| [ux-superintendent-validate-unclosed-tag.md](./ux-superintendent-validate-unclosed-tag.md) | 166 |
| [ux-tables-ignore-terminal-width.md](./ux-tables-ignore-terminal-width.md) | 371 |
| [ux-tasks-get-github-401-raw-json.md](./ux-tasks-get-github-401-raw-json.md) | 167 |
| [ux-tasks-github-401-raw-json-reconfirmed.md](./ux-tasks-github-401-raw-json-reconfirmed.md) | 168 |
| [ux-tasks-github-auth-raw-error.md](./ux-tasks-github-auth-raw-error.md) | 372 |
| [ux-tasks-import-delete-source-dangerous.md](./ux-tasks-import-delete-source-dangerous.md) | 169 |
| [ux-tasks-import-dry-run-still-requires-to.md](./ux-tasks-import-dry-run-still-requires-to.md) | 373 |
| [ux-tasks-move-delete-source-dangerous.md](./ux-tasks-move-delete-source-dangerous.md) | 170 |
| [ux-tasks-verify-format-error-good.md](./ux-tasks-verify-format-error-good.md) | 558 |
| [ux-test-and-install-reject-spawn-only-agents-as-unknown.md](./ux-test-and-install-reject-spawn-only-agents-as-unknown.md) | 171 |
| [ux-test-codex-with-valid-model-succeeds.md](./ux-test-codex-with-valid-model-succeeds.md) | 559 |
| [ux-test-failure-dumps-jsonl.md](./ux-test-failure-dumps-jsonl.md) | 172 |
| [ux-test-goose-with-valid-model-succeeds.md](./ux-test-goose-with-valid-model-succeeds.md) | 560 |
| [ux-test-kimi-invalid-config-provider-poe-not-found.md](./ux-test-kimi-invalid-config-provider-poe-not-found.md) | 173 |
| [ux-test-opencode-model-not-found-dumps-stack.md](./ux-test-opencode-model-not-found-dumps-stack.md) | 174 |
| [ux-test-with-valid-model-succeeds.md](./ux-test-with-valid-model-succeeds.md) | 561 |
| [ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md](./ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md) | 175 |
| [ux-timeout-errors-use-system-chrome.md](./ux-timeout-errors-use-system-chrome.md) | 374 |
| [ux-toolcraft-has-suggestions-poe-code-root-does-not.md](./ux-toolcraft-has-suggestions-poe-code-root-does-not.md) | 375 |
| [ux-toolcraft-heading-doubles-poe-code.md](./ux-toolcraft-heading-doubles-poe-code.md) | 376 |
| [ux-toolcraft-help-points-at-npm-run-dev.md](./ux-toolcraft-help-points-at-npm-run-dev.md) | 176 |
| [ux-toolcraft-suggests-options-but-still-npm-run-dev.md](./ux-toolcraft-suggests-options-but-still-npm-run-dev.md) | 177 |
| [ux-traces-cwd-only-flag-removed-or-renamed.md](./ux-traces-cwd-only-flag-removed-or-renamed.md) | 456 |
| [ux-traces-directory-path-eisdir.md](./ux-traces-directory-path-eisdir.md) | 377 |
| [ux-traces-enoent-eisdir-still-system-errors.md](./ux-traces-enoent-eisdir-still-system-errors.md) | 178 |
| [ux-traces-invalid-source-validation-good.md](./ux-traces-invalid-source-validation-good.md) | 562 |
| [ux-traces-json-includes-full-prompt-titles.md](./ux-traces-json-includes-full-prompt-titles.md) | 188 |
| [ux-traces-missing-file-system-error.md](./ux-traces-missing-file-system-error.md) | 378 |
| [ux-traces-poe-code-source-titles-are-agent-names.md](./ux-traces-poe-code-source-titles-are-agent-names.md) | 379 |
| [ux-traces-since-limit-works.md](./ux-traces-since-limit-works.md) | 563 |
| [ux-traces-since-validation-cleaner-than-models.md](./ux-traces-since-validation-cleaner-than-models.md) | 179 |
| [ux-traces-source-invalid-validation-good.md](./ux-traces-source-invalid-validation-good.md) | 564 |
| [ux-unconfigure-claude-dry-run-full-settings-dump.md](./ux-unconfigure-claude-dry-run-full-settings-dump.md) | 180 |
| [ux-unconfigure-goose-dry-run-full-config-dump.md](./ux-unconfigure-goose-dry-run-full-config-dump.md) | 380 |
| [ux-unconfigure-help-missing-dry-run-and-yes.md](./ux-unconfigure-help-missing-dry-run-and-yes.md) | 381 |
| [ux-unconfigure-help-no-dry-run-or-yes.md](./ux-unconfigure-help-no-dry-run-or-yes.md) | 382 |
| [ux-unconfigure-missing-agent-raw-commander.md](./ux-unconfigure-missing-agent-raw-commander.md) | 383 |
| [ux-unconfigure-no-confirmation.md](./ux-unconfigure-no-confirmation.md) | 384 |
| [ux-unconfigure-nonconfigured-agent-still-plans-mutations.md](./ux-unconfigure-nonconfigured-agent-still-plans-mutations.md) | 385 |
| [ux-unconfigure-rejects-spawn-only-agents.md](./ux-unconfigure-rejects-spawn-only-agents.md) | 386 |
| [ux-unknown-agent-no-allow-list-or-suggestions.md](./ux-unknown-agent-no-allow-list-or-suggestions.md) | 181 |
| [ux-update-always-suggests-npm-install-g.md](./ux-update-always-suggests-npm-install-g.md) | 387 |
| [ux-update-dry-run-always-global-npm.md](./ux-update-dry-run-always-global-npm.md) | 565 |
| [ux-update-help-omits-dry-run.md](./ux-update-help-omits-dry-run.md) | 457 |
| [ux-update-package-manager-override-works.md](./ux-update-package-manager-override-works.md) | 566 |
| [ux-update-pnpm-package-manager-works.md](./ux-update-pnpm-package-manager-works.md) | 567 |
| [ux-usage-balance-default-good.md](./ux-usage-balance-default-good.md) | 568 |
| [ux-usage-balance-presentation-good.md](./ux-usage-balance-presentation-good.md) | 569 |
| [ux-usage-help-hides-default-balance.md](./ux-usage-help-hides-default-balance.md) | 458 |
| [ux-usage-list-filter-works-well.md](./ux-usage-list-filter-works-well.md) | 570 |
| [ux-usage-list-no-json-flag.md](./ux-usage-list-no-json-flag.md) | 388 |
| [ux-usage-list-no-match-message-good.md](./ux-usage-list-no-match-message-good.md) | 571 |
| [ux-usage-pages-1-still-shows-20-entries.md](./ux-usage-pages-1-still-shows-20-entries.md) | 389 |
| [ux-usage-pages-invalid-raw-commander.md](./ux-usage-pages-invalid-raw-commander.md) | 390 |
| [ux-user-errors-look-like-system-failures.md](./ux-user-errors-look-like-system-failures.md) | 182 |
| [ux-utils-config-edit-missing-editor-system-chrome.md](./ux-utils-config-edit-missing-editor-system-chrome.md) | 391 |
| [ux-utils-config-init-already-exists-is-info.md](./ux-utils-config-init-already-exists-is-info.md) | 572 |
| [ux-utils-config-no-path-subcommand.md](./ux-utils-config-no-path-subcommand.md) | 459 |
| [ux-utils-config-path-subcommand-missing.md](./ux-utils-config-path-subcommand-missing.md) | 392 |
| [ux-utils-config-show-dumps-large-json.md](./ux-utils-config-show-dumps-large-json.md) | 393 |
| [ux-utils-symlink-agents-already-linked-good.md](./ux-utils-symlink-agents-already-linked-good.md) | 573 |
| [ux-utils-symlink-skills-both-exist-good-guidance.md](./ux-utils-symlink-skills-both-exist-good-guidance.md) | 574 |
| [ux-utils-symlink-skills-scope-error-vs-agents.md](./ux-utils-symlink-skills-scope-error-vs-agents.md) | 460 |
| [ux-utils-symlink-skills-yes-local-dry-run-works.md](./ux-utils-symlink-skills-yes-local-dry-run-works.md) | 575 |
| [ux-validation-error-still-prints-stack.md](./ux-validation-error-still-prints-stack.md) | 183 |
| [ux-verbose-prefixes-every-log-line.md](./ux-verbose-prefixes-every-log-line.md) | 461 |
| [ux-version-nags-dev-to-major-jump.md](./ux-version-nags-dev-to-major-jump.md) | 394 |
| [ux-version-still-nags-dev-to-4.0.0.md](./ux-version-still-nags-dev-to-4.0.0.md) | 395 |
| [ux-version-subcommand-missing-use-flag.md](./ux-version-subcommand-missing-use-flag.md) | 396 |
| [ux-version-update-nag-on-dev-builds.md](./ux-version-update-nag-on-dev-builds.md) | 462 |
| [ux-wide-tables-truncate-critical-cells.md](./ux-wide-tables-truncate-critical-cells.md) | 397 |
| [ux-worktree-reconcile-not-found-system-chrome.md](./ux-worktree-reconcile-not-found-system-chrome.md) | 398 |
| [ux-worktree-reconcile-requires-agent-not-in-error-order.md](./ux-worktree-reconcile-requires-agent-not-in-error-order.md) | 463 |
| [ux-worktree-remove-help-no-yes.md](./ux-worktree-remove-help-no-yes.md) | 399 |
| [ux-worktree-remove-help-omits-yes.md](./ux-worktree-remove-help-omits-yes.md) | 400 |
| [ux-worktree-remove-no-confirmation.md](./ux-worktree-remove-no-confirmation.md) | 401 |
| [ux-worktree-remove-not-found-system-chrome.md](./ux-worktree-remove-not-found-system-chrome.md) | 402 |
| [ux-wrap-command-still-missing.md](./ux-wrap-command-still-missing.md) | 403 |
| [ux-wrap-dry-run-forwards-flag.md](./ux-wrap-dry-run-forwards-flag.md) | 404 |
| [ux-wrap-resolves-alias-but-dry-run-lies.md](./ux-wrap-resolves-alias-but-dry-run-lies.md) | 405 |

See [AUDIT_STATUS.md](./AUDIT_STATUS.md).
