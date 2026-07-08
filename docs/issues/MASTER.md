# UX issues — master priority list

**1 = fix first.** Count: **668**. Continuous audit 2026-07-07.

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
| 14 | open | **Critical** | Gaslight / models | [ux-gaslight-empty-model-falls-back-to-dead-sonnet-5.md](./ux-gaslight-empty-model-falls-back-to-dead-sonnet-5.md) | gaslight --model "" falls back to dead claude-sonnet-5 with success glyphs |
| 15 | open | **Critical** | Spawn / poe-agent | [ux-spawn-poe-agent-crashes-fs-lstat.md](./ux-spawn-poe-agent-crashes-fs-lstat.md) | Advertised `spawn poe-agent` crashes: `fs.lstat is not a function` |
| 16 | open | **Critical** | Plan / destructive | [ux-plan-archive-delete-yes-picks-arbitrary-plan.md](./ux-plan-archive-delete-yes-picks-arbitrary-plan.md) | `plan archive|delete --yes` without path mutates an arbitrary plan |
| 17 | open | **Critical** | Auth / destructive | [ux-logout-overclaims-scope.md](./ux-logout-overclaims-scope.md) | `logout` copy says credentials but factory-resets agents + config |
| 18 | open | **Critical** | Memory | [ux-memory-show-cannot-open-root-index-file.md](./ux-memory-show-cannot-open-root-index-file.md) | memory init creates INDEX.md but show/ls cannot open it |
| 19 | open | **High** | Help / capability matrix | [ux-agent-capability-matrix-spawn-vs-configure-vs-install.md](./ux-agent-capability-matrix-spawn-vs-configure-vs-install.md) | spawn accepts pi, pi-agent, poe-agent; configure/install omit pi/poe-agent; configure pi → Unknown agent. N… |
| 20 | open | **High** | Approvals / recovery | [ux-approval-copy-hardcodes-toolcraft-in-source.md](./ux-approval-copy-hardcodes-toolcraft-in-source.md) | Confirmed packages/toolcraft/src/cli.ts and mcp.ts hardcode toolcraft approvals. |
| 21 | open | **High** | Approvals / recovery | [ux-approval-queued-message-says-toolcraft.md](./ux-approval-queued-message-says-toolcraft.md) | Blocked-flow copy Track toolcraft approvals show id. |
| 22 | open | **High** | Approvals | [ux-approvals-show-missing-says-task-not-found.md](./ux-approvals-show-missing-says-task-not-found.md) | approvals show --approval-id missing returns Task "approvals/missing" not found — task terminology for appr… |
| 23 | open | **High** | Auth / security | [ux-auth-api-key-dry-run-still-prints-secret-live-reconfirm.md](./ux-auth-api-key-dry-run-still-prints-secret-live-reconfirm.md) | Reconfirmed live: auth api-key --dry-run prints full key line (redacted in audit logs only by us) — Critica… |
| 24 | open | **High** | Auth / dry-run | [ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md](./ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md) | Reconfirmed Critical: auth api-key --dry-run still emits the full API key (dry-run ignored). |
| 25 | open | **High** | Auth / security | [ux-auth-api-key-help-no-danger-warning.md](./ux-auth-api-key-help-no-danger-warning.md) | Help says only Display stored API key with no mention of masking, --reveal, or secret handling — even thoug… |
| 26 | open | **High** | Auth / security | [ux-auth-api-key-help-still-no-danger-reconfirmed.md](./ux-auth-api-key-help-still-no-danger-reconfirmed.md) | auth api-key --help still only Display stored API key with -h — reconfirm no secret warning. |
| 27 | open | **High** | Auth / destructive | [ux-auth-logout-same-as-logout-help.md](./ux-auth-logout-same-as-logout-help.md) | auth logout help says Remove all configuration and credentials same as root logout — if auth logout is alia… |
| 28 | open | **High** | Code-review / errors | [ux-code-review-drafts-missing-arg-double-error.md](./ux-code-review-drafts-missing-arg-double-error.md) | Missing prUrl shows raw error: missing required argument then design-system error with same text and npm ru… |
| 29 | open | **High** | Code-review | [ux-code-review-run-invalid-url-wrong-error.md](./ux-code-review-run-invalid-url-wrong-error.md) | code-review run "not-a-url" fails with No code-review agent resolved rather than invalid PR URL — validatio… |
| 30 | open | **High** | Configure / models | [ux-configure-accepts-invalid-model-without-validation.md](./ux-configure-accepts-invalid-model-without-validation.md) | configure --model totally-fake-model-xyz --yes --dry-run proceeds to plan writes without validating the mod… |
| 31 | open | **High** | Configure | [ux-configure-base-url-may-be-ignored.md](./ux-configure-base-url-may-be-ignored.md) | configure claude --base-url https://example.com --yes --dry-run still shows ANTHROPIC_BASE_URL api.poe.com … |
| 32 | open | **High** | Configure / dry-run | [ux-configure-base-url-not-visible-in-dry-run.md](./ux-configure-base-url-not-visible-in-dry-run.md) | configure --base-url https://example.invalid --yes --dry-run still shows ANTHROPIC_BASE_URL https://api.poe… |
| 33 | open | **High** | Dry-run | [ux-configure-codex-dry-run-still-leaks-and-noise.md](./ux-configure-codex-dry-run-still-leaks-and-noise.md) | Reconfirmed: even with explicit --model openai/gpt-5.3-codex, dry-run still dumps large config rewrites (pr… |
| 34 | open | **High** | Dry-run / privacy | [ux-configure-dry-run-dumps-entire-existing-agent-config.md](./ux-configure-dry-run-dumps-entire-existing-agent-config.md) | configure codex --dry-run emits a full rewrite-style diff of the agent config that includes dozens of unrel… |
| 35 | open | **High** | Dry-run | [ux-configure-dry-run-shows-full-existing-settings-as-create.md](./ux-configure-dry-run-shows-full-existing-settings-as-create.md) | configure claude dry-run often shows --- /dev/null +++ settings.json with full 145-line content including e… |
| 36 | open | **High** | Configure / models | [ux-configure-dry-run-writes-stale-model-id.md](./ux-configure-dry-run-writes-stale-model-id.md) | configure --yes --dry-run for claude shows default model anthropic/claude-sonnet-5 and would write model cl… |
| 37 | open | **High** | Help / configure | [ux-configure-help-missing-examples.md](./ux-configure-help-missing-examples.md) | configure --help lists options including skip-if-configured but no Examples (contrast models). |
| 38 | open | **High** | Configure / models | [ux-configure-model-alias-sonnet-haiku-written-literally.md](./ux-configure-model-alias-sonnet-haiku-written-literally.md) | configure claude --model sonnet or haiku dry-run writes model: "sonnet" / "haiku" instead of resolving CLAU… |
| 39 | open | **High** | Configure / non-TTY | [ux-configure-non-tty-demands-poe-no-prompt-not-yes.md](./ux-configure-non-tty-demands-poe-no-prompt-not-yes.md) | configure claude without --yes in non-TTY: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — --yes w… |
| 40 | open | **High** | Configure / models | [ux-configure-reasoning-effort-ignored-for-claude.md](./ux-configure-reasoning-effort-ignored-for-claude.md) | configure claude --model opus-4.7 --reasoning-effort low --yes --dry-run still plans effortLevel xhigh — fl… |
| 41 | open | **High** | Configure / dry-run | [ux-configure-shape-base-url-not-visible-in-dry-run.md](./ux-configure-shape-base-url-not-visible-in-dry-run.md) | configure claude --shape-base-url anthropic-messages=https://example.invalid --yes --dry-run still shows AN… |
| 42 | open | **High** | Spawn / runtime | [ux-detach-runtime-host-still-inline.md](./ux-detach-runtime-host-still-inline.md) | spawn … --detach --runtime host still prints ✓ agent and Resume line like normal spawn — no detached job id… |
| 43 | open | **High** | Spawn / runtime | [ux-detach-without-runtime-still-inline-reconfirmed.md](./ux-detach-without-runtime-still-inline-reconfirmed.md) | spawn … --detach without --runtime host/docker/e2b still runs inline with ✓ agent and Resume — no job id (r… |
| 44 | open | **High** | Help / identity | [ux-development-mode-usage-intentional-but-leaks.md](./ux-development-mode-usage-intentional-but-leaks.md) | execution-context maps development to npm run dev -- leaking into all help/errors. |
| 45 | open | **High** | Help | [ux-dual-help-systems.md](./ux-dual-help-systems.md) | Commander vs toolcraft help completely different UIs. |
| 46 | open | **High** | Configure / models | [ux-effort-xhigh-valid-for-opus-not-sonnet.md](./ux-effort-xhigh-valid-for-opus-not-sonnet.md) | Catalog: opus-4.7 output_effort includes xhigh; sonnet-4.6 does not. configure always writes xhigh regardle… |
| 47 | open | **High** | Configure / flags | [ux-empty-api-key-flag-still-silently-ignored.md](./ux-empty-api-key-flag-still-silently-ignored.md) | configure … --api-key "" --yes --dry-run still plans config with existing Bearer (redacted) — empty explici… |
| 48 | open | **High** | Auth / configure | [ux-empty-api-key-login-good-but-configure-ignores.md](./ux-empty-api-key-login-good-but-configure-ignores.md) | login --api-key "" / " " correctly rejects POE API key cannot be empty. configure --api-key "" --yes --dry-… |
| 49 | open | **High** | Models / flags | [ux-empty-model-flag-behavior-inconsistent.md](./ux-empty-model-flag-behavior-inconsistent.md) | --model "" on agent fails with Missing model (good-ish); on spawn falls through to stale configured model a… |
| 50 | open | **High** | Errors / design system | [ux-error-panel-closes-before-error.md](./ux-error-panel-closes-before-error.md) | finalize Problems? then detached error. |
| 51 | open | **High** | Eval | [ux-eval-check-fails-on-placeholder-target-git-remote.md](./ux-eval-check-fails-on-placeholder-target-git-remote.md) | eval init then eval check clones a placeholder target and fails: git: remote-helper git+https aborted — sca… |
| 52 | open | **High** | Eval / identity | [ux-eval-report-invalid-format-npm-run-dev.md](./ux-eval-report-invalid-format-npm-run-dev.md) | Invalid --format bogus returns Expected one of: json, md, table with Run npm run dev -- eval report --help … |
| 53 | open | **High** | Install / consistency | [ux-experiment-install-already-exists-vs-pipeline-skip.md](./ux-experiment-install-already-exists-vs-pipeline-skip.md) | experiment install when skill exists hard-errors Skill already exists; pipeline install --dry-run skips exi… |
| 54 | open | **High** | Experiment / install | [ux-experiment-install-force-does-not-overwrite-skill.md](./ux-experiment-install-force-does-not-overwrite-skill.md) | experiment install --agent claude --local --force still: Skill already exists … See logs — --force document… |
| 55 | open | **High** | Experiment / install | [ux-experiment-install-force-does-not-overwrite.md](./ux-experiment-install-force-does-not-overwrite.md) | experiment install --local --force still fails Skill already exists — --force does not overwrite despite he… |
| 56 | open | **High** | Experiment | [ux-experiment-journal-no-experiment-docs-message.md](./ux-experiment-journal-no-experiment-docs-message.md) | experiment journal: No markdown doc found under docs/plans. Provide a doc path — false: many plans exist; m… |
| 57 | open | **High** | Experiment | [ux-experiment-journal-wrong-kind-says-not-found.md](./ux-experiment-journal-wrong-kind-says-not-found.md) | experiment journal docs/plans/32-agent-goal.md (kind: plan) says Experiment doc not found rather than wrong… |
| 58 | open | **High** | Experiment / Ralph | [ux-experiment-ralph-no-doc-wrong-message.md](./ux-experiment-ralph-no-doc-wrong-message.md) | experiment validate/journal and ralph run without doc say No markdown doc found under docs/plans. Provide a… |
| 59 | open | **High** | Experiment / kind errors | [ux-experiment-validate-wrong-kind-says-not-found.md](./ux-experiment-validate-wrong-kind-says-not-found.md) | experiment validate on agent-goal plan and pipeline plan both: Experiment doc not found — wrong kind, not m… |
| 60 | open | **High** | Package / bins | [ux-extra-npm-bins-still-published-reconfirmed.md](./ux-extra-npm-bins-still-published-reconfirmed.md) | package.json bin still includes poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test… |
| 61 | open | **High** | Packaging | [ux-extra-npm-bins-still-shipped.md](./ux-extra-npm-bins-still-shipped.md) | Root package.json bin still includes poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth… |
| 62 | open | **High** | Pipeline / trust | [ux-failure-shown-as-success-markers.md](./ux-failure-shown-as-success-markers.md) | Pipeline/gaslight use ✓ next to API errors. |
| 63 | open | **High** | Gaslight | [ux-gaslight-ingest-failure-dumps-jsonl.md](./ux-gaslight-ingest-failure-dumps-jsonl.md) | Ingest analysis failure JSONL after Analyzed N prompts. |
| 64 | open | **High** | Gaslight | [ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md](./ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md) | gaslight ingest --dry-run is unknown (falls through to gaslight Interactive prompt requires TTY / POE_NO_PR… |
| 65 | open | **High** | Gaslight | [ux-gaslight-no-plan-autopicks-and-hits-stale-model.md](./ux-gaslight-no-plan-autopicks-and-hits-stale-model.md) | gaslight --yes without plan-path autopicks a plan (e.g. 15-spawn-hooks.md) and fails on dead default model … |
| 66 | open | **High** | Gaslight | [ux-gaslight-plan-path-starts-implement-without-confirm.md](./ux-gaslight-plan-path-starts-implement-without-confirm.md) | gaslight docs/plans/32-agent-goal.md --mode read --yes begins Prompt: Implement <path> and agent starts exp… |
| 67 | open | **High** | Gaslight | [ux-gaslight-plans-flag-still-auto-implement.md](./ux-gaslight-plans-flag-still-auto-implement.md) | gaslight --plans docs/plans/32-agent-goal.md --mode read --yes still Prompt: Implement … and starts agent w… |
| 68 | open | **High** | Gaslight / non-TTY | [ux-gaslight-yes-without-plan-hangs-or-stalls.md](./ux-gaslight-yes-without-plan-hangs-or-stalls.md) | gaslight --mode read --yes --model haiku without plan path stalled past 45s — non-TTY should require plan p… |
| 69 | open | **High** | Spawn / gemini | [ux-gemini-still-provider-credential-after-configure-dry-run.md](./ux-gemini-still-provider-credential-after-configure-dry-run.md) | configure gemini --dry-run plans quiet success; spawn gemini still Cannot resolve providerCredential — reco… |
| 70 | open | **High** | Spawn / github | [ux-github-cwd-clone-errors-still-raw-git.md](./ux-github-cwd-clone-errors-still-raw-git.md) | Invalid github://owner/repo still dumps Cloning into… ERROR: Repository not found fatal… See logs — reconfi… |
| 71 | open | **High** | Harness | [ux-harness-new-kinds-undocumented-must-guess-demo-names.md](./ux-harness-new-kinds-undocumented-must-guess-demo-names.md) | harness new kind help says Built-in template kind without listing; common guesses safejs/agent-script/pipel… |
| 72 | open | **High** | Hooks / spawn | [ux-hooks-auto-strategy-still-refuses-user-settings.md](./ux-hooks-auto-strategy-still-refuses-user-settings.md) | --hooks-from claude-code --hooks-strategy auto fails same Refuse to replace user-authored hook file — auto … |
| 73 | open | **High** | Hooks / spawn | [ux-hooks-from-codex-to-claude-transform-unsupported.md](./ux-hooks-from-codex-to-claude-transform-unsupported.md) | spawn --hooks-from codex fails Transforming hooks from "codex" is not supported yet — help allows --hooks-f… |
| 74 | open | **High** | Hooks / spawn | [ux-hooks-from-spawn-poe-code-enoent.md](./ux-hooks-from-spawn-poe-code-enoent.md) | test/spawn with --hooks-from may exec poe-code not on PATH (tsx entry), opaque ENOENT. |
| 75 | open | **High** | Hooks / spawn | [ux-hooks-strategy-symlink-refuses-user-settings.md](./ux-hooks-strategy-symlink-refuses-user-settings.md) | spawn with --hooks-from claude-code --hooks-strategy symlink fails Refuse to replace user-authored hook fil… |
| 76 | open | **High** | Hooks / spawn | [ux-hooks-strategy-transform-unsupported-opaque.md](./ux-hooks-strategy-transform-unsupported-opaque.md) | Transforming hooks to claude-code is not supported yet is informative but still Error + See logs; help list… |
| 77 | open | **High** | Agents | [ux-inconsistent-agent-surface-across-commands.md](./ux-inconsistent-agent-surface-across-commands.md) | configure/wrap/spawn/skill different agent unions. |
| 78 | open | **High** | Install / non-TTY | [ux-install-non-tty-demands-poe-no-prompt-not-yes.md](./ux-install-non-tty-demands-poe-no-prompt-not-yes.md) | install without agent in non-TTY: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — --yes should sel… |
| 79 | open | **High** | Install / capability matrix | [ux-install-pi-unknown-not-in-installable-list.md](./ux-install-pi-unknown-not-in-installable-list.md) | install pi → Unknown agent; pi is spawnable but not in install agent list — capability matrix gap (related … |
| 80 | open | **High** | Skills / consistency | [ux-install-skill-flags-inconsistent-across-commands.md](./ux-install-skill-flags-inconsistent-across-commands.md) | Skill-related install commands use inconsistent flag sets: skill install has --local/--global/--yes; memory… |
| 81 | open | **High** | Install | [ux-install-yes-silently-defaults-to-claude.md](./ux-install-yes-silently-defaults-to-claude.md) | install without agent non-TTY fails POE_NO_PROMPT; install --yes without agent installs Claude Code with su… |
| 82 | open | **High** | Launch | [ux-launch-start-claims-running-then-status-stopped.md](./ux-launch-start-claims-running-then-status-stopped.md) | launch start sleepjob -- sleep 30 prints Managed process sleepjob is running. Immediately launch status sho… |
| 83 | open | **High** | Launch / identity | [ux-launch-start-dumps-turbo-build.md](./ux-launch-start-dumps-turbo-build.md) | launch start prints full turbo Packages in scope … FULL TURBO before Managed process is running — monorepo … |
| 84 | open | **High** | Launch | [ux-launch-start-success-then-status-shows-stopped.md](./ux-launch-start-success-then-status-shows-stopped.md) | launch start uxsleep2 -- sleep 30 prints Managed process uxsleep2 is running then turbo noise; immediate la… |
| 85 | open | **High** | Launch | [ux-launch-start-triggers-turbo-noise-and-opaque-failure.md](./ux-launch-start-triggers-turbo-noise-and-opaque-failure.md) | launch start foo -- echo hi (and without --) prints full turbo monorepo build output then Managed process f… |
| 86 | open | **High** | Launch | [ux-launch-status-blank-id-zombie-rows.md](./ux-launch-status-blank-id-zombie-rows.md) | After launch rm, status still lists rows with ID - STATUS stopped — registry not cleaned; table fills with … |
| 87 | open | **High** | Launch | [ux-launch-status-crashes-on-tombstone-dirs.md](./ux-launch-status-crashes-on-tombstone-dirs.md) | After launch rm, tombstone dirs named .state-removed-<id>-<uuid> can cause subsequent launch status/start/s… |
| 88 | open | **High** | Launch | [ux-launch-status-shows-dash-id-ghost-rows.md](./ux-launch-status-shows-dash-id-ghost-rows.md) | After failed/removed processes, launch status may show a table row with ID "-", STATUS stopped, empty metri… |
| 89 | open | **High** | Spawn / logging | [ux-log-dir-unwritable-silently-ignored.md](./ux-log-dir-unwritable-silently-ignored.md) | spawn with --log-dir /no/perm/dir still succeeds without warning that logs were not written. |
| 90 | open | **High** | Auth / CI | [ux-login-non-tty-hangs-on-oauth.md](./ux-login-non-tty-hangs-on-oauth.md) | Bare login starts OAuth wait forever without TTY. |
| 91 | open | **High** | Auth / non-TTY | [ux-login-non-tty-hangs-reconfirmed.md](./ux-login-non-tty-hangs-reconfirmed.md) | login without --api-key in non-TTY hung past 45s — reconfirm login-non-tty-hangs-on-oauth rather than fail-… |
| 92 | open | **High** | Logout / dry-run | [ux-logout-dry-run-multi-panel-noise.md](./ux-logout-dry-run-multi-panel-noise.md) | Logout dry-run floods diffs, multiple footers, and can print secrets. |
| 93 | open | **High** | Logout / dry-run | [ux-logout-dry-run-still-multi-panel-unconfigure.md](./ux-logout-dry-run-still-multi-panel-unconfigure.md) | logout --dry-run still nests Poe - unconfigure goose panels and large config dumps — factory-reset dry-run … |
| 94 | open | **High** | Auth / destructive | [ux-logout-help-no-danger-or-scope-detail.md](./ux-logout-help-no-danger-or-scope-detail.md) | logout help only says Remove all configuration and credentials with no file list, agent impact, or confirma… |
| 95 | open | **High** | Maestro | [ux-maestro-dry-run-hits-github-401-reconfirmed.md](./ux-maestro-dry-run-hits-github-401-reconfirmed.md) | maestro --dry-run without valid WORKFLOW/auth: GitHub GraphQL 401 raw JSON — dry-run still network-calls Gi… |
| 96 | open | **High** | Maestro | [ux-maestro-dry-run-path-vs-flag-confusion.md](./ux-maestro-dry-run-path-vs-flag-confusion.md) | `maestro dry-run` treats dry-run as a WORKFLOW.md path (Missing workflow file …/dry-run). `maestro --dry-ru… |
| 97 | open | **High** | Maestro | [ux-maestro-run-dry-run-still-hits-github-401.md](./ux-maestro-run-dry-run-still-hits-github-401.md) | maestro run --dry-run --yes still performs GitHub GraphQL and dumps 401 Bad credentials JSON — dry-run is n… |
| 98 | open | **High** | Plan | [ux-markdown-read-section-wrong-recovery-command.md](./ux-markdown-read-section-wrong-recovery-command.md) | markdown-read-section no-such-section: try read-markdown to see TOC — wrong command name (actual is plan ma… |
| 99 | open | **High** | Memory | [ux-memory-agent-commands-invalid-json-opaque.md](./ux-memory-agent-commands-invalid-json-opaque.md) | memory explain and memory query fail with Memory agent returned invalid JSON output + See logs — no agent s… |
| 100 | open | **High** | Memory | [ux-memory-explain-invalid-json-system-chrome.md](./ux-memory-explain-invalid-json-system-chrome.md) | memory explain pages/hello.md: Memory agent returned invalid JSON output + See logs — agent failure unframed. |
| 101 | open | **High** | Memory | [ux-memory-show-index-not-found-after-init.md](./ux-memory-show-index-not-found-after-init.md) | memory init succeeds; memory show INDEX.md → Page not found: INDEX.md — init claims INDEX.md/LOG.md but sho… |
| 102 | open | **High** | Models / errors | [ux-models-endpoint-invalid-good-list-but-stack.md](./ux-models-endpoint-invalid-good-list-but-stack.md) | Unsupported endpoint message lists Available endpoints (good) but still ERROR log + ValidationError stack —… |
| 103 | open | **High** | Models | [ux-models-exact-id-filter-rejects-namespaced-ids.md](./ux-models-exact-id-filter-rejects-namespaced-ids.md) | models --model anthropic/claude-opus-4.7 returns 0/341 while --model claude-opus-4.7 and --search opus-4.7 … |
| 104 | open | **High** | Models | [ux-models-invalid-endpoint-prints-stack.md](./ux-models-invalid-endpoint-prints-stack.md) | models --endpoint /v1/bogus: good message listing available endpoints, but also ERROR log line + full stack… |
| 105 | open | **High** | Models | [ux-models-invalid-input-output-modality-silent-empty.md](./ux-models-invalid-input-output-modality-silent-empty.md) | models --input bogus and --output bogus → 0/341 No models match — no ValidationError (related --output json… |
| 106 | open | **High** | Models | [ux-models-invalid-provider-silent-empty.md](./ux-models-invalid-provider-silent-empty.md) | models --provider not-a-provider → 0/341 No models match — no error that provider is unknown (contrast endp… |
| 107 | open | **High** | Models | [ux-models-model-flag-rejects-namespaced-ids.md](./ux-models-model-flag-rejects-namespaced-ids.md) | models --model anthropic/claude-haiku-4.5 → 0/341; models --model claude-haiku-4.5 → 1 hit. Help says exact… |
| 108 | open | **High** | Models | [ux-models-output-json-search-returns-empty-inconsistently.md](./ux-models-output-json-search-returns-empty-inconsistently.md) | models --output json silently empties results (invalid modality, not format) |
| 109 | open | **High** | Config / models | [ux-models-search-confirms-sonnet-5-absent-from-catalog.md](./ux-models-search-confirms-sonnet-5-absent-from-catalog.md) | Live catalog has no sonnet-5 (`models --search sonnet-5` → 0/341) while product defaults still reference it… |
| 110 | open | **High** | Models | [ux-models-since-invalid-prints-stack.md](./ux-models-since-invalid-prints-stack.md) | models --since bogus and --since 0d: good Invalid --since duration message but also ERROR log + full Valida… |
| 111 | open | **High** | Errors | [ux-models-since-validation-still-prints-stack.md](./ux-models-since-validation-still-prints-stack.md) | Invalid --since still dumps ERROR log + ValidationError stack + design-system error — reconfirm of validati… |
| 112 | open | **High** | Models | [ux-models-view-raw-namespaced-id-returns-empty-array.md](./ux-models-view-raw-namespaced-id-returns-empty-array.md) | models --view raw --model claude-haiku-4.5 dumps YAML; --model anthropic/claude-haiku-4.5 returns [] — name… |
| 113 | open | **High** | Interactive / CI | [ux-non-tty-prompt-wrong-guidance.md](./ux-non-tty-prompt-wrong-guidance.md) | Error says POE_NO_PROMPT=1; product contract is --yes. |
| 114 | open | **High** | Safety copy | [ux-permission-mode-sets-differ-across-commands.md](./ux-permission-mode-sets-differ-across-commands.md) | spawn: yolo/auto/edit/read; gaslight: read/edit/yolo/auto with default auto; harness: read/edit/auto/yolo; … |
| 115 | open | **High** | Agents | [ux-pi-spawnable-but-not-configurable.md](./ux-pi-spawnable-but-not-configurable.md) | pi on spawn help; configure pi unknown; spawn works. |
| 116 | open | **High** | Pipeline / install | [ux-pipeline-install-force-skips-skill-overwrites-steps.md](./ux-pipeline-install-force-skips-skill-overwrites-steps.md) | pipeline install --agent claude --local --force: Overwrite steps.yaml; Skip skill already exists — --force … |
| 117 | open | **High** | Pipeline / install | [ux-pipeline-install-force-skips-skill-still.md](./ux-pipeline-install-force-skips-skill-still.md) | pipeline install --local --force overwrites steps.yaml but Skip: skill already exists — --force partial; sk… |
| 118 | open | **High** | Pipeline | [ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md](./ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md) | --task foo --yes picks some plan, shows 21/21 done, then task not found. |
| 119 | open | **High** | Plan / destructive | [ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md](./ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md) | plan archive and delete --help still only path, --kind, --output, -h — no --yes, no warning that --yes with… |
| 120 | open | **High** | Plan / destructive | [ux-plan-archive-help-omits-yes-behavior.md](./ux-plan-archive-help-omits-yes-behavior.md) | plan archive help shows optional path and --kind/--output but does not document non-TTY selection requiring… |
| 121 | open | **High** | Plan / destructive | [ux-plan-archive-json-skips-without-explaining-why.md](./ux-plan-archive-json-skips-without-explaining-why.md) | plan archive docs/plans/README.md --output json returns skipped:true, confirmationRequired:true without exp… |
| 122 | open | **High** | Plan / non-TTY | [ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md](./ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md) | plan browse without TTY dumps full body of some plan (toolcraft human-in-loop…) without path or picker — no… |
| 123 | open | **High** | Plan / non-TTY | [ux-plan-browse-non-tty-dumps-plan-body.md](./ux-plan-browse-non-tty-dumps-plan-body.md) | plan browse without TTY dumps a full plan markdown body (looks like plan view of first plan) rather than Va… |
| 124 | open | **High** | Plan / destructive | [ux-plan-delete-allows-readme.md](./ux-plan-delete-allows-readme.md) | plan delete dry-run accepts docs/plans/README.md. |
| 125 | open | **High** | Plan / destructive | [ux-plan-delete-help-still-omits-yes.md](./ux-plan-delete-help-still-omits-yes.md) | plan delete help only path, --kind, --output, -h — no --yes despite non-TTY requiring it. |
| 126 | open | **High** | Plan / destructive | [ux-plan-delete-json-skips-without-reason.md](./ux-plan-delete-json-skips-without-reason.md) | plan delete docs/plans/README.md --output json returns skipped:true without reason field — same opacity as … |
| 127 | open | **High** | Plan / editor | [ux-plan-edit-hangs-without-editor.md](./ux-plan-edit-hangs-without-editor.md) | plan edit without EDITOR/VISUAL can hang or fail to return a clear ValidationError within a short time (obs… |
| 128 | open | **High** | Plan / non-TTY | [ux-plan-question-non-tty-may-hang.md](./ux-plan-question-non-tty-may-hang.md) | poe-code plan "improve tests" --yes in non-TTY can hang past 60s rather than ValidationError requiring TTY … |
| 129 | open | **High** | Plan / non-TTY | [ux-plan-root-non-tty-dumps-arbitrary-body.md](./ux-plan-root-non-tty-dumps-arbitrary-body.md) | poe-code plan without question/subcommand in non-TTY dumps full body of some plan (same as browse) — not a … |
| 130 | open | **High** | Auth / providers | [ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md](./ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md) | auth status reports Logged in as … but provider login poe --yes says No API key found and points to --api-k… |
| 131 | open | **High** | Provider / dry-run | [ux-provider-logout-dry-run-unconfigures-agents.md](./ux-provider-logout-dry-run-unconfigures-agents.md) | provider logout dry-run walks agent unconfigure not just credentials. |
| 132 | open | **High** | Providers / dry-run | [ux-provider-logout-poe-dry-run-still-agent-diffs.md](./ux-provider-logout-poe-dry-run-still-agent-diffs.md) | provider logout poe --dry-run still emits large agent settings diffs (claude plugins, effortLevel, etc.) an… |
| 133 | open | **High** | Providers / destructive | [ux-provider-logout-poe-dry-run-unconfigures-agents.md](./ux-provider-logout-poe-dry-run-unconfigures-agents.md) | provider logout poe --dry-run not only rm credentials.poe.enc but also rewrites goose config and more — bro… |
| 134 | open | **High** | Ralph | [ux-ralph-init-plan-says-not-found.md](./ux-ralph-init-plan-says-not-found.md) | ralph init docs/plans/32-agent-goal.md --dry-run: Ralph doc not found — file exists; ralph requires prior r… |
| 135 | open | **High** | Ralph | [ux-ralph-init-requires-existing-ralph-doc-circular.md](./ux-ralph-init-requires-existing-ralph-doc-circular.md) | ralph init docs/plans/32-agent-goal.md says Ralph doc not found — init cannot bootstrap a plan into ralph k… |
| 136 | open | **High** | Ralph | [ux-ralph-run-plan-kind-says-ralph-doc-not-found.md](./ux-ralph-run-plan-kind-says-ralph-doc-not-found.md) | ralph run docs/plans/32-agent-goal.md (kind: plan) says Ralph doc not found — same wrong-kind-as-missing pa… |
| 137 | open | **High** | Ralph | [ux-ralph-run-plan-says-not-found-reconfirmed.md](./ux-ralph-run-plan-says-not-found-reconfirmed.md) | ralph run docs/plans/32-agent-goal.md --yes: Ralph doc not found — same wrong-kind class as ralph init. |
| 138 | open | **High** | Docs / CI | [ux-readme-spawn-omits-mode-for-ci.md](./ux-readme-spawn-omits-mode-for-ci.md) | README CI spawn one-liners omit --mode/--yes; fail non-interactively. |
| 139 | open | **High** | Configure | [ux-reasoning-effort-bogus-silently-ignored.md](./ux-reasoning-effort-bogus-silently-ignored.md) | configure claude --reasoning-effort bogus --yes --dry-run still plans effortLevel xhigh without rejecting u… |
| 140 | open | **High** | Configure | [ux-reasoning-effort-flag-silently-ignored-for-some-agents.md](./ux-reasoning-effort-flag-silently-ignored-for-some-agents.md) | configure claude --reasoning-effort low/medium/max --yes --dry-run still plans effortLevel xhigh (or does n… |
| 141 | open | **High** | Configure | [ux-reasoning-effort-high-still-writes-xhigh.md](./ux-reasoning-effort-high-still-writes-xhigh.md) | configure claude --reasoning-effort high --model sonnet-4.6 --yes --dry-run still shows effortLevel xhigh —… |
| 142 | open | **High** | Spawn / resume | [ux-resume-thread-invalid-id-agent-raw-error.md](./ux-resume-thread-invalid-id-agent-raw-error.md) | Invalid resume id fails with Claude Code spawn failed … Error: --resume requires a valid session ID… Usage:… |
| 143 | open | **High** | Help / identity | [ux-root-help-footer-npm-run-dev-for-options.md](./ux-root-help-footer-npm-run-dev-for-options.md) | Footer: Run npm run dev -- <command> --help. |
| 144 | open | **High** | Help / identity | [ux-root-help-footer-npm-run-dev-reconfirmed.md](./ux-root-help-footer-npm-run-dev-reconfirmed.md) | Root help footer: Run npm run dev -- <command> --help for command options — reconfirm identity leak on footer. |
| 145 | open | **High** | Help / identity | [ux-root-help-footer-still-npm-run-dev.md](./ux-root-help-footer-still-npm-run-dev.md) | Root help ends with Run npm run dev -- <command> --help for command options — reconfirm development-mode id… |
| 146 | open | **High** | Help / discoverability | [ux-root-help-lists-19-commands-hides-more.md](./ux-root-help-lists-19-commands-hides-more.md) | Root help shows ~19 top-level commands; skill, memory, provider, runtime, launch, worktree, utils, braintru… |
| 147 | open | **High** | Help / discoverability | [ux-root-help-still-hides-skill-memory.md](./ux-root-help-still-hides-skill-memory.md) | Root help includes plan and gaslight but skill and memory remain absent — reconfirm discoverability gap. |
| 148 | open | **High** | Help / identity | [ux-root-help-usage-line-is-npm-run-dev.md](./ux-root-help-usage-line-is-npm-run-dev.md) | Root help Usage: npm run dev -- <command>. |
| 149 | open | **High** | Help / identity | [ux-root-help-usage-still-npm-run-dev-reconfirmed.md](./ux-root-help-usage-still-npm-run-dev-reconfirmed.md) | Root help Usage: npm run dev -- <command> [...args] — reconfirm development-mode identity when run via tsx. |
| 150 | open | **High** | Help / discoverability | [ux-root-typo-still-no-suggestions-reconfirmed.md](./ux-root-typo-still-no-suggestions-reconfirmed.md) | confgure and spaen → Unknown command with npm run dev help — no Did you mean configure/spawn. |
| 151 | open | **High** | Help / suggestions | [ux-root-typos-no-did-you-mean-configure-spawn.md](./ux-root-typos-no-did-you-mean-configure-spawn.md) | Unknown command confgure and spwn show only Run npm run dev -- --help without Did you mean configure/spawn … |
| 152 | open | **High** | Spawn / runtime | [ux-runner-sync-without-detach-silently-ignored.md](./ux-runner-sync-without-detach-silently-ignored.md) | spawn … --runner-sync both without --detach/--runtime succeeds inline — flag has no effect, no warning. |
| 153 | open | **High** | Runtime / non-TTY | [ux-runtime-init-non-tty-poe-no-prompt.md](./ux-runtime-init-non-tty-poe-no-prompt.md) | runtime init without TTY says Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — obscure env vs stand… |
| 154 | open | **High** | Runtime jobs | [ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md](./ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md) | runtime jobs logs without jobId errors with More than one … Pass a job id and lists many jobs including run… |
| 155 | open | **High** | Runtime jobs | [ux-runtime-jobs-ls-unbounded-stale-from-may.md](./ux-runtime-jobs-ls-unbounded-stale-from-may.md) | runtime jobs ls shows huge table including pending e2b jobs and exited host jobs from 2026-05-04 with no --… |
| 156 | open | **High** | Runtime jobs | [ux-runtime-jobs-stop-lists-many-stale-running.md](./ux-runtime-jobs-stop-lists-many-stale-running.md) | runtime jobs stop/attach without job id lists dozens of "running" jobs dating back weeks — zombie job state… |
| 157 | open | **High** | Runtime | [ux-runtime-templates-clear-no-yes-or-dry-run.md](./ux-runtime-templates-clear-no-yes-or-dry-run.md) | runtime templates clear --help only -h; non-TTY requires POE_NO_PROMPT; no dry-run of what will be deleted … |
| 158 | open | **High** | Runtime / non-TTY | [ux-runtime-templates-clear-poe-no-prompt-not-yes.md](./ux-runtime-templates-clear-poe-no-prompt-not-yes.md) | runtime templates clear without --yes: Interactive prompt requires TTY. Set POE_NO_PROMPT=1 — --yes works w… |
| 159 | open | **High** | Runtime | [ux-runtime-templates-ls-unbounded-stale.md](./ux-runtime-templates-ls-unbounded-stale.md) | runtime templates ls shows many e2b template cache rows from 2026-05-04 with no --limit — same unbounded hi… |
| 160 | open | **High** | SDK / safety | [ux-sdk-cli-mode-default-mismatch.md](./ux-sdk-cli-mode-default-mismatch.md) | SDK defaults mode to yolo; CLI spawn prompts/--yes yolo; gaslight defaults auto. |
| 161 | open | **High** | Skills | [ux-skill-configure-exists-system-chrome.md](./ux-skill-configure-exists-system-chrome.md) | skill configure claude-code --yes (global default) fails Skill already exists: ~/.claude/skills/poe-generat… |
| 162 | open | **High** | Help / discoverability | [ux-skill-help-hides-from-root-reconfirmed.md](./ux-skill-help-hides-from-root-reconfirmed.md) | Skill group works when invoked but remains absent from root help command list — reconfirm discoverability. |
| 163 | open | **High** | Help / discoverability | [ux-skill-memory-absent-from-root-help.md](./ux-skill-memory-absent-from-root-help.md) | Root --help does not list skill or memory though both exist as parent commands — reaffirm important-command… |
| 164 | open | **High** | Skills / discoverability | [ux-skill-no-list-or-bridge-subcommands.md](./ux-skill-no-list-or-bridge-subcommands.md) | skill list and skill bridge are Unknown command — skill only install/configure/unconfigure. Users cannot li… |
| 165 | open | **High** | Skills | [ux-skill-unconfigure-dry-run-path-inconsistent.md](./ux-skill-unconfigure-dry-run-path-inconsistent.md) | skill unconfigure claude-code --local --yes --dry-run says Would remove skills directory ~/.claude/skills A… |
| 166 | open | **High** | Configure | [ux-skip-if-configured-dry-run-still-plans-full-rewrite.md](./ux-skip-if-configured-dry-run-still-plans-full-rewrite.md) | Even with matching model and --skip-if-configured --dry-run, configure still emits full create settings.jso… |
| 167 | open | **High** | Configure / models | [ux-skip-if-configured-shows-stale-default-model.md](./ux-skip-if-configured-shows-stale-default-model.md) | Already-configured path prints anthropic/claude-sonnet-5 as default model though API rejects it. |
| 168 | open | **High** | Configure / models | [ux-sonnet-4-6-output-effort-has-no-xhigh.md](./ux-sonnet-4-6-output-effort-has-no-xhigh.md) | models --view parameters --model claude-sonnet-4.6 shows output_effort enum max, high, medium, low, none (d… |
| 169 | open | **High** | Config / models | [ux-sonnet-5-still-absent-from-catalog.md](./ux-sonnet-5-still-absent-from-catalog.md) | Reconfirmed: models --search sonnet-5 → 0/341 while product defaults still reference it. |
| 170 | open | **High** | Spawn / runtime | [ux-spawn-detach-silently-ignored-without-runtime.md](./ux-spawn-detach-silently-ignored-without-runtime.md) | spawn … --detach without --runtime still runs the agent inline and succeeds; no warning that detach require… |
| 171 | open | **High** | Spawn / gemini | [ux-spawn-gemini-provider-credential-opaque-error.md](./ux-spawn-gemini-provider-credential-opaque-error.md) | spawn gemini with an explicit model can fail with Cannot resolve "providerCredential": no active provider o… |
| 172 | open | **High** | Help / spawn | [ux-spawn-help-still-no-examples.md](./ux-spawn-help-still-no-examples.md) | spawn --help lists many advanced flags but no Examples for common flows (read mode one-shot, @file, --yes). |
| 173 | open | **High** | Spawn / interactive | [ux-spawn-interactive-raw-agent-error.md](./ux-spawn-interactive-raw-agent-error.md) | Interactive spawn without prompt/TTY surfaces raw agent-native --print error outside design system. |
| 174 | open | **High** | Spawn / interactive | [ux-spawn-interactive-still-uses-stale-model-bare-error.md](./ux-spawn-interactive-still-uses-stale-model-bare-error.md) | Even with prompt and -i, non-TTY spawn can surface bare API Error: 400 Unsupported model without design-sys… |
| 175 | open | **High** | Spawn / errors | [ux-spawn-invalid-model-shows-success-then-failure.md](./ux-spawn-invalid-model-shows-success-then-failure.md) | spawn with --model does-not-exist-xyz prints ✓ agent: API Error: 400 Unsupported model and ✓ tokens then Er… |
| 176 | open | **High** | Spawn / kimi | [ux-spawn-kimi-not-configured-yes-message.md](./ux-spawn-kimi-not-configured-yes-message.md) | spawn kimi without configure: Kimi is not configured via poe. Pass --yes to proceed without prompting — unc… |
| 177 | open | **High** | Safety copy | [ux-spawn-mode-and-permission-copy.md](./ux-spawn-mode-and-permission-copy.md) | Modes minimal definition; --yes uses yolo buried; order differs spawn vs gaslight. |
| 178 | open | **High** | Spawn / poe-agent | [ux-spawn-poe-agent-lstat-reconfirmed.md](./ux-spawn-poe-agent-lstat-reconfirmed.md) | Live reconfirm: spawn poe-agent "hi" --mode read → fs.lstat is not a function + See logs. |
| 179 | open | **High** | Spawn / worktree | [ux-spawn-worktree-flag-missing-on-spawn.md](./ux-spawn-worktree-flag-missing-on-spawn.md) | spawn --worktree is unknown option; worktree exists on gaslight/ralph/pipeline/experiment — spawn users can… |
| 180 | open | **High** | Spawn / safety | [ux-spawn-yes-defaults-to-yolo-mode.md](./ux-spawn-yes-defaults-to-yolo-mode.md) | spawn --yes without --mode runs successfully (uses yolo per help). Help documents --yes uses yolo — good if… |
| 181 | open | **High** | Config / models | [ux-stale-configured-model-fails-late.md](./ux-stale-configured-model-fails-late.md) | Invalid configured model ids only fail mid gaslight/pipeline with API 400 and success checkmarks. |
| 182 | open | **High** | Superintendent / identity | [ux-superintendent-builder-inspector-toolcraft-help.md](./ux-superintendent-builder-inspector-toolcraft-help.md) | superintendent builder and inspector --help show Usage: npm run dev -- superintendent builder… — dual help … |
| 183 | open | **High** | Help / identity | [ux-superintendent-help-npm-run-dev-reconfirmed.md](./ux-superintendent-help-npm-run-dev-reconfirmed.md) | superintendent run/complete help Usage: npm run dev -- superintendent … — reconfirm identity leak on toolcr… |
| 184 | open | **High** | Superintendent / install | [ux-superintendent-install-already-exists-debug-tease.md](./ux-superintendent-install-already-exists-debug-tease.md) | superintendent install when skill exists: Skill already exists … Use --debug for a stack trace — toolcraft … |
| 185 | open | **High** | Install / flags | [ux-superintendent-install-scope-vs-local-global.md](./ux-superintendent-install-scope-vs-local-global.md) | superintendent install --scope local/global (npm run dev help); experiment/pipeline use --local/--global — … |
| 186 | open | **High** | Superintendent / errors | [ux-superintendent-missing-path-double-error.md](./ux-superintendent-missing-path-double-error.md) | superintendent validate and complete without path print raw Commander missing required argument then design… |
| 187 | open | **High** | Superintendent / kind errors | [ux-superintendent-validate-unclosed-tag.md](./ux-superintendent-validate-unclosed-tag.md) | superintendent validate docs/plans/32-agent-goal.md → Superintendent document is invalid (1 error): Unclose… |
| 188 | open | **High** | Tasks / GitHub | [ux-tasks-get-github-401-raw-json.md](./ux-tasks-get-github-401-raw-json.md) | tasks get missing-id fails with raw GitHub GraphQL 401 JSON Bad credentials — unframed auth error. |
| 189 | open | **High** | Tasks | [ux-tasks-github-401-raw-json-reconfirmed.md](./ux-tasks-github-401-raw-json-reconfirmed.md) | tasks get/next without valid GitHub auth dump [error] GitHub GraphQL request failed with status 401: { json… |
| 190 | open | **High** | Tasks / destructive | [ux-tasks-import-delete-source-dangerous.md](./ux-tasks-import-delete-source-dangerous.md) | tasks import has --delete-source to delete markdown after import and --keep — help does not emphasize irrev… |
| 191 | open | **High** | Tasks / destructive | [ux-tasks-move-delete-source-dangerous.md](./ux-tasks-move-delete-source-dangerous.md) | tasks move has --delete-source without documenting --yes requirement or irreversibility (same class as impo… |
| 192 | open | **High** | Agents | [ux-test-and-install-reject-spawn-only-agents-as-unknown.md](./ux-test-and-install-reject-spawn-only-agents-as-unknown.md) | poe-agent/pi fail test/install with Unknown agent (false). |
| 193 | open | **High** | Test / errors | [ux-test-failure-dumps-jsonl.md](./ux-test-failure-dumps-jsonl.md) | test failure inlines hook JSONL flood. |
| 194 | open | **High** | Test / kimi | [ux-test-kimi-invalid-config-provider-poe-not-found.md](./ux-test-kimi-invalid-config-provider-poe-not-found.md) | test kimi --model novitaai/kimi-k2.5 fails: Invalid configuration file … Provider poe not found in provider… |
| 195 | open | **High** | Test / opencode | [ux-test-opencode-model-mapping-still-broken.md](./ux-test-opencode-model-mapping-still-broken.md) | test opencode --model anthropic/claude-haiku-4.5 still: Model not found: poe/anthropic/claude-haiku-4.5 wit… |
| 196 | open | **High** | Test / opencode | [ux-test-opencode-model-not-found-dumps-stack.md](./ux-test-opencode-model-not-found-dumps-stack.md) | test opencode --model anthropic/claude-haiku-4.5 fails: Model not found: poe/anthropic/claude-haiku-4.5 wit… |
| 197 | open | **High** | Test | [ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md](./ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md) | test --yes without agent defaults to claude-code; failure dumps long hook JSONL stdout and See logs — healt… |
| 198 | open | **High** | Help / identity | [ux-toolcraft-help-points-at-npm-run-dev.md](./ux-toolcraft-help-points-at-npm-run-dev.md) | Toolcraft groups bake monorepo invocation. |
| 199 | open | **High** | Help / identity | [ux-toolcraft-suggests-options-but-still-npm-run-dev.md](./ux-toolcraft-suggests-options-but-still-npm-run-dev.md) | Good option suggestions; wrong recovery footer. |
| 200 | open | **High** | Traces | [ux-traces-enoent-eisdir-still-system-errors.md](./ux-traces-enoent-eisdir-still-system-errors.md) | traces /tmp/no-such-trace.jsonl → ENOENT…; traces /tmp → EISDIR… + See logs — reconfirm of traces-missing-f… |
| 201 | open | **High** | Errors / consistency | [ux-traces-since-validation-cleaner-than-models.md](./ux-traces-since-validation-cleaner-than-models.md) | traces --since notaduration returns short Invalid duration for --since without stack; models --since notadu… |
| 202 | open | **High** | Dry-run | [ux-unconfigure-claude-dry-run-full-settings-dump.md](./ux-unconfigure-claude-dry-run-full-settings-dump.md) | unconfigure claude-code --dry-run shows full settings.json rewrite with hooks, permissions, plugins — not j… |
| 203 | open | **High** | Security / dry-run | [ux-unconfigure-goose-dry-run-still-prints-secrets.md](./ux-unconfigure-goose-dry-run-still-prints-secrets.md) | unconfigure goose --dry-run rewrites secrets.yaml with CUSTOM_POE_API_KEY: sk-poe-… — Critical secret leak … |
| 204 | open | **High** | Agents | [ux-unknown-agent-no-allow-list-or-suggestions.md](./ux-unknown-agent-no-allow-list-or-suggestions.md) | install/test/configure/unconfigure unknown agent say Unknown agent "notanagent" (+ See logs) without listin… |
| 205 | open | **High** | Errors / trust | [ux-user-errors-look-like-system-failures.md](./ux-user-errors-look-like-system-failures.md) | Recoverable errors thrown as Error; bootstrap See logs + errors.log. |
| 206 | open | **High** | Errors | [ux-validation-error-still-prints-stack.md](./ux-validation-error-still-prints-stack.md) | ValidationError paths dump stack + double-render. |
| 207 | open | Medium–High | Spawn / workspaces | [ux-github-cwd-clone-errors-unframed.md](./ux-github-cwd-clone-errors-unframed.md) | Bad locator raw git stderr. |
| 208 | open | Medium–High | Maestro | [ux-maestro-dry-run-hits-github-without-workflow.md](./ux-maestro-dry-run-hits-github-without-workflow.md) | Dry-run hits GraphQL 401 JSON. |
| 209 | open | Medium–High | Install / postinstall | [ux-postinstall-sync-skills-can-run-on-user-install.md](./ux-postinstall-sync-skills-can-run-on-user-install.md) | package.json postinstall: node scripts/postinstall-sync-skills.mjs — runs skill sync on every install unles… |
| 210 | open | Medium–High | Runtime | [ux-runtime-jobs-stale-running-zombies.md](./ux-runtime-jobs-stale-running-zombies.md) | running since May. |
| 211 | open | Medium–High | Traces / privacy | [ux-traces-json-includes-full-prompt-titles.md](./ux-traces-json-includes-full-prompt-titles.md) | traces --json dumps title fields that can be entire memory-query prompts or long user messages — useful for… |
| 212 | open | Medium | Visual language | [ux-acp-stream-uses-success-glyph-for-partial-text.md](./ux-acp-stream-uses-success-glyph-for-partial-text.md) | Checkmark for partial text. |
| 213 | open | Medium | Spawn / timeouts | [ux-activity-timeout-ms-uses-system-chrome.md](./ux-activity-timeout-ms-uses-system-chrome.md) | spawn … --activity-timeout-ms 1 fails Agent spawn timed out after 0.001s of inactivity with See logs — time… |
| 214 | open | Medium | Agent | [ux-agent-empty-api-key-silently-uses-stored.md](./ux-agent-empty-api-key-silently-uses-stored.md) | agent "…" --api-key "" succeeds with tokens — empty api-key ignored, uses stored auth (same empty-flag class). |
| 215 | open | Medium | Agent | [ux-agent-empty-model-see-logs.md](./ux-agent-empty-model-see-logs.md) | agent --model "" → Missing model. Provide a non-empty model to createAgentSession + See logs — internal API… |
| 216 | open | Medium | Agent | [ux-agent-empty-prompt-see-logs.md](./ux-agent-empty-prompt-see-logs.md) | agent "" → Prompt must not be empty + See logs — message good, chrome wrong. |
| 217 | open | Medium | Agent | [ux-agent-invalid-model-system-chrome.md](./ux-agent-invalid-model-system-chrome.md) | 404 + logs. |
| 218 | open | Medium | Errors | [ux-agent-spawn-missing-args-raw-commander.md](./ux-agent-spawn-missing-args-raw-commander.md) | agent without prompt and spawn without agent print error: missing required argument without design-system f… |
| 219 | open | Medium | Auth / security | [ux-api-key-flags-encourage-shell-history-leaks.md](./ux-api-key-flags-encourage-shell-history-leaks.md) | Flags without history warning. |
| 220 | open | Medium | Approvals | [ux-approvals-invalid-state-silent-empty-reconfirmed.md](./ux-approvals-invalid-state-silent-empty-reconfirmed.md) | approvals list --state bogus returns No approvals found without invalid-state error — reconfirm. |
| 221 | open | Medium | Approvals | [ux-approvals-invalid-state-silent-empty.md](./ux-approvals-invalid-state-silent-empty.md) | nope looks empty queue. |
| 222 | open | Medium | Approvals | [ux-approvals-show-missing-task-debug-tease-reconfirmed.md](./ux-approvals-show-missing-task-debug-tease-reconfirmed.md) | approvals show --approval-id missing: Task "approvals/missing" not found. Use --debug for a stack trace — r… |
| 223 | open | Medium | Auth | [ux-auth-help-api-key-no-danger.md](./ux-auth-help-api-key-no-danger.md) | auth --help lists api-key Display stored API key with no danger/secret warning at group level. |
| 224 | open | Medium | IA / install | [ux-binary-wrappers-undocumented.md](./ux-binary-wrappers-undocumented.md) | dist/bin wrappers no help map. |
| 225 | open | Medium | Braintrust | [ux-braintrust-only-status-no-enable.md](./ux-braintrust-only-status-no-enable.md) | braintrust --help only status; braintrust enable falls back to same help — no enable/disable surface despit… |
| 226 | open | Medium | Braintrust | [ux-braintrust-status-disabled-no-next-step.md](./ux-braintrust-status-disabled-no-next-step.md) | braintrust status: disabled — no how to enable, no env vars, no link to docs. |
| 227 | open | Medium | Spawn / otel | [ux-capture-otel-alone-silent-success.md](./ux-capture-otel-alone-silent-success.md) | spawn --capture-otel succeeds without confirming otel capture started or where data went — silent success f… |
| 228 | open | Medium | Spawn / flags | [ux-capture-otel-content-without-capture-silent.md](./ux-capture-otel-content-without-capture-silent.md) | spawn with --capture-otel-content alone succeeds without enabling otel capture or warning that --capture-ot… |
| 229 | open | Medium | Errors | [ux-code-review-double-error-skin.md](./ux-code-review-double-error-skin.md) | Raw + toolcraft both. |
| 230 | open | Medium | Code-review | [ux-code-review-drafts-not-found-debug-tease.md](./ux-code-review-drafts-not-found-debug-tease.md) | No active code review draft found for URL. Use --debug for a stack trace — not-found should not suggest deb… |
| 231 | open | Medium | Code-review | [ux-code-review-install-no-dry-run-force-writes.md](./ux-code-review-install-no-dry-run-force-writes.md) | code-review install --force creates profiles/prompts under .poe-code/code-review with word-wrapped path lis… |
| 232 | open | Medium | Code-review | [ux-code-review-install-output-unframed-wrapped.md](./ux-code-review-install-output-unframed-wrapped.md) | code-review install prints Lists Created with hard-wrapped absolute paths mid-word without design-system pa… |
| 233 | open | Medium | Code-review / identity | [ux-code-review-missing-prurl-npm-run-dev.md](./ux-code-review-missing-prurl-npm-run-dev.md) | code-review run without prUrl: missing required argument prUrl; Run npm run dev -- code-review run --help —… |
| 234 | open | Medium | Code-review | [ux-code-review-profiles-bare-table.md](./ux-code-review-profiles-bare-table.md) | code-review profiles prints bare name/source table (generic built-in) without Poe - code-review panel frami… |
| 235 | open | Medium | Code-review / identity | [ux-code-review-prompt-preview-missing-spawn-npm-run-dev.md](./ux-code-review-prompt-preview-missing-spawn-npm-run-dev.md) | prompt-preview without --spawn: Missing required parameter spawn + npm run dev recovery. |
| 236 | open | Medium | Code-review | [ux-code-review-prompt-preview-unframed.md](./ux-code-review-prompt-preview-unframed.md) | code-review prompt-preview dumps long prompt with Prompt preview header and toolcraft identity on help — sa… |
| 237 | open | Medium | Errors / recovery | [ux-command-not-found-no-suggestions.md](./ux-command-not-found-no-suggestions.md) | confgure/skills/pipelne no suggestion. |
| 238 | open | Medium | Utils | [ux-config-edit-missing-editor-see-logs.md](./ux-config-edit-missing-editor-see-logs.md) | utils config edit without EDITOR: Set $EDITOR to use this command + See logs — clear message, system chrome. |
| 239 | open | Medium | Configure / codex | [ux-configure-codex-reasoning-effort-medium-partial.md](./ux-configure-codex-reasoning-effort-medium-partial.md) | configure codex --reasoning-effort medium dry-run shows mixed model_reasoning_effort high and medium across… |
| 240 | open | Medium | Configure / cursor | [ux-configure-cursor-dry-run-no-filesystem-changes.md](./ux-configure-cursor-dry-run-no-filesystem-changes.md) | configure cursor --yes --dry-run: would configure Cursor; # no filesystem changes — success without showing… |
| 241 | open | Medium | Dry-run | [ux-configure-cursor-dry-run-too-quiet.md](./ux-configure-cursor-dry-run-too-quiet.md) | configure cursor and cursor-agent --yes --dry-run only print would configure Cursor / # no filesystem chang… |
| 242 | open | Medium | Configure | [ux-configure-cursor-model-flag-silent-noop.md](./ux-configure-cursor-model-flag-silent-noop.md) | configure cursor --model anthropic/claude-opus-4.7 --yes --dry-run still only says would configure / no fil… |
| 243 | open | Medium | Dry-run | [ux-configure-dry-run-floods-diff.md](./ux-configure-dry-run-floods-diff.md) | Huge settings diffs. |
| 244 | open | Medium | Configure / models | [ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md](./ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md) | configure with full catalog id rewrites via stripModelNamespace + replace dots with hyphens to claude-haiku… |
| 245 | open | Medium | Configure / kimi | [ux-configure-kimi-default-model-novitaai.md](./ux-configure-kimi-default-model-novitaai.md) | configure kimi --yes --dry-run defaults to novitaai/kimi-k2.5 — verify still in catalog; dry-run floods ful… |
| 246 | open | Medium | Configure / models | [ux-configure-kimi-ignores-explicit-novita-namespace.md](./ux-configure-kimi-ignores-explicit-novita-namespace.md) | Passing --model novitaai/kimi-k2.5 still dry-runs default_model = poe/kimi-k2.5 — explicit catalog-style id… |
| 247 | open | Medium | Configure | [ux-configure-provider-requires-model-without-listing-models.md](./ux-configure-provider-requires-model-without-listing-models.md) | When a provider requires an explicit model, configure errors Pass --model without listing available models,… |
| 248 | open | Medium | Configure | [ux-configure-yes-silent-default-agent.md](./ux-configure-yes-silent-default-agent.md) | Picks Claude without upfront line. |
| 249 | open | Medium | Dashboard / TUI | [ux-dashboard-keybindings-undocumented-on-cli-help.md](./ux-dashboard-keybindings-undocumented-on-cli-help.md) | Live dashboards support q quit and Ctrl+C forceQuit but --tui help only says Show a live dashboard without … |
| 250 | open | Medium | Help | [ux-doctor-and-completion-still-missing.md](./ux-doctor-and-completion-still-missing.md) | doctor and completion remain Unknown command — reconfirm doctor gap and completion gap. |
| 251 | open | Medium | Editor | [ux-editor-error-still-system-chrome.md](./ux-editor-error-still-system-chrome.md) | Set $EDITOR + logs. |
| 252 | open | Medium | Auth | [ux-empty-api-key-flag-silently-ignored.md](./ux-empty-api-key-flag-silently-ignored.md) | --api-key '' falls back to stored key. |
| 253 | open | Medium | Plan list | [ux-empty-plan-kind-lists-still-draw-empty-tables.md](./ux-empty-plan-kind-lists-still-draw-empty-tables.md) | plan list --kind experiment/ralph/superintendent draws full empty table borders with no "No plans" message … |
| 254 | open | Medium | Spawn / flags | [ux-empty-resume-thread-id-silently-ignored.md](./ux-empty-resume-thread-id-silently-ignored.md) | spawn … --resume-thread-id "" succeeds as a fresh session — empty resume id not rejected (related empty-mod… |
| 255 | open | Medium | Eval | [ux-eval-empty-source-message-inconsistent-skins.md](./ux-eval-empty-source-message-inconsistent-skins.md) | eval check/lint print bare Eval source does not contain… lines; eval report uses design-system ■ Error for … |
| 256 | open | Medium | Eval | [ux-eval-init-bare-stdout-no-design-system.md](./ux-eval-init-bare-stdout-no-design-system.md) | eval init demo -C /tmp prints only: demo / next: poe-code eval check demo — no panel, no success glyph fram… |
| 257 | open | Medium | Eval | [ux-eval-init-name-validation-bare-text.md](./ux-eval-init-name-validation-bare-text.md) | eval init /tmp/ux-eval-test fails with bare Eval name must be kebab-case… without panel framing or examples… |
| 258 | open | Medium | Eval | [ux-eval-lint-check-empty-same-message.md](./ux-eval-lint-check-empty-same-message.md) | eval lint and eval check without evals: bare Eval source does not contain any first-level eval.yaml — no de… |
| 259 | open | Medium | Eval | [ux-eval-report-empty-debug-tease.md](./ux-eval-report-empty-debug-tease.md) | eval report with no evals: does not contain any first-level eval.yaml. Use --debug for a stack trace. |
| 260 | open | Medium | Eval / identity | [ux-eval-run-missing-params-npm-run-dev.md](./ux-eval-run-missing-params-npm-run-dev.md) | eval run without agent/model: 2 parameter errors … Run npm run dev -- eval run --help — toolcraft-style hel… |
| 261 | open | Medium | Eval / suggestions | [ux-eval-unknown-command-suggests-lint-for-list.md](./ux-eval-unknown-command-suggests-lint-for-list.md) | eval list is not a command; error Did you mean: lint? which is a poor suggestion for list (distance match w… |
| 262 | open | Medium | Gaslight | [ux-gaslight-config-missing-enoent-system-chrome.md](./ux-gaslight-config-missing-enoent-system-chrome.md) | gaslight --config /tmp/no-gaslight.yaml: ENOENT open + See logs — should be ValidationError config not found. |
| 263 | open | Medium | Gaslight | [ux-gaslight-config-missing-enoent.md](./ux-gaslight-config-missing-enoent.md) | Raw ENOENT. |
| 264 | open | Medium | Gaslight | [ux-gaslight-install-force-dry-run-vs-already-exists.md](./ux-gaslight-install-force-dry-run-vs-already-exists.md) | gaslight install --local --force --dry-run says Would create gaslight.yaml; without --force dry-run says al… |
| 265 | open | Medium | Gaslight | [ux-gaslight-install-force-overwrites-without-diff.md](./ux-gaslight-install-force-overwrites-without-diff.md) | gaslight install --local --force overwrites gaslight.yaml and says Installed without dry-run of content cha… |
| 266 | open | Medium | Gaslight | [ux-gaslight-missing-plan-system-chrome-reconfirmed.md](./ux-gaslight-missing-plan-system-chrome-reconfirmed.md) | gaslight /tmp/missing.yaml: Plan file not found + See logs — reconfirm ValidationError gap. |
| 267 | open | Medium | Gaslight | [ux-gaslight-multi-plan-fails-fast-with-success-markers.md](./ux-gaslight-multi-plan-fails-fast-with-success-markers.md) | Multi-plan gaslight fails first plan with ✓ agent API error and message plan 1/2 … failed without summarizi… |
| 268 | open | Medium | Gaslight / safety | [ux-gaslight-no-activity-timeout-flag.md](./ux-gaslight-no-activity-timeout-flag.md) | Long gaslight runs cannot set activity timeout from CLI though spawn supports --activity-timeout-ms; users … |
| 269 | open | Medium | Naming | [ux-gaslight-opaque-naming.md](./ux-gaslight-opaque-naming.md) | Root gaslight no plain gloss. |
| 270 | open | Medium | Gaslight / Pipeline | [ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md](./ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md) | Both gaslight and pipeline have --archive and --no-archive but help does not state default archive behavior… |
| 271 | open | Medium | Gaslight / naming | [ux-gaslight-unknown-agent-says-service.md](./ux-gaslight-unknown-agent-says-service.md) | Says service not agent. |
| 272 | open | Medium | Dry-run | [ux-gemini-configure-dry-run-too-quiet.md](./ux-gemini-configure-dry-run-too-quiet.md) | configure gemini --yes --dry-run only shows Gemini model resolved line and would configure without listing … |
| 273 | open | Medium | GitHub workflows | [ux-gh-install-dry-run-lists-paths-without-panel.md](./ux-gh-install-dry-run-lists-paths-without-panel.md) | github-workflows install --dry-run prints bare workflow paths and would write messages without panel framin… |
| 274 | open | Medium | GitHub workflows | [ux-gh-install-preview-without-dry-run-flag.md](./ux-gh-install-preview-without-dry-run-flag.md) | gh install fix-vulnerabilities (with --dry-run passed) showed would be written paths and eject tip — previe… |
| 275 | open | Medium | GitHub workflows | [ux-gh-prompt-preview-dumps-long-unframed-prompt.md](./ux-gh-prompt-preview-dumps-long-unframed-prompt.md) | github-workflows prompt-preview prints multi-section prompt body without design-system framing or --json op… |
| 276 | open | Medium | Help | [ux-global-flags-hidden-on-subcommand-help.md](./ux-global-flags-hidden-on-subcommand-help.md) | --yes/--dry-run/--verbose missing on most help. |
| 277 | open | Medium | Help / product gaps | [ux-goal-chat-acp-commands-missing.md](./ux-goal-chat-acp-commands-missing.md) | goal, chat, acp are Unknown command — agent-goal plan documents goal CLI but commands not registered; chat/… |
| 278 | open | Medium | First-run | [ux-group-commands-print-help-only.md](./ux-group-commands-print-help-only.md) | pipeline bare help only. |
| 279 | open | Medium | Harness | [ux-harness-list-no-dir-flag.md](./ux-harness-list-no-dir-flag.md) | harness new supports --dir; harness list --dir is unknown — cannot list pairs created outside default searc… |
| 280 | open | Medium | Harness | [ux-harness-list-only-cwd-not-created-dir.md](./ux-harness-list-only-cwd-not-created-dir.md) | harness new … --dir /tmp/h4 creates pair successfully; harness list still says No harness pairs found becau… |
| 281 | open | Medium | Harness | [ux-harness-missing-file-system-chrome.md](./ux-harness-missing-file-system-chrome.md) | Good message + See logs. |
| 282 | open | Medium | Harness | [ux-harness-new-unknown-template-no-kinds-reconfirmed.md](./ux-harness-new-unknown-template-no-kinds-reconfirmed.md) | harness new bogus-kind x: Unknown harness template "bogus-kind" — no list of valid kinds; help says Built-i… |
| 283 | open | Medium | Harness | [ux-harness-run-missing-file-system-chrome.md](./ux-harness-run-missing-file-system-chrome.md) | Missing harness md file: path + See logs — good message, unnecessary logs. |
| 284 | open | Medium | Harness | [ux-harness-run-success-opaque-result-object.md](./ux-harness-run-success-opaque-result-object.md) | Successful harness run prints Result: object · kind, version, message, numbers, branches, +1 more — interna… |
| 285 | open | Medium | Harness | [ux-harness-unknown-template-still-omits-kind-list.md](./ux-harness-unknown-template-still-omits-kind-list.md) | Unknown harness template "notakind" still prints only that message without listing ralph-demo, coverage-dem… |
| 286 | open | Medium | Help | [ux-help-command-not-registered.md](./ux-help-command-not-registered.md) | help not registered. |
| 287 | open | Medium | IA | [ux-hidden-and-orphan-commands.md](./ux-hidden-and-orphan-commands.md) | memory-mcp top-level; agent vs spawn poe-agent. |
| 288 | open | Medium | Hooks / spawn | [ux-hooks-bridge-refuse-user-authored-file-opaque.md](./ux-hooks-bridge-refuse-user-authored-file-opaque.md) | spawn with --hooks-from/--hooks-scope can fail with Refuse to replace user-authored hook file at …/settings… |
| 289 | open | Medium | Spawn / hooks | [ux-hooks-from-unsupported-system-chrome.md](./ux-hooks-from-unsupported-system-chrome.md) | Allow-list + See logs. |
| 290 | open | Medium | Hooks | [ux-hooks-scope-project-same-refuse-as-symlink.md](./ux-hooks-scope-project-same-refuse-as-symlink.md) | --hooks-from claude-code --hooks-scope project fails same Refuse to replace user-authored hook file — scope… |
| 291 | open | Medium | Help / IA | [ux-important-commands-absent-from-root-help.md](./ux-important-commands-absent-from-root-help.md) | skill/memory/provider missing no show-all. |
| 292 | open | Medium | Install | [ux-install-always-success-reconfirmed.md](./ux-install-always-success-reconfirmed.md) | install claude-code when already installed still says Installed Claude Code without version/already-present… |
| 293 | open | Medium | Install | [ux-install-help-missing-yes-and-list.md](./ux-install-help-missing-yes-and-list.md) | install --help only -h; no --yes documented though it works; --list unknown. Agent list only in argument de… |
| 294 | open | Medium | Install | [ux-install-yes-defaults-agent-silently.md](./ux-install-yes-defaults-agent-silently.md) | install --yes without agent installs Claude Code without stating default selection policy in the first line. |
| 295 | open | Medium | Scripting | [ux-json-flag-inconsistent-across-commands.md](./ux-json-flag-inconsistent-across-commands.md) | Some commands only. |
| 296 | open | Medium | Configure / models | [ux-kimi-default-model-id-mismatches-catalog-namespace.md](./ux-kimi-default-model-id-mismatches-catalog-namespace.md) | configure kimi dry-run plans default_model = poe/kimi-k2.5 while models catalog lists novita ai/kimi-k2.5. … |
| 297 | open | Medium | Launch / dev UX | [ux-launch-commands-trigger-full-turbo-rebuild.md](./ux-launch-commands-trigger-full-turbo-rebuild.md) | Invoking launch through npm run dev / predev runs turbo build across 68 packages before the command, adding… |
| 298 | open | Medium | Launch | [ux-launch-missing-process-system-chrome.md](./ux-launch-missing-process-system-chrome.md) | Managed process "missing" was not found + See logs for launch logs/restart. |
| 299 | open | Medium | Launch | [ux-launch-restart-missing-see-logs.md](./ux-launch-restart-missing-see-logs.md) | launch restart missing: Managed process was not found + See logs. |
| 300 | open | Medium | Launch | [ux-launch-start-opaque-failure.md](./ux-launch-start-opaque-failure.md) | Missing -- → failed to start. |
| 301 | open | Medium | Launch | [ux-launch-start-via-npm-run-dev-confuses-argv.md](./ux-launch-start-via-npm-run-dev-confuses-argv.md) | launch start can mis-parse process ids and commands when invoked through npm run dev (turbo predev noise, s… |
| 302 | open | Medium | Spawn / logging | [ux-log-content-flag-no-danger-warning.md](./ux-log-content-flag-no-danger-warning.md) | spawn --log-content help only says Include message and tool content in ACP JSONL spawn logs — no warning th… |
| 303 | open | Medium | Privacy | [ux-log-content-flags-underwarn-sensitive-data.md](./ux-log-content-flags-underwarn-sensitive-data.md) | --log-content no PII warning. |
| 304 | open | Medium | Spawn / security | [ux-log-content-help-underwarns-reconfirmed.md](./ux-log-content-help-underwarns-reconfirmed.md) | Help only says Include message and tool content in ACP JSONL spawn logs without security warning; default r… |
| 305 | open | Medium | Spawn / logging | [ux-log-file-name-no-path-feedback.md](./ux-log-file-name-no-path-feedback.md) | spawn … --log-file-name ux-probe.jsonl succeeds but file not at ~/.poe-code/logs/ux-probe.jsonl — no path f… |
| 306 | open | Medium | Auth / help | [ux-login-help-omits-interactive-and-yes.md](./ux-login-help-omits-interactive-and-yes.md) | login help only lists --api-key and -h; does not document interactive OAuth browser flow, non-TTY requireme… |
| 307 | open | Medium | Auth / help | [ux-login-help-omits-oauth-default.md](./ux-login-help-omits-oauth-default.md) | Only --api-key documented. |
| 308 | open | Medium | Auth | [ux-login-help-still-minimal.md](./ux-login-help-still-minimal.md) | login --help only --api-key and -h — no --yes, no note that non-TTY without key hangs/OAuth, no env POE_API… |
| 309 | open | Medium | Auth | [ux-login-rejected-no-recovery.md](./ux-login-rejected-no-recovery.md) | API key rejected only. |
| 310 | open | Medium | Maestro | [ux-maestro-config-vs-workflow-flags-duplicated.md](./ux-maestro-config-vs-workflow-flags-duplicated.md) | maestro tui accepts --config and --workflow for WORKFLOW.md and errors if both set — duplicate flags for on… |
| 311 | open | Medium | Maestro | [ux-maestro-tick-missing-transition-raw-commander.md](./ux-maestro-tick-missing-transition-raw-commander.md) | maestro tick --task foo fails error: required option --transition not specified without design-system framing. |
| 312 | open | Medium | Maestro | [ux-maestro-tui-duplicate-config-workflow-flags.md](./ux-maestro-tui-duplicate-config-workflow-flags.md) | maestro tui --help lists --config Path to WORKFLOW.md and --workflow Path to WORKFLOW.md — duplicate flags … |
| 313 | open | Medium | First-run | [ux-many-parent-groups-only-dump-help.md](./ux-many-parent-groups-only-dump-help.md) | Beyond pipeline/experiment/ralph, bare invocations of skill, memory, provider, runtime, launch, worktree, u… |
| 314 | open | Medium | Plan | [ux-markdown-read-depth-1-empty-for-h1-only-structure.md](./ux-markdown-read-depth-1-empty-for-h1-only-structure.md) | markdown-read --depth 1 on agent-goal plan shows sections (none) because headings may be ## only — depth se… |
| 315 | open | Medium | Destructive | [ux-memory-clear-help-still-no-force-or-yes.md](./ux-memory-clear-help-still-no-force-or-yes.md) | memory clear --help still only shows -h/--help despite being fully destructive when initialized. |
| 316 | open | Medium | Destructive | [ux-memory-clear-no-confirmation.md](./ux-memory-clear-no-confirmation.md) | Destructive no confirm. |
| 317 | open | Medium | Memory | [ux-memory-ingest-enoent-system-chrome.md](./ux-memory-ingest-enoent-system-chrome.md) | memory ingest /tmp/no-such-file: ENOENT open path + See logs — should be ValidationError source not found. |
| 318 | open | Medium | Memory / install | [ux-memory-install-already-exists-system-chrome.md](./ux-memory-install-already-exists-system-chrome.md) | memory install when skill exists fails with Skill already exists: path and See logs, without --force guidan… |
| 319 | open | Medium | Memory | [ux-memory-install-no-force-already-exists.md](./ux-memory-install-no-force-already-exists.md) | memory install --agent claude --skill-only fails Skill already exists … See logs; no --force on help; reins… |
| 320 | open | Medium | Memory | [ux-memory-install-requires-agent-raw-commander.md](./ux-memory-install-requires-agent-raw-commander.md) | memory install without --agent: error: required option '--agent <agent>' not specified — raw commander, not… |
| 321 | open | Medium | Memory | [ux-memory-ls-search-show-raw-unframed.md](./ux-memory-ls-search-show-raw-unframed.md) | memory ls/search/show/lint/write still dump raw text without design-system panels (except init) — reconfirm… |
| 322 | open | Medium | Memory | [ux-memory-mcp-print-config-command-missing.md](./ux-memory-mcp-print-config-command-missing.md) | memory mcp, mcp-print, print-config are unknown; if docs/README mention them they are stale. memory install… |
| 323 | open | Medium | Memory | [ux-memory-query-no-model-flag.md](./ux-memory-query-no-model-flag.md) | memory query --help has --budget and --agent but no --model — cannot fix stale default model for memory age… |
| 324 | open | Medium | Memory | [ux-memory-write-requires-reason-before-path.md](./ux-memory-write-requires-reason-before-path.md) | memory write without args fails on required option --reason before missing path argument — wrong recovery o… |
| 325 | open | Medium | Memory | [ux-memory-write-requires-reason-raw-commander.md](./ux-memory-write-requires-reason-raw-commander.md) | memory write without --reason prints raw error: required option '--reason <text>' not specified instead of … |
| 326 | open | Medium | Memory | [ux-memory-write-success-is-raw-unframed.md](./ux-memory-write-success-is-raw-unframed.md) | After memory write, stdout dumps frontmatter/body and path:line snippets without design-system success pane… |
| 327 | open | Medium | Configure / models | [ux-model-id-namespace-stripping-surprises.md](./ux-model-id-namespace-stripping-surprises.md) | configure --model anthropic/claude-sonnet-4.6 dry-run writes model as claude-sonnet-4-6 (dots to hyphens / … |
| 328 | open | Medium | Models | [ux-models-dumps-full-catalog.md](./ux-models-dumps-full-catalog.md) | 300+ rows default. |
| 329 | open | Medium | Models | [ux-models-empty-search-returns-all.md](./ux-models-empty-search-returns-all.md) | Empty string filters are treated as no filter (341/341) rather than validation error — easy footgun in scri… |
| 330 | open | Medium | Models | [ux-models-feature-bogus-silent-empty.md](./ux-models-feature-bogus-silent-empty.md) | Invalid feature name returns 0 models / No models match rather than invalid feature error — reconfirm of si… |
| 331 | open | Medium | Models | [ux-models-feature-flag-not-repeatable.md](./ux-models-feature-flag-not-repeatable.md) | models --feature tools --feature reasoning does not AND features; Commander keeps a single string so the la… |
| 332 | open | Medium | Models | [ux-models-input-bogus-silent-empty.md](./ux-models-input-bogus-silent-empty.md) | Invalid input modality returns 0 models without listing valid modalities text/image/audio/video. |
| 333 | open | Medium | Models | [ux-models-invalid-feature-silent-empty-reconfirmed.md](./ux-models-invalid-feature-silent-empty-reconfirmed.md) | models --feature bogus → 0/341 No models match — no error that feature is invalid (related invalid modality… |
| 334 | open | Medium | Models | [ux-models-invalid-feature-silent-empty.md](./ux-models-invalid-feature-silent-empty.md) | --feature notreal → 0/341. |
| 335 | open | Medium | Models | [ux-models-invalid-modality-silent-empty.md](./ux-models-invalid-modality-silent-empty.md) | --input smell → 0/341. |
| 336 | open | Medium | Models | [ux-models-no-limit-flag.md](./ux-models-no-limit-flag.md) | models --limit 5 is unknown option — 341-model tables always dump many rows; no pagination flag. |
| 337 | open | Medium | Models | [ux-models-search-claude-slash-zero.md](./ux-models-search-claude-slash-zero.md) | models --search "claude/" → 0/341 while claude models exist — slash confuses substring match for namespaced… |
| 338 | open | Medium | Models | [ux-models-view-invalid-uses-raw-commander.md](./ux-models-view-invalid-uses-raw-commander.md) | Invalid --view value uses Commander option argument is invalid. Allowed choices… while other models validat… |
| 339 | open | Medium | Models | [ux-models-view-parameters-without-filter-floods.md](./ux-models-view-parameters-without-filter-floods.md) | models --view parameters without --model/--search dumps parameters for entire catalog (starts with random m… |
| 340 | open | Medium | First-run / diagnostics | [ux-no-doctor-or-health-overview-command.md](./ux-no-doctor-or-health-overview-command.md) | There is no poe-code doctor (or similar) that summarizes auth status, configured agents, stale models, prov… |
| 341 | open | Medium | Configure / models | [ux-opencode-model-flag-still-triple-namespace.md](./ux-opencode-model-flag-still-triple-namespace.md) | configure opencode --model anthropic/claude-opus-4.7 still plans poe/anthropic/claude-opus-4.7 — reconfirm … |
| 342 | open | Medium | Configure / models | [ux-opencode-model-triple-namespace.md](./ux-opencode-model-triple-namespace.md) | configure opencode dry-run plans model poe/anthropic/claude-opus-4.7 — a third namespace style (poe/owner/m… |
| 343 | open | Medium | Pipeline | [ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md](./ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md) | Good validation Problems first. |
| 344 | open | Medium | Pipeline / install | [ux-pipeline-install-claims-success-when-all-skipped.md](./ux-pipeline-install-claims-success-when-all-skipped.md) | pipeline install when steps.yaml and skill already exist: Skip both; then Installed Pipeline skill… success… |
| 345 | open | Medium | Pipeline | [ux-pipeline-nothing-to-run-success-framing.md](./ux-pipeline-nothing-to-run-success-framing.md) | pipeline run on fully done plan prints Nothing to run, Pipeline run finished success, and Problems? footer … |
| 346 | open | Medium | Pipeline / TUI | [ux-pipeline-tui-flag-ignored-on-init-failure.md](./ux-pipeline-tui-flag-ignored-on-init-failure.md) | pipeline run --tui still shows non-dashboard failure path with success markers and Problems-before-error wh… |
| 347 | open | Medium | Pipeline | [ux-pipeline-validate-enoent-system-error.md](./ux-pipeline-validate-enoent-system-error.md) | System chrome. |
| 348 | open | Medium | Pipeline | [ux-pipeline-validate-no-json-flag.md](./ux-pipeline-validate-no-json-flag.md) | pipeline validate --json is unknown option — cannot machine-parse validation results. |
| 349 | open | Medium | Pipeline | [ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md](./ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md) | pipeline validate on agent-goal plan: Invalid plan YAML: "kind" must be "pipeline" + See logs — kind-aware … |
| 350 | open | Medium | Pipeline | [ux-pipeline-validate-wrong-kind-system-chrome.md](./ux-pipeline-validate-wrong-kind-system-chrome.md) | kind must be pipeline + See logs. |
| 351 | open | Medium | Plan browser | [ux-plan-archive-allows-readme.md](./ux-plan-archive-allows-readme.md) | Would archive README.md. |
| 352 | open | Medium | Plan browser | [ux-plan-browse-non-tty-dumps-first-plan.md](./ux-plan-browse-non-tty-dumps-first-plan.md) | plan browse without a TTY prints a full rendered plan (first/selected) rather than an error, list, or expli… |
| 353 | open | Medium | Plan | [ux-plan-browse-rejects-path-argument.md](./ux-plan-browse-rejects-path-argument.md) | plan browse docs/plans/32-agent-goal.md fails error: too many arguments for browse. Expected 0 — users expe… |
| 354 | open | Medium | Docs / CLI sync | [ux-plan-docs-advertise-goal-and-chat-commands-missing.md](./ux-plan-docs-advertise-goal-and-chat-commands-missing.md) | Plan content (e.g. agent-goal plan) documents `poe-code goal …` and `poe-code chat` slash surfaces, but CLI… |
| 355 | open | Medium | Plan / editor | [ux-plan-edit-editor-true-claims-edited-without-change.md](./ux-plan-edit-editor-true-claims-edited-without-change.md) | EDITOR=true plan edit reports Edited path even when true is a no-op binary — success without change detection. |
| 356 | open | Medium | Plan / install | [ux-plan-install-no-force-flag.md](./ux-plan-install-no-force-flag.md) | plan install rejects --force as unknown option while experiment/pipeline have --force — inconsistent instal… |
| 357 | open | Medium | Plan / install | [ux-plan-install-yes-defaults-claude-writes-skill.md](./ux-plan-install-yes-defaults-claude-writes-skill.md) | plan install --yes (no agent) defaults to claude-code local and Creates SKILL.md — silent default; no --for… |
| 358 | open | Medium | Plan list | [ux-plan-list-empty-kind-table-reconfirmed.md](./ux-plan-list-empty-kind-table-reconfirmed.md) | plan list --kind superintendent draws empty table chrome without No plans message — reconfirm. |
| 359 | open | Medium | Plan list | [ux-plan-list-includes-exactly-one-readme.md](./ux-plan-list-includes-exactly-one-readme.md) | plan list --output json has 11 plans including 1 README.md — reconfirm noise file in list. |
| 360 | open | Medium | Plan browser | [ux-plan-list-includes-noise-files.md](./ux-plan-list-includes-noise-files.md) | README.md listed as plan. |
| 361 | open | Medium | Plan list | [ux-plan-list-includes-readme-reconfirmed.md](./ux-plan-list-includes-readme-reconfirmed.md) | plan list --kind plan shows README.md Active Plans among plans — reconfirm noise file in list. |
| 362 | open | Medium | Plan list | [ux-plan-list-json-includes-readme-reconfirmed.md](./ux-plan-list-json-includes-readme-reconfirmed.md) | plan list --output json has 11 entries including README.md — reconfirm noise. |
| 363 | open | Medium | Plan list | [ux-plan-list-md-includes-readme-noise.md](./ux-plan-list-md-includes-readme-noise.md) | plan list --kind plan --output md includes README.md Active Plans row — reconfirm plan-list-includes-noise-… |
| 364 | open | Medium | Plan | [ux-plan-markdown-read-depth-zero-shows-no-sections.md](./ux-plan-markdown-read-depth-zero-shows-no-sections.md) | plan markdown-read with --depth 1 on a plan whose headings start at depth 2-style numbering may print secti… |
| 365 | open | Medium | Plan | [ux-plan-markdown-read-section-wrong-command-hint.md](./ux-plan-markdown-read-section-wrong-command-hint.md) | When section match fails, error says try read-markdown to see TOC, but the actual command is plan markdown-… |
| 366 | open | Medium | Plan | [ux-plan-markdown-read-section-wrong-hint-reconfirmed.md](./ux-plan-markdown-read-section-wrong-hint-reconfirmed.md) | Reconfirmed: no section matching still says try read-markdown (wrong command name). |
| 367 | open | Medium | Plan | [ux-plan-markdown-read-system-chrome.md](./ux-plan-markdown-read-system-chrome.md) | file not found + logs. |
| 368 | open | Medium | Plan | [ux-plan-non-tty-unclear-failure.md](./ux-plan-non-tty-unclear-failure.md) | plan question bare 400. |
| 369 | open | Medium | Plan | [ux-plan-question-starts-session-without-mode.md](./ux-plan-question-starts-session-without-mode.md) | plan "test plan question only" --yes printed What do you want to build? and began session — multi-word with… |
| 370 | open | Medium | Plan | [ux-plan-view-json-dumps-full-content.md](./ux-plan-view-json-dumps-full-content.md) | plan view --output json includes entire content string of the plan body — huge payload for scripts that onl… |
| 371 | open | Medium | Plan | [ux-plan-view-vs-markdown-read-not-found-inconsistent.md](./ux-plan-view-vs-markdown-read-not-found-inconsistent.md) | plan view missing.md → Plan not found: missing.md (clean, no logs). plan markdown-read missing.md → file no… |
| 372 | open | Medium | Help | [ux-primary-commands-lack-examples-in-help.md](./ux-primary-commands-lack-examples-in-help.md) | models has Examples; configure/spawn do not. |
| 373 | open | Medium | Help | [ux-primary-commands-still-lack-examples.md](./ux-primary-commands-still-lack-examples.md) | spawn, configure, and gaslight --help still have no Examples section while models --help is best-in-class w… |
| 374 | open | Medium | Providers | [ux-provider-list-agents-column-incomplete.md](./ux-provider-list-agents-column-incomplete.md) | Omits spawn-only agents. |
| 375 | open | Medium | Providers | [ux-provider-list-agents-column-truncates.md](./ux-provider-list-agents-column-truncates.md) | provider list cloudflare Agents cell ends with poe-… truncation — full agent list not visible without wide … |
| 376 | open | Medium | Providers | [ux-provider-list-no-json-flag.md](./ux-provider-list-no-json-flag.md) | provider list --json is unknown; only design-system table available for scripting. |
| 377 | open | Medium | Provider auth | [ux-provider-login-missing-key-system-chrome.md](./ux-provider-login-missing-key-system-chrome.md) | Good message + logs. |
| 378 | open | Medium | Workflows | [ux-ralph-experiment-wrong-kind-says-not-found.md](./ux-ralph-experiment-wrong-kind-says-not-found.md) | Existing plan wrong kind. |
| 379 | open | Medium | Errors | [ux-raw-commander-invalid-option-choices.md](./ux-raw-commander-invalid-option-choices.md) | --view nope raw. |
| 380 | open | Medium | Errors | [ux-raw-commander-missing-args.md](./ux-raw-commander-missing-args.md) | unconfigure/wrap missing agent raw error. |
| 381 | open | Medium | Docs / CLI sync | [ux-readme-features-wrap-but-cli-missing.md](./ux-readme-features-wrap-but-cli-missing.md) | README wrap quickstart removed; wrap CLI residual (muscle memory / external docs) |
| 382 | open | Medium | Configure | [ux-reasoning-effort-flag-opaque.md](./ux-reasoning-effort-flag-opaque.md) | No validation/examples. |
| 383 | open | Medium | Spawn | [ux-resume-thread-errors-are-agent-raw.md](./ux-resume-thread-errors-are-agent-raw.md) | Long agent usage text. |
| 384 | open | Medium | Spawn | [ux-runner-sync-and-runtime-invalid-raw-commander.md](./ux-runner-sync-and-runtime-invalid-raw-commander.md) | Invalid --runner-sync bogus and --runtime bogus print Commander option argument is invalid. Allowed choices… |
| 385 | open | Medium | Spawn / runtime | [ux-runner-sync-without-runtime-silently-accepted.md](./ux-runner-sync-without-runtime-silently-accepted.md) | spawn with --runner-sync both but no runtime/detach runs inline successfully — flag appears no-op without w… |
| 386 | open | Medium | Runtime jobs | [ux-runtime-job-missing-see-logs.md](./ux-runtime-job-missing-see-logs.md) | runtime jobs stop/logs missing-id: No runtime job found + See logs — clear message, system chrome. |
| 387 | open | Medium | Runtime | [ux-runtime-jobs-list-unbounded-opaque-statuses.md](./ux-runtime-jobs-list-unbounded-opaque-statuses.md) | History dump; lost unexplained. |
| 388 | open | Medium | Runtime jobs | [ux-runtime-jobs-ls-help-no-limit-reconfirmed.md](./ux-runtime-jobs-ls-help-no-limit-reconfirmed.md) | runtime jobs ls --help only -h — no --limit, --since, --status despite unbounded May-era list. |
| 389 | open | Medium | Runtime jobs | [ux-runtime-jobs-show-unknown-suggests-stop.md](./ux-runtime-jobs-show-unknown-suggests-stop.md) | runtime jobs show is not a command; Commander Did you mean: stop? — users expect show/get for job details. |
| 390 | open | Medium | Runtime / errors | [ux-runtime-missing-deps-good-message-system-chrome.md](./ux-runtime-missing-deps-good-message-system-chrome.md) | spawn --runtime docker/e2b missing engine/API key messages include install links and config paths (excellen… |
| 391 | open | Medium | SDK | [ux-sdk-getpoeapikey-throws-generic-error.md](./ux-sdk-getpoeapikey-throws-generic-error.md) | SDK credential helper throws new Error("No API key found…") rather than a typed/user-facing error class, so… |
| 392 | open | Medium | Spawn / skills | [ux-skill-bridge-failure-system-chrome.md](./ux-skill-bridge-failure-system-chrome.md) | Paths listed + See logs. |
| 393 | open | Medium | Skills / agents | [ux-skill-configure-kimi-unsupported-abrupt.md](./ux-skill-configure-kimi-unsupported-abrupt.md) | Skills not supported for kimi. |
| 394 | open | Medium | Skills | [ux-skill-configure-yes-defaults-agent-silently.md](./ux-skill-configure-yes-defaults-agent-silently.md) | skill configure --yes --local without agent configures claude-code without stating default selection policy… |
| 395 | open | Medium | Skills | [ux-skill-configure-yes-defaults-to-claude-already-exists.md](./ux-skill-configure-yes-defaults-to-claude-already-exists.md) | skill configure --yes without agent targets claude-code and fails Skill already exists … See logs — silent … |
| 396 | open | Medium | Skills | [ux-skill-install-file-required-before-name.md](./ux-skill-install-file-required-before-name.md) | skill install claude-code --name onlyname fails required option --file first — both name and file required;… |
| 397 | open | Medium | Skills | [ux-skill-install-missing-file-enoent.md](./ux-skill-install-missing-file-enoent.md) | skill install --file /tmp/no-skill.md fails ENOENT: no such file… + See logs. |
| 398 | open | Medium | Skills | [ux-skill-install-name-and-file-both-required.md](./ux-skill-install-name-and-file-both-required.md) | Serial required options opaque. |
| 399 | open | Medium | Naming | [ux-skill-naming-collisions.md](./ux-skill-naming-collisions.md) | skills≠skill; dual /plan. |
| 400 | open | Medium | Skills / first-run | [ux-skill-parent-no-next-step-guidance.md](./ux-skill-parent-no-next-step-guidance.md) | poe-code skill with no subcommand prints a bare subcommand list without suggesting the common onboarding pa… |
| 401 | open | Medium | Skills | [ux-skill-unconfigure-defaults-agent-and-soft-blocks.md](./ux-skill-unconfigure-defaults-agent-and-soft-blocks.md) | skill unconfigure without agent defaults to claude-code and refuses non-empty skill dirs unless --force, bu… |
| 402 | open | Medium | Spawn / skills | [ux-skills-empty-string-silently-ignored.md](./ux-skills-empty-string-silently-ignored.md) | spawn with --skills "" succeeds without warning — empty skills flag ignored unlike --skill "" which fails m… |
| 403 | open | Medium | Spawn / skills | [ux-skills-flag-without-value-is-noop-or-unclear.md](./ux-skills-flag-without-value-is-noop-or-unclear.md) | spawn … --skills with no value still runs the agent successfully (boolean presence?) without error or warni… |
| 404 | open | Medium | Configure | [ux-skip-if-configured-still-writes-when-model-differs.md](./ux-skip-if-configured-still-writes-when-model-differs.md) | Passing --skip-if-configured with an explicit --model that differs from stored config still runs a full con… |
| 405 | open | Medium | Spawn help | [ux-spawn-advanced-flags-undifferentiated.md](./ux-spawn-advanced-flags-undifferentiated.md) | ~20 options ungrouped. |
| 406 | open | Medium | Spawn / codex | [ux-spawn-codex-reads-stdin-message-on-tty-less-success.md](./ux-spawn-codex-reads-stdin-message-on-tty-less-success.md) | Even when prompt is provided as an argument, successful codex spawn emits Reading additional input from std… |
| 407 | open | Medium | Spawn | [ux-spawn-cwd-file-not-directory-see-logs.md](./ux-spawn-cwd-file-not-directory-see-logs.md) | spawn --cwd /tmp/file: Workspace path is not a directory + See logs — clear message, system chrome. |
| 408 | open | Medium | Spawn | [ux-spawn-cwd-missing-see-logs.md](./ux-spawn-cwd-missing-see-logs.md) | spawn --cwd /tmp/does-not-exist: Workspace path does not exist + See logs — clear message, system chrome. |
| 409 | open | Medium | Spawn / paths | [ux-spawn-cwd-missing-system-chrome.md](./ux-spawn-cwd-missing-system-chrome.md) | spawn -C /missing says Workspace path does not exist (good) but still attaches errors.log system-failure fo… |
| 410 | open | Medium | Spawn / runtime | [ux-spawn-detach-ignored-on-failure-path.md](./ux-spawn-detach-ignored-on-failure-path.md) | With --detach, spawn still appears to run the agent path that fails on stale model in-foreground with succe… |
| 411 | open | Medium | Spawn | [ux-spawn-interactive-bypasses-design-system-panel.md](./ux-spawn-interactive-bypasses-design-system-panel.md) | spawn … --interactive / -i in non-TTY still runs and prints bare agent text (ok / Hey!) without Poe - spawn… |
| 412 | open | Medium | Spawn / interactive | [ux-spawn-interactive-non-tty-still-runs.md](./ux-spawn-interactive-non-tty-still-runs.md) | spawn … --interactive without TTY still produces agent output (not a clear "requires TTY" failure) — flag i… |
| 413 | open | Medium | Spawn | [ux-spawn-no-prompt-system-chrome.md](./ux-spawn-no-prompt-system-chrome.md) | No prompt provided via argument or stdin is correct message but still See logs system chrome. |
| 414 | open | Medium | Spawn | [ux-spawn-stdin-empty-see-logs.md](./ux-spawn-stdin-empty-see-logs.md) | spawn --stdin with empty stdin: No prompt provided via argument or stdin + See logs — good message, system … |
| 415 | open | Medium | Spawn | [ux-spawn-validates-mode-before-agent-reconfirmed.md](./ux-spawn-validates-mode-before-agent-reconfirmed.md) | spawn unknown-agent --mode foobar fails mode first; spawn unknown-agent --mode read fails Unknown agent wit… |
| 416 | open | Medium | Spawn / errors | [ux-spawn-validates-mode-before-agent.md](./ux-spawn-validates-mode-before-agent.md) | Invalid agent fails missing --mode first. |
| 417 | open | Medium | Visual language | [ux-successful-spawn-still-uses-checkmark-for-agent-text.md](./ux-successful-spawn-still-uses-checkmark-for-agent-text.md) | Even successful spawn pi output prefixes agent thinking/answer lines with ✓, same glyph as success status —… |
| 418 | open | Medium | Help / identity | [ux-superintendent-builder-inspector-npm-run-dev.md](./ux-superintendent-builder-inspector-npm-run-dev.md) | superintendent builder/inspector help Usage: npm run dev -- superintendent builder … — reconfirm identity. |
| 419 | open | Medium | Superintendent | [ux-superintendent-complete-wrong-kind-debug-tease.md](./ux-superintendent-complete-wrong-kind-debug-tease.md) | superintendent complete on plan-kind file: frontmatter kind must be superintendent Use --debug for a stack … |
| 420 | open | Medium | Superintendent | [ux-superintendent-validate-unclosed-tag-opaque.md](./ux-superintendent-validate-unclosed-tag-opaque.md) | No location. |
| 421 | open | Medium | Tables | [ux-tables-ignore-terminal-width.md](./ux-tables-ignore-terminal-width.md) | Wide at COLUMNS=40. |
| 422 | open | Medium | Tasks / auth | [ux-tasks-github-auth-raw-error.md](./ux-tasks-github-auth-raw-error.md) | tasks get raw GraphQL 401. |
| 423 | open | Medium | Tasks | [ux-tasks-import-dry-run-still-requires-to.md](./ux-tasks-import-dry-run-still-requires-to.md) | tasks import --dry-run --from /tmp fails tasks import requires --to <workflow.md> — dry-run cannot preview … |
| 424 | open | Medium | Spawn / timeouts | [ux-timeout-errors-use-system-chrome.md](./ux-timeout-errors-use-system-chrome.md) | 0.001s + See logs. |
| 425 | open | Medium | Errors / recovery | [ux-toolcraft-has-suggestions-poe-code-root-does-not.md](./ux-toolcraft-has-suggestions-poe-code-root-does-not.md) | suggest.ts exists; root unused. |
| 426 | open | Medium | Help / visual | [ux-toolcraft-heading-doubles-poe-code.md](./ux-toolcraft-heading-doubles-poe-code.md) | Double name heading. |
| 427 | open | Medium | Traces | [ux-traces-directory-path-eisdir-reconfirmed.md](./ux-traces-directory-path-eisdir-reconfirmed.md) | traces /tmp → EISDIR illegal operation on directory, read + See logs — reconfirm kind-aware path error. |
| 428 | open | Medium | Traces | [ux-traces-directory-path-eisdir.md](./ux-traces-directory-path-eisdir.md) | traces docs EISDIR. |
| 429 | open | Medium | Traces | [ux-traces-missing-file-enoent-system-chrome.md](./ux-traces-missing-file-enoent-system-chrome.md) | traces /tmp/no-trace.jsonl → ENOENT open + See logs. |
| 430 | open | Medium | Traces | [ux-traces-missing-file-system-error.md](./ux-traces-missing-file-system-error.md) | System chrome. |
| 431 | open | Medium | Traces | [ux-traces-poe-code-source-titles-are-agent-names.md](./ux-traces-poe-code-source-titles-are-agent-names.md) | poe-code source traces show title pi / claude-code / cursor without user prompt — less useful than claude s… |
| 432 | open | Medium | Dry-run | [ux-unconfigure-goose-dry-run-full-config-dump.md](./ux-unconfigure-goose-dry-run-full-config-dump.md) | unconfigure goose --dry-run creates large full config.yaml + dump rather than intentional-only removal summ… |
| 433 | open | Medium | Unconfigure | [ux-unconfigure-help-missing-dry-run-and-yes.md](./ux-unconfigure-help-missing-dry-run-and-yes.md) | unconfigure help only -h; no --dry-run/--yes though global flags may apply — destructive command underdocum… |
| 434 | open | Medium | Unconfigure | [ux-unconfigure-help-no-dry-run-or-yes.md](./ux-unconfigure-help-no-dry-run-or-yes.md) | unconfigure --help only lists agent and -h — no mention of global --dry-run, confirmation, or files affected. |
| 435 | open | Medium | Unconfigure | [ux-unconfigure-missing-agent-raw-commander.md](./ux-unconfigure-missing-agent-raw-commander.md) | unconfigure without agent: error: missing required argument agent — raw commander; unconfigure not-an-agent… |
| 436 | open | Medium | Destructive | [ux-unconfigure-no-confirmation.md](./ux-unconfigure-no-confirmation.md) | Immediate rewrite no --yes gate. |
| 437 | open | Medium | Unconfigure | [ux-unconfigure-nonconfigured-agent-still-plans-mutations.md](./ux-unconfigure-nonconfigured-agent-still-plans-mutations.md) | unconfigure gemini --dry-run still emits large settings diffs and backup deletes even when user mental mode… |
| 438 | open | Medium | Unconfigure | [ux-unconfigure-rejects-spawn-only-agents.md](./ux-unconfigure-rejects-spawn-only-agents.md) | unconfigure pi and unconfigure poe-agent: Unknown agent — correct that they are not configurable, but error… |
| 439 | open | Medium | Update | [ux-update-always-suggests-npm-install-g.md](./ux-update-always-suggests-npm-install-g.md) | Ignores install method. |
| 440 | open | Medium | Usage | [ux-usage-list-no-json-flag.md](./ux-usage-list-no-json-flag.md) | usage list lacks --json/--output; scripts cannot machine-parse usage history without scraping tables. trace… |
| 441 | open | Medium | Usage | [ux-usage-pages-1-still-shows-20-entries.md](./ux-usage-pages-1-still-shows-20-entries.md) | usage list --pages 1 still fetches/displays 20 usage entries — --pages means number of pages not page size,… |
| 442 | open | Medium | Usage | [ux-usage-pages-invalid-raw-commander.md](./ux-usage-pages-invalid-raw-commander.md) | --pages 0/-1 prints error: option argument is invalid. Expected a positive integer without design-system fr… |
| 443 | open | Medium | Utils / editor | [ux-utils-config-edit-missing-editor-system-chrome.md](./ux-utils-config-edit-missing-editor-system-chrome.md) | utils config edit without EDITOR says Set $EDITOR to use this command + See logs — good message, unnecessar… |
| 444 | open | Medium | Utils / config | [ux-utils-config-path-subcommand-missing.md](./ux-utils-config-path-subcommand-missing.md) | utils config path fails with too many arguments; only show/init/edit exist. Users often need the path witho… |
| 445 | open | Medium | Utils / config | [ux-utils-config-show-dumps-large-json.md](./ux-utils-config-show-dumps-large-json.md) | utils config show prints full global config JSON including configured_services detail — useful but noisy; n… |
| 446 | open | Medium | Version | [ux-version-nags-dev-to-major-jump.md](./ux-version-nags-dev-to-major-jump.md) | Local 0.0.0-dev build reports Update available to 4.0.0 and suggests npm install -g, which is noise for con… |
| 447 | open | Medium | Version | [ux-version-still-nags-dev-to-4.0.0.md](./ux-version-still-nags-dev-to-4.0.0.md) | Reconfirmed: --version shows Update available: 0.0.0-dev -> 4.0.0 and npm install -g suggestion. |
| 448 | open | Medium | Version | [ux-version-subcommand-missing-use-flag.md](./ux-version-subcommand-missing-use-flag.md) | poe-code version is Unknown command; version works via -V/--version. Users typing version as subcommand (co… |
| 449 | open | Medium | Tables | [ux-wide-tables-truncate-critical-cells.md](./ux-wide-tables-truncate-critical-cells.md) | Agents column ellipsis. |
| 450 | open | Medium | Worktree | [ux-worktree-reconcile-not-found-system-chrome.md](./ux-worktree-reconcile-not-found-system-chrome.md) | Worktree "missing" not found in registry + See logs — same as remove not-found. |
| 451 | open | Medium | Worktree | [ux-worktree-reconcile-requires-agent-raw.md](./ux-worktree-reconcile-requires-agent-raw.md) | worktree reconcile missing --yes fails required option --agent not specified (raw) before not-found; --yes … |
| 452 | open | Medium | Worktree | [ux-worktree-remove-help-no-yes.md](./ux-worktree-remove-help-no-yes.md) | worktree remove --help has --delete-branch but no --yes / confirmation notes for destructive remove. |
| 453 | open | Medium | Worktree | [ux-worktree-remove-help-omits-yes.md](./ux-worktree-remove-help-omits-yes.md) | worktree remove --help shows only --delete-branch; no --yes. worktree remove ghost-name --yes fails Worktre… |
| 454 | open | Medium | Worktree | [ux-worktree-remove-no-confirmation.md](./ux-worktree-remove-no-confirmation.md) | Destructive no confirm. |
| 455 | open | Medium | Worktree | [ux-worktree-remove-not-found-system-chrome.md](./ux-worktree-remove-not-found-system-chrome.md) | worktree remove no-such → Worktree not found in registry + See logs. |
| 456 | open | Medium | Docs / CLI sync | [ux-wrap-command-still-missing.md](./ux-wrap-command-still-missing.md) | wrap remains Unknown command — residual after README wrap removal; muscle memory / external docs. |
| 457 | open | Medium | Dry-run | [ux-wrap-dry-run-forwards-flag.md](./ux-wrap-dry-run-forwards-flag.md) | would run goose --dry-run. |
| 458 | open | Medium | Dry-run | [ux-wrap-resolves-alias-but-dry-run-lies.md](./ux-wrap-resolves-alias-but-dry-run-lies.md) | kimi-cli --dry-run invented. |
| 459 | open | Low–Medium | Agent defaults | [ux-agent-default-model-hardcoded.md](./ux-agent-default-model-hardcoded.md) | default anthropic/claude-opus-4.7. |
| 460 | open | Low–Medium | Config / models | [ux-agent-default-opus-4-7-not-latest-opus-4-8.md](./ux-agent-default-opus-4-7-not-latest-opus-4-8.md) | agent --model default is anthropic/claude-opus-4.7; catalog has anthropic/claude-opus-4.8 (Date Added 2026-… |
| 461 | open | Low–Medium | Auth | [ux-auth-status-no-json-flag.md](./ux-auth-status-no-json-flag.md) | auth status --json unknown; whoami is JSON. Split is OK if documented; status --help does not mention whoam… |
| 462 | open | Low–Medium | Auth | [ux-auth-whoami-raw-json-vs-status-panel.md](./ux-auth-whoami-raw-json-vs-status-panel.md) | auth whoami dumps raw JSON identity; auth status uses design-system Logged in as. Dual presentation for sam… |
| 463 | open | Low–Medium | Auth polish | [ux-auth-whoami-raw-json.md](./ux-auth-whoami-raw-json.md) | JSON vs status design-system. |
| 464 | open | Low–Medium | Braintrust | [ux-braintrust-status-minimal-disabled.md](./ux-braintrust-status-minimal-disabled.md) | braintrust status prints disabled with Problems footer — no how to enable, env vars, or docs link (reaffirm… |
| 465 | open | Low–Medium | Spawn / telemetry | [ux-capture-otel-no-visible-output-change.md](./ux-capture-otel-no-visible-output-change.md) | spawn … --capture-otel succeeds like normal spawn without saying where OTEL was written or if capture was a… |
| 466 | open | Low–Medium | Code-review | [ux-code-review-profiles-raw-table.md](./ux-code-review-profiles-raw-table.md) | code-review profiles dumps a minimal ascii table of name/source without Poe panel framing used elsewhere. |
| 467 | open | Low–Medium | Code-review / visual | [ux-code-review-profiles-table-outside-design-system.md](./ux-code-review-profiles-table-outside-design-system.md) | No Poe framing. |
| 468 | open | Low–Medium | Help | [ux-command-aliases-undocumented-on-root-help.md](./ux-command-aliases-undocumented-on-root-help.md) | Work but not shown. |
| 469 | open | Low–Medium | Configure help | [ux-configure-shape-base-url-opaque.md](./ux-configure-shape-base-url-opaque.md) | Jargon no examples. |
| 470 | open | Low–Medium | Help / discoverability | [ux-dashboard-ui-tui-missing.md](./ux-dashboard-ui-tui-missing.md) | dashboard, ui, tui are Unknown command with npm run dev help — no interactive dashboard entrypoint in CLI. |
| 471 | open | Low–Medium | Editor | [ux-editor-missing-raw-error.md](./ux-editor-missing-raw-error.md) | throw new Error Set $EDITOR. |
| 472 | open | Low–Medium | Eval | [ux-eval-errors-outside-design-system.md](./ux-eval-errors-outside-design-system.md) | Some eval plain text. |
| 473 | open | Low–Medium | Eval | [ux-eval-init-creates-in-cwd-with-bare-success.md](./ux-eval-init-creates-in-cwd-with-bare-success.md) | eval init ux-audit-eval-two creates files with bare name/next lines — reconfirm eval init success framing; … |
| 474 | open | Low–Medium | Eval | [ux-eval-init-success-is-bare-paths.md](./ux-eval-init-success-is-bare-paths.md) | eval init prints folder name and next: poe-code eval check … as bare lines; also next command may still be … |
| 475 | open | Low–Medium | Eval | [ux-eval-report-debug-flag-undocumented-in-error.md](./ux-eval-report-debug-flag-undocumented-in-error.md) | eval report with no eval folders says Use --debug for a stack trace while primary help may not surface --de… |
| 476 | open | Low–Medium | Experiment | [ux-experiment-journal-wrong-doc-type-message.md](./ux-experiment-journal-wrong-doc-type-message.md) | Doc not found for existing. |
| 477 | open | Low–Medium | Install / IA | [ux-extra-npm-bins-confusing.md](./ux-extra-npm-bins-confusing.md) | poe-code-configure + test servers. |
| 478 | open | Low–Medium | Gaslight | [ux-gaslight-archive-and-no-archive-both-accepted.md](./ux-gaslight-archive-and-no-archive-both-accepted.md) | Passing both --archive and --no-archive does not error; one silently wins (Commander negate) while help lis… |
| 479 | open | Low–Medium | GH workflows | [ux-gh-install-eject-flag-opaque.md](./ux-gh-install-eject-flag-opaque.md) | Description eject. |
| 480 | open | Low–Medium | Harness | [ux-harness-run-no-path-says-no-pairs.md](./ux-harness-run-no-path-says-no-pairs.md) | harness run --yes without md-path: No harness pairs found — OK if empty, but does not prompt to pick or sug… |
| 481 | open | Low–Medium | Hooks / spawn | [ux-hooks-from-pi-unsupported-lists-supported.md](./ux-hooks-from-pi-unsupported-lists-supported.md) | spawn --hooks-from pi: Unsupported source hook agent "pi". Supported hook agents: claude-code, codex — clea… |
| 482 | open | Low–Medium | Spawn / hooks | [ux-hooks-scope-invalid-raw-commander.md](./ux-hooks-scope-invalid-raw-commander.md) | spawn --hooks-scope bogus: raw commander Allowed choices are project, user, merged — same class as hooks-st… |
| 483 | open | Low–Medium | Spawn / hooks | [ux-hooks-strategy-invalid-raw-commander.md](./ux-hooks-strategy-invalid-raw-commander.md) | spawn --hooks-strategy bogus: error: option argument bogus is invalid. Allowed choices are auto, symlink, t… |
| 484 | open | Low–Medium | Install | [ux-install-always-claims-success.md](./ux-install-always-claims-success.md) | No already-present state. |
| 485 | open | Low–Medium | Launch | [ux-launch-status-shows-failed-experiment-leftovers.md](./ux-launch-status-shows-failed-experiment-leftovers.md) | stopped leftovers no cleanup hint. |
| 486 | open | Low–Medium | Spawn / logging | [ux-log-dir-relative-works-with-path-feedback-gap.md](./ux-log-dir-relative-works-with-path-feedback-gap.md) | spawn --log-dir ./tmp-ux-logs creates timestamped jsonl under relative dir successfully — works; still no p… |
| 487 | open | Low–Medium | Plan | [ux-markdown-read-depth-zero-empty-sections.md](./ux-markdown-read-depth-zero-empty-sections.md) | markdown-read --depth 0 prints sections: (none) while file has content — depth 0 means no headings shown wi… |
| 488 | open | Low–Medium | Spawn | [ux-mcp-servers-empty-object-accepted.md](./ux-mcp-servers-empty-object-accepted.md) | spawn with --mcp-servers {} succeeds without warning that no servers were configured — empty object is vali… |
| 489 | open | Low–Medium | Errors / consistency | [ux-mcp-servers-missing-file-almost-good.md](./ux-mcp-servers-missing-file-almost-good.md) | Good message class vary. |
| 490 | open | Low–Medium | Memory | [ux-memory-cache-clear-requires-yes-see-logs.md](./ux-memory-cache-clear-requires-yes-see-logs.md) | memory cache clear without --yes: Refusing to clear cache without --yes + See logs — good policy, system ch… |
| 491 | open | Low–Medium | Memory / MCP | [ux-memory-mcp-print-config-raw-json.md](./ux-memory-mcp-print-config-raw-json.md) | Bare JSON no guidance. |
| 492 | open | Low–Medium | Memory | [ux-memory-status-after-write-is-terse.md](./ux-memory-status-after-write-is-terse.md) | memory status prints Pages/Bytes/Last write/Tokens as bare lines without panel framing or interpretation (h… |
| 493 | open | Low–Medium | Memory | [ux-memory-write-bare-stdout-path.md](./ux-memory-write-bare-stdout-path.md) | memory write pages/hello.md prints bare hello.md without design-system success panel — inconsistent with me… |
| 494 | open | Low–Medium | Models | [ux-models-raw-view-bypasses-design-system-reconfirmed.md](./ux-models-raw-view-bypasses-design-system-reconfirmed.md) | models --model claude-haiku-4.5 --view raw prints raw YAML without design-system panel — reconfirm models-r… |
| 495 | open | Low–Medium | Models | [ux-models-raw-view-bypasses-design-system.md](./ux-models-raw-view-bypasses-design-system.md) | No framing. |
| 496 | open | Low–Medium | Models | [ux-models-search-empty-returns-all.md](./ux-models-search-empty-returns-all.md) | models --search "" → 341/341 models — empty search ignored (empty flag class). |
| 497 | open | Low–Medium | Models | [ux-models-since-1d-empty-today.md](./ux-models-since-1d-empty-today.md) | models --since 1d returns 0/341 No models match — correct if no adds in 24h but message looks like filter f… |
| 498 | open | Low–Medium | Models | [ux-models-tools-and-feature-filter-semantics-undocumented.md](./ux-models-tools-and-feature-filter-semantics-undocumented.md) | --tools is documented as shorthand for --feature tools, but combining --tools with --feature web_search ret… |
| 499 | open | Low–Medium | Models | [ux-models-view-invalid-raw-commander.md](./ux-models-view-invalid-raw-commander.md) | models --view bogus: raw commander Allowed choices are capabilities, pricing, parameters, raw — contrast pl… |
| 500 | open | Low–Medium | Help / completion | [ux-no-shell-completion-command.md](./ux-no-shell-completion-command.md) | No poe-code completion (bash/zsh/fish) command to install tab completion, despite a large command surface w… |
| 501 | open | Low–Medium | Auth polish | [ux-oauth-url-dumps-full-query-string.md](./ux-oauth-url-dumps-full-query-string.md) | Long authorize URL line. |
| 502 | open | Low–Medium | Pipeline | [ux-pipeline-validate-success-still-problems-footer.md](./ux-pipeline-validate-success-still-problems-footer.md) | Valid pipeline validation ends with Problems? GitHub link after Plan is valid success. |
| 503 | open | Low–Medium | Plan list | [ux-plan-list-empty-table-no-message.md](./ux-plan-list-empty-table-no-message.md) | No no-plans message. |
| 504 | open | Low–Medium | Plan list | [ux-plan-list-output-json-unframed.md](./ux-plan-list-output-json-unframed.md) | plan list --output json prints a raw JSON array to stdout with no design-system intro; --output md prints a… |
| 505 | open | Low–Medium | Plan | [ux-plan-markdown-read-raw-yaml-ish-output.md](./ux-plan-markdown-read-raw-yaml-ish-output.md) | plan markdown-read prints raw file:/frontmatter:/sections: blocks without design-system framing used by pla… |
| 506 | open | Low–Medium | Plan / MCP | [ux-plan-markdown-reader-mcp-help-minimal.md](./ux-plan-markdown-reader-mcp-help-minimal.md) | plan markdown-reader-mcp --help only description Run the standalone markdown reader MCP server with -h — no… |
| 507 | open | Low–Medium | Plan view | [ux-plan-view-json-dumps-full-markdown-content.md](./ux-plan-view-json-dumps-full-markdown-content.md) | plan view --output json includes a huge content string of the full plan body, which is useful for tooling b… |
| 508 | open | Low–Medium | Design system | [ux-problems-footer-on-every-success.md](./ux-problems-footer-on-every-success.md) | finalize always. |
| 509 | open | Low–Medium | Providers | [ux-provider-login-unknown-has-list-hint-and-see-logs.md](./ux-provider-login-unknown-has-list-hint-and-see-logs.md) | provider login not-a-provider: Unknown provider … Run provider list — good next step; still See logs system… |
| 510 | open | Low–Medium | Runtime | [ux-runtime-templates-ls-shows-empty-docker-row.md](./ux-runtime-templates-ls-shows-empty-docker-row.md) | runtime templates ls includes a docker row with (empty) hash and dashes, plus many old e2b artifacts — nois… |
| 511 | open | Low–Medium | Runtime | [ux-runtime-templates-ls-unbounded-noise.md](./ux-runtime-templates-ls-unbounded-noise.md) | Old e2b /tmp rows. |
| 512 | open | Low–Medium | Configure | [ux-shape-base-url-error-good-message-system-prefix.md](./ux-shape-base-url-error-good-message-system-prefix.md) | Good text system prefix. |
| 513 | open | Low–Medium | Spawn / skills | [ux-skill-and-skills-flags-undocumented-relationship.md](./ux-skill-and-skills-flags-undocumented-relationship.md) | Both merge; help silent. |
| 514 | open | Low–Medium | Skills | [ux-skill-configure-goose-writes-dot-agents-skills.md](./ux-skill-configure-goose-writes-dot-agents-skills.md) | skill configure goose --yes --local succeeds at ./.agents/skills while claude uses ./.claude/skills — path … |
| 515 | open | Low–Medium | Spawn / skills | [ux-skill-empty-string-malformed-reference.md](./ux-skill-empty-string-malformed-reference.md) | spawn --skill "" fails Malformed skill references: - (empty) Expected syntax name or agentId/name — empty s… |
| 516 | open | Low–Medium | Configure | [ux-skip-if-configured-still-noises-dry-run.md](./ux-skip-if-configured-still-noises-dry-run.md) | Still full would-configure. |
| 517 | open | Low–Medium | Spawn | [ux-spawn-mode-case-sensitive.md](./ux-spawn-mode-case-sensitive.md) | spawn --mode AUTO fails Invalid --mode "AUTO". Expected yolo, auto, edit, or read — case-sensitive; users t… |
| 518 | open | Low–Medium | Design system | [ux-spawn-success-still-problems-footer.md](./ux-spawn-success-still-problems-footer.md) | Even successful spawn pi/claude/goose runs end with Problems? GitHub issues link, training users to ignore … |
| 519 | open | Low–Medium | Visual language | [ux-success-and-info-share-magenta-glyphs.md](./ux-success-and-info-share-magenta-glyphs.md) | logger ◆ and ● magenta. |
| 520 | open | Low–Medium | Traces | [ux-traces-cwd-only-flag-removed-or-renamed.md](./ux-traces-cwd-only-flag-removed-or-renamed.md) | traces defaults to cwd-only listing; expansion is via --all-workspaces. The flag --cwd-only is unknown. Ear… |
| 521 | open | Low–Medium | Update | [ux-update-help-omits-dry-run.md](./ux-update-help-omits-dry-run.md) | update help lists --force, --no-version-check, --package-manager but not --dry-run though dry-run works via… |
| 522 | open | Low–Medium | Usage | [ux-usage-help-hides-default-balance.md](./ux-usage-help-hides-default-balance.md) | Bare usage balance; help omits. |
| 523 | open | Low–Medium | Usage | [ux-usage-list-empty-filter-returns-all.md](./ux-usage-list-empty-filter-returns-all.md) | usage list --filter "" still shows 20 entries — empty filter ignored (empty flag class). |
| 524 | open | Low–Medium | Utils | [ux-utils-config-no-path-subcommand.md](./ux-utils-config-no-path-subcommand.md) | utils config path fails too many arguments; only show/init/edit — users cannot print config file paths alone. |
| 525 | open | Low–Medium | Utils | [ux-utils-symlink-skills-scope-error-vs-agents.md](./ux-utils-symlink-skills-scope-error-vs-agents.md) | skills dry-run needs flags. |
| 526 | open | Low–Medium | Logging / verbose | [ux-verbose-prefixes-every-log-line.md](./ux-verbose-prefixes-every-log-line.md) | [models] on tables. |
| 527 | open | Low–Medium | Version | [ux-version-update-nag-on-dev-builds.md](./ux-version-update-nag-on-dev-builds.md) | Always update available. |
| 528 | open | Low–Medium | Worktree | [ux-worktree-reconcile-requires-agent-not-in-error-order.md](./ux-worktree-reconcile-requires-agent-not-in-error-order.md) | worktree reconcile without args hits required option --agent before missing name, similar to spawn mode-bef… |
| 529 | open | Low | Spawn / positive pattern | [ux-activity-timeout-1ms-works-but-chrome.md](./ux-activity-timeout-1ms-works-but-chrome.md) | Agent spawn timed out after 0.001s of inactivity — correct behavior for extreme timeout; still See logs. |
| 530 | open | Low | Spawn / positive pattern | [ux-activity-timeout-ms-zero-validation-good.md](./ux-activity-timeout-ms-zero-validation-good.md) | spawn --activity-timeout-ms 0: Invalid --activity-timeout-ms "0". Expected a positive integer — clear Valid… |
| 531 | open | Low | Errors / positive pattern | [ux-activity-timeout-zero-good-validation.md](./ux-activity-timeout-zero-good-validation.md) | Invalid --activity-timeout-ms "0" returns a clear ValidationError-style message without raw Commander text … |
| 532 | open | Low | Spawn / positive pattern | [ux-activity-timeout-zero-validation-good.md](./ux-activity-timeout-zero-validation-good.md) | Invalid activity timeout returns Expected a positive integer without stack. |
| 533 | open | Low | Agent / positive pattern | [ux-agent-default-model-works-when-opus-valid.md](./ux-agent-default-model-works-when-opus-valid.md) | agent "say only: ok" without --model succeeds using default anthropic/claude-opus-4.7 — positive that DEFAU… |
| 534 | open | Low | Auth / positive pattern | [ux-auth-whoami-fields-documented-by-shape.md](./ux-auth-whoami-fields-documented-by-shape.md) | auth whoami JSON keys: handle, name, profile_picture, user_id — stable machine shape. |
| 535 | open | Low | Auth / positive pattern | [ux-auth-whoami-help-documents-json-good.md](./ux-auth-whoami-help-documents-json-good.md) | auth whoami help says Print Poe account identity as JSON (uses POE_API_KEY if set) — clear machine mode vs … |
| 536 | open | Low | Braintrust | [ux-braintrust-status-opaque.md](./ux-braintrust-status-opaque.md) | disabled only. |
| 537 | open | Low | Code-review / positive pattern | [ux-code-review-prompt-preview-good.md](./ux-code-review-prompt-preview-good.md) | code-review prompt-preview --spawn orchestrator prints Spawn/Profile/Prompt preview without side effects — … |
| 538 | open | Low | Utils / positive pattern | [ux-config-init-already-exists-good.md](./ux-config-init-already-exists-good.md) | utils config init: Project config already exists at path — clear idempotent message. |
| 539 | open | Low | Configure / positive pattern | [ux-configure-api-key-dry-run-redacts-bearer.md](./ux-configure-api-key-dry-run-redacts-bearer.md) | configure dry-run shows Authorization: Bearer <redacted> — good redaction in at least this path (contrast u… |
| 540 | open | Low | Configure / positive pattern | [ux-configure-success-vscode-next-steps-good.md](./ux-configure-success-vscode-next-steps-good.md) | After configuring Claude Code, a Next steps note with vscode://settings/claudeCode.disableLoginPrompt deep … |
| 541 | open | Low | Configure / positive pattern | [ux-configure-unknown-api-shape-lists-exposed.md](./ux-configure-unknown-api-shape-lists-exposed.md) | configure --shape-base-url messages=… → Unknown API shape "messages" for provider poe. Exposed shapes: open… |
| 542 | open | Low | Configure / positive pattern | [ux-configure-unknown-provider-good-message.md](./ux-configure-unknown-provider-good-message.md) | configure --provider notaprovider returns Unknown provider "notaprovider" cleanly (could still list known p… |
| 543 | open | Low | Configure / positive pattern | [ux-configure-unknown-provider-validation-good.md](./ux-configure-unknown-provider-validation-good.md) | configure --provider not-a-provider → Unknown provider "not-a-provider" without See logs — good ValidationE… |
| 544 | open | Low | Agents / positive pattern | [ux-cursor-and-cursor-agent-aliases-both-work.md](./ux-cursor-and-cursor-agent-aliases-both-work.md) | spawn cursor and spawn cursor-agent both succeed; configure aliases map to same Cursor surface. Positive al… |
| 545 | open | Low | Spawn / positive pattern | [ux-cwd-file-path-not-directory-good.md](./ux-cwd-file-path-not-directory-good.md) | spawn --cwd package.json returns Workspace path … is not a directory clearly. |
| 546 | open | Low | Spawn / positive pattern | [ux-cwd-missing-path-good-message.md](./ux-cwd-missing-path-good-message.md) | spawn --cwd /no/such/dir returns Workspace path does not exist clearly (still See logs). |
| 547 | open | Low | Spawn / positive pattern | [ux-e2b-missing-key-error-good.md](./ux-e2b-missing-key-error-good.md) | No E2B API key message points to E2B_API_KEY and config.json paths — good recovery (still See logs). |
| 548 | open | Low | Spawn / positive pattern | [ux-empty-prompt-string-rejected.md](./ux-empty-prompt-string-rejected.md) | spawn claude "" and agent "" both reject empty prompts — good. spawn: No prompt provided; agent: Prompt mus… |
| 549 | open | Low | Eval / positive pattern | [ux-eval-lint-table-good.md](./ux-eval-lint-table-good.md) | eval lint shows Warnings table with Code W004, path, message about pinning target.ref to SHA — scannable. |
| 550 | open | Low | Experiment / positive pattern | [ux-experiment-install-requires-agent-or-yes-good.md](./ux-experiment-install-requires-agent-or-yes-good.md) | experiment install --local --force without agent: Experiment install agent selection requires --agent or --… |
| 551 | open | Low | Gaslight / positive pattern | [ux-gaslight-ingest-limit-zero-validation-good.md](./ux-gaslight-ingest-limit-zero-validation-good.md) | --limit must be a positive integer for limit 0 — good ValidationError. |
| 552 | open | Low | Gaslight / positive pattern | [ux-gaslight-install-global-dry-run-clean.md](./ux-gaslight-install-global-dry-run-clean.md) | gaslight install --global --dry-run: Would create path; Would install; no filesystem changes — intentional … |
| 553 | open | Low | GitHub workflows / positive pattern | [ux-gh-uninstall-invalid-name-lists-choices-good.md](./ux-gh-uninstall-invalid-name-lists-choices-good.md) | Invalid uninstall name lists Expected one of: fix-vulnerabilities, … — good allow-list (still npm run dev h… |
| 554 | open | Low | GitHub workflows / positive pattern | [ux-gh-variables-list-good.md](./ux-gh-variables-list-good.md) | gh variables shows Name/Status/Source table for shared prompt variables — clear inventory. |
| 555 | open | Low | Harness / positive pattern | [ux-harness-list-empty-message-good.md](./ux-harness-list-empty-message-good.md) | harness list: No harness pairs found — clear empty state (no empty table). |
| 556 | open | Low | Harness / positive pattern | [ux-harness-new-all-builtin-kinds-work.md](./ux-harness-new-all-builtin-kinds-work.md) | ralph-demo, experiment-demo, superintendent-demo, coverage-demo, pipeline-demo all scaffold successfully wi… |
| 557 | open | Low | Harness / positive pattern | [ux-harness-new-success-good.md](./ux-harness-new-success-good.md) | harness new with --yes creates pair with clear Created harness pair at path success framing. |
| 558 | open | Low | Harness / positive pattern | [ux-harness-run-coverage-demo-works.md](./ux-harness-run-coverage-demo-works.md) | harness new coverage-demo + harness run succeeds with Result object summary and 0 spawns — demo path works … |
| 559 | open | Low | Harness / positive pattern | [ux-harness-run-fix-works.md](./ux-harness-run-fix-works.md) | harness run … --fix --yes succeeds with Result object — fix path works for demo. |
| 560 | open | Low | Harness | [ux-harness-unknown-template-no-kinds.md](./ux-harness-unknown-template-no-kinds.md) | No allow-list. |
| 561 | open | Low | Polish | [ux-help-subcommand-inconsistency.md](./ux-help-subcommand-inconsistency.md) | Some groups help [command]. |
| 562 | open | Low | Hooks / positive pattern | [ux-hooks-from-unknown-lists-supported-good.md](./ux-hooks-from-unknown-lists-supported-good.md) | Unsupported source hook agent lists Supported hook agents: claude-code, codex — good allow-list (still See … |
| 563 | open | Low | Install / positive pattern | [ux-install-opencode-success-good.md](./ux-install-opencode-success-good.md) | install opencode --yes: Installed OpenCode CLI — clear success (test still broken after install). |
| 564 | open | Low | Auth / positive pattern | [ux-login-api-key-rejected-good.md](./ux-login-api-key-rejected-good.md) | login --api-key sk-fake-not-real → API key rejected without overwriting session; auth status still logged in. |
| 565 | open | Low | Auth | [ux-login-yes-message-good-but-worth-aligning.md](./ux-login-yes-message-good-but-worth-aligning.md) | --yes fail-fast good; bare hangs. |
| 566 | open | Low | Auth / positive pattern | [ux-login-yes-without-key-message-good.md](./ux-login-yes-without-key-message-good.md) | login --yes without key: No API key found. Pass --api-key, set POE_API_KEY, or run without --yes to authent… |
| 567 | open | Low | Maestro | [ux-maestro-dual-invocation-shape.md](./ux-maestro-dual-invocation-shape.md) | Parent + run unclear. |
| 568 | open | Low | Maestro | [ux-maestro-duplicate-config-flags.md](./ux-maestro-duplicate-config-flags.md) | --config and --workflow same. |
| 569 | open | Low | Maestro / positive pattern | [ux-maestro-tui-mutual-exclusion-validation-good.md](./ux-maestro-tui-mutual-exclusion-validation-good.md) | Specifying both --config and --workflow fails with clear mutual exclusion message. |
| 570 | open | Low | Plan / positive pattern | [ux-markdown-read-depth-2-works-well.md](./ux-markdown-read-depth-2-works-well.md) | plan markdown-read --depth 2 prints numbered sections 1–6 for agent-goal plan; --output json includes depth… |
| 571 | open | Low | Plan / positive pattern | [ux-markdown-read-negative-depth-validation-good.md](./ux-markdown-read-negative-depth-validation-good.md) | markdown-read --depth -1: Invalid depth "-1". Expected a non-negative integer. |
| 572 | open | Low | Spawn / positive pattern | [ux-mcp-servers-file-and-json-validation-good.md](./ux-mcp-servers-file-and-json-validation-good.md) | Missing @file reports could not read file with path; invalid JSON reports required shape — good ValidationE… |
| 573 | open | Low | Spawn / positive pattern | [ux-mcp-servers-invalid-json-validation-good.md](./ux-mcp-servers-invalid-json-validation-good.md) | spawn --mcp-servers "{bad" → --mcp-servers must be valid JSON in this shape: {name: {command, args?, env?}}… |
| 574 | open | Low | Spawn / positive pattern | [ux-mcp-servers-validation-good.md](./ux-mcp-servers-validation-good.md) | Invalid MCP server JSON without command returns a clear field-level ValidationError without system chrome. |
| 575 | open | Low | Memory / positive pattern | [ux-memory-cache-clear-requires-yes-good.md](./ux-memory-cache-clear-requires-yes-good.md) | memory cache clear without --yes refuses with Refusing to clear cache without --yes — good guard (still See… |
| 576 | open | Low | Memory / positive pattern | [ux-memory-cache-status-zero-good.md](./ux-memory-cache-status-zero-good.md) | memory cache status: 0 cache entries (0 bytes) — clear empty state. |
| 577 | open | Low | Memory / positive pattern | [ux-memory-clear-requires-yes-non-tty-good.md](./ux-memory-clear-requires-yes-non-tty-good.md) | memory clear without --yes: memory clear requires --yes when running without an interactive TTY — clear des… |
| 578 | open | Low | Memory / positive pattern | [ux-memory-clear-yes-works-when-initialized.md](./ux-memory-clear-yes-works-when-initialized.md) | memory clear --yes after init succeeds with Cleared memory design-system framing; without init points to me… |
| 579 | open | Low | Memory / positive pattern | [ux-memory-ingest-not-init-good.md](./ux-memory-ingest-not-init-good.md) | Memory is not initialized. Run poe-code memory init — clear recovery. |
| 580 | open | Low | Memory / positive pattern | [ux-memory-ls-empty-message-good.md](./ux-memory-ls-empty-message-good.md) | memory ls after init: No memory pages yet — clear empty state. |
| 581 | open | Low | Models / positive pattern | [ux-models-endpoint-pricing-combo-works.md](./ux-models-endpoint-pricing-combo-works.md) | models --endpoint /v1/messages --view pricing returns multi-provider pricing table for messages-capable mod… |
| 582 | open | Low | Models / positive pattern | [ux-models-feature-reasoning-filter-works.md](./ux-models-feature-reasoning-filter-works.md) | models --feature reasoning --provider anthropic returns reasoning-capable models with ✓ in Reasoning column. |
| 583 | open | Low | Models / positive pattern | [ux-models-feature-web-search-works.md](./ux-models-feature-web-search-works.md) | models --provider anthropic --feature web_search returns models with web_search ✓. |
| 584 | open | Low | Models / positive pattern | [ux-models-help-examples-are-excellent.md](./ux-models-help-examples-are-excellent.md) | models --help includes Filters, Views, and Examples sections — best-in-class help in the CLI; other primary… |
| 585 | open | Low | Help / positive pattern | [ux-models-help-examples-still-best-in-class.md](./ux-models-help-examples-still-best-in-class.md) | models --help Examples block shows provider, feature, endpoint, view, search, model, since — reconfirm best… |
| 586 | open | Low | Models / positive pattern | [ux-models-openai-tools-capabilities-good.md](./ux-models-openai-tools-capabilities-good.md) | models --view capabilities --provider openai --tools returns 41 tool-capable openai models. |
| 587 | open | Low | Models / positive pattern | [ux-models-openai-tools-filter-works.md](./ux-models-openai-tools-filter-works.md) | models --provider openai --tools returns tool-capable openai models cleanly. |
| 588 | open | Low | Models / positive pattern | [ux-models-parameters-view-good-for-filtered.md](./ux-models-parameters-view-good-for-filtered.md) | parameters view for anthropic shows output_effort enums including xhigh — useful for configuring reasoning-… |
| 589 | open | Low | Models / positive pattern | [ux-models-pricing-search-combo-good.md](./ux-models-pricing-search-combo-good.md) | models --search haiku --view pricing shows clean single-model pricing row. |
| 590 | open | Low | Models / positive pattern | [ux-models-pricing-search-works.md](./ux-models-pricing-search-works.md) | models --view pricing --search haiku and --model claude-haiku-4.5 show clear pricing table. |
| 591 | open | Low | Models / positive pattern | [ux-models-pricing-sonnet-4-6-good.md](./ux-models-pricing-sonnet-4-6-good.md) | models --view pricing --model claude-sonnet-4.6 shows $2.58/$12.88 per MTok cleanly. |
| 592 | open | Low | Models / positive pattern | [ux-models-provider-case-insensitive-good.md](./ux-models-provider-case-insensitive-good.md) | models --provider Anthropic --search sonnet works same as anthropic — case-insensitive provider filter. |
| 593 | open | Low | Models / positive pattern | [ux-models-provider-xai-works.md](./ux-models-provider-xai-works.md) | models --provider xai lists grok models cleanly. |
| 594 | open | Low | Models / positive pattern | [ux-models-tools-and-feature-tools-redundant-ok.md](./ux-models-tools-and-feature-tools-redundant-ok.md) | models --tools --feature tools --provider anthropic returns same tool-capable set — redundant flags compose… |
| 595 | open | Low | Models | [ux-models-view-raw-bypasses-design-system-reconfirmed.md](./ux-models-view-raw-bypasses-design-system-reconfirmed.md) | models --view raw --search haiku prints bare YAML without design-system panel — reconfirm raw view escape h… |
| 596 | open | Low | Spawn / positive pattern | [ux-pi-agent-alias-works.md](./ux-pi-agent-alias-works.md) | spawn pi-agent resolves to pi and succeeds — positive alias behavior (title shows spawn pi). |
| 597 | open | Low | Pipeline / positive pattern | [ux-pipeline-init-yes-requires-source-good.md](./ux-pipeline-init-yes-requires-source-good.md) | Provide --source or --sources when using --yes is clear non-TTY guidance. |
| 598 | open | Low | Pipeline / positive pattern | [ux-pipeline-max-runs-zero-good-validation.md](./ux-pipeline-max-runs-zero-good-validation.md) | Invalid max-runs "0" returns clear positive-integer validation without raw Commander text — positive patter… |
| 599 | open | Low | Pipeline / positive pattern | [ux-pipeline-max-runs-zero-validation-good.md](./ux-pipeline-max-runs-zero-validation-good.md) | pipeline run --max-runs 0: Invalid max-runs "0". Expected a positive integer — clear ValidationError. |
| 600 | open | Low | Pipeline / positive pattern | [ux-pipeline-run-model-override-shown-on-nothing-to-run.md](./ux-pipeline-run-model-override-shown-on-nothing-to-run.md) | pipeline run with --model shows Model: anthropic/claude-haiku-4.5 in Config even when 21/21 done and Nothin… |
| 601 | open | Low | Pipeline / positive pattern | [ux-pipeline-validate-valid-pipeline-good.md](./ux-pipeline-validate-valid-pipeline-good.md) | pipeline validate on valid pipeline shows Plan, Tasks 21 done, Steps, Plan is valid — clear success framing. |
| 602 | open | Low | Pipeline / positive pattern | [ux-pipeline-validate-wrong-kind-good-message.md](./ux-pipeline-validate-wrong-kind-good-message.md) | pipeline validate on plan-kind file: Invalid plan YAML: "kind" must be "pipeline" — clear kind check (still… |
| 603 | open | Low | Plan / positive pattern | [ux-plan-archive-json-output-good.md](./ux-plan-archive-json-output-good.md) | plan archive path --yes --output json returns action/path/archivedPath JSON — good machine contract (destru… |
| 604 | open | Low | Plan / positive pattern | [ux-plan-archive-requires-yes-non-tty-good.md](./ux-plan-archive-requires-yes-non-tty-good.md) | plan archive docs/plans/32-agent-goal.md --output md without --yes: plan archive requires --yes when runnin… |
| 605 | open | Low | Plan / positive pattern | [ux-plan-delete-json-output-good.md](./ux-plan-delete-json-output-good.md) | plan delete path --yes --output json returns action/path — good machine contract (restored file after audit). |
| 606 | open | Low | Plan | [ux-plan-edit-bare-edited-message.md](./ux-plan-edit-bare-edited-message.md) | EDITOR=true plan edit path prints Edited docs/plans/… without design-system panel. |
| 607 | open | Low | Plan / positive pattern | [ux-plan-install-success-good.md](./ux-plan-install-success-good.md) | plan install shows Create path and Installed plan skill with design-system framing — positive pattern. |
| 608 | open | Low | Plan / positive pattern | [ux-plan-kind-invalid-validation-good.md](./ux-plan-kind-invalid-validation-good.md) | Invalid --kind bogus lists Expected plan, pipeline, experiment, ralph, superintendent, superintendent-base. |
| 609 | open | Low | Plan list / positive pattern | [ux-plan-list-invalid-kind-output-validation-good.md](./ux-plan-list-invalid-kind-output-validation-good.md) | plan list --kind bogus and --output bogus return clear Expected … lists without See logs. |
| 610 | open | Low | Plan list | [ux-plan-list-json-empty-is-bare-array.md](./ux-plan-list-json-empty-is-bare-array.md) | Empty plan list as JSON is bare [] without envelope — fine for scripts but inconsistent with design-system … |
| 611 | open | Low | Plan list / positive pattern | [ux-plan-list-output-md-is-markdown-table-good.md](./ux-plan-list-output-md-is-markdown-table-good.md) | plan list --output md prints GFM table with Kind/Type/Name/Detail/Updated — good export (still includes REA… |
| 612 | open | Low | Plan list / positive pattern | [ux-plan-list-pipeline-json-good.md](./ux-plan-list-pipeline-json-good.md) | JSON array with kind, path, detail 21/21 done — good machine-readable pipeline list. |
| 613 | open | Low | Plan / positive pattern | [ux-plan-markdown-read-section-by-number-works.md](./ux-plan-markdown-read-section-by-number-works.md) | plan markdown-read-section … "2" returns section 2 User-facing shape content correctly. |
| 614 | open | Low | Plan / positive pattern | [ux-plan-output-invalid-validation-good.md](./ux-plan-output-invalid-validation-good.md) | Invalid --output value "bad" returns Expected one of: terminal, md, json without raw Commander skin. |
| 615 | open | Low | Plan path | [ux-plan-path-commands-bare-stdout-reconfirmed.md](./ux-plan-path-commands-bare-stdout-reconfirmed.md) | pipeline/experiment/superintendent plan-path print absolute path as bare stdout — good for scripting, incon… |
| 616 | open | Low | Plan paths | [ux-plan-path-commands-bare-stdout.md](./ux-plan-path-commands-bare-stdout.md) | Path only. |
| 617 | open | Low | Plan / positive pattern | [ux-plan-view-non-tty-requires-path-good.md](./ux-plan-view-non-tty-requires-path-good.md) | plan view without path: Plan selection requires a path or --yes when running without an interactive TTY — c… |
| 618 | open | Low | Plan / positive pattern | [ux-plan-view-pipeline-md-output-good.md](./ux-plan-view-pipeline-md-output-good.md) | plan view on pipeline plan with --output md produces markdown checklist Status 21/21 done with tasks — good… |
| 619 | open | Low | Configure / positive pattern | [ux-poe-no-prompt-works-for-configure-dry-run.md](./ux-poe-no-prompt-works-for-configure-dry-run.md) | POE_NO_PROMPT=1 configure claude --model haiku --dry-run proceeds without TTY — works but remains obscure v… |
| 620 | open | Low | Providers / positive pattern | [ux-provider-login-anthropic-dry-run-clean.md](./ux-provider-login-anthropic-dry-run-clean.md) | provider login anthropic --api-key sk-fake --dry-run: would save credential; no filesystem changes — clean … |
| 621 | open | Low | Providers / positive pattern | [ux-provider-login-anthropic-dry-run-good.md](./ux-provider-login-anthropic-dry-run-good.md) | provider login anthropic --api-key test --yes --dry-run says would save credential without dumping secrets … |
| 622 | open | Low | Providers / positive pattern | [ux-provider-login-cloudflare-requires-base-url-good.md](./ux-provider-login-cloudflare-requires-base-url-good.md) | Provider "cloudflare" requires a base URL. Pass --base-url or set CF_AIG_BASE_URL — clear recovery (still S… |
| 623 | open | Low | Providers / positive pattern | [ux-provider-logout-anthropic-dry-run-good.md](./ux-provider-logout-anthropic-dry-run-good.md) | provider logout anthropic --dry-run only shows would log out + rm credentials.anthropic.enc — good contrast… |
| 624 | open | Low | Providers / positive pattern | [ux-provider-logout-openai-dry-run-clean.md](./ux-provider-logout-openai-dry-run-clean.md) | provider logout openai --dry-run only would log out + rm credentials.openai.enc — clean credential-only dry… |
| 625 | open | Low | Brand | [ux-root-tagline-inconsistent.md](./ux-root-tagline-inconsistent.md) | Different one-liners. |
| 626 | open | Low | Runtime / positive pattern | [ux-runtime-build-host-message-good.md](./ux-runtime-build-host-message-good.md) | Host runtime has no template to build with pass --runtime e2b/docker or config hint — clear recovery. |
| 627 | open | Low | Runtime / positive pattern | [ux-runtime-init-docker-dry-run-clean.md](./ux-runtime-init-docker-dry-run-clean.md) | runtime init --type docker --yes --dry-run: would set runtime.type docker; would create Dockerfile — clean. |
| 628 | open | Low | Runtime / positive pattern | [ux-runtime-init-dry-run-clean.md](./ux-runtime-init-dry-run-clean.md) | runtime init --type host --yes --dry-run: would set runtime.type; would create Dockerfile if missing — inte… |
| 629 | open | Low | Configure / positive pattern | [ux-shape-base-url-invalid-validation-good.md](./ux-shape-base-url-invalid-validation-good.md) | Invalid --shape-base-url value returns Use <shape-id>=<url> clearly. |
| 630 | open | Low | Configure / positive pattern | [ux-shape-base-url-unknown-shape-lists-exposed-good.md](./ux-shape-base-url-unknown-shape-lists-exposed-good.md) | Unknown API shape "messages" lists Exposed shapes: openai-chat-completions, openai-responses, anthropic-mes… |
| 631 | open | Low | Spawn / positive pattern | [ux-skill-bridge-failure-lists-paths-good.md](./ux-skill-bridge-failure-lists-paths-good.md) | Failed to bridge active skills lists Not found skill references and searched paths — good recovery content … |
| 632 | open | Low | Skills / positive pattern | [ux-skill-configure-goose-local-success.md](./ux-skill-configure-goose-local-success.md) | skill configure goose --yes --local succeeds at ./.agents/skills with clear path. |
| 633 | open | Low | Skills / positive pattern | [ux-skill-configure-pi-poe-agent-not-supported-clear.md](./ux-skill-configure-pi-poe-agent-not-supported-clear.md) | skill configure pi/poe-agent: Skills not supported for pi/poe-agent — clear capability message (contrast co… |
| 634 | open | Low | Skills / positive pattern | [ux-skill-install-from-file-works-well.md](./ux-skill-install-from-file-works-well.md) | skill install with --file/--name/--yes/--local produces a clear design-system success naming agent and path… |
| 635 | open | Low | Skills / positive pattern | [ux-skill-unconfigure-refuses-nonempty-without-force-good.md](./ux-skill-unconfigure-refuses-nonempty-without-force-good.md) | skill unconfigure claude: Skill directory … has files. Use --force to remove — clear safety (no --yes on he… |
| 636 | open | Low | Spawn / positive pattern | [ux-spawn-at-file-missing-validation-good.md](./ux-spawn-at-file-missing-validation-good.md) | spawn @/tmp/no-prompt.txt reports prompt could not read file with path and ENOENT — clear ValidationError s… |
| 637 | open | Low | Spawn / positive pattern | [ux-spawn-at-file-works.md](./ux-spawn-at-file-works.md) | spawn claude @/tmp/file with content succeeds — reconfirm @file prompt form works. |
| 638 | open | Low | Spawn / positive pattern | [ux-spawn-codex-works-with-frontier-model.md](./ux-spawn-codex-works-with-frontier-model.md) | spawn codex --model openai/gpt-5.3-codex succeeds (with stdin reading message residual). |
| 639 | open | Low | Spawn / positive pattern | [ux-spawn-cursor-with-model-works.md](./ux-spawn-cursor-with-model-works.md) | spawn cursor "say only: ok" --mode read --model anthropic/claude-haiku-4.5 succeeds. |
| 640 | open | Low | Spawn / positive pattern | [ux-spawn-cwd-tmp-works.md](./ux-spawn-cwd-tmp-works.md) | spawn with -C /tmp succeeds; Resume line shows cd /tmp && claude --resume — cwd override works. |
| 641 | open | Low | Spawn / positive pattern | [ux-spawn-invalid-mode-validation-good.md](./ux-spawn-invalid-mode-validation-good.md) | Invalid --mode "bogus" returns Expected yolo, auto, edit, or read without Commander raw skin. |
| 642 | open | Low | Spawn / positive pattern | [ux-spawn-log-default-redacts-agent-message-good.md](./ux-spawn-log-default-redacts-agent-message-good.md) | Default ACP JSONL log writes agent_message text as [redacted] — good privacy default. --log-content include… |
| 643 | open | Low | Spawn / positive pattern | [ux-spawn-pi-yes-works.md](./ux-spawn-pi-yes-works.md) | spawn pi "say only: ok" --yes succeeds without --mode (pi may not require mode like claude). |
| 644 | open | Low | Spawn / positive pattern | [ux-spawn-runtime-docker-error-good-install-hints.md](./ux-spawn-runtime-docker-error-good-install-hints.md) | No container engine found includes Docker Desktop / Colima / Podman install hints — good recovery copy (sti… |
| 645 | open | Low | Spawn / positive pattern | [ux-spawn-runtime-host-works.md](./ux-spawn-runtime-host-works.md) | spawn … --runtime host succeeds for claude with valid model — host runtime path works. |
| 646 | open | Low | Spawn / positive pattern | [ux-spawn-stdin-pipe-works.md](./ux-spawn-stdin-pipe-works.md) | echo "say only: ok" / spawn claude --mode read --model haiku --stdin succeeds. |
| 647 | open | Low | Spawn / positive pattern | [ux-spawn-test-goose-works.md](./ux-spawn-test-goose-works.md) | spawn goose and test goose with anthropic/claude-haiku-4.5 succeed. |
| 648 | open | Low | Configure / positive pattern | [ux-spawn-test-sonnet-4-6-works.md](./ux-spawn-test-sonnet-4-6-works.md) | spawn and test claude with anthropic/claude-sonnet-4.6 succeed — live model works when explicitly passed; d… |
| 649 | open | Low | Spawn / positive pattern | [ux-spawn-yes-with-explicit-mode-read-works.md](./ux-spawn-yes-with-explicit-mode-read-works.md) | spawn … --yes --mode read succeeds — explicit --mode overrides --yes yolo default as help implies. |
| 650 | open | Low | Tasks / positive pattern | [ux-tasks-verify-bad-list-format-good.md](./ux-tasks-verify-bad-list-format-good.md) | tasks verify some-list: Expected project to use "<owner>/<number>" format — clear ValidationError. |
| 651 | open | Low | Tasks / positive pattern | [ux-tasks-verify-format-error-good.md](./ux-tasks-verify-format-error-good.md) | Expected project to use owner/number format is clear (still [error] prefix odd). |
| 652 | open | Low | Test / positive pattern | [ux-test-codex-with-valid-model-succeeds.md](./ux-test-codex-with-valid-model-succeeds.md) | test codex --model openai/gpt-5.3-codex succeeds with design-system Tested Codex framing. |
| 653 | open | Low | Test / positive pattern | [ux-test-goose-with-valid-model-succeeds.md](./ux-test-goose-with-valid-model-succeeds.md) | test goose --model anthropic/claude-haiku-4.5 succeeds with Tested Goose framing. |
| 654 | open | Low | Test / positive pattern | [ux-test-with-valid-model-succeeds.md](./ux-test-with-valid-model-succeeds.md) | test claude --model anthropic/claude-haiku-4.5 succeeds with Tested Claude Code framing when model is valid… |
| 655 | open | Low | Traces / positive pattern | [ux-traces-invalid-source-validation-good.md](./ux-traces-invalid-source-validation-good.md) | traces --source bogus: Unsupported trace source "bogus". Expected one of: claude, codex, poe-code — clear V… |
| 656 | open | Low | Traces / positive pattern | [ux-traces-since-limit-works.md](./ux-traces-since-limit-works.md) | traces --since 1h --limit 3 returns 3 recent traces with sources — filters work. |
| 657 | open | Low | Traces / positive pattern | [ux-traces-source-invalid-validation-good.md](./ux-traces-source-invalid-validation-good.md) | Unsupported trace source lists Expected one of: claude, codex, poe-code without stack. |
| 658 | open | Low | Update / positive pattern | [ux-update-dry-run-always-global-npm.md](./ux-update-dry-run-always-global-npm.md) | update --dry-run plans npm install -g poe-code@latest — clear dry-run (always -g; package-manager override … |
| 659 | open | Low | Update / positive pattern | [ux-update-package-manager-override-works.md](./ux-update-package-manager-override-works.md) | update --package-manager bun --dry-run correctly plans bun install -g poe-code@latest — positive package-ma… |
| 660 | open | Low | Update / positive pattern | [ux-update-pnpm-package-manager-works.md](./ux-update-pnpm-package-manager-works.md) | update --package-manager pnpm --dry-run plans pnpm add -g poe-code@latest — positive package manager overri… |
| 661 | open | Low | Usage / positive pattern | [ux-usage-balance-default-good.md](./ux-usage-balance-default-good.md) | usage with no subcommand shows balance card with plan/add-on and next grant — strong positive. |
| 662 | open | Low | Usage / positive pattern | [ux-usage-balance-presentation-good.md](./ux-usage-balance-presentation-good.md) | usage balance shows Balance, Plan, Add-on, next grant with design-system framing and helpful next-points link. |
| 663 | open | Low | Usage / positive pattern | [ux-usage-list-filter-works-well.md](./ux-usage-list-filter-works-well.md) | usage list --filter Claude-Haiku returns filtered table with clear costs — good list UX (still no --json). |
| 664 | open | Low | Usage / positive pattern | [ux-usage-list-no-match-message-good.md](./ux-usage-list-no-match-message-good.md) | usage list --filter nonexistent-model-xyz → No entries match "…" — clear empty filter message. |
| 665 | open | Low | Utils / positive pattern | [ux-utils-config-init-already-exists-is-info.md](./ux-utils-config-init-already-exists-is-info.md) | config init when project config exists prints Project config already exists at path without error exit dram… |
| 666 | open | Low | Utils / positive pattern | [ux-utils-symlink-agents-already-linked-good.md](./ux-utils-symlink-agents-already-linked-good.md) | utils symlink agents --dry-run prints already linked without error — good idempotent message. |
| 667 | open | Low | Utils / positive pattern | [ux-utils-symlink-skills-both-exist-good-guidance.md](./ux-utils-symlink-skills-both-exist-good-guidance.md) | When both .claude/skills and .agents/skills exist, message explains resolve manually steps — good conflict … |
| 668 | open | Low | Utils / positive pattern | [ux-utils-symlink-skills-yes-local-dry-run-works.md](./ux-utils-symlink-skills-yes-local-dry-run-works.md) | With explicit scope flags, dry-run shows rename+symlink plan — positive once scope is provided (still subje… |

## Platform fixes

1. **Secret redaction** (dry-run diffs + auth + logout + unconfigure) + danger help  
2. **One-line fix: sonnet-5 → sonnet-4.6 in constants.ts + goose map** (also gaslight empty-model fallback)  
3. Make `--skip-if-configured` truthful  
4. **Validate configure --model against catalog** (reject any-string)  
5. Intentional-only dry-run diffs (including base-url/shape-base-url visibility)  
6. Model-aware effortLevel; **honor --reasoning-effort for claude**  
7. Resolve model aliases (sonnet/haiku) to full ids; show resolved id  
8. models filters: namespaced ids; reject invalid filters; **no stacks on ValidationError**; **--limit**  
9. Reject empty/invalid explicit flags  
10. Unified permission mode enum; safer --yes defaults  
11. **Unified skill-install scope flags + real --force overwrite policy**  
12. UserError classification; no success glyphs on failure; no JSONL flood on test  
13. displayBinaryName vs npm run dev / toolcraft  
14. **Agent capability matrix** (spawnable / configurable / installable)  
15. Destructive policy + model catalog validation  
16. Doctor overview  
17. Runtime/launch job GC + fix false "running" success + blank-ID rows  
18. Parent-group next-step defaults  
19. Detach/runner-sync require runtime context  
20. Slim published npm bins  
21. Non-TTY fail-fast: honor **--yes** over POE_NO_PROMPT (incl. gaslight without plan)  
22. Kind-aware plan/experiment/ralph/superintendent doc errors  
23. Split auth logout vs full factory reset  
24. Ralph init bootstrap any markdown  
25. Root command typo suggestions  
26. Fail/warn on unwritable --log-dir; print log paths  
27. Eval scaffold runnable defaults  
28. **Fix memory INDEX/LOG path contract** (init vs show/ls)  
29. Surface skill/memory on root help  
30. Fix opencode/kimi/gemini credential paths + **opencode model id mapping**  
31. Hooks source→target capability matrix  
32. Launch without turbo monorepo noise  
33. Opt-in postinstall skill sync  
34. plan browse / plan root non-TTY path/list contract  
35. Primary command Examples (spawn/configure)  
36. Gaslight default prompt should not auto-Implement plans  
37. Unified --worktree on spawn  
38. Document/list harness new template kinds  
39. Split provider logout credential-only vs agent unconfigure  

## Alphabetical index

| File | # |
| --- | ---: |
| [ux-acp-stream-uses-success-glyph-for-partial-text.md](./ux-acp-stream-uses-success-glyph-for-partial-text.md) | 212 |
| [ux-activity-timeout-1ms-works-but-chrome.md](./ux-activity-timeout-1ms-works-but-chrome.md) | 529 |
| [ux-activity-timeout-ms-uses-system-chrome.md](./ux-activity-timeout-ms-uses-system-chrome.md) | 213 |
| [ux-activity-timeout-ms-zero-validation-good.md](./ux-activity-timeout-ms-zero-validation-good.md) | 530 |
| [ux-activity-timeout-zero-good-validation.md](./ux-activity-timeout-zero-good-validation.md) | 531 |
| [ux-activity-timeout-zero-validation-good.md](./ux-activity-timeout-zero-validation-good.md) | 532 |
| [ux-agent-capability-matrix-spawn-vs-configure-vs-install.md](./ux-agent-capability-matrix-spawn-vs-configure-vs-install.md) | 19 |
| [ux-agent-default-model-hardcoded.md](./ux-agent-default-model-hardcoded.md) | 459 |
| [ux-agent-default-model-works-when-opus-valid.md](./ux-agent-default-model-works-when-opus-valid.md) | 533 |
| [ux-agent-default-opus-4-7-not-latest-opus-4-8.md](./ux-agent-default-opus-4-7-not-latest-opus-4-8.md) | 460 |
| [ux-agent-empty-api-key-silently-uses-stored.md](./ux-agent-empty-api-key-silently-uses-stored.md) | 214 |
| [ux-agent-empty-model-see-logs.md](./ux-agent-empty-model-see-logs.md) | 215 |
| [ux-agent-empty-prompt-see-logs.md](./ux-agent-empty-prompt-see-logs.md) | 216 |
| [ux-agent-invalid-model-system-chrome.md](./ux-agent-invalid-model-system-chrome.md) | 217 |
| [ux-agent-spawn-missing-args-raw-commander.md](./ux-agent-spawn-missing-args-raw-commander.md) | 218 |
| [ux-api-key-flags-encourage-shell-history-leaks.md](./ux-api-key-flags-encourage-shell-history-leaks.md) | 219 |
| [ux-approval-copy-hardcodes-toolcraft-in-source.md](./ux-approval-copy-hardcodes-toolcraft-in-source.md) | 20 |
| [ux-approval-queued-message-says-toolcraft.md](./ux-approval-queued-message-says-toolcraft.md) | 21 |
| [ux-approvals-invalid-state-silent-empty-reconfirmed.md](./ux-approvals-invalid-state-silent-empty-reconfirmed.md) | 220 |
| [ux-approvals-invalid-state-silent-empty.md](./ux-approvals-invalid-state-silent-empty.md) | 221 |
| [ux-approvals-show-missing-says-task-not-found.md](./ux-approvals-show-missing-says-task-not-found.md) | 22 |
| [ux-approvals-show-missing-task-debug-tease-reconfirmed.md](./ux-approvals-show-missing-task-debug-tease-reconfirmed.md) | 222 |
| [ux-auth-api-key-dry-run-still-prints-secret-live-reconfirm.md](./ux-auth-api-key-dry-run-still-prints-secret-live-reconfirm.md) | 23 |
| [ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md](./ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md) | 24 |
| [ux-auth-api-key-dry-run-still-prints-secret.md](./ux-auth-api-key-dry-run-still-prints-secret.md) | 4 |
| [ux-auth-api-key-help-no-danger-warning.md](./ux-auth-api-key-help-no-danger-warning.md) | 25 |
| [ux-auth-api-key-help-still-no-danger-reconfirmed.md](./ux-auth-api-key-help-still-no-danger-reconfirmed.md) | 26 |
| [ux-auth-api-key-prints-secret.md](./ux-auth-api-key-prints-secret.md) | 3 |
| [ux-auth-help-api-key-no-danger.md](./ux-auth-help-api-key-no-danger.md) | 223 |
| [ux-auth-logout-same-as-logout-help.md](./ux-auth-logout-same-as-logout-help.md) | 27 |
| [ux-auth-status-no-json-flag.md](./ux-auth-status-no-json-flag.md) | 461 |
| [ux-auth-whoami-fields-documented-by-shape.md](./ux-auth-whoami-fields-documented-by-shape.md) | 534 |
| [ux-auth-whoami-help-documents-json-good.md](./ux-auth-whoami-help-documents-json-good.md) | 535 |
| [ux-auth-whoami-raw-json-vs-status-panel.md](./ux-auth-whoami-raw-json-vs-status-panel.md) | 462 |
| [ux-auth-whoami-raw-json.md](./ux-auth-whoami-raw-json.md) | 463 |
| [ux-binary-wrappers-undocumented.md](./ux-binary-wrappers-undocumented.md) | 224 |
| [ux-braintrust-only-status-no-enable.md](./ux-braintrust-only-status-no-enable.md) | 225 |
| [ux-braintrust-status-disabled-no-next-step.md](./ux-braintrust-status-disabled-no-next-step.md) | 226 |
| [ux-braintrust-status-minimal-disabled.md](./ux-braintrust-status-minimal-disabled.md) | 464 |
| [ux-braintrust-status-opaque.md](./ux-braintrust-status-opaque.md) | 536 |
| [ux-capture-otel-alone-silent-success.md](./ux-capture-otel-alone-silent-success.md) | 227 |
| [ux-capture-otel-content-without-capture-silent.md](./ux-capture-otel-content-without-capture-silent.md) | 228 |
| [ux-capture-otel-no-visible-output-change.md](./ux-capture-otel-no-visible-output-change.md) | 465 |
| [ux-code-review-double-error-skin.md](./ux-code-review-double-error-skin.md) | 229 |
| [ux-code-review-drafts-missing-arg-double-error.md](./ux-code-review-drafts-missing-arg-double-error.md) | 28 |
| [ux-code-review-drafts-not-found-debug-tease.md](./ux-code-review-drafts-not-found-debug-tease.md) | 230 |
| [ux-code-review-install-no-dry-run-force-writes.md](./ux-code-review-install-no-dry-run-force-writes.md) | 231 |
| [ux-code-review-install-output-unframed-wrapped.md](./ux-code-review-install-output-unframed-wrapped.md) | 232 |
| [ux-code-review-missing-prurl-npm-run-dev.md](./ux-code-review-missing-prurl-npm-run-dev.md) | 233 |
| [ux-code-review-profiles-bare-table.md](./ux-code-review-profiles-bare-table.md) | 234 |
| [ux-code-review-profiles-raw-table.md](./ux-code-review-profiles-raw-table.md) | 466 |
| [ux-code-review-profiles-table-outside-design-system.md](./ux-code-review-profiles-table-outside-design-system.md) | 467 |
| [ux-code-review-prompt-preview-good.md](./ux-code-review-prompt-preview-good.md) | 537 |
| [ux-code-review-prompt-preview-missing-spawn-npm-run-dev.md](./ux-code-review-prompt-preview-missing-spawn-npm-run-dev.md) | 235 |
| [ux-code-review-prompt-preview-unframed.md](./ux-code-review-prompt-preview-unframed.md) | 236 |
| [ux-code-review-run-invalid-url-wrong-error.md](./ux-code-review-run-invalid-url-wrong-error.md) | 29 |
| [ux-command-aliases-undocumented-on-root-help.md](./ux-command-aliases-undocumented-on-root-help.md) | 468 |
| [ux-command-not-found-no-suggestions.md](./ux-command-not-found-no-suggestions.md) | 237 |
| [ux-config-edit-missing-editor-see-logs.md](./ux-config-edit-missing-editor-see-logs.md) | 238 |
| [ux-config-init-already-exists-good.md](./ux-config-init-already-exists-good.md) | 538 |
| [ux-configure-accepts-any-string-as-model-no-catalog-check.md](./ux-configure-accepts-any-string-as-model-no-catalog-check.md) | 9 |
| [ux-configure-accepts-invalid-model-without-validation.md](./ux-configure-accepts-invalid-model-without-validation.md) | 30 |
| [ux-configure-api-key-dry-run-redacts-bearer.md](./ux-configure-api-key-dry-run-redacts-bearer.md) | 539 |
| [ux-configure-base-url-may-be-ignored.md](./ux-configure-base-url-may-be-ignored.md) | 31 |
| [ux-configure-base-url-not-visible-in-dry-run.md](./ux-configure-base-url-not-visible-in-dry-run.md) | 32 |
| [ux-configure-codex-dry-run-still-leaks-and-noise.md](./ux-configure-codex-dry-run-still-leaks-and-noise.md) | 33 |
| [ux-configure-codex-reasoning-effort-medium-partial.md](./ux-configure-codex-reasoning-effort-medium-partial.md) | 239 |
| [ux-configure-cursor-dry-run-no-filesystem-changes.md](./ux-configure-cursor-dry-run-no-filesystem-changes.md) | 240 |
| [ux-configure-cursor-dry-run-too-quiet.md](./ux-configure-cursor-dry-run-too-quiet.md) | 241 |
| [ux-configure-cursor-model-flag-silent-noop.md](./ux-configure-cursor-model-flag-silent-noop.md) | 242 |
| [ux-configure-dry-run-dumps-entire-existing-agent-config.md](./ux-configure-dry-run-dumps-entire-existing-agent-config.md) | 34 |
| [ux-configure-dry-run-floods-diff.md](./ux-configure-dry-run-floods-diff.md) | 243 |
| [ux-configure-dry-run-shows-full-existing-settings-as-create.md](./ux-configure-dry-run-shows-full-existing-settings-as-create.md) | 35 |
| [ux-configure-dry-run-writes-stale-model-id.md](./ux-configure-dry-run-writes-stale-model-id.md) | 36 |
| [ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md](./ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md) | 244 |
| [ux-configure-help-missing-examples.md](./ux-configure-help-missing-examples.md) | 37 |
| [ux-configure-kimi-default-model-novitaai.md](./ux-configure-kimi-default-model-novitaai.md) | 245 |
| [ux-configure-kimi-ignores-explicit-novita-namespace.md](./ux-configure-kimi-ignores-explicit-novita-namespace.md) | 246 |
| [ux-configure-model-alias-sonnet-haiku-written-literally.md](./ux-configure-model-alias-sonnet-haiku-written-literally.md) | 38 |
| [ux-configure-non-tty-demands-poe-no-prompt-not-yes.md](./ux-configure-non-tty-demands-poe-no-prompt-not-yes.md) | 39 |
| [ux-configure-provider-requires-model-without-listing-models.md](./ux-configure-provider-requires-model-without-listing-models.md) | 247 |
| [ux-configure-reasoning-effort-ignored-for-claude.md](./ux-configure-reasoning-effort-ignored-for-claude.md) | 40 |
| [ux-configure-shape-base-url-not-visible-in-dry-run.md](./ux-configure-shape-base-url-not-visible-in-dry-run.md) | 41 |
| [ux-configure-shape-base-url-opaque.md](./ux-configure-shape-base-url-opaque.md) | 469 |
| [ux-configure-success-vscode-next-steps-good.md](./ux-configure-success-vscode-next-steps-good.md) | 540 |
| [ux-configure-unknown-api-shape-lists-exposed.md](./ux-configure-unknown-api-shape-lists-exposed.md) | 541 |
| [ux-configure-unknown-provider-good-message.md](./ux-configure-unknown-provider-good-message.md) | 542 |
| [ux-configure-unknown-provider-validation-good.md](./ux-configure-unknown-provider-validation-good.md) | 543 |
| [ux-configure-yes-dry-run-always-defaults-dead-sonnet-5.md](./ux-configure-yes-dry-run-always-defaults-dead-sonnet-5.md) | 8 |
| [ux-configure-yes-silent-default-agent.md](./ux-configure-yes-silent-default-agent.md) | 248 |
| [ux-constants-source-of-dead-sonnet-5.md](./ux-constants-source-of-dead-sonnet-5.md) | 5 |
| [ux-cursor-and-cursor-agent-aliases-both-work.md](./ux-cursor-and-cursor-agent-aliases-both-work.md) | 544 |
| [ux-cwd-file-path-not-directory-good.md](./ux-cwd-file-path-not-directory-good.md) | 545 |
| [ux-cwd-missing-path-good-message.md](./ux-cwd-missing-path-good-message.md) | 546 |
| [ux-dashboard-keybindings-undocumented-on-cli-help.md](./ux-dashboard-keybindings-undocumented-on-cli-help.md) | 249 |
| [ux-dashboard-ui-tui-missing.md](./ux-dashboard-ui-tui-missing.md) | 470 |
| [ux-detach-runtime-host-still-inline.md](./ux-detach-runtime-host-still-inline.md) | 42 |
| [ux-detach-without-runtime-still-inline-reconfirmed.md](./ux-detach-without-runtime-still-inline-reconfirmed.md) | 43 |
| [ux-development-mode-usage-intentional-but-leaks.md](./ux-development-mode-usage-intentional-but-leaks.md) | 44 |
| [ux-doctor-and-completion-still-missing.md](./ux-doctor-and-completion-still-missing.md) | 250 |
| [ux-dry-run-diffs-print-secrets.md](./ux-dry-run-diffs-print-secrets.md) | 1 |
| [ux-dual-help-systems.md](./ux-dual-help-systems.md) | 45 |
| [ux-e2b-missing-key-error-good.md](./ux-e2b-missing-key-error-good.md) | 547 |
| [ux-editor-error-still-system-chrome.md](./ux-editor-error-still-system-chrome.md) | 251 |
| [ux-editor-missing-raw-error.md](./ux-editor-missing-raw-error.md) | 471 |
| [ux-effort-xhigh-valid-for-opus-not-sonnet.md](./ux-effort-xhigh-valid-for-opus-not-sonnet.md) | 46 |
| [ux-empty-api-key-flag-silently-ignored.md](./ux-empty-api-key-flag-silently-ignored.md) | 252 |
| [ux-empty-api-key-flag-still-silently-ignored.md](./ux-empty-api-key-flag-still-silently-ignored.md) | 47 |
| [ux-empty-api-key-login-good-but-configure-ignores.md](./ux-empty-api-key-login-good-but-configure-ignores.md) | 48 |
| [ux-empty-model-flag-behavior-inconsistent.md](./ux-empty-model-flag-behavior-inconsistent.md) | 49 |
| [ux-empty-plan-kind-lists-still-draw-empty-tables.md](./ux-empty-plan-kind-lists-still-draw-empty-tables.md) | 253 |
| [ux-empty-prompt-string-rejected.md](./ux-empty-prompt-string-rejected.md) | 548 |
| [ux-empty-resume-thread-id-silently-ignored.md](./ux-empty-resume-thread-id-silently-ignored.md) | 254 |
| [ux-error-panel-closes-before-error.md](./ux-error-panel-closes-before-error.md) | 50 |
| [ux-eval-check-fails-on-placeholder-target-git-remote.md](./ux-eval-check-fails-on-placeholder-target-git-remote.md) | 51 |
| [ux-eval-empty-source-message-inconsistent-skins.md](./ux-eval-empty-source-message-inconsistent-skins.md) | 255 |
| [ux-eval-errors-outside-design-system.md](./ux-eval-errors-outside-design-system.md) | 472 |
| [ux-eval-init-bare-stdout-no-design-system.md](./ux-eval-init-bare-stdout-no-design-system.md) | 256 |
| [ux-eval-init-creates-in-cwd-with-bare-success.md](./ux-eval-init-creates-in-cwd-with-bare-success.md) | 473 |
| [ux-eval-init-name-validation-bare-text.md](./ux-eval-init-name-validation-bare-text.md) | 257 |
| [ux-eval-init-success-is-bare-paths.md](./ux-eval-init-success-is-bare-paths.md) | 474 |
| [ux-eval-lint-check-empty-same-message.md](./ux-eval-lint-check-empty-same-message.md) | 258 |
| [ux-eval-lint-table-good.md](./ux-eval-lint-table-good.md) | 549 |
| [ux-eval-report-debug-flag-undocumented-in-error.md](./ux-eval-report-debug-flag-undocumented-in-error.md) | 475 |
| [ux-eval-report-empty-debug-tease.md](./ux-eval-report-empty-debug-tease.md) | 259 |
| [ux-eval-report-invalid-format-npm-run-dev.md](./ux-eval-report-invalid-format-npm-run-dev.md) | 52 |
| [ux-eval-run-missing-params-npm-run-dev.md](./ux-eval-run-missing-params-npm-run-dev.md) | 260 |
| [ux-eval-unknown-command-suggests-lint-for-list.md](./ux-eval-unknown-command-suggests-lint-for-list.md) | 261 |
| [ux-experiment-install-already-exists-vs-pipeline-skip.md](./ux-experiment-install-already-exists-vs-pipeline-skip.md) | 53 |
| [ux-experiment-install-force-does-not-overwrite-skill.md](./ux-experiment-install-force-does-not-overwrite-skill.md) | 54 |
| [ux-experiment-install-force-does-not-overwrite.md](./ux-experiment-install-force-does-not-overwrite.md) | 55 |
| [ux-experiment-install-requires-agent-or-yes-good.md](./ux-experiment-install-requires-agent-or-yes-good.md) | 550 |
| [ux-experiment-journal-no-experiment-docs-message.md](./ux-experiment-journal-no-experiment-docs-message.md) | 56 |
| [ux-experiment-journal-wrong-doc-type-message.md](./ux-experiment-journal-wrong-doc-type-message.md) | 476 |
| [ux-experiment-journal-wrong-kind-says-not-found.md](./ux-experiment-journal-wrong-kind-says-not-found.md) | 57 |
| [ux-experiment-ralph-no-doc-wrong-message.md](./ux-experiment-ralph-no-doc-wrong-message.md) | 58 |
| [ux-experiment-validate-wrong-kind-says-not-found.md](./ux-experiment-validate-wrong-kind-says-not-found.md) | 59 |
| [ux-extra-npm-bins-confusing.md](./ux-extra-npm-bins-confusing.md) | 477 |
| [ux-extra-npm-bins-still-published-reconfirmed.md](./ux-extra-npm-bins-still-published-reconfirmed.md) | 60 |
| [ux-extra-npm-bins-still-shipped.md](./ux-extra-npm-bins-still-shipped.md) | 61 |
| [ux-failure-shown-as-success-markers.md](./ux-failure-shown-as-success-markers.md) | 62 |
| [ux-frontier-models-only-sonnet-5-is-dead.md](./ux-frontier-models-only-sonnet-5-is-dead.md) | 6 |
| [ux-gaslight-archive-and-no-archive-both-accepted.md](./ux-gaslight-archive-and-no-archive-both-accepted.md) | 478 |
| [ux-gaslight-config-missing-enoent-system-chrome.md](./ux-gaslight-config-missing-enoent-system-chrome.md) | 262 |
| [ux-gaslight-config-missing-enoent.md](./ux-gaslight-config-missing-enoent.md) | 263 |
| [ux-gaslight-empty-model-falls-back-to-dead-sonnet-5.md](./ux-gaslight-empty-model-falls-back-to-dead-sonnet-5.md) | 14 |
| [ux-gaslight-ingest-failure-dumps-jsonl.md](./ux-gaslight-ingest-failure-dumps-jsonl.md) | 63 |
| [ux-gaslight-ingest-limit-zero-validation-good.md](./ux-gaslight-ingest-limit-zero-validation-good.md) | 551 |
| [ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md](./ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md) | 64 |
| [ux-gaslight-install-force-dry-run-vs-already-exists.md](./ux-gaslight-install-force-dry-run-vs-already-exists.md) | 264 |
| [ux-gaslight-install-force-overwrites-without-diff.md](./ux-gaslight-install-force-overwrites-without-diff.md) | 265 |
| [ux-gaslight-install-global-dry-run-clean.md](./ux-gaslight-install-global-dry-run-clean.md) | 552 |
| [ux-gaslight-missing-plan-system-chrome-reconfirmed.md](./ux-gaslight-missing-plan-system-chrome-reconfirmed.md) | 266 |
| [ux-gaslight-multi-plan-fails-fast-with-success-markers.md](./ux-gaslight-multi-plan-fails-fast-with-success-markers.md) | 267 |
| [ux-gaslight-no-activity-timeout-flag.md](./ux-gaslight-no-activity-timeout-flag.md) | 268 |
| [ux-gaslight-no-plan-autopicks-and-hits-stale-model.md](./ux-gaslight-no-plan-autopicks-and-hits-stale-model.md) | 65 |
| [ux-gaslight-opaque-naming.md](./ux-gaslight-opaque-naming.md) | 269 |
| [ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md](./ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md) | 270 |
| [ux-gaslight-plan-path-starts-implement-without-confirm.md](./ux-gaslight-plan-path-starts-implement-without-confirm.md) | 66 |
| [ux-gaslight-plans-flag-still-auto-implement.md](./ux-gaslight-plans-flag-still-auto-implement.md) | 67 |
| [ux-gaslight-unknown-agent-says-service.md](./ux-gaslight-unknown-agent-says-service.md) | 271 |
| [ux-gaslight-yes-without-plan-hangs-or-stalls.md](./ux-gaslight-yes-without-plan-hangs-or-stalls.md) | 68 |
| [ux-gemini-configure-dry-run-too-quiet.md](./ux-gemini-configure-dry-run-too-quiet.md) | 272 |
| [ux-gemini-still-provider-credential-after-configure-dry-run.md](./ux-gemini-still-provider-credential-after-configure-dry-run.md) | 69 |
| [ux-gh-install-dry-run-lists-paths-without-panel.md](./ux-gh-install-dry-run-lists-paths-without-panel.md) | 273 |
| [ux-gh-install-eject-flag-opaque.md](./ux-gh-install-eject-flag-opaque.md) | 479 |
| [ux-gh-install-preview-without-dry-run-flag.md](./ux-gh-install-preview-without-dry-run-flag.md) | 274 |
| [ux-gh-prompt-preview-dumps-long-unframed-prompt.md](./ux-gh-prompt-preview-dumps-long-unframed-prompt.md) | 275 |
| [ux-gh-uninstall-invalid-name-lists-choices-good.md](./ux-gh-uninstall-invalid-name-lists-choices-good.md) | 553 |
| [ux-gh-variables-list-good.md](./ux-gh-variables-list-good.md) | 554 |
| [ux-github-cwd-clone-errors-still-raw-git.md](./ux-github-cwd-clone-errors-still-raw-git.md) | 70 |
| [ux-github-cwd-clone-errors-unframed.md](./ux-github-cwd-clone-errors-unframed.md) | 207 |
| [ux-global-flags-hidden-on-subcommand-help.md](./ux-global-flags-hidden-on-subcommand-help.md) | 276 |
| [ux-goal-chat-acp-commands-missing.md](./ux-goal-chat-acp-commands-missing.md) | 277 |
| [ux-goose-configure-still-embeds-sonnet-5-in-models-list.md](./ux-goose-configure-still-embeds-sonnet-5-in-models-list.md) | 10 |
| [ux-group-commands-print-help-only.md](./ux-group-commands-print-help-only.md) | 278 |
| [ux-hardcoded-stale-sonnet-5-in-product-defaults.md](./ux-hardcoded-stale-sonnet-5-in-product-defaults.md) | 7 |
| [ux-harness-list-empty-message-good.md](./ux-harness-list-empty-message-good.md) | 555 |
| [ux-harness-list-no-dir-flag.md](./ux-harness-list-no-dir-flag.md) | 279 |
| [ux-harness-list-only-cwd-not-created-dir.md](./ux-harness-list-only-cwd-not-created-dir.md) | 280 |
| [ux-harness-missing-file-system-chrome.md](./ux-harness-missing-file-system-chrome.md) | 281 |
| [ux-harness-new-all-builtin-kinds-work.md](./ux-harness-new-all-builtin-kinds-work.md) | 556 |
| [ux-harness-new-kinds-undocumented-must-guess-demo-names.md](./ux-harness-new-kinds-undocumented-must-guess-demo-names.md) | 71 |
| [ux-harness-new-success-good.md](./ux-harness-new-success-good.md) | 557 |
| [ux-harness-new-unknown-template-no-kinds-reconfirmed.md](./ux-harness-new-unknown-template-no-kinds-reconfirmed.md) | 282 |
| [ux-harness-run-coverage-demo-works.md](./ux-harness-run-coverage-demo-works.md) | 558 |
| [ux-harness-run-fix-works.md](./ux-harness-run-fix-works.md) | 559 |
| [ux-harness-run-missing-file-system-chrome.md](./ux-harness-run-missing-file-system-chrome.md) | 283 |
| [ux-harness-run-no-path-says-no-pairs.md](./ux-harness-run-no-path-says-no-pairs.md) | 480 |
| [ux-harness-run-success-opaque-result-object.md](./ux-harness-run-success-opaque-result-object.md) | 284 |
| [ux-harness-unknown-template-no-kinds.md](./ux-harness-unknown-template-no-kinds.md) | 560 |
| [ux-harness-unknown-template-still-omits-kind-list.md](./ux-harness-unknown-template-still-omits-kind-list.md) | 285 |
| [ux-help-command-not-registered.md](./ux-help-command-not-registered.md) | 286 |
| [ux-help-subcommand-inconsistency.md](./ux-help-subcommand-inconsistency.md) | 561 |
| [ux-hidden-and-orphan-commands.md](./ux-hidden-and-orphan-commands.md) | 287 |
| [ux-hooks-auto-strategy-still-refuses-user-settings.md](./ux-hooks-auto-strategy-still-refuses-user-settings.md) | 72 |
| [ux-hooks-bridge-refuse-user-authored-file-opaque.md](./ux-hooks-bridge-refuse-user-authored-file-opaque.md) | 288 |
| [ux-hooks-from-codex-to-claude-transform-unsupported.md](./ux-hooks-from-codex-to-claude-transform-unsupported.md) | 73 |
| [ux-hooks-from-pi-unsupported-lists-supported.md](./ux-hooks-from-pi-unsupported-lists-supported.md) | 481 |
| [ux-hooks-from-spawn-poe-code-enoent.md](./ux-hooks-from-spawn-poe-code-enoent.md) | 74 |
| [ux-hooks-from-unknown-lists-supported-good.md](./ux-hooks-from-unknown-lists-supported-good.md) | 562 |
| [ux-hooks-from-unsupported-system-chrome.md](./ux-hooks-from-unsupported-system-chrome.md) | 289 |
| [ux-hooks-scope-invalid-raw-commander.md](./ux-hooks-scope-invalid-raw-commander.md) | 482 |
| [ux-hooks-scope-project-same-refuse-as-symlink.md](./ux-hooks-scope-project-same-refuse-as-symlink.md) | 290 |
| [ux-hooks-strategy-invalid-raw-commander.md](./ux-hooks-strategy-invalid-raw-commander.md) | 483 |
| [ux-hooks-strategy-symlink-refuses-user-settings.md](./ux-hooks-strategy-symlink-refuses-user-settings.md) | 75 |
| [ux-hooks-strategy-transform-unsupported-opaque.md](./ux-hooks-strategy-transform-unsupported-opaque.md) | 76 |
| [ux-important-commands-absent-from-root-help.md](./ux-important-commands-absent-from-root-help.md) | 291 |
| [ux-inconsistent-agent-surface-across-commands.md](./ux-inconsistent-agent-surface-across-commands.md) | 77 |
| [ux-install-always-claims-success.md](./ux-install-always-claims-success.md) | 484 |
| [ux-install-always-success-reconfirmed.md](./ux-install-always-success-reconfirmed.md) | 292 |
| [ux-install-help-missing-yes-and-list.md](./ux-install-help-missing-yes-and-list.md) | 293 |
| [ux-install-non-tty-demands-poe-no-prompt-not-yes.md](./ux-install-non-tty-demands-poe-no-prompt-not-yes.md) | 78 |
| [ux-install-opencode-success-good.md](./ux-install-opencode-success-good.md) | 563 |
| [ux-install-pi-unknown-not-in-installable-list.md](./ux-install-pi-unknown-not-in-installable-list.md) | 79 |
| [ux-install-skill-flags-inconsistent-across-commands.md](./ux-install-skill-flags-inconsistent-across-commands.md) | 80 |
| [ux-install-yes-defaults-agent-silently.md](./ux-install-yes-defaults-agent-silently.md) | 294 |
| [ux-install-yes-silently-defaults-to-claude.md](./ux-install-yes-silently-defaults-to-claude.md) | 81 |
| [ux-json-flag-inconsistent-across-commands.md](./ux-json-flag-inconsistent-across-commands.md) | 295 |
| [ux-kimi-default-model-id-mismatches-catalog-namespace.md](./ux-kimi-default-model-id-mismatches-catalog-namespace.md) | 296 |
| [ux-launch-commands-trigger-full-turbo-rebuild.md](./ux-launch-commands-trigger-full-turbo-rebuild.md) | 297 |
| [ux-launch-missing-process-system-chrome.md](./ux-launch-missing-process-system-chrome.md) | 298 |
| [ux-launch-restart-missing-see-logs.md](./ux-launch-restart-missing-see-logs.md) | 299 |
| [ux-launch-start-claims-running-then-status-stopped.md](./ux-launch-start-claims-running-then-status-stopped.md) | 82 |
| [ux-launch-start-dumps-turbo-build.md](./ux-launch-start-dumps-turbo-build.md) | 83 |
| [ux-launch-start-opaque-failure.md](./ux-launch-start-opaque-failure.md) | 300 |
| [ux-launch-start-success-then-status-shows-stopped.md](./ux-launch-start-success-then-status-shows-stopped.md) | 84 |
| [ux-launch-start-triggers-turbo-noise-and-opaque-failure.md](./ux-launch-start-triggers-turbo-noise-and-opaque-failure.md) | 85 |
| [ux-launch-start-via-npm-run-dev-confuses-argv.md](./ux-launch-start-via-npm-run-dev-confuses-argv.md) | 301 |
| [ux-launch-status-blank-id-zombie-rows.md](./ux-launch-status-blank-id-zombie-rows.md) | 86 |
| [ux-launch-status-crashes-on-tombstone-dirs.md](./ux-launch-status-crashes-on-tombstone-dirs.md) | 87 |
| [ux-launch-status-shows-dash-id-ghost-rows.md](./ux-launch-status-shows-dash-id-ghost-rows.md) | 88 |
| [ux-launch-status-shows-failed-experiment-leftovers.md](./ux-launch-status-shows-failed-experiment-leftovers.md) | 485 |
| [ux-log-content-flag-no-danger-warning.md](./ux-log-content-flag-no-danger-warning.md) | 302 |
| [ux-log-content-flags-underwarn-sensitive-data.md](./ux-log-content-flags-underwarn-sensitive-data.md) | 303 |
| [ux-log-content-help-underwarns-reconfirmed.md](./ux-log-content-help-underwarns-reconfirmed.md) | 304 |
| [ux-log-dir-relative-works-with-path-feedback-gap.md](./ux-log-dir-relative-works-with-path-feedback-gap.md) | 486 |
| [ux-log-dir-unwritable-silently-ignored.md](./ux-log-dir-unwritable-silently-ignored.md) | 89 |
| [ux-log-file-name-no-path-feedback.md](./ux-log-file-name-no-path-feedback.md) | 305 |
| [ux-login-api-key-rejected-good.md](./ux-login-api-key-rejected-good.md) | 564 |
| [ux-login-help-omits-interactive-and-yes.md](./ux-login-help-omits-interactive-and-yes.md) | 306 |
| [ux-login-help-omits-oauth-default.md](./ux-login-help-omits-oauth-default.md) | 307 |
| [ux-login-help-still-minimal.md](./ux-login-help-still-minimal.md) | 308 |
| [ux-login-non-tty-hangs-on-oauth.md](./ux-login-non-tty-hangs-on-oauth.md) | 90 |
| [ux-login-non-tty-hangs-reconfirmed.md](./ux-login-non-tty-hangs-reconfirmed.md) | 91 |
| [ux-login-rejected-no-recovery.md](./ux-login-rejected-no-recovery.md) | 309 |
| [ux-login-yes-message-good-but-worth-aligning.md](./ux-login-yes-message-good-but-worth-aligning.md) | 565 |
| [ux-login-yes-without-key-message-good.md](./ux-login-yes-without-key-message-good.md) | 566 |
| [ux-logout-dry-run-multi-panel-noise.md](./ux-logout-dry-run-multi-panel-noise.md) | 92 |
| [ux-logout-dry-run-still-multi-panel-unconfigure.md](./ux-logout-dry-run-still-multi-panel-unconfigure.md) | 93 |
| [ux-logout-dry-run-still-prints-secrets-reconfirmed.md](./ux-logout-dry-run-still-prints-secrets-reconfirmed.md) | 2 |
| [ux-logout-help-no-danger-or-scope-detail.md](./ux-logout-help-no-danger-or-scope-detail.md) | 94 |
| [ux-logout-overclaims-scope.md](./ux-logout-overclaims-scope.md) | 17 |
| [ux-maestro-config-vs-workflow-flags-duplicated.md](./ux-maestro-config-vs-workflow-flags-duplicated.md) | 310 |
| [ux-maestro-dry-run-hits-github-401-reconfirmed.md](./ux-maestro-dry-run-hits-github-401-reconfirmed.md) | 95 |
| [ux-maestro-dry-run-hits-github-without-workflow.md](./ux-maestro-dry-run-hits-github-without-workflow.md) | 208 |
| [ux-maestro-dry-run-path-vs-flag-confusion.md](./ux-maestro-dry-run-path-vs-flag-confusion.md) | 96 |
| [ux-maestro-dual-invocation-shape.md](./ux-maestro-dual-invocation-shape.md) | 567 |
| [ux-maestro-duplicate-config-flags.md](./ux-maestro-duplicate-config-flags.md) | 568 |
| [ux-maestro-run-dry-run-still-hits-github-401.md](./ux-maestro-run-dry-run-still-hits-github-401.md) | 97 |
| [ux-maestro-tick-missing-transition-raw-commander.md](./ux-maestro-tick-missing-transition-raw-commander.md) | 311 |
| [ux-maestro-tui-duplicate-config-workflow-flags.md](./ux-maestro-tui-duplicate-config-workflow-flags.md) | 312 |
| [ux-maestro-tui-mutual-exclusion-validation-good.md](./ux-maestro-tui-mutual-exclusion-validation-good.md) | 569 |
| [ux-many-parent-groups-only-dump-help.md](./ux-many-parent-groups-only-dump-help.md) | 313 |
| [ux-markdown-read-depth-1-empty-for-h1-only-structure.md](./ux-markdown-read-depth-1-empty-for-h1-only-structure.md) | 314 |
| [ux-markdown-read-depth-2-works-well.md](./ux-markdown-read-depth-2-works-well.md) | 570 |
| [ux-markdown-read-depth-zero-empty-sections.md](./ux-markdown-read-depth-zero-empty-sections.md) | 487 |
| [ux-markdown-read-negative-depth-validation-good.md](./ux-markdown-read-negative-depth-validation-good.md) | 571 |
| [ux-markdown-read-section-wrong-recovery-command.md](./ux-markdown-read-section-wrong-recovery-command.md) | 98 |
| [ux-mcp-servers-empty-object-accepted.md](./ux-mcp-servers-empty-object-accepted.md) | 488 |
| [ux-mcp-servers-file-and-json-validation-good.md](./ux-mcp-servers-file-and-json-validation-good.md) | 572 |
| [ux-mcp-servers-invalid-json-validation-good.md](./ux-mcp-servers-invalid-json-validation-good.md) | 573 |
| [ux-mcp-servers-missing-file-almost-good.md](./ux-mcp-servers-missing-file-almost-good.md) | 489 |
| [ux-mcp-servers-validation-good.md](./ux-mcp-servers-validation-good.md) | 574 |
| [ux-memory-agent-commands-invalid-json-opaque.md](./ux-memory-agent-commands-invalid-json-opaque.md) | 99 |
| [ux-memory-cache-clear-requires-yes-good.md](./ux-memory-cache-clear-requires-yes-good.md) | 575 |
| [ux-memory-cache-clear-requires-yes-see-logs.md](./ux-memory-cache-clear-requires-yes-see-logs.md) | 490 |
| [ux-memory-cache-status-zero-good.md](./ux-memory-cache-status-zero-good.md) | 576 |
| [ux-memory-clear-help-still-no-force-or-yes.md](./ux-memory-clear-help-still-no-force-or-yes.md) | 315 |
| [ux-memory-clear-no-confirmation.md](./ux-memory-clear-no-confirmation.md) | 316 |
| [ux-memory-clear-requires-yes-non-tty-good.md](./ux-memory-clear-requires-yes-non-tty-good.md) | 577 |
| [ux-memory-clear-yes-works-when-initialized.md](./ux-memory-clear-yes-works-when-initialized.md) | 578 |
| [ux-memory-explain-invalid-json-system-chrome.md](./ux-memory-explain-invalid-json-system-chrome.md) | 100 |
| [ux-memory-ingest-enoent-system-chrome.md](./ux-memory-ingest-enoent-system-chrome.md) | 317 |
| [ux-memory-ingest-not-init-good.md](./ux-memory-ingest-not-init-good.md) | 579 |
| [ux-memory-install-already-exists-system-chrome.md](./ux-memory-install-already-exists-system-chrome.md) | 318 |
| [ux-memory-install-no-force-already-exists.md](./ux-memory-install-no-force-already-exists.md) | 319 |
| [ux-memory-install-requires-agent-raw-commander.md](./ux-memory-install-requires-agent-raw-commander.md) | 320 |
| [ux-memory-ls-empty-message-good.md](./ux-memory-ls-empty-message-good.md) | 580 |
| [ux-memory-ls-search-show-raw-unframed.md](./ux-memory-ls-search-show-raw-unframed.md) | 321 |
| [ux-memory-mcp-print-config-command-missing.md](./ux-memory-mcp-print-config-command-missing.md) | 322 |
| [ux-memory-mcp-print-config-raw-json.md](./ux-memory-mcp-print-config-raw-json.md) | 491 |
| [ux-memory-query-no-model-flag.md](./ux-memory-query-no-model-flag.md) | 323 |
| [ux-memory-show-cannot-open-root-index-file.md](./ux-memory-show-cannot-open-root-index-file.md) | 18 |
| [ux-memory-show-index-not-found-after-init.md](./ux-memory-show-index-not-found-after-init.md) | 101 |
| [ux-memory-status-after-write-is-terse.md](./ux-memory-status-after-write-is-terse.md) | 492 |
| [ux-memory-write-bare-stdout-path.md](./ux-memory-write-bare-stdout-path.md) | 493 |
| [ux-memory-write-requires-reason-before-path.md](./ux-memory-write-requires-reason-before-path.md) | 324 |
| [ux-memory-write-requires-reason-raw-commander.md](./ux-memory-write-requires-reason-raw-commander.md) | 325 |
| [ux-memory-write-success-is-raw-unframed.md](./ux-memory-write-success-is-raw-unframed.md) | 326 |
| [ux-model-id-namespace-stripping-surprises.md](./ux-model-id-namespace-stripping-surprises.md) | 327 |
| [ux-models-dumps-full-catalog.md](./ux-models-dumps-full-catalog.md) | 328 |
| [ux-models-empty-search-returns-all.md](./ux-models-empty-search-returns-all.md) | 329 |
| [ux-models-endpoint-invalid-good-list-but-stack.md](./ux-models-endpoint-invalid-good-list-but-stack.md) | 102 |
| [ux-models-endpoint-pricing-combo-works.md](./ux-models-endpoint-pricing-combo-works.md) | 581 |
| [ux-models-exact-id-filter-rejects-namespaced-ids.md](./ux-models-exact-id-filter-rejects-namespaced-ids.md) | 103 |
| [ux-models-feature-bogus-silent-empty.md](./ux-models-feature-bogus-silent-empty.md) | 330 |
| [ux-models-feature-flag-not-repeatable.md](./ux-models-feature-flag-not-repeatable.md) | 331 |
| [ux-models-feature-reasoning-filter-works.md](./ux-models-feature-reasoning-filter-works.md) | 582 |
| [ux-models-feature-web-search-works.md](./ux-models-feature-web-search-works.md) | 583 |
| [ux-models-help-examples-are-excellent.md](./ux-models-help-examples-are-excellent.md) | 584 |
| [ux-models-help-examples-still-best-in-class.md](./ux-models-help-examples-still-best-in-class.md) | 585 |
| [ux-models-input-bogus-silent-empty.md](./ux-models-input-bogus-silent-empty.md) | 332 |
| [ux-models-invalid-endpoint-prints-stack.md](./ux-models-invalid-endpoint-prints-stack.md) | 104 |
| [ux-models-invalid-feature-silent-empty-reconfirmed.md](./ux-models-invalid-feature-silent-empty-reconfirmed.md) | 333 |
| [ux-models-invalid-feature-silent-empty.md](./ux-models-invalid-feature-silent-empty.md) | 334 |
| [ux-models-invalid-input-output-modality-silent-empty.md](./ux-models-invalid-input-output-modality-silent-empty.md) | 105 |
| [ux-models-invalid-modality-silent-empty.md](./ux-models-invalid-modality-silent-empty.md) | 335 |
| [ux-models-invalid-provider-silent-empty.md](./ux-models-invalid-provider-silent-empty.md) | 106 |
| [ux-models-model-flag-rejects-namespaced-ids.md](./ux-models-model-flag-rejects-namespaced-ids.md) | 107 |
| [ux-models-no-limit-flag.md](./ux-models-no-limit-flag.md) | 336 |
| [ux-models-openai-tools-capabilities-good.md](./ux-models-openai-tools-capabilities-good.md) | 586 |
| [ux-models-openai-tools-filter-works.md](./ux-models-openai-tools-filter-works.md) | 587 |
| [ux-models-output-json-search-returns-empty-inconsistently.md](./ux-models-output-json-search-returns-empty-inconsistently.md) | 108 |
| [ux-models-parameters-view-good-for-filtered.md](./ux-models-parameters-view-good-for-filtered.md) | 588 |
| [ux-models-pricing-search-combo-good.md](./ux-models-pricing-search-combo-good.md) | 589 |
| [ux-models-pricing-search-works.md](./ux-models-pricing-search-works.md) | 590 |
| [ux-models-pricing-sonnet-4-6-good.md](./ux-models-pricing-sonnet-4-6-good.md) | 591 |
| [ux-models-provider-case-insensitive-good.md](./ux-models-provider-case-insensitive-good.md) | 592 |
| [ux-models-provider-xai-works.md](./ux-models-provider-xai-works.md) | 593 |
| [ux-models-raw-view-bypasses-design-system-reconfirmed.md](./ux-models-raw-view-bypasses-design-system-reconfirmed.md) | 494 |
| [ux-models-raw-view-bypasses-design-system.md](./ux-models-raw-view-bypasses-design-system.md) | 495 |
| [ux-models-search-claude-slash-zero.md](./ux-models-search-claude-slash-zero.md) | 337 |
| [ux-models-search-confirms-sonnet-5-absent-from-catalog.md](./ux-models-search-confirms-sonnet-5-absent-from-catalog.md) | 109 |
| [ux-models-search-empty-returns-all.md](./ux-models-search-empty-returns-all.md) | 496 |
| [ux-models-since-1d-empty-today.md](./ux-models-since-1d-empty-today.md) | 497 |
| [ux-models-since-invalid-prints-stack.md](./ux-models-since-invalid-prints-stack.md) | 110 |
| [ux-models-since-validation-still-prints-stack.md](./ux-models-since-validation-still-prints-stack.md) | 111 |
| [ux-models-tools-and-feature-filter-semantics-undocumented.md](./ux-models-tools-and-feature-filter-semantics-undocumented.md) | 498 |
| [ux-models-tools-and-feature-tools-redundant-ok.md](./ux-models-tools-and-feature-tools-redundant-ok.md) | 594 |
| [ux-models-view-invalid-raw-commander.md](./ux-models-view-invalid-raw-commander.md) | 499 |
| [ux-models-view-invalid-uses-raw-commander.md](./ux-models-view-invalid-uses-raw-commander.md) | 338 |
| [ux-models-view-parameters-without-filter-floods.md](./ux-models-view-parameters-without-filter-floods.md) | 339 |
| [ux-models-view-raw-bypasses-design-system-reconfirmed.md](./ux-models-view-raw-bypasses-design-system-reconfirmed.md) | 595 |
| [ux-models-view-raw-namespaced-id-returns-empty-array.md](./ux-models-view-raw-namespaced-id-returns-empty-array.md) | 112 |
| [ux-no-doctor-or-health-overview-command.md](./ux-no-doctor-or-health-overview-command.md) | 340 |
| [ux-no-shell-completion-command.md](./ux-no-shell-completion-command.md) | 500 |
| [ux-non-tty-prompt-wrong-guidance.md](./ux-non-tty-prompt-wrong-guidance.md) | 113 |
| [ux-oauth-url-dumps-full-query-string.md](./ux-oauth-url-dumps-full-query-string.md) | 501 |
| [ux-opencode-model-flag-still-triple-namespace.md](./ux-opencode-model-flag-still-triple-namespace.md) | 341 |
| [ux-opencode-model-triple-namespace.md](./ux-opencode-model-triple-namespace.md) | 342 |
| [ux-permission-mode-sets-differ-across-commands.md](./ux-permission-mode-sets-differ-across-commands.md) | 114 |
| [ux-pi-agent-alias-works.md](./ux-pi-agent-alias-works.md) | 596 |
| [ux-pi-spawnable-but-not-configurable.md](./ux-pi-spawnable-but-not-configurable.md) | 115 |
| [ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md](./ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md) | 343 |
| [ux-pipeline-init-yes-requires-source-good.md](./ux-pipeline-init-yes-requires-source-good.md) | 597 |
| [ux-pipeline-install-claims-success-when-all-skipped.md](./ux-pipeline-install-claims-success-when-all-skipped.md) | 344 |
| [ux-pipeline-install-force-skips-skill-overwrites-steps.md](./ux-pipeline-install-force-skips-skill-overwrites-steps.md) | 116 |
| [ux-pipeline-install-force-skips-skill-still.md](./ux-pipeline-install-force-skips-skill-still.md) | 117 |
| [ux-pipeline-max-runs-zero-good-validation.md](./ux-pipeline-max-runs-zero-good-validation.md) | 598 |
| [ux-pipeline-max-runs-zero-validation-good.md](./ux-pipeline-max-runs-zero-validation-good.md) | 599 |
| [ux-pipeline-nothing-to-run-success-framing.md](./ux-pipeline-nothing-to-run-success-framing.md) | 345 |
| [ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md](./ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md) | 118 |
| [ux-pipeline-run-model-override-shown-on-nothing-to-run.md](./ux-pipeline-run-model-override-shown-on-nothing-to-run.md) | 600 |
| [ux-pipeline-tui-flag-ignored-on-init-failure.md](./ux-pipeline-tui-flag-ignored-on-init-failure.md) | 346 |
| [ux-pipeline-validate-enoent-system-error.md](./ux-pipeline-validate-enoent-system-error.md) | 347 |
| [ux-pipeline-validate-no-json-flag.md](./ux-pipeline-validate-no-json-flag.md) | 348 |
| [ux-pipeline-validate-success-still-problems-footer.md](./ux-pipeline-validate-success-still-problems-footer.md) | 502 |
| [ux-pipeline-validate-valid-pipeline-good.md](./ux-pipeline-validate-valid-pipeline-good.md) | 601 |
| [ux-pipeline-validate-wrong-kind-good-message.md](./ux-pipeline-validate-wrong-kind-good-message.md) | 602 |
| [ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md](./ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md) | 349 |
| [ux-pipeline-validate-wrong-kind-system-chrome.md](./ux-pipeline-validate-wrong-kind-system-chrome.md) | 350 |
| [ux-plan-archive-allows-readme.md](./ux-plan-archive-allows-readme.md) | 351 |
| [ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md](./ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md) | 119 |
| [ux-plan-archive-delete-yes-picks-arbitrary-plan.md](./ux-plan-archive-delete-yes-picks-arbitrary-plan.md) | 16 |
| [ux-plan-archive-help-omits-yes-behavior.md](./ux-plan-archive-help-omits-yes-behavior.md) | 120 |
| [ux-plan-archive-json-output-good.md](./ux-plan-archive-json-output-good.md) | 603 |
| [ux-plan-archive-json-skips-without-explaining-why.md](./ux-plan-archive-json-skips-without-explaining-why.md) | 121 |
| [ux-plan-archive-requires-yes-non-tty-good.md](./ux-plan-archive-requires-yes-non-tty-good.md) | 604 |
| [ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md](./ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md) | 122 |
| [ux-plan-browse-non-tty-dumps-first-plan.md](./ux-plan-browse-non-tty-dumps-first-plan.md) | 352 |
| [ux-plan-browse-non-tty-dumps-plan-body.md](./ux-plan-browse-non-tty-dumps-plan-body.md) | 123 |
| [ux-plan-browse-rejects-path-argument.md](./ux-plan-browse-rejects-path-argument.md) | 353 |
| [ux-plan-delete-allows-readme.md](./ux-plan-delete-allows-readme.md) | 124 |
| [ux-plan-delete-help-still-omits-yes.md](./ux-plan-delete-help-still-omits-yes.md) | 125 |
| [ux-plan-delete-json-output-good.md](./ux-plan-delete-json-output-good.md) | 605 |
| [ux-plan-delete-json-skips-without-reason.md](./ux-plan-delete-json-skips-without-reason.md) | 126 |
| [ux-plan-docs-advertise-goal-and-chat-commands-missing.md](./ux-plan-docs-advertise-goal-and-chat-commands-missing.md) | 354 |
| [ux-plan-edit-bare-edited-message.md](./ux-plan-edit-bare-edited-message.md) | 606 |
| [ux-plan-edit-editor-true-claims-edited-without-change.md](./ux-plan-edit-editor-true-claims-edited-without-change.md) | 355 |
| [ux-plan-edit-hangs-without-editor.md](./ux-plan-edit-hangs-without-editor.md) | 127 |
| [ux-plan-install-no-force-flag.md](./ux-plan-install-no-force-flag.md) | 356 |
| [ux-plan-install-success-good.md](./ux-plan-install-success-good.md) | 607 |
| [ux-plan-install-yes-defaults-claude-writes-skill.md](./ux-plan-install-yes-defaults-claude-writes-skill.md) | 357 |
| [ux-plan-kind-invalid-validation-good.md](./ux-plan-kind-invalid-validation-good.md) | 608 |
| [ux-plan-list-empty-kind-table-reconfirmed.md](./ux-plan-list-empty-kind-table-reconfirmed.md) | 358 |
| [ux-plan-list-empty-table-no-message.md](./ux-plan-list-empty-table-no-message.md) | 503 |
| [ux-plan-list-includes-exactly-one-readme.md](./ux-plan-list-includes-exactly-one-readme.md) | 359 |
| [ux-plan-list-includes-noise-files.md](./ux-plan-list-includes-noise-files.md) | 360 |
| [ux-plan-list-includes-readme-reconfirmed.md](./ux-plan-list-includes-readme-reconfirmed.md) | 361 |
| [ux-plan-list-invalid-kind-output-validation-good.md](./ux-plan-list-invalid-kind-output-validation-good.md) | 609 |
| [ux-plan-list-json-empty-is-bare-array.md](./ux-plan-list-json-empty-is-bare-array.md) | 610 |
| [ux-plan-list-json-includes-readme-reconfirmed.md](./ux-plan-list-json-includes-readme-reconfirmed.md) | 362 |
| [ux-plan-list-md-includes-readme-noise.md](./ux-plan-list-md-includes-readme-noise.md) | 363 |
| [ux-plan-list-output-json-unframed.md](./ux-plan-list-output-json-unframed.md) | 504 |
| [ux-plan-list-output-md-is-markdown-table-good.md](./ux-plan-list-output-md-is-markdown-table-good.md) | 611 |
| [ux-plan-list-pipeline-json-good.md](./ux-plan-list-pipeline-json-good.md) | 612 |
| [ux-plan-markdown-read-depth-zero-shows-no-sections.md](./ux-plan-markdown-read-depth-zero-shows-no-sections.md) | 364 |
| [ux-plan-markdown-read-raw-yaml-ish-output.md](./ux-plan-markdown-read-raw-yaml-ish-output.md) | 505 |
| [ux-plan-markdown-read-section-by-number-works.md](./ux-plan-markdown-read-section-by-number-works.md) | 613 |
| [ux-plan-markdown-read-section-wrong-command-hint.md](./ux-plan-markdown-read-section-wrong-command-hint.md) | 365 |
| [ux-plan-markdown-read-section-wrong-hint-reconfirmed.md](./ux-plan-markdown-read-section-wrong-hint-reconfirmed.md) | 366 |
| [ux-plan-markdown-read-system-chrome.md](./ux-plan-markdown-read-system-chrome.md) | 367 |
| [ux-plan-markdown-reader-mcp-help-minimal.md](./ux-plan-markdown-reader-mcp-help-minimal.md) | 506 |
| [ux-plan-non-tty-unclear-failure.md](./ux-plan-non-tty-unclear-failure.md) | 368 |
| [ux-plan-output-invalid-validation-good.md](./ux-plan-output-invalid-validation-good.md) | 614 |
| [ux-plan-path-commands-bare-stdout-reconfirmed.md](./ux-plan-path-commands-bare-stdout-reconfirmed.md) | 615 |
| [ux-plan-path-commands-bare-stdout.md](./ux-plan-path-commands-bare-stdout.md) | 616 |
| [ux-plan-question-non-tty-may-hang.md](./ux-plan-question-non-tty-may-hang.md) | 128 |
| [ux-plan-question-starts-session-without-mode.md](./ux-plan-question-starts-session-without-mode.md) | 369 |
| [ux-plan-root-non-tty-dumps-arbitrary-body.md](./ux-plan-root-non-tty-dumps-arbitrary-body.md) | 129 |
| [ux-plan-view-json-dumps-full-content.md](./ux-plan-view-json-dumps-full-content.md) | 370 |
| [ux-plan-view-json-dumps-full-markdown-content.md](./ux-plan-view-json-dumps-full-markdown-content.md) | 507 |
| [ux-plan-view-non-tty-requires-path-good.md](./ux-plan-view-non-tty-requires-path-good.md) | 617 |
| [ux-plan-view-pipeline-md-output-good.md](./ux-plan-view-pipeline-md-output-good.md) | 618 |
| [ux-plan-view-vs-markdown-read-not-found-inconsistent.md](./ux-plan-view-vs-markdown-read-not-found-inconsistent.md) | 371 |
| [ux-poe-no-prompt-works-for-configure-dry-run.md](./ux-poe-no-prompt-works-for-configure-dry-run.md) | 619 |
| [ux-postinstall-sync-skills-can-run-on-user-install.md](./ux-postinstall-sync-skills-can-run-on-user-install.md) | 209 |
| [ux-primary-commands-lack-examples-in-help.md](./ux-primary-commands-lack-examples-in-help.md) | 372 |
| [ux-primary-commands-still-lack-examples.md](./ux-primary-commands-still-lack-examples.md) | 373 |
| [ux-problems-footer-on-every-success.md](./ux-problems-footer-on-every-success.md) | 508 |
| [ux-provider-list-agents-column-incomplete.md](./ux-provider-list-agents-column-incomplete.md) | 374 |
| [ux-provider-list-agents-column-truncates.md](./ux-provider-list-agents-column-truncates.md) | 375 |
| [ux-provider-list-no-json-flag.md](./ux-provider-list-no-json-flag.md) | 376 |
| [ux-provider-login-anthropic-dry-run-clean.md](./ux-provider-login-anthropic-dry-run-clean.md) | 620 |
| [ux-provider-login-anthropic-dry-run-good.md](./ux-provider-login-anthropic-dry-run-good.md) | 621 |
| [ux-provider-login-cloudflare-requires-base-url-good.md](./ux-provider-login-cloudflare-requires-base-url-good.md) | 622 |
| [ux-provider-login-missing-key-system-chrome.md](./ux-provider-login-missing-key-system-chrome.md) | 377 |
| [ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md](./ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md) | 130 |
| [ux-provider-login-unknown-has-list-hint-and-see-logs.md](./ux-provider-login-unknown-has-list-hint-and-see-logs.md) | 509 |
| [ux-provider-logout-anthropic-dry-run-good.md](./ux-provider-logout-anthropic-dry-run-good.md) | 623 |
| [ux-provider-logout-dry-run-unconfigures-agents.md](./ux-provider-logout-dry-run-unconfigures-agents.md) | 131 |
| [ux-provider-logout-openai-dry-run-clean.md](./ux-provider-logout-openai-dry-run-clean.md) | 624 |
| [ux-provider-logout-poe-dry-run-still-agent-diffs.md](./ux-provider-logout-poe-dry-run-still-agent-diffs.md) | 132 |
| [ux-provider-logout-poe-dry-run-unconfigures-agents.md](./ux-provider-logout-poe-dry-run-unconfigures-agents.md) | 133 |
| [ux-ralph-experiment-wrong-kind-says-not-found.md](./ux-ralph-experiment-wrong-kind-says-not-found.md) | 378 |
| [ux-ralph-init-plan-says-not-found.md](./ux-ralph-init-plan-says-not-found.md) | 134 |
| [ux-ralph-init-requires-existing-ralph-doc-circular.md](./ux-ralph-init-requires-existing-ralph-doc-circular.md) | 135 |
| [ux-ralph-run-plan-kind-says-ralph-doc-not-found.md](./ux-ralph-run-plan-kind-says-ralph-doc-not-found.md) | 136 |
| [ux-ralph-run-plan-says-not-found-reconfirmed.md](./ux-ralph-run-plan-says-not-found-reconfirmed.md) | 137 |
| [ux-raw-commander-invalid-option-choices.md](./ux-raw-commander-invalid-option-choices.md) | 379 |
| [ux-raw-commander-missing-args.md](./ux-raw-commander-missing-args.md) | 380 |
| [ux-readme-features-wrap-but-cli-missing.md](./ux-readme-features-wrap-but-cli-missing.md) | 381 |
| [ux-readme-spawn-omits-mode-for-ci.md](./ux-readme-spawn-omits-mode-for-ci.md) | 138 |
| [ux-reasoning-effort-bogus-silently-ignored.md](./ux-reasoning-effort-bogus-silently-ignored.md) | 139 |
| [ux-reasoning-effort-flag-opaque.md](./ux-reasoning-effort-flag-opaque.md) | 382 |
| [ux-reasoning-effort-flag-silently-ignored-for-some-agents.md](./ux-reasoning-effort-flag-silently-ignored-for-some-agents.md) | 140 |
| [ux-reasoning-effort-high-still-writes-xhigh.md](./ux-reasoning-effort-high-still-writes-xhigh.md) | 141 |
| [ux-resume-thread-errors-are-agent-raw.md](./ux-resume-thread-errors-are-agent-raw.md) | 383 |
| [ux-resume-thread-invalid-id-agent-raw-error.md](./ux-resume-thread-invalid-id-agent-raw-error.md) | 142 |
| [ux-root-help-footer-npm-run-dev-for-options.md](./ux-root-help-footer-npm-run-dev-for-options.md) | 143 |
| [ux-root-help-footer-npm-run-dev-reconfirmed.md](./ux-root-help-footer-npm-run-dev-reconfirmed.md) | 144 |
| [ux-root-help-footer-still-npm-run-dev.md](./ux-root-help-footer-still-npm-run-dev.md) | 145 |
| [ux-root-help-lists-19-commands-hides-more.md](./ux-root-help-lists-19-commands-hides-more.md) | 146 |
| [ux-root-help-still-hides-skill-memory.md](./ux-root-help-still-hides-skill-memory.md) | 147 |
| [ux-root-help-usage-line-is-npm-run-dev.md](./ux-root-help-usage-line-is-npm-run-dev.md) | 148 |
| [ux-root-help-usage-still-npm-run-dev-reconfirmed.md](./ux-root-help-usage-still-npm-run-dev-reconfirmed.md) | 149 |
| [ux-root-tagline-inconsistent.md](./ux-root-tagline-inconsistent.md) | 625 |
| [ux-root-typo-still-no-suggestions-reconfirmed.md](./ux-root-typo-still-no-suggestions-reconfirmed.md) | 150 |
| [ux-root-typos-no-did-you-mean-configure-spawn.md](./ux-root-typos-no-did-you-mean-configure-spawn.md) | 151 |
| [ux-runner-sync-and-runtime-invalid-raw-commander.md](./ux-runner-sync-and-runtime-invalid-raw-commander.md) | 384 |
| [ux-runner-sync-without-detach-silently-ignored.md](./ux-runner-sync-without-detach-silently-ignored.md) | 152 |
| [ux-runner-sync-without-runtime-silently-accepted.md](./ux-runner-sync-without-runtime-silently-accepted.md) | 385 |
| [ux-runtime-build-host-message-good.md](./ux-runtime-build-host-message-good.md) | 626 |
| [ux-runtime-init-docker-dry-run-clean.md](./ux-runtime-init-docker-dry-run-clean.md) | 627 |
| [ux-runtime-init-dry-run-clean.md](./ux-runtime-init-dry-run-clean.md) | 628 |
| [ux-runtime-init-non-tty-poe-no-prompt.md](./ux-runtime-init-non-tty-poe-no-prompt.md) | 153 |
| [ux-runtime-job-missing-see-logs.md](./ux-runtime-job-missing-see-logs.md) | 386 |
| [ux-runtime-jobs-list-unbounded-opaque-statuses.md](./ux-runtime-jobs-list-unbounded-opaque-statuses.md) | 387 |
| [ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md](./ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md) | 154 |
| [ux-runtime-jobs-ls-help-no-limit-reconfirmed.md](./ux-runtime-jobs-ls-help-no-limit-reconfirmed.md) | 388 |
| [ux-runtime-jobs-ls-unbounded-stale-from-may.md](./ux-runtime-jobs-ls-unbounded-stale-from-may.md) | 155 |
| [ux-runtime-jobs-show-unknown-suggests-stop.md](./ux-runtime-jobs-show-unknown-suggests-stop.md) | 389 |
| [ux-runtime-jobs-stale-running-zombies.md](./ux-runtime-jobs-stale-running-zombies.md) | 210 |
| [ux-runtime-jobs-stop-lists-many-stale-running.md](./ux-runtime-jobs-stop-lists-many-stale-running.md) | 156 |
| [ux-runtime-missing-deps-good-message-system-chrome.md](./ux-runtime-missing-deps-good-message-system-chrome.md) | 390 |
| [ux-runtime-templates-clear-no-yes-or-dry-run.md](./ux-runtime-templates-clear-no-yes-or-dry-run.md) | 157 |
| [ux-runtime-templates-clear-poe-no-prompt-not-yes.md](./ux-runtime-templates-clear-poe-no-prompt-not-yes.md) | 158 |
| [ux-runtime-templates-ls-shows-empty-docker-row.md](./ux-runtime-templates-ls-shows-empty-docker-row.md) | 510 |
| [ux-runtime-templates-ls-unbounded-noise.md](./ux-runtime-templates-ls-unbounded-noise.md) | 511 |
| [ux-runtime-templates-ls-unbounded-stale.md](./ux-runtime-templates-ls-unbounded-stale.md) | 159 |
| [ux-sdk-cli-mode-default-mismatch.md](./ux-sdk-cli-mode-default-mismatch.md) | 160 |
| [ux-sdk-getpoeapikey-throws-generic-error.md](./ux-sdk-getpoeapikey-throws-generic-error.md) | 391 |
| [ux-shape-base-url-error-good-message-system-prefix.md](./ux-shape-base-url-error-good-message-system-prefix.md) | 512 |
| [ux-shape-base-url-invalid-validation-good.md](./ux-shape-base-url-invalid-validation-good.md) | 629 |
| [ux-shape-base-url-unknown-shape-lists-exposed-good.md](./ux-shape-base-url-unknown-shape-lists-exposed-good.md) | 630 |
| [ux-skill-and-skills-flags-undocumented-relationship.md](./ux-skill-and-skills-flags-undocumented-relationship.md) | 513 |
| [ux-skill-bridge-failure-lists-paths-good.md](./ux-skill-bridge-failure-lists-paths-good.md) | 631 |
| [ux-skill-bridge-failure-system-chrome.md](./ux-skill-bridge-failure-system-chrome.md) | 392 |
| [ux-skill-configure-exists-system-chrome.md](./ux-skill-configure-exists-system-chrome.md) | 161 |
| [ux-skill-configure-goose-local-success.md](./ux-skill-configure-goose-local-success.md) | 632 |
| [ux-skill-configure-goose-writes-dot-agents-skills.md](./ux-skill-configure-goose-writes-dot-agents-skills.md) | 514 |
| [ux-skill-configure-kimi-unsupported-abrupt.md](./ux-skill-configure-kimi-unsupported-abrupt.md) | 393 |
| [ux-skill-configure-pi-poe-agent-not-supported-clear.md](./ux-skill-configure-pi-poe-agent-not-supported-clear.md) | 633 |
| [ux-skill-configure-yes-defaults-agent-silently.md](./ux-skill-configure-yes-defaults-agent-silently.md) | 394 |
| [ux-skill-configure-yes-defaults-to-claude-already-exists.md](./ux-skill-configure-yes-defaults-to-claude-already-exists.md) | 395 |
| [ux-skill-empty-string-malformed-reference.md](./ux-skill-empty-string-malformed-reference.md) | 515 |
| [ux-skill-help-hides-from-root-reconfirmed.md](./ux-skill-help-hides-from-root-reconfirmed.md) | 162 |
| [ux-skill-install-file-required-before-name.md](./ux-skill-install-file-required-before-name.md) | 396 |
| [ux-skill-install-from-file-works-well.md](./ux-skill-install-from-file-works-well.md) | 634 |
| [ux-skill-install-missing-file-enoent.md](./ux-skill-install-missing-file-enoent.md) | 397 |
| [ux-skill-install-name-and-file-both-required.md](./ux-skill-install-name-and-file-both-required.md) | 398 |
| [ux-skill-memory-absent-from-root-help.md](./ux-skill-memory-absent-from-root-help.md) | 163 |
| [ux-skill-naming-collisions.md](./ux-skill-naming-collisions.md) | 399 |
| [ux-skill-no-list-or-bridge-subcommands.md](./ux-skill-no-list-or-bridge-subcommands.md) | 164 |
| [ux-skill-parent-no-next-step-guidance.md](./ux-skill-parent-no-next-step-guidance.md) | 400 |
| [ux-skill-unconfigure-defaults-agent-and-soft-blocks.md](./ux-skill-unconfigure-defaults-agent-and-soft-blocks.md) | 401 |
| [ux-skill-unconfigure-dry-run-path-inconsistent.md](./ux-skill-unconfigure-dry-run-path-inconsistent.md) | 165 |
| [ux-skill-unconfigure-refuses-nonempty-without-force-good.md](./ux-skill-unconfigure-refuses-nonempty-without-force-good.md) | 635 |
| [ux-skills-empty-string-silently-ignored.md](./ux-skills-empty-string-silently-ignored.md) | 402 |
| [ux-skills-flag-without-value-is-noop-or-unclear.md](./ux-skills-flag-without-value-is-noop-or-unclear.md) | 403 |
| [ux-skip-if-configured-dry-run-shows-dead-sonnet-5-default.md](./ux-skip-if-configured-dry-run-shows-dead-sonnet-5-default.md) | 13 |
| [ux-skip-if-configured-dry-run-still-plans-full-rewrite.md](./ux-skip-if-configured-dry-run-still-plans-full-rewrite.md) | 166 |
| [ux-skip-if-configured-help-text-lies.md](./ux-skip-if-configured-help-text-lies.md) | 12 |
| [ux-skip-if-configured-shows-stale-default-model.md](./ux-skip-if-configured-shows-stale-default-model.md) | 167 |
| [ux-skip-if-configured-still-noises-dry-run.md](./ux-skip-if-configured-still-noises-dry-run.md) | 516 |
| [ux-skip-if-configured-still-writes-when-model-differs.md](./ux-skip-if-configured-still-writes-when-model-differs.md) | 404 |
| [ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md](./ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md) | 11 |
| [ux-sonnet-4-6-output-effort-has-no-xhigh.md](./ux-sonnet-4-6-output-effort-has-no-xhigh.md) | 168 |
| [ux-sonnet-5-still-absent-from-catalog.md](./ux-sonnet-5-still-absent-from-catalog.md) | 169 |
| [ux-spawn-advanced-flags-undifferentiated.md](./ux-spawn-advanced-flags-undifferentiated.md) | 405 |
| [ux-spawn-at-file-missing-validation-good.md](./ux-spawn-at-file-missing-validation-good.md) | 636 |
| [ux-spawn-at-file-works.md](./ux-spawn-at-file-works.md) | 637 |
| [ux-spawn-codex-reads-stdin-message-on-tty-less-success.md](./ux-spawn-codex-reads-stdin-message-on-tty-less-success.md) | 406 |
| [ux-spawn-codex-works-with-frontier-model.md](./ux-spawn-codex-works-with-frontier-model.md) | 638 |
| [ux-spawn-cursor-with-model-works.md](./ux-spawn-cursor-with-model-works.md) | 639 |
| [ux-spawn-cwd-file-not-directory-see-logs.md](./ux-spawn-cwd-file-not-directory-see-logs.md) | 407 |
| [ux-spawn-cwd-missing-see-logs.md](./ux-spawn-cwd-missing-see-logs.md) | 408 |
| [ux-spawn-cwd-missing-system-chrome.md](./ux-spawn-cwd-missing-system-chrome.md) | 409 |
| [ux-spawn-cwd-tmp-works.md](./ux-spawn-cwd-tmp-works.md) | 640 |
| [ux-spawn-detach-ignored-on-failure-path.md](./ux-spawn-detach-ignored-on-failure-path.md) | 410 |
| [ux-spawn-detach-silently-ignored-without-runtime.md](./ux-spawn-detach-silently-ignored-without-runtime.md) | 170 |
| [ux-spawn-gemini-provider-credential-opaque-error.md](./ux-spawn-gemini-provider-credential-opaque-error.md) | 171 |
| [ux-spawn-help-still-no-examples.md](./ux-spawn-help-still-no-examples.md) | 172 |
| [ux-spawn-interactive-bypasses-design-system-panel.md](./ux-spawn-interactive-bypasses-design-system-panel.md) | 411 |
| [ux-spawn-interactive-non-tty-still-runs.md](./ux-spawn-interactive-non-tty-still-runs.md) | 412 |
| [ux-spawn-interactive-raw-agent-error.md](./ux-spawn-interactive-raw-agent-error.md) | 173 |
| [ux-spawn-interactive-still-uses-stale-model-bare-error.md](./ux-spawn-interactive-still-uses-stale-model-bare-error.md) | 174 |
| [ux-spawn-invalid-mode-validation-good.md](./ux-spawn-invalid-mode-validation-good.md) | 641 |
| [ux-spawn-invalid-model-shows-success-then-failure.md](./ux-spawn-invalid-model-shows-success-then-failure.md) | 175 |
| [ux-spawn-kimi-not-configured-yes-message.md](./ux-spawn-kimi-not-configured-yes-message.md) | 176 |
| [ux-spawn-log-default-redacts-agent-message-good.md](./ux-spawn-log-default-redacts-agent-message-good.md) | 642 |
| [ux-spawn-mode-and-permission-copy.md](./ux-spawn-mode-and-permission-copy.md) | 177 |
| [ux-spawn-mode-case-sensitive.md](./ux-spawn-mode-case-sensitive.md) | 517 |
| [ux-spawn-no-prompt-system-chrome.md](./ux-spawn-no-prompt-system-chrome.md) | 413 |
| [ux-spawn-pi-yes-works.md](./ux-spawn-pi-yes-works.md) | 643 |
| [ux-spawn-poe-agent-crashes-fs-lstat.md](./ux-spawn-poe-agent-crashes-fs-lstat.md) | 15 |
| [ux-spawn-poe-agent-lstat-reconfirmed.md](./ux-spawn-poe-agent-lstat-reconfirmed.md) | 178 |
| [ux-spawn-runtime-docker-error-good-install-hints.md](./ux-spawn-runtime-docker-error-good-install-hints.md) | 644 |
| [ux-spawn-runtime-host-works.md](./ux-spawn-runtime-host-works.md) | 645 |
| [ux-spawn-stdin-empty-see-logs.md](./ux-spawn-stdin-empty-see-logs.md) | 414 |
| [ux-spawn-stdin-pipe-works.md](./ux-spawn-stdin-pipe-works.md) | 646 |
| [ux-spawn-success-still-problems-footer.md](./ux-spawn-success-still-problems-footer.md) | 518 |
| [ux-spawn-test-goose-works.md](./ux-spawn-test-goose-works.md) | 647 |
| [ux-spawn-test-sonnet-4-6-works.md](./ux-spawn-test-sonnet-4-6-works.md) | 648 |
| [ux-spawn-validates-mode-before-agent-reconfirmed.md](./ux-spawn-validates-mode-before-agent-reconfirmed.md) | 415 |
| [ux-spawn-validates-mode-before-agent.md](./ux-spawn-validates-mode-before-agent.md) | 416 |
| [ux-spawn-worktree-flag-missing-on-spawn.md](./ux-spawn-worktree-flag-missing-on-spawn.md) | 179 |
| [ux-spawn-yes-defaults-to-yolo-mode.md](./ux-spawn-yes-defaults-to-yolo-mode.md) | 180 |
| [ux-spawn-yes-with-explicit-mode-read-works.md](./ux-spawn-yes-with-explicit-mode-read-works.md) | 649 |
| [ux-stale-configured-model-fails-late.md](./ux-stale-configured-model-fails-late.md) | 181 |
| [ux-success-and-info-share-magenta-glyphs.md](./ux-success-and-info-share-magenta-glyphs.md) | 519 |
| [ux-successful-spawn-still-uses-checkmark-for-agent-text.md](./ux-successful-spawn-still-uses-checkmark-for-agent-text.md) | 417 |
| [ux-superintendent-builder-inspector-npm-run-dev.md](./ux-superintendent-builder-inspector-npm-run-dev.md) | 418 |
| [ux-superintendent-builder-inspector-toolcraft-help.md](./ux-superintendent-builder-inspector-toolcraft-help.md) | 182 |
| [ux-superintendent-complete-wrong-kind-debug-tease.md](./ux-superintendent-complete-wrong-kind-debug-tease.md) | 419 |
| [ux-superintendent-help-npm-run-dev-reconfirmed.md](./ux-superintendent-help-npm-run-dev-reconfirmed.md) | 183 |
| [ux-superintendent-install-already-exists-debug-tease.md](./ux-superintendent-install-already-exists-debug-tease.md) | 184 |
| [ux-superintendent-install-scope-vs-local-global.md](./ux-superintendent-install-scope-vs-local-global.md) | 185 |
| [ux-superintendent-missing-path-double-error.md](./ux-superintendent-missing-path-double-error.md) | 186 |
| [ux-superintendent-validate-unclosed-tag-opaque.md](./ux-superintendent-validate-unclosed-tag-opaque.md) | 420 |
| [ux-superintendent-validate-unclosed-tag.md](./ux-superintendent-validate-unclosed-tag.md) | 187 |
| [ux-tables-ignore-terminal-width.md](./ux-tables-ignore-terminal-width.md) | 421 |
| [ux-tasks-get-github-401-raw-json.md](./ux-tasks-get-github-401-raw-json.md) | 188 |
| [ux-tasks-github-401-raw-json-reconfirmed.md](./ux-tasks-github-401-raw-json-reconfirmed.md) | 189 |
| [ux-tasks-github-auth-raw-error.md](./ux-tasks-github-auth-raw-error.md) | 422 |
| [ux-tasks-import-delete-source-dangerous.md](./ux-tasks-import-delete-source-dangerous.md) | 190 |
| [ux-tasks-import-dry-run-still-requires-to.md](./ux-tasks-import-dry-run-still-requires-to.md) | 423 |
| [ux-tasks-move-delete-source-dangerous.md](./ux-tasks-move-delete-source-dangerous.md) | 191 |
| [ux-tasks-verify-bad-list-format-good.md](./ux-tasks-verify-bad-list-format-good.md) | 650 |
| [ux-tasks-verify-format-error-good.md](./ux-tasks-verify-format-error-good.md) | 651 |
| [ux-test-and-install-reject-spawn-only-agents-as-unknown.md](./ux-test-and-install-reject-spawn-only-agents-as-unknown.md) | 192 |
| [ux-test-codex-with-valid-model-succeeds.md](./ux-test-codex-with-valid-model-succeeds.md) | 652 |
| [ux-test-failure-dumps-jsonl.md](./ux-test-failure-dumps-jsonl.md) | 193 |
| [ux-test-goose-with-valid-model-succeeds.md](./ux-test-goose-with-valid-model-succeeds.md) | 653 |
| [ux-test-kimi-invalid-config-provider-poe-not-found.md](./ux-test-kimi-invalid-config-provider-poe-not-found.md) | 194 |
| [ux-test-opencode-model-mapping-still-broken.md](./ux-test-opencode-model-mapping-still-broken.md) | 195 |
| [ux-test-opencode-model-not-found-dumps-stack.md](./ux-test-opencode-model-not-found-dumps-stack.md) | 196 |
| [ux-test-with-valid-model-succeeds.md](./ux-test-with-valid-model-succeeds.md) | 654 |
| [ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md](./ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md) | 197 |
| [ux-timeout-errors-use-system-chrome.md](./ux-timeout-errors-use-system-chrome.md) | 424 |
| [ux-toolcraft-has-suggestions-poe-code-root-does-not.md](./ux-toolcraft-has-suggestions-poe-code-root-does-not.md) | 425 |
| [ux-toolcraft-heading-doubles-poe-code.md](./ux-toolcraft-heading-doubles-poe-code.md) | 426 |
| [ux-toolcraft-help-points-at-npm-run-dev.md](./ux-toolcraft-help-points-at-npm-run-dev.md) | 198 |
| [ux-toolcraft-suggests-options-but-still-npm-run-dev.md](./ux-toolcraft-suggests-options-but-still-npm-run-dev.md) | 199 |
| [ux-traces-cwd-only-flag-removed-or-renamed.md](./ux-traces-cwd-only-flag-removed-or-renamed.md) | 520 |
| [ux-traces-directory-path-eisdir-reconfirmed.md](./ux-traces-directory-path-eisdir-reconfirmed.md) | 427 |
| [ux-traces-directory-path-eisdir.md](./ux-traces-directory-path-eisdir.md) | 428 |
| [ux-traces-enoent-eisdir-still-system-errors.md](./ux-traces-enoent-eisdir-still-system-errors.md) | 200 |
| [ux-traces-invalid-source-validation-good.md](./ux-traces-invalid-source-validation-good.md) | 655 |
| [ux-traces-json-includes-full-prompt-titles.md](./ux-traces-json-includes-full-prompt-titles.md) | 211 |
| [ux-traces-missing-file-enoent-system-chrome.md](./ux-traces-missing-file-enoent-system-chrome.md) | 429 |
| [ux-traces-missing-file-system-error.md](./ux-traces-missing-file-system-error.md) | 430 |
| [ux-traces-poe-code-source-titles-are-agent-names.md](./ux-traces-poe-code-source-titles-are-agent-names.md) | 431 |
| [ux-traces-since-limit-works.md](./ux-traces-since-limit-works.md) | 656 |
| [ux-traces-since-validation-cleaner-than-models.md](./ux-traces-since-validation-cleaner-than-models.md) | 201 |
| [ux-traces-source-invalid-validation-good.md](./ux-traces-source-invalid-validation-good.md) | 657 |
| [ux-unconfigure-claude-dry-run-full-settings-dump.md](./ux-unconfigure-claude-dry-run-full-settings-dump.md) | 202 |
| [ux-unconfigure-goose-dry-run-full-config-dump.md](./ux-unconfigure-goose-dry-run-full-config-dump.md) | 432 |
| [ux-unconfigure-goose-dry-run-still-prints-secrets.md](./ux-unconfigure-goose-dry-run-still-prints-secrets.md) | 203 |
| [ux-unconfigure-help-missing-dry-run-and-yes.md](./ux-unconfigure-help-missing-dry-run-and-yes.md) | 433 |
| [ux-unconfigure-help-no-dry-run-or-yes.md](./ux-unconfigure-help-no-dry-run-or-yes.md) | 434 |
| [ux-unconfigure-missing-agent-raw-commander.md](./ux-unconfigure-missing-agent-raw-commander.md) | 435 |
| [ux-unconfigure-no-confirmation.md](./ux-unconfigure-no-confirmation.md) | 436 |
| [ux-unconfigure-nonconfigured-agent-still-plans-mutations.md](./ux-unconfigure-nonconfigured-agent-still-plans-mutations.md) | 437 |
| [ux-unconfigure-rejects-spawn-only-agents.md](./ux-unconfigure-rejects-spawn-only-agents.md) | 438 |
| [ux-unknown-agent-no-allow-list-or-suggestions.md](./ux-unknown-agent-no-allow-list-or-suggestions.md) | 204 |
| [ux-update-always-suggests-npm-install-g.md](./ux-update-always-suggests-npm-install-g.md) | 439 |
| [ux-update-dry-run-always-global-npm.md](./ux-update-dry-run-always-global-npm.md) | 658 |
| [ux-update-help-omits-dry-run.md](./ux-update-help-omits-dry-run.md) | 521 |
| [ux-update-package-manager-override-works.md](./ux-update-package-manager-override-works.md) | 659 |
| [ux-update-pnpm-package-manager-works.md](./ux-update-pnpm-package-manager-works.md) | 660 |
| [ux-usage-balance-default-good.md](./ux-usage-balance-default-good.md) | 661 |
| [ux-usage-balance-presentation-good.md](./ux-usage-balance-presentation-good.md) | 662 |
| [ux-usage-help-hides-default-balance.md](./ux-usage-help-hides-default-balance.md) | 522 |
| [ux-usage-list-empty-filter-returns-all.md](./ux-usage-list-empty-filter-returns-all.md) | 523 |
| [ux-usage-list-filter-works-well.md](./ux-usage-list-filter-works-well.md) | 663 |
| [ux-usage-list-no-json-flag.md](./ux-usage-list-no-json-flag.md) | 440 |
| [ux-usage-list-no-match-message-good.md](./ux-usage-list-no-match-message-good.md) | 664 |
| [ux-usage-pages-1-still-shows-20-entries.md](./ux-usage-pages-1-still-shows-20-entries.md) | 441 |
| [ux-usage-pages-invalid-raw-commander.md](./ux-usage-pages-invalid-raw-commander.md) | 442 |
| [ux-user-errors-look-like-system-failures.md](./ux-user-errors-look-like-system-failures.md) | 205 |
| [ux-utils-config-edit-missing-editor-system-chrome.md](./ux-utils-config-edit-missing-editor-system-chrome.md) | 443 |
| [ux-utils-config-init-already-exists-is-info.md](./ux-utils-config-init-already-exists-is-info.md) | 665 |
| [ux-utils-config-no-path-subcommand.md](./ux-utils-config-no-path-subcommand.md) | 524 |
| [ux-utils-config-path-subcommand-missing.md](./ux-utils-config-path-subcommand-missing.md) | 444 |
| [ux-utils-config-show-dumps-large-json.md](./ux-utils-config-show-dumps-large-json.md) | 445 |
| [ux-utils-symlink-agents-already-linked-good.md](./ux-utils-symlink-agents-already-linked-good.md) | 666 |
| [ux-utils-symlink-skills-both-exist-good-guidance.md](./ux-utils-symlink-skills-both-exist-good-guidance.md) | 667 |
| [ux-utils-symlink-skills-scope-error-vs-agents.md](./ux-utils-symlink-skills-scope-error-vs-agents.md) | 525 |
| [ux-utils-symlink-skills-yes-local-dry-run-works.md](./ux-utils-symlink-skills-yes-local-dry-run-works.md) | 668 |
| [ux-validation-error-still-prints-stack.md](./ux-validation-error-still-prints-stack.md) | 206 |
| [ux-verbose-prefixes-every-log-line.md](./ux-verbose-prefixes-every-log-line.md) | 526 |
| [ux-version-nags-dev-to-major-jump.md](./ux-version-nags-dev-to-major-jump.md) | 446 |
| [ux-version-still-nags-dev-to-4.0.0.md](./ux-version-still-nags-dev-to-4.0.0.md) | 447 |
| [ux-version-subcommand-missing-use-flag.md](./ux-version-subcommand-missing-use-flag.md) | 448 |
| [ux-version-update-nag-on-dev-builds.md](./ux-version-update-nag-on-dev-builds.md) | 527 |
| [ux-wide-tables-truncate-critical-cells.md](./ux-wide-tables-truncate-critical-cells.md) | 449 |
| [ux-worktree-reconcile-not-found-system-chrome.md](./ux-worktree-reconcile-not-found-system-chrome.md) | 450 |
| [ux-worktree-reconcile-requires-agent-not-in-error-order.md](./ux-worktree-reconcile-requires-agent-not-in-error-order.md) | 528 |
| [ux-worktree-reconcile-requires-agent-raw.md](./ux-worktree-reconcile-requires-agent-raw.md) | 451 |
| [ux-worktree-remove-help-no-yes.md](./ux-worktree-remove-help-no-yes.md) | 452 |
| [ux-worktree-remove-help-omits-yes.md](./ux-worktree-remove-help-omits-yes.md) | 453 |
| [ux-worktree-remove-no-confirmation.md](./ux-worktree-remove-no-confirmation.md) | 454 |
| [ux-worktree-remove-not-found-system-chrome.md](./ux-worktree-remove-not-found-system-chrome.md) | 455 |
| [ux-wrap-command-still-missing.md](./ux-wrap-command-still-missing.md) | 456 |
| [ux-wrap-dry-run-forwards-flag.md](./ux-wrap-dry-run-forwards-flag.md) | 457 |
| [ux-wrap-resolves-alias-but-dry-run-lies.md](./ux-wrap-resolves-alias-but-dry-run-lies.md) | 458 |

See [AUDIT_STATUS.md](./AUDIT_STATUS.md).
