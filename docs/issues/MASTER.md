# UX issues — master priority list

**1 = fix first.** Count: **907**. Continuous audit 2026-07-07/08.

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
| 14 | open | **Critical** | Configure / models | [ux-configure-claude-ignores-reasoning-effort-always-xhigh.md](./ux-configure-claude-ignores-reasoning-effort-always-xhigh.md) | configure claude ignores --reasoning-effort and always plans effortLevel xhigh |
| 15 | open | **Critical** | Configure / models | [ux-configure-reasoning-effort-still-ignored-always-high.md](./ux-configure-reasoning-effort-still-ignored-always-high.md) | configure --reasoning-effort still ignored; always plans effortLevel high |
| 16 | open | **Critical** | Spawn / safety | [ux-spawn-yes-defaults-mode-to-yolo.md](./ux-spawn-yes-defaults-mode-to-yolo.md) | spawn --yes defaults --mode to yolo (CI full permissions) |
| 17 | open | **Critical** | Skills / destructive | [ux-skill-unconfigure-force-deletes-entire-skills-dir.md](./ux-skill-unconfigure-force-deletes-entire-skills-dir.md) | skill unconfigure --force deletes entire .claude/skills tree |
| 18 | open | **Critical** | Gaslight / models | [ux-gaslight-empty-model-falls-back-to-dead-sonnet-5.md](./ux-gaslight-empty-model-falls-back-to-dead-sonnet-5.md) | gaslight --model "" falls back to dead claude-sonnet-5 with success glyphs |
| 19 | open | **Critical** | Gaslight / destructive | [ux-gaslight-mode-read-still-mutated-plans-dir.md](./ux-gaslight-mode-read-still-mutated-plans-dir.md) | gaslight --mode read --no-archive still mutated plans/ (archived another plan) |
| 20 | open | **Critical** | Spawn / poe-agent | [ux-spawn-poe-agent-crashes-fs-lstat.md](./ux-spawn-poe-agent-crashes-fs-lstat.md) | Advertised `spawn poe-agent` crashes: `fs.lstat is not a function` |
| 21 | open | **Critical** | Plan / destructive | [ux-plan-archive-delete-yes-picks-arbitrary-plan.md](./ux-plan-archive-delete-yes-picks-arbitrary-plan.md) | `plan archive|delete --yes` without path mutates an arbitrary plan |
| 22 | open | **Critical** | Auth / destructive | [ux-logout-overclaims-scope.md](./ux-logout-overclaims-scope.md) | `logout` copy says credentials but factory-resets agents + config |
| 23 | open | **Critical** | Memory | [ux-memory-show-cannot-open-root-index-file.md](./ux-memory-show-cannot-open-root-index-file.md) | memory init creates INDEX.md but show/ls cannot open it |
| 24 | open | **Critical** | Help / discoverability | [ux-root-help-hides-skill-memory-runtime-eval-and-more.md](./ux-root-help-hides-skill-memory-runtime-eval-and-more.md) | root --help hides skill, memory, runtime, eval, provider, and many more working commands |
| 25 | open | **Critical** | Auth / logout / safety / destructive | [ux-auth-logout-no-confirmation-removes-all-agents.md](./ux-auth-logout-no-confirmation-removes-all-agents.md) | `poe-code auth logout` executes immediately without any prompt, confirmation, or `--yes` flag. It removes c… |
| 26 | open | **Critical** | Eval / help / usage line / formatting | [ux-eval-help-npm-run-dev-and-inline-flags.md](./ux-eval-help-npm-run-dev-and-inline-flags.md) | `eval --help` suffers the same systemic formatting problems as `superintendent --help`: |
| 27 | open | **Critical** | Superintendent / help / usage line | [ux-superintendent-usage-shows-npm-run-dev.md](./ux-superintendent-usage-shows-npm-run-dev.md) | `superintendent --help` and `superintendent run --help` both render the Usage line as `npm run dev -- super… |
| 28 | open | **Critical** | CLI / error-handling / recovery message | [ux-unknown-command-error-suggests-npm-run-dev.md](./ux-unknown-command-error-suggests-npm-run-dev.md) | When any unrecognised command is passed to `poe-code`, the error panel's recovery line reads: |
| 29 | open | **High** | Help / capability matrix | [ux-agent-capability-matrix-spawn-vs-configure-vs-install.md](./ux-agent-capability-matrix-spawn-vs-configure-vs-install.md) | spawn accepts pi, pi-agent, poe-agent; configure/install omit pi/poe-agent; configure pi → Unknown agent. N… |
| 30 | open | **High** | Approvals / recovery | [ux-approval-copy-hardcodes-toolcraft-in-source.md](./ux-approval-copy-hardcodes-toolcraft-in-source.md) | Confirmed packages/toolcraft/src/cli.ts and mcp.ts hardcode toolcraft approvals. |
| 31 | open | **High** | Approvals / recovery | [ux-approval-queued-message-says-toolcraft.md](./ux-approval-queued-message-says-toolcraft.md) | Blocked-flow copy Track toolcraft approvals show id. |
| 32 | open | **High** | Approvals | [ux-approvals-missing-id-says-task-not-found-double.md](./ux-approvals-missing-id-says-task-not-found-double.md) | approvals show/run --approval-id missing: Task "approvals/missing" not found. Use --debug for a stack trace… |
| 33 | open | **High** | Approvals | [ux-approvals-show-missing-says-task-not-found.md](./ux-approvals-show-missing-says-task-not-found.md) | approvals show --approval-id missing returns Task "approvals/missing" not found — task terminology for appr… |
| 34 | open | **High** | Auth / security / credential display | [ux-auth-api-key-displays-secret-to-stdout.md](./ux-auth-api-key-displays-secret-to-stdout.md) | `poe-code auth api-key` is described as "Display stored API key." If this command prints the raw key to std… |
| 35 | open | **High** | Auth / dry-run | [ux-auth-api-key-dry-run-still-prints-secret-2026-07-08-reconfirm.md](./ux-auth-api-key-dry-run-still-prints-secret-2026-07-08-reconfirm.md) | auth api-key --dry-run still prints the full sk-poe-… key on a single line (length ~50). No mask, no dry-ru… |
| 36 | open | **High** | Auth / security | [ux-auth-api-key-dry-run-still-prints-secret-live-reconfirm.md](./ux-auth-api-key-dry-run-still-prints-secret-live-reconfirm.md) | Reconfirmed live: auth api-key --dry-run prints full key line (redacted in audit logs only by us) — Critica… |
| 37 | open | **High** | Auth / dry-run | [ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md](./ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md) | Reconfirmed Critical: auth api-key --dry-run still emits the full API key (dry-run ignored). |
| 38 | open | **High** | Auth / security | [ux-auth-api-key-help-no-danger-or-mask-flag.md](./ux-auth-api-key-help-no-danger-or-mask-flag.md) | auth api-key help: Display stored API key; Options only -h — no --mask, no danger that it prints full secre… |
| 39 | open | **High** | Auth / security | [ux-auth-api-key-help-no-danger-warning.md](./ux-auth-api-key-help-no-danger-warning.md) | Help says only Display stored API key with no mention of masking, --reveal, or secret handling — even thoug… |
| 40 | open | **High** | Auth / security | [ux-auth-api-key-help-still-no-danger-reconfirmed.md](./ux-auth-api-key-help-still-no-danger-reconfirmed.md) | auth api-key --help still only Display stored API key with -h — reconfirm no secret warning. |
| 41 | open | **High** | Auth / destructive | [ux-auth-logout-same-as-logout-help.md](./ux-auth-logout-same-as-logout-help.md) | auth logout help says Remove all configuration and credentials same as root logout — if auth logout is alia… |
| 42 | open | **High** | Auth | [ux-auth-status-became-not-logged-in-mid-session.md](./ux-auth-status-became-not-logged-in-mid-session.md) | Earlier auth status Logged in as Kamil and whoami worked; later same session auth status: Not logged in and… |
| 43 | open | **High** | Config / models | [ux-claude-fable-appears-in-trace-fixtures-not-product-defaults.md](./ux-claude-fable-appears-in-trace-fixtures-not-product-defaults.md) | claude-fable-5 appears in packages/agent-traces test fixtures and archived plans as fixture model ids. Live… |
| 44 | open | **High** | Config / models | [ux-claude-settings-model-corrupted-to-fable-restored.md](./ux-claude-settings-model-corrupted-to-fable-restored.md) | During audit status check, ~/.claude/settings.json model was claude-fable-5[1m] (invalid id with control-se… |
| 45 | open | **High** | Code-review / errors | [ux-code-review-drafts-missing-arg-double-error.md](./ux-code-review-drafts-missing-arg-double-error.md) | Missing prUrl shows raw error: missing required argument then design-system error with same text and npm ru… |
| 46 | open | **High** | Code-review | [ux-code-review-install-unframed-and-npm-run-dev.md](./ux-code-review-install-unframed-and-npm-run-dev.md) | code-review install --force prints unframed "Install repo-local…" and broken word-wrapped absolute paths fo… |
| 47 | open | **High** | Code-review | [ux-code-review-run-invalid-url-wrong-error.md](./ux-code-review-run-invalid-url-wrong-error.md) | code-review run "not-a-url" fails with No code-review agent resolved rather than invalid PR URL — validatio… |
| 48 | open | **High** | Configure / models | [ux-configure-accepts-invalid-model-without-validation.md](./ux-configure-accepts-invalid-model-without-validation.md) | configure --model totally-fake-model-xyz --yes --dry-run proceeds to plan writes without validating the mod… |
| 49 | open | **High** | Configure | [ux-configure-base-url-may-be-ignored.md](./ux-configure-base-url-may-be-ignored.md) | configure claude --base-url https://example.com --yes --dry-run still shows ANTHROPIC_BASE_URL api.poe.com … |
| 50 | open | **High** | Configure / dry-run | [ux-configure-base-url-not-visible-in-dry-run.md](./ux-configure-base-url-not-visible-in-dry-run.md) | configure --base-url https://example.invalid --yes --dry-run still shows ANTHROPIC_BASE_URL https://api.poe… |
| 51 | open | **High** | Dry-run | [ux-configure-codex-dry-run-still-leaks-and-noise.md](./ux-configure-codex-dry-run-still-leaks-and-noise.md) | Reconfirmed: even with explicit --model openai/gpt-5.3-codex, dry-run still dumps large config rewrites (pr… |
| 52 | open | **High** | Dry-run / privacy | [ux-configure-dry-run-dumps-entire-existing-agent-config.md](./ux-configure-dry-run-dumps-entire-existing-agent-config.md) | configure codex --dry-run emits a full rewrite-style diff of the agent config that includes dozens of unrel… |
| 53 | open | **High** | Dry-run | [ux-configure-dry-run-shows-full-existing-settings-as-create.md](./ux-configure-dry-run-shows-full-existing-settings-as-create.md) | configure claude dry-run often shows --- /dev/null +++ settings.json with full 145-line content including e… |
| 54 | open | **High** | Configure / models | [ux-configure-dry-run-writes-stale-model-id.md](./ux-configure-dry-run-writes-stale-model-id.md) | configure --yes --dry-run for claude shows default model anthropic/claude-sonnet-5 and would write model cl… |
| 55 | open | **High** | Configure / models | [ux-configure-empty-api-key-still-defaults-dead-sonnet-5.md](./ux-configure-empty-api-key-still-defaults-dead-sonnet-5.md) | configure claude --api-key "" --yes --dry-run without --model still shows default model anthropic/claude-so… |
| 56 | open | **High** | Configure / models | [ux-configure-haiku-still-plans-effortlevel-xhigh.md](./ux-configure-haiku-still-plans-effortlevel-xhigh.md) | configure claude --provider poe --model anthropic/claude-haiku-4.5 --yes --dry-run plans model claude-haiku… |
| 57 | open | **High** | Help / configure | [ux-configure-help-missing-examples.md](./ux-configure-help-missing-examples.md) | configure --help lists options including skip-if-configured but no Examples (contrast models). |
| 58 | open | **High** | Configure / help | [ux-configure-help-skip-if-configured-still-lies.md](./ux-configure-help-skip-if-configured-still-lies.md) | configure --help: --skip-if-configured Exit without writes when current config already matches — help still… |
| 59 | open | **High** | Configure / models | [ux-configure-model-alias-sonnet-haiku-written-literally.md](./ux-configure-model-alias-sonnet-haiku-written-literally.md) | configure claude --model sonnet or haiku dry-run writes model: "sonnet" / "haiku" instead of resolving CLAU… |
| 60 | open | **High** | Configure / models | [ux-configure-model-haiku-alias-writes-literal-reconfirmed.md](./ux-configure-model-haiku-alias-writes-literal-reconfirmed.md) | configure claude --model haiku --yes --dry-run plans model: "haiku" not full id; dry-run also shows claude-… |
| 61 | open | **High** | Configure / models | [ux-configure-model-sonnet-alias-writes-literal-reconfirmed.md](./ux-configure-model-sonnet-alias-writes-literal-reconfirmed.md) | configure claude --model sonnet --yes --dry-run plans model: "sonnet" not resolved full id anthropic/claude… |
| 62 | open | **High** | Configure / non-TTY | [ux-configure-non-tty-demands-poe-no-prompt-not-yes.md](./ux-configure-non-tty-demands-poe-no-prompt-not-yes.md) | configure claude without --yes in non-TTY: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — --yes w… |
| 63 | open | **High** | Configure / models | [ux-configure-reasoning-effort-ignored-for-claude.md](./ux-configure-reasoning-effort-ignored-for-claude.md) | configure claude --model opus-4.7 --reasoning-effort low --yes --dry-run still plans effortLevel xhigh — fl… |
| 64 | open | **High** | Configure / dry-run | [ux-configure-shape-base-url-not-visible-in-dry-run.md](./ux-configure-shape-base-url-not-visible-in-dry-run.md) | configure claude --shape-base-url anthropic-messages=https://example.invalid --yes --dry-run still shows AN… |
| 65 | open | **High** | Config / models | [ux-constants-still-hardcodes-sonnet-5-source-reconfirm.md](./ux-constants-still-hardcodes-sonnet-5-source-reconfirm.md) | src/cli/constants.ts still has FRONTIER_MODELS anthropic/claude-sonnet-5, CLAUDE_CODE_VARIANTS.sonnet → son… |
| 66 | open | **High** | Spawn / runtime | [ux-detach-runtime-host-still-inline.md](./ux-detach-runtime-host-still-inline.md) | spawn … --detach --runtime host still prints ✓ agent and Resume line like normal spawn — no detached job id… |
| 67 | open | **High** | Spawn / runtime | [ux-detach-without-runtime-still-inline-reconfirmed.md](./ux-detach-without-runtime-still-inline-reconfirmed.md) | spawn … --detach without --runtime host/docker/e2b still runs inline with ✓ agent and Resume — no job id (r… |
| 68 | open | **High** | Help / identity | [ux-development-mode-usage-intentional-but-leaks.md](./ux-development-mode-usage-intentional-but-leaks.md) | execution-context maps development to npm run dev -- leaking into all help/errors. |
| 69 | open | **High** | Help | [ux-doctor-still-missing-reconfirmed-2026-07-08.md](./ux-doctor-still-missing-reconfirmed-2026-07-08.md) | doctor → Unknown command + npm run dev help — still missing; would catch model sonnet/xhigh corruption. |
| 70 | open | **High** | Help | [ux-dual-help-systems.md](./ux-dual-help-systems.md) | Commander vs toolcraft help completely different UIs. |
| 71 | open | **High** | Configure / models | [ux-effort-xhigh-valid-for-opus-not-sonnet.md](./ux-effort-xhigh-valid-for-opus-not-sonnet.md) | Catalog: opus-4.7 output_effort includes xhigh; sonnet-4.6 does not. configure always writes xhigh regardle… |
| 72 | open | **High** | Configure / flags | [ux-empty-api-key-flag-still-silently-ignored.md](./ux-empty-api-key-flag-still-silently-ignored.md) | configure … --api-key "" --yes --dry-run still plans config with existing Bearer (redacted) — empty explici… |
| 73 | open | **High** | Auth / configure | [ux-empty-api-key-login-good-but-configure-ignores.md](./ux-empty-api-key-login-good-but-configure-ignores.md) | login --api-key "" / " " correctly rejects POE API key cannot be empty. configure --api-key "" --yes --dry-… |
| 74 | open | **High** | Models / flags | [ux-empty-model-flag-behavior-inconsistent.md](./ux-empty-model-flag-behavior-inconsistent.md) | --model "" on agent fails with Missing model (good-ish); on spawn falls through to stale configured model a… |
| 75 | open | **High** | Errors / design system | [ux-error-panel-closes-before-error.md](./ux-error-panel-closes-before-error.md) | finalize Problems? then detached error. |
| 76 | open | **High** | Eval | [ux-eval-check-fails-on-placeholder-target-git-remote.md](./ux-eval-check-fails-on-placeholder-target-git-remote.md) | eval init then eval check clones a placeholder target and fails: git: remote-helper git+https aborted — sca… |
| 77 | open | **High** | Eval | [ux-eval-init-prints-bare-name-and-cwd-default-confusing.md](./ux-eval-init-prints-bare-name-and-cwd-default-confusing.md) | eval init ux-probe-eval prints bare ux-probe-eval and next: eval check; creates ./ux-probe-eval in cwd not … |
| 78 | open | **High** | Eval / identity | [ux-eval-report-invalid-format-npm-run-dev.md](./ux-eval-report-invalid-format-npm-run-dev.md) | Invalid --format bogus returns Expected one of: json, md, table with Run npm run dev -- eval report --help … |
| 79 | open | **High** | Install / consistency | [ux-experiment-install-already-exists-vs-pipeline-skip.md](./ux-experiment-install-already-exists-vs-pipeline-skip.md) | experiment install when skill exists hard-errors Skill already exists; pipeline install --dry-run skips exi… |
| 80 | open | **High** | Experiment / install | [ux-experiment-install-force-does-not-overwrite-skill.md](./ux-experiment-install-force-does-not-overwrite-skill.md) | experiment install --agent claude --local --force still: Skill already exists … See logs — --force document… |
| 81 | open | **High** | Experiment / install | [ux-experiment-install-force-does-not-overwrite.md](./ux-experiment-install-force-does-not-overwrite.md) | experiment install --local --force still fails Skill already exists — --force does not overwrite despite he… |
| 82 | open | **High** | Experiment / install | [ux-experiment-install-force-still-fails-already-exists.md](./ux-experiment-install-force-still-fails-already-exists.md) | experiment install --agent claude --local --force fails Error: Skill already exists even with --force docum… |
| 83 | open | **High** | Experiment | [ux-experiment-journal-empty-kind-unaware.md](./ux-experiment-journal-empty-kind-unaware.md) | experiment journal: No markdown doc found under docs/plans — same kind-unaware empty message as experiment … |
| 84 | open | **High** | Experiment | [ux-experiment-journal-no-experiment-docs-message.md](./ux-experiment-journal-no-experiment-docs-message.md) | experiment journal: No markdown doc found under docs/plans. Provide a doc path — false: many plans exist; m… |
| 85 | open | **High** | Experiment | [ux-experiment-journal-wrong-kind-says-not-found.md](./ux-experiment-journal-wrong-kind-says-not-found.md) | experiment journal docs/plans/32-agent-goal.md (kind: plan) says Experiment doc not found rather than wrong… |
| 86 | open | **High** | Experiment / Ralph | [ux-experiment-ralph-no-doc-wrong-message.md](./ux-experiment-ralph-no-doc-wrong-message.md) | experiment validate/journal and ralph run without doc say No markdown doc found under docs/plans. Provide a… |
| 87 | open | **High** | Experiment | [ux-experiment-run-empty-says-no-markdown-under-plans.md](./ux-experiment-run-empty-says-no-markdown-under-plans.md) | experiment run --yes: No markdown doc found under docs/plans. Provide a doc path — but docs/plans has many … |
| 88 | open | **High** | Experiment / kind errors | [ux-experiment-validate-wrong-kind-says-not-found.md](./ux-experiment-validate-wrong-kind-says-not-found.md) | experiment validate on agent-goal plan and pipeline plan both: Experiment doc not found — wrong kind, not m… |
| 89 | open | **High** | Package / bins | [ux-extra-npm-bins-still-published-reconfirmed.md](./ux-extra-npm-bins-still-published-reconfirmed.md) | package.json bin still includes poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test… |
| 90 | open | **High** | Packaging | [ux-extra-npm-bins-still-shipped.md](./ux-extra-npm-bins-still-shipped.md) | Root package.json bin still includes poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth… |
| 91 | open | **High** | Pipeline / trust | [ux-failure-shown-as-success-markers.md](./ux-failure-shown-as-success-markers.md) | Pipeline/gaslight use ✓ next to API errors. |
| 92 | open | **High** | Spawn / worktree | [ux-gaslight-has-worktree-spawn-does-not.md](./ux-gaslight-has-worktree-spawn-does-not.md) | gaslight --help lists --worktree; spawn --worktree unknown — inconsistent worktree surface. |
| 93 | open | **High** | Gaslight / help | [ux-gaslight-help-says-plan-to-implement.md](./ux-gaslight-help-says-plan-to-implement.md) | gaslight --help Argument plan-path: Markdown plan to implement — hard-codes Implement intent in help; defau… |
| 94 | open | **High** | Gaslight / help | [ux-gaslight-help-still-says-implement-reconfirmed.md](./ux-gaslight-help-still-says-implement-reconfirmed.md) | gaslight --help Argument plan-path: Markdown plan to implement; default mode auto — still steers Implement … |
| 95 | open | **High** | Gaslight | [ux-gaslight-ingest-failure-dumps-jsonl.md](./ux-gaslight-ingest-failure-dumps-jsonl.md) | Ingest analysis failure JSONL after Analyzed N prompts. |
| 96 | open | **High** | Gaslight | [ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md](./ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md) | gaslight ingest --dry-run is unknown (falls through to gaslight Interactive prompt requires TTY / POE_NO_PR… |
| 97 | open | **High** | Gaslight / non-TTY | [ux-gaslight-ingest-nontty-demands-poe-no-prompt.md](./ux-gaslight-ingest-nontty-demands-poe-no-prompt.md) | gaslight ingest --limit 1 --since 1d --dry-run still: Interactive prompt requires a TTY. Set POE_NO_PROMPT=… |
| 98 | open | **High** | Gaslight | [ux-gaslight-no-plan-autopicks-and-hits-stale-model.md](./ux-gaslight-no-plan-autopicks-and-hits-stale-model.md) | gaslight --yes without plan-path autopicks a plan (e.g. 15-spawn-hooks.md) and fails on dead default model … |
| 99 | open | **High** | Gaslight | [ux-gaslight-plan-path-starts-implement-without-confirm.md](./ux-gaslight-plan-path-starts-implement-without-confirm.md) | gaslight docs/plans/32-agent-goal.md --mode read --yes begins Prompt: Implement <path> and agent starts exp… |
| 100 | open | **High** | Gaslight | [ux-gaslight-plans-flag-still-auto-implement.md](./ux-gaslight-plans-flag-still-auto-implement.md) | gaslight --plans docs/plans/32-agent-goal.md --mode read --yes still Prompt: Implement … and starts agent w… |
| 101 | open | **High** | Gaslight / non-TTY | [ux-gaslight-yes-without-plan-hangs-or-stalls.md](./ux-gaslight-yes-without-plan-hangs-or-stalls.md) | gaslight --mode read --yes --model haiku without plan path stalled past 45s — non-TTY should require plan p… |
| 102 | open | **High** | Config / models | [ux-gemini-default-model-unnamespaced-and-stale-vs-frontier.md](./ux-gemini-default-model-unnamespaced-and-stale-vs-frontier.md) | DEFAULT_GEMINI_MODEL is gemini-2.5-pro (no google/ prefix). Catalog shows google/gemini-2.5-pro. FRONTIER_M… |
| 103 | open | **High** | Spawn / gemini | [ux-gemini-still-provider-credential-after-configure-dry-run.md](./ux-gemini-still-provider-credential-after-configure-dry-run.md) | configure gemini --dry-run plans quiet success; spawn gemini still Cannot resolve providerCredential — reco… |
| 104 | open | **High** | Spawn / github | [ux-github-cwd-clone-errors-still-raw-git.md](./ux-github-cwd-clone-errors-still-raw-git.md) | Invalid github://owner/repo still dumps Cloning into… ERROR: Repository not found fatal… See logs — reconfi… |
| 105 | open | **High** | Help | [ux-global-yes-not-listed-on-spawn-gaslight-help.md](./ux-global-yes-not-listed-on-spawn-gaslight-help.md) | spawn help only mentions --yes in mode description (--yes uses yolo); gaslight help has no --yes at all tho… |
| 106 | open | **High** | Config / models | [ux-goose-configure-haiku-still-embeds-sonnet-5-in-models-list-reconfirm.md](./ux-goose-configure-haiku-still-embeds-sonnet-5-in-models-list-reconfirm.md) | configure goose --model anthropic/claude-haiku-4.5 --yes --dry-run still embeds anthropic/claude-sonnet-5 i… |
| 107 | open | **High** | Config / models | [ux-goose-provider-map-still-has-sonnet-5-context.md](./ux-goose-provider-map-still-has-sonnet-5-context.md) | src/providers/goose.ts still maps "anthropic/claude-sonnet-5": 983_040 — dead model context window entry (r… |
| 108 | open | **High** | Harness | [ux-harness-new-kinds-undocumented-must-guess-demo-names.md](./ux-harness-new-kinds-undocumented-must-guess-demo-names.md) | harness new kind help says Built-in template kind without listing; common guesses safejs/agent-script/pipel… |
| 109 | open | **High** | Harness | [ux-harness-new-kinds-undocumented-only-coverage-demo-works.md](./ux-harness-new-kinds-undocumented-only-coverage-demo-works.md) | harness new --help says Built-in template kind with no list. coverage-demo works; agent-script, safejs, hel… |
| 110 | open | **High** | Hooks / spawn | [ux-hooks-auto-strategy-still-refuses-user-settings.md](./ux-hooks-auto-strategy-still-refuses-user-settings.md) | --hooks-from claude-code --hooks-strategy auto fails same Refuse to replace user-authored hook file — auto … |
| 111 | open | **High** | Hooks / spawn | [ux-hooks-from-codex-to-claude-not-supported-yet.md](./ux-hooks-from-codex-to-claude-not-supported-yet.md) | spawn --hooks-from codex: Transforming hooks from "codex" is not supported yet + See logs — late failure af… |
| 112 | open | **High** | Hooks / spawn | [ux-hooks-from-codex-to-claude-transform-unsupported.md](./ux-hooks-from-codex-to-claude-transform-unsupported.md) | spawn --hooks-from codex fails Transforming hooks from "codex" is not supported yet — help allows --hooks-f… |
| 113 | open | **High** | Hooks / spawn | [ux-hooks-from-spawn-poe-code-enoent.md](./ux-hooks-from-spawn-poe-code-enoent.md) | test/spawn with --hooks-from may exec poe-code not on PATH (tsx entry), opaque ENOENT. |
| 114 | open | **High** | Hooks / spawn | [ux-hooks-strategy-symlink-refuses-user-settings.md](./ux-hooks-strategy-symlink-refuses-user-settings.md) | spawn with --hooks-from claude-code --hooks-strategy symlink fails Refuse to replace user-authored hook fil… |
| 115 | open | **High** | Hooks / spawn | [ux-hooks-strategy-transform-unsupported-opaque.md](./ux-hooks-strategy-transform-unsupported-opaque.md) | Transforming hooks to claude-code is not supported yet is informative but still Error + See logs; help list… |
| 116 | open | **High** | Hooks / spawn | [ux-hooks-symlink-refuses-user-settings-reconfirmed.md](./ux-hooks-symlink-refuses-user-settings-reconfirmed.md) | spawn --hooks-from claude-code --hooks-strategy symlink: Refuse to replace user-authored hook file …/.claud… |
| 117 | open | **High** | Hooks / spawn | [ux-hooks-transform-to-claude-not-supported-yet.md](./ux-hooks-transform-to-claude-not-supported-yet.md) | spawn --hooks-from claude-code --hooks-strategy transform: Transforming hooks to claude-code is not support… |
| 118 | open | **High** | Agents | [ux-inconsistent-agent-surface-across-commands.md](./ux-inconsistent-agent-surface-across-commands.md) | configure/wrap/spawn/skill different agent unions. |
| 119 | open | **High** | Install / non-TTY | [ux-install-non-tty-demands-poe-no-prompt-not-yes.md](./ux-install-non-tty-demands-poe-no-prompt-not-yes.md) | install without agent in non-TTY: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — --yes should sel… |
| 120 | open | **High** | Install / capability matrix | [ux-install-pi-unknown-not-in-installable-list.md](./ux-install-pi-unknown-not-in-installable-list.md) | install pi → Unknown agent; pi is spawnable but not in install agent list — capability matrix gap (related … |
| 121 | open | **High** | Skills / consistency | [ux-install-skill-flags-inconsistent-across-commands.md](./ux-install-skill-flags-inconsistent-across-commands.md) | Skill-related install commands use inconsistent flag sets: skill install has --local/--global/--yes; memory… |
| 122 | open | **High** | Install / capability | [ux-install-test-pi-unknown-not-spawn-only.md](./ux-install-test-pi-unknown-not-spawn-only.md) | install pi and test pi: Unknown agent "pi" + See logs — but spawn accepts pi. Capability matrix: should say… |
| 123 | open | **High** | Install / Unconfigure | [ux-install-unconfigure-help-still-sparse-reconfirmed.md](./ux-install-unconfigure-help-still-sparse-reconfirmed.md) | install and unconfigure help only agent and -h — no --yes/--force/--dry-run notes; unconfigure is destructive. |
| 124 | open | **High** | Install | [ux-install-yes-silently-defaults-to-claude.md](./ux-install-yes-silently-defaults-to-claude.md) | install without agent non-TTY fails POE_NO_PROMPT; install --yes without agent installs Claude Code with su… |
| 125 | open | **High** | Config / models | [ux-kimi-default-model-id-namespace-mismatch.md](./ux-kimi-default-model-id-namespace-mismatch.md) | Catalog shows novita ai/kimi-k2.5 (space); configure kimi defaults to novitaai/kimi-k2.5 (no space). --sear… |
| 126 | open | **High** | Launch | [ux-launch-logs-missing-says-runtime-job.md](./ux-launch-logs-missing-says-runtime-job.md) | launch logs missing: No runtime job found for "missing" + See logs — wrong subsystem name (launch vs runtim… |
| 127 | open | **High** | Launch | [ux-launch-start-claims-running-then-status-stopped.md](./ux-launch-start-claims-running-then-status-stopped.md) | launch start sleepjob -- sleep 30 prints Managed process sleepjob is running. Immediately launch status sho… |
| 128 | open | **High** | Launch / identity | [ux-launch-start-dumps-turbo-build.md](./ux-launch-start-dumps-turbo-build.md) | launch start prints full turbo Packages in scope … FULL TURBO before Managed process is running — monorepo … |
| 129 | open | **High** | Launch | [ux-launch-start-success-then-status-shows-stopped.md](./ux-launch-start-success-then-status-shows-stopped.md) | launch start uxsleep2 -- sleep 30 prints Managed process uxsleep2 is running then turbo noise; immediate la… |
| 130 | open | **High** | Launch | [ux-launch-start-triggers-turbo-monorepo-build.md](./ux-launch-start-triggers-turbo-monorepo-build.md) | launch start foo -- echo hi runs turbo build across 68 packages (~24s) then Managed process failed to start… |
| 131 | open | **High** | Launch | [ux-launch-start-triggers-turbo-noise-and-opaque-failure.md](./ux-launch-start-triggers-turbo-noise-and-opaque-failure.md) | launch start foo -- echo hi (and without --) prints full turbo monorepo build output then Managed process f… |
| 132 | open | **High** | Launch | [ux-launch-status-blank-id-rows-reconfirmed.md](./ux-launch-status-blank-id-rows-reconfirmed.md) | launch status table has multiple rows with ID "-" STATUS stopped — blank-ID zombie rows pollute status (rel… |
| 133 | open | **High** | Launch | [ux-launch-status-blank-id-zombie-rows.md](./ux-launch-status-blank-id-zombie-rows.md) | After launch rm, status still lists rows with ID - STATUS stopped — registry not cleaned; table fills with … |
| 134 | open | **High** | Launch | [ux-launch-status-crashes-on-tombstone-dirs.md](./ux-launch-status-crashes-on-tombstone-dirs.md) | After launch rm, tombstone dirs named .state-removed-<id>-<uuid> can cause subsequent launch status/start/s… |
| 135 | open | **High** | Launch | [ux-launch-status-shows-dash-id-ghost-rows.md](./ux-launch-status-shows-dash-id-ghost-rows.md) | After failed/removed processes, launch status may show a table row with ID "-", STATUS stopped, empty metri… |
| 136 | open | **High** | Config / models | [ux-live-claude-settings-had-sonnet-alias-and-xhigh-restored.md](./ux-live-claude-settings-had-sonnet-alias-and-xhigh-restored.md) | During continuous audit status check, ~/.claude/settings.json had model: "sonnet" (unresolved alias from co… |
| 137 | open | **High** | Spawn / logging | [ux-log-dir-unwritable-silently-ignored.md](./ux-log-dir-unwritable-silently-ignored.md) | spawn with --log-dir /no/perm/dir still succeeds without warning that logs were not written. |
| 138 | open | **High** | Auth / CI | [ux-login-non-tty-hangs-on-oauth.md](./ux-login-non-tty-hangs-on-oauth.md) | Bare login starts OAuth wait forever without TTY. |
| 139 | open | **High** | Auth / non-TTY | [ux-login-non-tty-hangs-reconfirmed.md](./ux-login-non-tty-hangs-reconfirmed.md) | login without --api-key in non-TTY hung past 45s — reconfirm login-non-tty-hangs-on-oauth rather than fail-… |
| 140 | open | **High** | Logout / dry-run | [ux-logout-dry-run-multi-panel-noise.md](./ux-logout-dry-run-multi-panel-noise.md) | Logout dry-run floods diffs, multiple footers, and can print secrets. |
| 141 | open | **High** | Logout / dry-run | [ux-logout-dry-run-still-multi-panel-unconfigure.md](./ux-logout-dry-run-still-multi-panel-unconfigure.md) | logout --dry-run still nests Poe - unconfigure goose panels and large config dumps — factory-reset dry-run … |
| 142 | open | **High** | Auth / destructive | [ux-logout-help-no-danger-or-scope-detail.md](./ux-logout-help-no-danger-or-scope-detail.md) | logout help only says Remove all configuration and credentials with no file list, agent impact, or confirma… |
| 143 | open | **High** | Auth / destructive | [ux-logout-help-no-danger-or-yes.md](./ux-logout-help-no-danger-or-yes.md) | logout and auth logout help: Remove all configuration and credentials — no --yes, no factory-reset blast ra… |
| 144 | open | **High** | Maestro | [ux-maestro-dry-run-github-401-without-workflow.md](./ux-maestro-dry-run-github-401-without-workflow.md) | maestro --dry-run --yes with missing/default WORKFLOW.md fails with raw GitHub GraphQL 401 Bad credentials … |
| 145 | open | **High** | Maestro | [ux-maestro-dry-run-hits-github-401-reconfirmed.md](./ux-maestro-dry-run-hits-github-401-reconfirmed.md) | maestro --dry-run without valid WORKFLOW/auth: GitHub GraphQL 401 raw JSON — dry-run still network-calls Gi… |
| 146 | open | **High** | Maestro | [ux-maestro-dry-run-path-vs-flag-confusion.md](./ux-maestro-dry-run-path-vs-flag-confusion.md) | `maestro dry-run` treats dry-run as a WORKFLOW.md path (Missing workflow file …/dry-run). `maestro --dry-ru… |
| 147 | open | **High** | Maestro | [ux-maestro-run-dry-run-still-hits-github-401.md](./ux-maestro-run-dry-run-still-hits-github-401.md) | maestro run --dry-run --yes still performs GitHub GraphQL and dumps 401 Bad credentials JSON — dry-run is n… |
| 148 | open | **High** | Plan | [ux-markdown-read-section-wrong-recovery-command.md](./ux-markdown-read-section-wrong-recovery-command.md) | markdown-read-section no-such-section: try read-markdown to see TOC — wrong command name (actual is plan ma… |
| 149 | open | **High** | Memory | [ux-memory-agent-commands-invalid-json-opaque.md](./ux-memory-agent-commands-invalid-json-opaque.md) | memory explain and memory query fail with Memory agent returned invalid JSON output + See logs — no agent s… |
| 150 | open | **High** | Memory / clear / safety / destructive | [ux-memory-clear-no-yes-no-dry-run.md](./ux-memory-clear-no-yes-no-dry-run.md) | `poe-code memory clear` description: "Delete all memory content and re-initialize INDEX.md and LOG.md." Thi… |
| 151 | open | **High** | Memory / destructive | [ux-memory-clear-requires-yes-help-omits-yes.md](./ux-memory-clear-requires-yes-help-omits-yes.md) | memory clear non-TTY after init: memory clear requires --yes — good policy; memory clear --help only -h, no… |
| 152 | open | **High** | Memory | [ux-memory-explain-invalid-json-system-chrome.md](./ux-memory-explain-invalid-json-system-chrome.md) | memory explain pages/hello.md: Memory agent returned invalid JSON output + See logs — agent failure unframed. |
| 153 | open | **High** | Memory | [ux-memory-show-index-md-still-not-found-after-init.md](./ux-memory-show-index-md-still-not-found-after-init.md) | memory init creates .poe-code/memory/INDEX.md and LOG.md, but memory show INDEX, INDEX.md, and .poe-code/me… |
| 154 | open | **High** | Memory | [ux-memory-show-index-not-found-after-init.md](./ux-memory-show-index-not-found-after-init.md) | memory init succeeds; memory show INDEX.md → Page not found: INDEX.md — init claims INDEX.md/LOG.md but sho… |
| 155 | open | **High** | Memory | [ux-memory-user-page-show-works-index-does-not.md](./ux-memory-user-page-show-works-index-does-not.md) | After write pages/hello.md, memory show pages/hello.md works; memory show INDEX/INDEX.md still fails after … |
| 156 | open | **High** | Models | [ux-models-endpoint-bogus-double-error-and-stack.md](./ux-models-endpoint-bogus-double-error-and-stack.md) | models --endpoint bogus: good Available endpoints message but ERROR log + ValidationError stack + Error dur… |
| 157 | open | **High** | Models / errors | [ux-models-endpoint-invalid-good-list-but-stack.md](./ux-models-endpoint-invalid-good-list-but-stack.md) | Unsupported endpoint message lists Available endpoints (good) but still ERROR log + ValidationError stack —… |
| 158 | open | **High** | Models | [ux-models-exact-id-filter-rejects-namespaced-ids.md](./ux-models-exact-id-filter-rejects-namespaced-ids.md) | models --model anthropic/claude-opus-4.7 returns 0/341 while --model claude-opus-4.7 and --search opus-4.7 … |
| 159 | open | **High** | Models | [ux-models-invalid-endpoint-prints-stack.md](./ux-models-invalid-endpoint-prints-stack.md) | models --endpoint /v1/bogus: good message listing available endpoints, but also ERROR log line + full stack… |
| 160 | open | **High** | Models | [ux-models-invalid-input-output-modality-silent-empty.md](./ux-models-invalid-input-output-modality-silent-empty.md) | models --input bogus and --output bogus → 0/341 No models match — no ValidationError (related --output json… |
| 161 | open | **High** | Models | [ux-models-invalid-provider-silent-empty.md](./ux-models-invalid-provider-silent-empty.md) | models --provider not-a-provider → 0/341 No models match — no error that provider is unknown (contrast endp… |
| 162 | open | **High** | Models | [ux-models-model-flag-rejects-namespaced-ids.md](./ux-models-model-flag-rejects-namespaced-ids.md) | models --model anthropic/claude-haiku-4.5 → 0/341; models --model claude-haiku-4.5 → 1 hit. Help says exact… |
| 163 | open | **High** | Models | [ux-models-no-limit-flag-confirmed.md](./ux-models-no-limit-flag-confirmed.md) | models --limit 5 unknown option; traces has --limit but models does not. 341-row default flood. |
| 164 | open | **High** | Models | [ux-models-no-limit-flag.md](./ux-models-no-limit-flag.md) | models has no --limit flag (341-row dumps flood TTY) |
| 165 | open | **High** | Models | [ux-models-output-json-search-returns-empty-inconsistently.md](./ux-models-output-json-search-returns-empty-inconsistently.md) | models --output json silently empties results (invalid modality, not format) |
| 166 | open | **High** | Models | [ux-models-parameters-namespaced-id-empty.md](./ux-models-parameters-namespaced-id-empty.md) | models --view parameters --model claude-sonnet-4.6 works; --model anthropic/claude-sonnet-4.6 → 0/341 empty… |
| 167 | open | **High** | Models | [ux-models-pricing-capabilities-namespaced-id-empty.md](./ux-models-pricing-capabilities-namespaced-id-empty.md) | models --view pricing/capabilities --model anthropic/claude-haiku-4.5 → 0/341; bare claude-haiku-4.5 works.… |
| 168 | open | **High** | Models | [ux-models-raw-empty-model-dumps-all-yaml.md](./ux-models-raw-empty-model-dumps-all-yaml.md) | models --view raw --model "" dumps full YAML for all models starting with hy3-n — empty --model ignored; fl… |
| 169 | open | **High** | Config / models | [ux-models-search-confirms-sonnet-5-absent-from-catalog.md](./ux-models-search-confirms-sonnet-5-absent-from-catalog.md) | Live catalog has no sonnet-5 (`models --search sonnet-5` → 0/341) while product defaults still reference it… |
| 170 | open | **High** | Models / config | [ux-models-search-quoted-catalog-display-name-fails.md](./ux-models-search-quoted-catalog-display-name-fails.md) | Catalog displays novita ai/kimi-k2.5 but --search "novita ai/kimi-k2.5" returns 0 — space in provider displ… |
| 171 | open | **High** | Config / models | [ux-models-search-sonnet-5-zero-proves-dead-id.md](./ux-models-search-sonnet-5-zero-proves-dead-id.md) | models --search sonnet-5 and --search claude-sonnet-5 return 0/341 — catalog has no sonnet-5; product defau… |
| 172 | open | **High** | Models | [ux-models-since-invalid-prints-stack.md](./ux-models-since-invalid-prints-stack.md) | models --since bogus and --since 0d: good Invalid --since duration message but also ERROR log + full Valida… |
| 173 | open | **High** | Errors | [ux-models-since-validation-still-prints-stack.md](./ux-models-since-validation-still-prints-stack.md) | Invalid --since still dumps ERROR log + ValidationError stack + design-system error — reconfirm of validati… |
| 174 | open | **High** | Models | [ux-models-view-raw-namespaced-id-returns-empty-array.md](./ux-models-view-raw-namespaced-id-returns-empty-array.md) | models --view raw --model claude-haiku-4.5 dumps YAML; --model anthropic/claude-haiku-4.5 returns [] — name… |
| 175 | open | **High** | Interactive / CI | [ux-non-tty-prompt-wrong-guidance.md](./ux-non-tty-prompt-wrong-guidance.md) | Error says POE_NO_PROMPT=1; product contract is --yes. |
| 176 | open | **High** | Config / models | [ux-opus-4-7-catalog-supports-xhigh-sonnet-does-not.md](./ux-opus-4-7-catalog-supports-xhigh-sonnet-does-not.md) | models --view parameters --model claude-opus-4.7: output_effort enum includes xhigh. sonnet-4.6 parameters … |
| 177 | open | **High** | Package / install | [ux-package-json-extra-bins-still-present-reconfirmed.md](./ux-package-json-extra-bins-still-present-reconfirmed.md) | package.json bin still has poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test-serv… |
| 178 | open | **High** | Package / install | [ux-package-json-extra-npm-bins-reconfirmed.md](./ux-package-json-extra-npm-bins-reconfirmed.md) | package.json bin includes poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test-serve… |
| 179 | open | **High** | Safety copy | [ux-permission-mode-sets-differ-across-commands.md](./ux-permission-mode-sets-differ-across-commands.md) | spawn: yolo/auto/edit/read; gaslight: read/edit/yolo/auto with default auto; harness: read/edit/auto/yolo; … |
| 180 | open | **High** | Agents | [ux-pi-spawnable-but-not-configurable.md](./ux-pi-spawnable-but-not-configurable.md) | pi on spawn help; configure pi unknown; spawn works. |
| 181 | open | **High** | Pipeline / install | [ux-pipeline-install-force-skips-skill-overwrites-steps.md](./ux-pipeline-install-force-skips-skill-overwrites-steps.md) | pipeline install --agent claude --local --force: Overwrite steps.yaml; Skip skill already exists — --force … |
| 182 | open | **High** | Pipeline / install | [ux-pipeline-install-force-skips-skill-still.md](./ux-pipeline-install-force-skips-skill-still.md) | pipeline install --local --force overwrites steps.yaml but Skip: skill already exists — --force partial; sk… |
| 183 | open | **High** | Pipeline | [ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md](./ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md) | --task foo --yes picks some plan, shows 21/21 done, then task not found. |
| 184 | open | **High** | Pipeline | [ux-pipeline-run-help-omits-yes-and-mode.md](./ux-pipeline-run-help-omits-yes-and-mode.md) | pipeline run help has agent/model/tui/archive/task/plan/max-runs/worktree — no --yes, --mode, dry-run notes… |
| 185 | open | **High** | Pipeline | [ux-pipeline-run-yes-autopicks-completed-plan-nothing-to-run.md](./ux-pipeline-run-yes-autopicks-completed-plan-nothing-to-run.md) | pipeline run --yes without --plan autopicks docs/plans/tiny-http-mcp-server-production-hardening.md (21/21 … |
| 186 | open | **High** | Plan / destructive | [ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md](./ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md) | plan archive and delete --help still only path, --kind, --output, -h — no --yes, no warning that --yes with… |
| 187 | open | **High** | Plan / destructive | [ux-plan-archive-help-omits-yes-behavior.md](./ux-plan-archive-help-omits-yes-behavior.md) | plan archive help shows optional path and --kind/--output but does not document non-TTY selection requiring… |
| 188 | open | **High** | Plan / destructive | [ux-plan-archive-help-still-omits-yes.md](./ux-plan-archive-help-still-omits-yes.md) | plan archive help only lists path, --kind, --output, -h — no --yes despite non-TTY requiring it and destruc… |
| 189 | open | **High** | Plan / destructive | [ux-plan-archive-json-skips-without-explaining-why.md](./ux-plan-archive-json-skips-without-explaining-why.md) | plan archive docs/plans/README.md --output json returns skipped:true, confirmationRequired:true without exp… |
| 190 | open | **High** | Plan / non-TTY | [ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md](./ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md) | plan browse without TTY dumps full body of some plan (toolcraft human-in-loop…) without path or picker — no… |
| 191 | open | **High** | Plan / non-TTY | [ux-plan-browse-non-tty-dumps-plan-body.md](./ux-plan-browse-non-tty-dumps-plan-body.md) | plan browse without TTY dumps a full plan markdown body (looks like plan view of first plan) rather than Va… |
| 192 | open | **High** | Plan / destructive | [ux-plan-delete-allows-readme.md](./ux-plan-delete-allows-readme.md) | plan delete dry-run accepts docs/plans/README.md. |
| 193 | open | **High** | Plan / destructive | [ux-plan-delete-help-still-omits-yes.md](./ux-plan-delete-help-still-omits-yes.md) | plan delete help only path, --kind, --output, -h — no --yes despite non-TTY requiring it. |
| 194 | open | **High** | Plan / destructive | [ux-plan-delete-json-skips-without-reason.md](./ux-plan-delete-json-skips-without-reason.md) | plan delete docs/plans/README.md --output json returns skipped:true without reason field — same opacity as … |
| 195 | open | **High** | Plan / editor | [ux-plan-edit-hangs-without-editor.md](./ux-plan-edit-hangs-without-editor.md) | plan edit without EDITOR/VISUAL can hang or fail to return a clear ValidationError within a short time (obs… |
| 196 | open | **High** | Plan / help | [ux-plan-help-omits-yes-on-destructive-subcommands.md](./ux-plan-help-omits-yes-on-destructive-subcommands.md) | plan group help lists archive/delete without --yes; explorer keymap e/a/d/n without non-TTY guidance. |
| 197 | open | **High** | Plan / non-TTY | [ux-plan-question-non-tty-may-hang.md](./ux-plan-question-non-tty-may-hang.md) | poe-code plan "improve tests" --yes in non-TTY can hang past 60s rather than ValidationError requiring TTY … |
| 198 | open | **High** | Plan / non-TTY | [ux-plan-root-non-tty-dumps-arbitrary-body.md](./ux-plan-root-non-tty-dumps-arbitrary-body.md) | poe-code plan without question/subcommand in non-TTY dumps full body of some plan (same as browse) — not a … |
| 199 | open | **High** | Plan / non-TTY | [ux-plan-root-nontty-dumps-arbitrary-plan-body.md](./ux-plan-root-nontty-dumps-arbitrary-plan-body.md) | plan with no args/subcommands in non-TTY dumps full body of some plan (Agent goal…) instead of list or fail… |
| 200 | open | **High** | Plan | [ux-plan-view-json-embeds-full-content-flood.md](./ux-plan-view-json-embeds-full-content-flood.md) | plan view pipeline plan --output json includes full content string of the entire plan body (thousands of ch… |
| 201 | open | **High** | Providers / dry-run | [ux-provider-login-poe-dry-run-rewrites-claude-settings-xhigh.md](./ux-provider-login-poe-dry-run-rewrites-claude-settings-xhigh.md) | provider login poe --api-key sk-fake --dry-run not only would save credential but also plans full ~/.claude… |
| 202 | open | **High** | Auth / providers | [ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md](./ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md) | auth status reports Logged in as … but provider login poe --yes says No API key found and points to --api-k… |
| 203 | open | **High** | Provider / dry-run | [ux-provider-logout-dry-run-unconfigures-agents.md](./ux-provider-logout-dry-run-unconfigures-agents.md) | provider logout dry-run walks agent unconfigure not just credentials. |
| 204 | open | **High** | Provider / help / destructive | [ux-provider-logout-help-no-danger-or-yes.md](./ux-provider-logout-help-no-danger-or-yes.md) | `provider logout --help` only documents `-h, --help`. Credential removal is destructive yet there is no `--… |
| 205 | open | **High** | Providers / dry-run | [ux-provider-logout-poe-dry-run-still-agent-diffs.md](./ux-provider-logout-poe-dry-run-still-agent-diffs.md) | provider logout poe --dry-run still emits large agent settings diffs (claude plugins, effortLevel, etc.) an… |
| 206 | open | **High** | Providers / destructive | [ux-provider-logout-poe-dry-run-unconfigures-agents.md](./ux-provider-logout-poe-dry-run-unconfigures-agents.md) | provider logout poe --dry-run not only rm credentials.poe.enc but also rewrites goose config and more — bro… |
| 207 | open | **High** | Ralph | [ux-ralph-init-plan-says-not-found.md](./ux-ralph-init-plan-says-not-found.md) | ralph init docs/plans/32-agent-goal.md --dry-run: Ralph doc not found — file exists; ralph requires prior r… |
| 208 | open | **High** | Ralph | [ux-ralph-init-requires-existing-ralph-doc-circular.md](./ux-ralph-init-requires-existing-ralph-doc-circular.md) | ralph init docs/plans/32-agent-goal.md says Ralph doc not found — init cannot bootstrap a plan into ralph k… |
| 209 | open | **High** | Ralph | [ux-ralph-run-empty-kind-unaware-reconfirmed.md](./ux-ralph-run-empty-kind-unaware-reconfirmed.md) | ralph run --yes: No markdown doc found under docs/plans — kind-unaware like experiment run despite many pla… |
| 210 | open | **High** | Ralph | [ux-ralph-run-plan-kind-says-ralph-doc-not-found.md](./ux-ralph-run-plan-kind-says-ralph-doc-not-found.md) | ralph run docs/plans/32-agent-goal.md (kind: plan) says Ralph doc not found — same wrong-kind-as-missing pa… |
| 211 | open | **High** | Ralph | [ux-ralph-run-plan-says-not-found-reconfirmed.md](./ux-ralph-run-plan-says-not-found-reconfirmed.md) | ralph run docs/plans/32-agent-goal.md --yes: Ralph doc not found — same wrong-kind class as ralph init. |
| 212 | open | **High** | Docs / CI | [ux-readme-spawn-omits-mode-for-ci.md](./ux-readme-spawn-omits-mode-for-ci.md) | README CI spawn one-liners omit --mode/--yes; fail non-interactively. |
| 213 | open | **High** | Configure | [ux-reasoning-effort-bogus-silently-ignored.md](./ux-reasoning-effort-bogus-silently-ignored.md) | configure claude --reasoning-effort bogus --yes --dry-run still plans effortLevel xhigh without rejecting u… |
| 214 | open | **High** | Configure | [ux-reasoning-effort-flag-silently-ignored-for-some-agents.md](./ux-reasoning-effort-flag-silently-ignored-for-some-agents.md) | configure claude --reasoning-effort low/medium/max --yes --dry-run still plans effortLevel xhigh (or does n… |
| 215 | open | **High** | Configure | [ux-reasoning-effort-high-still-writes-xhigh.md](./ux-reasoning-effort-high-still-writes-xhigh.md) | configure claude --reasoning-effort high --model sonnet-4.6 --yes --dry-run still shows effortLevel xhigh —… |
| 216 | open | **High** | Spawn / resume | [ux-resume-thread-invalid-id-agent-raw-error.md](./ux-resume-thread-invalid-id-agent-raw-error.md) | Invalid resume id fails with Claude Code spawn failed … Error: --resume requires a valid session ID… Usage:… |
| 217 | open | **High** | Help / identity | [ux-root-help-footer-npm-run-dev-for-options.md](./ux-root-help-footer-npm-run-dev-for-options.md) | Footer: Run npm run dev -- <command> --help. |
| 218 | open | **High** | Help / identity | [ux-root-help-footer-npm-run-dev-reconfirmed.md](./ux-root-help-footer-npm-run-dev-reconfirmed.md) | Root help footer: Run npm run dev -- <command> --help for command options — reconfirm identity leak on footer. |
| 219 | open | **High** | Help / identity | [ux-root-help-footer-still-npm-run-dev.md](./ux-root-help-footer-still-npm-run-dev.md) | Root help ends with Run npm run dev -- <command> --help for command options — reconfirm development-mode id… |
| 220 | open | **High** | Help / discoverability | [ux-root-help-lists-19-commands-hides-more.md](./ux-root-help-lists-19-commands-hides-more.md) | Root help shows ~19 top-level commands; skill, memory, provider, runtime, launch, worktree, utils, braintru… |
| 221 | open | **High** | Help / discoverability | [ux-root-help-still-hides-13-working-commands-reconfirmed.md](./ux-root-help-still-hides-13-working-commands-reconfirmed.md) | Root help still lists ~18 commands ending at usage. Working but hidden: skill, memory, worktree, eval, maes… |
| 222 | open | **High** | Help / discoverability | [ux-root-help-still-hides-skill-memory.md](./ux-root-help-still-hides-skill-memory.md) | Root help includes plan and gaslight but skill and memory remain absent — reconfirm discoverability gap. |
| 223 | open | **High** | Help / identity | [ux-root-help-usage-line-is-npm-run-dev.md](./ux-root-help-usage-line-is-npm-run-dev.md) | Root help Usage: npm run dev -- <command>. |
| 224 | open | **High** | Help / identity | [ux-root-help-usage-npm-run-dev-reconfirmed.md](./ux-root-help-usage-npm-run-dev-reconfirmed.md) | root --help: Usage: npm run dev -- <command> [...args] — displayBinaryName leak still open; hides half of c… |
| 225 | open | **High** | Help / identity | [ux-root-help-usage-still-npm-run-dev-reconfirmed.md](./ux-root-help-usage-still-npm-run-dev-reconfirmed.md) | Root help Usage: npm run dev -- <command> [...args] — reconfirm development-mode identity when run via tsx. |
| 226 | open | **High** | Help / discoverability | [ux-root-typo-still-no-suggestions-reconfirmed.md](./ux-root-typo-still-no-suggestions-reconfirmed.md) | confgure and spaen → Unknown command with npm run dev help — no Did you mean configure/spawn. |
| 227 | open | **High** | Help / suggestions | [ux-root-typos-no-did-you-mean-configure-spawn.md](./ux-root-typos-no-did-you-mean-configure-spawn.md) | Unknown command confgure and spwn show only Run npm run dev -- --help without Did you mean configure/spawn … |
| 228 | open | **High** | Spawn / runtime | [ux-runner-sync-without-detach-silently-ignored.md](./ux-runner-sync-without-detach-silently-ignored.md) | spawn … --runner-sync both without --detach/--runtime succeeds inline — flag has no effect, no warning. |
| 229 | open | **High** | Runtime / non-TTY | [ux-runtime-init-non-tty-poe-no-prompt.md](./ux-runtime-init-non-tty-poe-no-prompt.md) | runtime init without TTY says Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — obscure env vs stand… |
| 230 | open | **High** | Runtime jobs | [ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md](./ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md) | runtime jobs logs without jobId errors with More than one … Pass a job id and lists many jobs including run… |
| 231 | open | **High** | Runtime jobs | [ux-runtime-jobs-ls-unbounded-may-era-reconfirmed.md](./ux-runtime-jobs-ls-unbounded-may-era-reconfirmed.md) | runtime jobs ls dumps many May 2026 exited jobs plus pending e2b rows with blank STARTED — unbounded opaque… |
| 232 | open | **High** | Runtime jobs | [ux-runtime-jobs-ls-unbounded-stale-from-may.md](./ux-runtime-jobs-ls-unbounded-stale-from-may.md) | runtime jobs ls shows huge table including pending e2b jobs and exited host jobs from 2026-05-04 with no --… |
| 233 | open | **High** | Runtime jobs | [ux-runtime-jobs-stop-lists-many-stale-running.md](./ux-runtime-jobs-stop-lists-many-stale-running.md) | runtime jobs stop/attach without job id lists dozens of "running" jobs dating back weeks — zombie job state… |
| 234 | open | **High** | Runtime | [ux-runtime-templates-clear-no-yes-or-dry-run.md](./ux-runtime-templates-clear-no-yes-or-dry-run.md) | runtime templates clear --help only -h; non-TTY requires POE_NO_PROMPT; no dry-run of what will be deleted … |
| 235 | open | **High** | Runtime / non-TTY | [ux-runtime-templates-clear-poe-no-prompt-not-yes.md](./ux-runtime-templates-clear-poe-no-prompt-not-yes.md) | runtime templates clear without --yes: Interactive prompt requires TTY. Set POE_NO_PROMPT=1 — --yes works w… |
| 236 | open | **High** | Runtime | [ux-runtime-templates-ls-unbounded-stale.md](./ux-runtime-templates-ls-unbounded-stale.md) | runtime templates ls shows many e2b template cache rows from 2026-05-04 with no --limit — same unbounded hi… |
| 237 | open | **High** | SDK / safety | [ux-sdk-cli-mode-default-mismatch.md](./ux-sdk-cli-mode-default-mismatch.md) | SDK defaults mode to yolo; CLI spawn prompts/--yes yolo; gaslight defaults auto. |
| 238 | open | **High** | Skills | [ux-skill-configure-exists-system-chrome.md](./ux-skill-configure-exists-system-chrome.md) | skill configure claude-code --yes (global default) fails Skill already exists: ~/.claude/skills/poe-generat… |
| 239 | open | **High** | Skills | [ux-skill-configure-yes-silent-default-agent.md](./ux-skill-configure-yes-silent-default-agent.md) | skill configure --yes --local without agent silently configures claude-code skills — no confirmation of def… |
| 240 | open | **High** | Help / discoverability | [ux-skill-help-hides-from-root-reconfirmed.md](./ux-skill-help-hides-from-root-reconfirmed.md) | Skill group works when invoked but remains absent from root help command list — reconfirm discoverability. |
| 241 | open | **High** | Skills | [ux-skill-install-help-omits-force.md](./ux-skill-install-help-omits-force.md) | skill install help has name/file/yes/local/global only — no --force while experiment install has --force; o… |
| 242 | open | **High** | Skills | [ux-skill-install-name-and-file-both-required-reconfirmed.md](./ux-skill-install-name-and-file-both-required-reconfirmed.md) | skill install with only --name fails required --file; only --file fails required --name — both required; ca… |
| 243 | open | **High** | Skills | [ux-skill-list-command-missing.md](./ux-skill-list-command-missing.md) | skill list → Unknown command: list + npm run dev recovery. skill only has install/configure/unconfigure; no… |
| 244 | open | **High** | Help / discoverability | [ux-skill-memory-absent-from-root-help.md](./ux-skill-memory-absent-from-root-help.md) | Root --help does not list skill or memory though both exist as parent commands — reaffirm important-command… |
| 245 | open | **High** | Skills / discoverability | [ux-skill-no-list-or-bridge-subcommands.md](./ux-skill-no-list-or-bridge-subcommands.md) | skill list and skill bridge are Unknown command — skill only install/configure/unconfigure. Users cannot li… |
| 246 | open | **High** | Skills | [ux-skill-unconfigure-dry-run-path-inconsistent.md](./ux-skill-unconfigure-dry-run-path-inconsistent.md) | skill unconfigure claude-code --local --yes --dry-run says Would remove skills directory ~/.claude/skills A… |
| 247 | open | **High** | Configure | [ux-skip-if-configured-dry-run-still-plans-full-rewrite.md](./ux-skip-if-configured-dry-run-still-plans-full-rewrite.md) | Even with matching model and --skip-if-configured --dry-run, configure still emits full create settings.jso… |
| 248 | open | **High** | Configure | [ux-skip-if-configured-matching-model-still-plans-full-rewrite.md](./ux-skip-if-configured-matching-model-still-plans-full-rewrite.md) | configure claude --model anthropic/claude-sonnet-4.6 --skip-if-configured --yes --dry-run still plans full … |
| 249 | open | **High** | Configure | [ux-skip-if-configured-matching-sonnet-4-6-still-full-rewrite-reconfirm.md](./ux-skip-if-configured-matching-sonnet-4-6-still-full-rewrite-reconfirm.md) | configure claude --model anthropic/claude-sonnet-4.6 --skip-if-configured --yes --dry-run still plans full … |
| 250 | open | **High** | Configure / models | [ux-skip-if-configured-shows-stale-default-model.md](./ux-skip-if-configured-shows-stale-default-model.md) | Already-configured path prints anthropic/claude-sonnet-5 as default model though API rejects it. |
| 251 | open | **High** | Configure / models | [ux-sonnet-4-6-output-effort-has-no-xhigh.md](./ux-sonnet-4-6-output-effort-has-no-xhigh.md) | models --view parameters --model claude-sonnet-4.6 shows output_effort enum max, high, medium, low, none (d… |
| 252 | open | **High** | Config / models | [ux-sonnet-5-still-absent-from-catalog.md](./ux-sonnet-5-still-absent-from-catalog.md) | Reconfirmed: models --search sonnet-5 → 0/341 while product defaults still reference it. |
| 253 | open | **High** | Help | [ux-spawn-configure-help-still-no-examples-reconfirmed.md](./ux-spawn-configure-help-still-no-examples-reconfirmed.md) | spawn --help and configure --help still have no Examples section — reconfirm vs models best-in-class help. |
| 254 | open | **High** | Spawn / detach | [ux-spawn-detach-silently-ignored-without-runtime.md](./ux-spawn-detach-silently-ignored-without-runtime.md) | spawn --detach silently ignored without runtime (runs foreground) |
| 255 | open | **High** | Spawn | [ux-spawn-empty-agent-validates-mode-first.md](./ux-spawn-empty-agent-validates-mode-first.md) | spawn "" "hi" non-TTY: spawn requires --mode … or --yes to use yolo — mode checked before empty agent rejec… |
| 256 | open | **High** | Spawn / gemini | [ux-spawn-gemini-provider-credential-missing.md](./ux-spawn-gemini-provider-credential-missing.md) | spawn gemini with google/gemini-2.5-flash: Cannot resolve "providerCredential": no active provider on conte… |
| 257 | open | **High** | Spawn / gemini | [ux-spawn-gemini-provider-credential-opaque-error.md](./ux-spawn-gemini-provider-credential-opaque-error.md) | spawn gemini with an explicit model can fail with Cannot resolve "providerCredential": no active provider o… |
| 258 | open | **High** | Help / spawn | [ux-spawn-help-still-no-examples.md](./ux-spawn-help-still-no-examples.md) | spawn --help lists many advanced flags but no Examples for common flows (read mode one-shot, @file, --yes). |
| 259 | open | **High** | Spawn / hooks | [ux-spawn-hooks-auto-demands-yes-when-not-poe-configured-message.md](./ux-spawn-hooks-auto-demands-yes-when-not-poe-configured-message.md) | spawn claude with model + --hooks-from claude-code --hooks-strategy auto non-TTY: Claude Code is not config… |
| 260 | open | **High** | Spawn / non-TTY | [ux-spawn-interactive-non-tty-launches-agent-tui-copy.md](./ux-spawn-interactive-non-tty-launches-agent-tui-copy.md) | spawn claude … --interactive on non-TTY does not fail-fast; prints agent TUI greeting Hey! What would you l… |
| 261 | open | **High** | Spawn / interactive | [ux-spawn-interactive-raw-agent-error.md](./ux-spawn-interactive-raw-agent-error.md) | Interactive spawn without prompt/TTY surfaces raw agent-native --print error outside design system. |
| 262 | open | **High** | Spawn / interactive | [ux-spawn-interactive-still-uses-stale-model-bare-error.md](./ux-spawn-interactive-still-uses-stale-model-bare-error.md) | Even with prompt and -i, non-TTY spawn can surface bare API Error: 400 Unsupported model without design-sys… |
| 263 | open | **High** | Spawn / errors | [ux-spawn-invalid-model-shows-success-then-failure.md](./ux-spawn-invalid-model-shows-success-then-failure.md) | spawn with --model does-not-exist-xyz prints ✓ agent: API Error: 400 Unsupported model and ✓ tokens then Er… |
| 264 | open | **High** | Spawn / kimi | [ux-spawn-kimi-acp-internal-error-stack.md](./ux-spawn-kimi-acp-internal-error-stack.md) | spawn kimi --yes: ✗ Internal error AcpError stack from poe-acp-client then Kimi spawn failed exit code 1 + … |
| 265 | open | **High** | Spawn / kimi | [ux-spawn-kimi-not-configured-yes-message.md](./ux-spawn-kimi-not-configured-yes-message.md) | spawn kimi without configure: Kimi is not configured via poe. Pass --yes to proceed without prompting — unc… |
| 266 | open | **High** | Spawn | [ux-spawn-missing-reasoning-effort-flag.md](./ux-spawn-missing-reasoning-effort-flag.md) | spawn --reasoning-effort xhigh/high is unknown option; flag exists only on configure. Users expect spawn-ti… |
| 267 | open | **High** | Spawn / worktree | [ux-spawn-missing-worktree-flag-reconfirmed.md](./ux-spawn-missing-worktree-flag-reconfirmed.md) | spawn --worktree foo unknown option; worktree exists as separate command group; superintendent has --worktree. |
| 268 | open | **High** | Safety copy | [ux-spawn-mode-and-permission-copy.md](./ux-spawn-mode-and-permission-copy.md) | Modes minimal definition; --yes uses yolo buried; order differs spawn vs gaslight. |
| 269 | open | **High** | Spawn / pi | [ux-spawn-pi-demands-openrouter-not-poe.md](./ux-spawn-pi-demands-openrouter-not-poe.md) | spawn pi with haiku --yes: Pi spawn failed — No API key found for openrouter; points at earendil-works pi-c… |
| 270 | open | **High** | Spawn / poe-agent | [ux-spawn-poe-agent-lstat-reconfirmed-2026-07-08.md](./ux-spawn-poe-agent-lstat-reconfirmed-2026-07-08.md) | spawn poe-agent --yes with haiku still: fs.lstat is not a function + See logs — Critical #18 still open. |
| 271 | open | **High** | Spawn / poe-agent | [ux-spawn-poe-agent-lstat-reconfirmed.md](./ux-spawn-poe-agent-lstat-reconfirmed.md) | Live reconfirm: spawn poe-agent "hi" --mode read → fs.lstat is not a function + See logs. |
| 272 | open | **High** | Spawn / worktree | [ux-spawn-worktree-flag-missing-on-spawn.md](./ux-spawn-worktree-flag-missing-on-spawn.md) | spawn --worktree is unknown option; worktree exists on gaslight/ralph/pipeline/experiment — spawn users can… |
| 273 | open | **High** | Spawn / safety | [ux-spawn-yes-defaults-to-yolo-mode.md](./ux-spawn-yes-defaults-to-yolo-mode.md) | spawn --yes without --mode runs successfully (uses yolo per help). Help documents --yes uses yolo — good if… |
| 274 | open | **High** | Config / models | [ux-stale-configured-model-fails-late.md](./ux-stale-configured-model-fails-late.md) | Invalid configured model ids only fail mid gaslight/pipeline with API 400 and success checkmarks. |
| 275 | open | **High** | Superintendent / identity | [ux-superintendent-builder-inspector-toolcraft-help.md](./ux-superintendent-builder-inspector-toolcraft-help.md) | superintendent builder and inspector --help show Usage: npm run dev -- superintendent builder… — dual help … |
| 276 | open | **High** | Superintendent / help / formatting | [ux-superintendent-help-format-inconsistencies.md](./ux-superintendent-help-format-inconsistencies.md) | `superintendent --help` has multiple formatting inconsistencies vs. every other poe-code command: |
| 277 | open | **High** | Help / identity | [ux-superintendent-help-npm-run-dev-reconfirmed.md](./ux-superintendent-help-npm-run-dev-reconfirmed.md) | superintendent run/complete help Usage: npm run dev -- superintendent … — reconfirm identity leak on toolcr… |
| 278 | open | **High** | Superintendent / install | [ux-superintendent-install-already-exists-debug-tease.md](./ux-superintendent-install-already-exists-debug-tease.md) | superintendent install when skill exists: Skill already exists … Use --debug for a stack trace — toolcraft … |
| 279 | open | **High** | Install / flags | [ux-superintendent-install-scope-vs-local-global.md](./ux-superintendent-install-scope-vs-local-global.md) | superintendent install --scope local/global (npm run dev help); experiment/pipeline use --local/--global — … |
| 280 | open | **High** | Superintendent / errors | [ux-superintendent-missing-path-double-error.md](./ux-superintendent-missing-path-double-error.md) | superintendent validate and complete without path print raw Commander missing required argument then design… |
| 281 | open | **High** | Superintendent / run / help / formatting | [ux-superintendent-run-help-options-split.md](./ux-superintendent-run-help-options-split.md) | `superintendent run --help` renders its options in two separate sections — "OPTIONS" (all caps, listing the… |
| 282 | open | **High** | Superintendent / kind errors | [ux-superintendent-validate-unclosed-tag.md](./ux-superintendent-validate-unclosed-tag.md) | superintendent validate docs/plans/32-agent-goal.md → Superintendent document is invalid (1 error): Unclose… |
| 283 | open | **High** | Superintendent | [ux-superintendent-validate-wrong-kind-unclosed-tag.md](./ux-superintendent-validate-wrong-kind-unclosed-tag.md) | superintendent validate on plan doc: Superintendent document is invalid — Error: Unclosed tag — parser nois… |
| 284 | open | **High** | Tasks / GitHub | [ux-tasks-get-github-401-raw-json-reconfirmed.md](./ux-tasks-get-github-401-raw-json-reconfirmed.md) | tasks get missing --yes: GitHub GraphQL 401 Bad credentials raw JSON — reconfirm GitHub auth UX class. |
| 285 | open | **High** | Tasks / GitHub | [ux-tasks-get-github-401-raw-json.md](./ux-tasks-get-github-401-raw-json.md) | tasks get missing-id fails with raw GitHub GraphQL 401 JSON Bad credentials — unframed auth error. |
| 286 | open | **High** | Tasks | [ux-tasks-github-401-raw-json-reconfirmed.md](./ux-tasks-github-401-raw-json-reconfirmed.md) | tasks get/next without valid GitHub auth dump [error] GitHub GraphQL request failed with status 401: { json… |
| 287 | open | **High** | Tasks / destructive | [ux-tasks-import-delete-source-dangerous.md](./ux-tasks-import-delete-source-dangerous.md) | tasks import has --delete-source to delete markdown after import and --keep — help does not emphasize irrev… |
| 288 | open | **High** | Tasks / destructive | [ux-tasks-move-delete-source-dangerous.md](./ux-tasks-move-delete-source-dangerous.md) | tasks move has --delete-source without documenting --yes requirement or irreversibility (same class as impo… |
| 289 | open | **High** | Tasks / GitHub | [ux-tasks-next-github-401-raw-json.md](./ux-tasks-next-github-401-raw-json.md) | tasks next some-id --yes fails with raw GraphQL 401 Bad credentials — unframed auth error. |
| 290 | open | **High** | Agents | [ux-test-and-install-reject-spawn-only-agents-as-unknown.md](./ux-test-and-install-reject-spawn-only-agents-as-unknown.md) | poe-agent/pi fail test/install with Unknown agent (false). |
| 291 | open | **High** | Test / errors | [ux-test-failure-dumps-jsonl.md](./ux-test-failure-dumps-jsonl.md) | test failure inlines hook JSONL flood. |
| 292 | open | **High** | Test / gemini | [ux-test-gemini-requires-native-api-key-not-poe.md](./ux-test-gemini-requires-native-api-key-not-poe.md) | test gemini fails: When using Gemini API, you must specify the GEMINI_API_KEY — does not use Poe auth after… |
| 293 | open | **High** | Test / kimi | [ux-test-kimi-invalid-config-provider-poe-not-found.md](./ux-test-kimi-invalid-config-provider-poe-not-found.md) | test kimi --model novitaai/kimi-k2.5 fails: Invalid configuration file … Provider poe not found in provider… |
| 294 | open | **High** | Test / kimi | [ux-test-kimi-provider-poe-not-found-reconfirmed.md](./ux-test-kimi-provider-poe-not-found-reconfirmed.md) | test kimi: Invalid configuration file ~/.kimi/config.toml — Provider poe not found in providers — reconfirm… |
| 295 | open | **High** | Test / kimi | [ux-test-kimi-yes-still-provider-poe-not-found.md](./ux-test-kimi-yes-still-provider-poe-not-found.md) | test kimi --yes without model still fails Provider poe not found in ~/.kimi/config.toml — --yes does not fi… |
| 296 | open | **High** | Test / non-TTY | [ux-test-nontty-demands-poe-no-prompt-not-yes.md](./ux-test-nontty-demands-poe-no-prompt-not-yes.md) | test without agent non-TTY: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 to accept defaults non-i… |
| 297 | open | **High** | Test / opencode | [ux-test-opencode-model-mapping-still-broken.md](./ux-test-opencode-model-mapping-still-broken.md) | test opencode --model anthropic/claude-haiku-4.5 still: Model not found: poe/anthropic/claude-haiku-4.5 wit… |
| 298 | open | **High** | Test / opencode | [ux-test-opencode-model-not-found-dumps-stack.md](./ux-test-opencode-model-not-found-dumps-stack.md) | test opencode --model anthropic/claude-haiku-4.5 fails: Model not found: poe/anthropic/claude-haiku-4.5 wit… |
| 299 | open | **High** | Test | [ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md](./ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md) | test --yes without agent defaults to claude-code; failure dumps long hook JSONL stdout and See logs — healt… |
| 300 | open | **High** | Help / identity | [ux-toolcraft-help-points-at-npm-run-dev.md](./ux-toolcraft-help-points-at-npm-run-dev.md) | Toolcraft groups bake monorepo invocation. |
| 301 | open | **High** | Help / identity | [ux-toolcraft-suggests-options-but-still-npm-run-dev.md](./ux-toolcraft-suggests-options-but-still-npm-run-dev.md) | Good option suggestions; wrong recovery footer. |
| 302 | open | **High** | Traces | [ux-traces-enoent-eisdir-still-system-errors.md](./ux-traces-enoent-eisdir-still-system-errors.md) | traces /tmp/no-such-trace.jsonl → ENOENT…; traces /tmp → EISDIR… + See logs — reconfirm of traces-missing-f… |
| 303 | open | **High** | Errors / consistency | [ux-traces-since-validation-cleaner-than-models.md](./ux-traces-since-validation-cleaner-than-models.md) | traces --since notaduration returns short Invalid duration for --since without stack; models --since notadu… |
| 304 | open | **High** | Dry-run | [ux-unconfigure-claude-dry-run-full-settings-dump.md](./ux-unconfigure-claude-dry-run-full-settings-dump.md) | unconfigure claude-code --dry-run shows full settings.json rewrite with hooks, permissions, plugins — not j… |
| 305 | open | **High** | Security / dry-run | [ux-unconfigure-goose-dry-run-still-prints-secrets.md](./ux-unconfigure-goose-dry-run-still-prints-secrets.md) | unconfigure goose --dry-run rewrites secrets.yaml with CUSTOM_POE_API_KEY: sk-poe-… — Critical secret leak … |
| 306 | open | **High** | Unconfigure / help | [ux-unconfigure-help-omits-yes-and-dry-run.md](./ux-unconfigure-help-omits-yes-and-dry-run.md) | unconfigure help only agent and -h — no --yes/--dry-run despite global dry-run and destructive unconfigure … |
| 307 | open | **High** | Unconfigure / capability | [ux-unconfigure-pi-unknown-not-spawn-only.md](./ux-unconfigure-pi-unknown-not-spawn-only.md) | unconfigure pi --dry-run: Unknown agent "pi" — same capability matrix gap as install/test. |
| 308 | open | **High** | Agents | [ux-unknown-agent-no-allow-list-or-suggestions.md](./ux-unknown-agent-no-allow-list-or-suggestions.md) | install/test/configure/unconfigure unknown agent say Unknown agent "notanagent" (+ See logs) without listin… |
| 309 | open | **High** | Errors / trust | [ux-user-errors-look-like-system-failures.md](./ux-user-errors-look-like-system-failures.md) | Recoverable errors thrown as Error; bootstrap See logs + errors.log. |
| 310 | open | **High** | Errors | [ux-validation-error-still-prints-stack.md](./ux-validation-error-still-prints-stack.md) | ValidationError paths dump stack + double-render. |
| 311 | open | Medium–High | Spawn / workspaces | [ux-github-cwd-clone-errors-unframed.md](./ux-github-cwd-clone-errors-unframed.md) | Bad locator raw git stderr. |
| 312 | open | Medium–High | Maestro | [ux-maestro-dry-run-hits-github-without-workflow.md](./ux-maestro-dry-run-hits-github-without-workflow.md) | Dry-run hits GraphQL 401 JSON. |
| 313 | open | Medium–High | Install / postinstall | [ux-postinstall-sync-skills-can-run-on-user-install.md](./ux-postinstall-sync-skills-can-run-on-user-install.md) | package.json postinstall: node scripts/postinstall-sync-skills.mjs — runs skill sync on every install unles… |
| 314 | open | Medium–High | Providers / tables | [ux-provider-list-table-layout-broken.md](./ux-provider-list-table-layout-broken.md) | `provider list` table breaks on multi-word provider names: `cloudflare` (full name `cloudflare-ai-gateway`)… |
| 315 | open | Medium–High | Runtime | [ux-runtime-jobs-stale-running-zombies.md](./ux-runtime-jobs-stale-running-zombies.md) | running since May. |
| 316 | open | Medium–High | Traces / privacy | [ux-traces-json-includes-full-prompt-titles.md](./ux-traces-json-includes-full-prompt-titles.md) | traces --json dumps title fields that can be entire memory-query prompts or long user messages — useful for… |
| 317 | open | Medium | Visual language | [ux-acp-stream-uses-success-glyph-for-partial-text.md](./ux-acp-stream-uses-success-glyph-for-partial-text.md) | Checkmark for partial text. |
| 318 | open | Medium | Spawn / timeouts | [ux-activity-timeout-ms-uses-system-chrome.md](./ux-activity-timeout-ms-uses-system-chrome.md) | spawn … --activity-timeout-ms 1 fails Agent spawn timed out after 0.001s of inactivity with See logs — time… |
| 319 | open | Medium | Agent / security / help accuracy | [ux-agent-api-key-and-stale-default-model.md](./ux-agent-api-key-and-stale-default-model.md) | `poe-code agent --help` has two issues: |
| 320 | open | Medium | Agent / security | [ux-agent-api-key-flag-on-help.md](./ux-agent-api-key-flag-on-help.md) | agent --help lists --api-key <key> — encourages passing secrets on CLI (history/process list leak class). |
| 321 | open | Medium | Agent | [ux-agent-empty-api-key-silently-uses-stored.md](./ux-agent-empty-api-key-silently-uses-stored.md) | agent "…" --api-key "" succeeds with tokens — empty api-key ignored, uses stored auth (same empty-flag class). |
| 322 | open | Medium | Agent | [ux-agent-empty-model-see-logs.md](./ux-agent-empty-model-see-logs.md) | agent --model "" → Missing model. Provide a non-empty model to createAgentSession + See logs — internal API… |
| 323 | open | Medium | Agent | [ux-agent-empty-prompt-see-logs.md](./ux-agent-empty-prompt-see-logs.md) | agent "" → Prompt must not be empty + See logs — message good, chrome wrong. |
| 324 | open | Medium | Agent | [ux-agent-invalid-model-system-chrome.md](./ux-agent-invalid-model-system-chrome.md) | 404 + logs. |
| 325 | open | Medium | Agent | [ux-agent-missing-prompt-raw-commander.md](./ux-agent-missing-prompt-raw-commander.md) | agent with no args: error: missing required argument prompt — raw commander. |
| 326 | open | Medium | Errors | [ux-agent-spawn-missing-args-raw-commander.md](./ux-agent-spawn-missing-args-raw-commander.md) | agent without prompt and spawn without agent print error: missing required argument without design-system f… |
| 327 | open | Medium | Auth / security | [ux-api-key-flags-encourage-shell-history-leaks.md](./ux-api-key-flags-encourage-shell-history-leaks.md) | Flags without history warning. |
| 328 | open | Medium | Approvals | [ux-approvals-invalid-state-silent-empty-reconfirmed.md](./ux-approvals-invalid-state-silent-empty-reconfirmed.md) | approvals list --state bogus returns No approvals found without invalid-state error — reconfirm. |
| 329 | open | Medium | Approvals | [ux-approvals-invalid-state-silent-empty.md](./ux-approvals-invalid-state-silent-empty.md) | nope looks empty queue. |
| 330 | open | Medium | Approvals | [ux-approvals-show-missing-task-debug-tease-reconfirmed.md](./ux-approvals-show-missing-task-debug-tease-reconfirmed.md) | approvals show --approval-id missing: Task "approvals/missing" not found. Use --debug for a stack trace — r… |
| 331 | open | Medium | Auth | [ux-auth-help-api-key-no-danger.md](./ux-auth-help-api-key-no-danger.md) | auth --help lists api-key Display stored API key with no danger/secret warning at group level. |
| 332 | open | Medium | Auth / login / security / shell history | [ux-auth-login-api-key-shell-history-risk.md](./ux-auth-login-api-key-shell-history-risk.md) | `poe-code auth login --api-key <key>` accepts the Poe API key as a positional CLI flag. Any value passed th… |
| 333 | open | Medium | Auth / visual | [ux-auth-status-spinner-pre-panel.md](./ux-auth-status-spinner-pre-panel.md) | `auth status` prints "Checking authentication..." at the left edge before (or outside) the panel bracket, n… |
| 334 | open | Medium | IA / install | [ux-binary-wrappers-undocumented.md](./ux-binary-wrappers-undocumented.md) | dist/bin wrappers no help map. |
| 335 | open | Medium | Braintrust | [ux-braintrust-only-status-no-enable.md](./ux-braintrust-only-status-no-enable.md) | braintrust --help only status; braintrust enable falls back to same help — no enable/disable surface despit… |
| 336 | open | Medium | Braintrust | [ux-braintrust-status-disabled-no-next-step.md](./ux-braintrust-status-disabled-no-next-step.md) | braintrust status: disabled — no how to enable, no env vars, no link to docs. |
| 337 | open | Medium | Spawn / otel | [ux-capture-otel-alone-silent-success.md](./ux-capture-otel-alone-silent-success.md) | spawn --capture-otel succeeds without confirming otel capture started or where data went — silent success f… |
| 338 | open | Medium | Spawn / flags | [ux-capture-otel-content-without-capture-silent.md](./ux-capture-otel-content-without-capture-silent.md) | spawn with --capture-otel-content alone succeeds without enabling otel capture or warning that --capture-ot… |
| 339 | open | Medium | Errors | [ux-code-review-double-error-skin.md](./ux-code-review-double-error-skin.md) | Raw + toolcraft both. |
| 340 | open | Medium | Code-review / identity | [ux-code-review-drafts-missing-prurl-double-error-npm-run-dev.md](./ux-code-review-drafts-missing-prurl-double-error-npm-run-dev.md) | code-review drafts without prUrl: missing required argument prUrl twice + npm run dev recovery — same class… |
| 341 | open | Medium | Code-review | [ux-code-review-drafts-not-found-debug-tease.md](./ux-code-review-drafts-not-found-debug-tease.md) | No active code review draft found for URL. Use --debug for a stack trace — not-found should not suggest deb… |
| 342 | open | Medium | Code-review | [ux-code-review-install-no-dry-run-force-writes.md](./ux-code-review-install-no-dry-run-force-writes.md) | code-review install --force creates profiles/prompts under .poe-code/code-review with word-wrapped path lis… |
| 343 | open | Medium | Code-review | [ux-code-review-install-output-unframed-wrapped.md](./ux-code-review-install-output-unframed-wrapped.md) | code-review install prints Lists Created with hard-wrapped absolute paths mid-word without design-system pa… |
| 344 | open | Medium | Code-review / identity | [ux-code-review-missing-prurl-npm-run-dev.md](./ux-code-review-missing-prurl-npm-run-dev.md) | code-review run without prUrl: missing required argument prUrl; Run npm run dev -- code-review run --help —… |
| 345 | open | Medium | Code-review | [ux-code-review-profiles-bare-table.md](./ux-code-review-profiles-bare-table.md) | code-review profiles prints bare name/source table (generic built-in) without Poe - code-review panel frami… |
| 346 | open | Medium | Code-review / identity | [ux-code-review-prompt-preview-missing-spawn-npm-run-dev.md](./ux-code-review-prompt-preview-missing-spawn-npm-run-dev.md) | prompt-preview without --spawn: Missing required parameter spawn + npm run dev recovery. |
| 347 | open | Medium | Code-review | [ux-code-review-prompt-preview-unframed.md](./ux-code-review-prompt-preview-unframed.md) | code-review prompt-preview dumps long prompt with Prompt preview header and toolcraft identity on help — sa… |
| 348 | open | Medium | Code-review / identity | [ux-code-review-run-missing-prurl-double-error-npm-run-dev.md](./ux-code-review-run-missing-prurl-double-error-npm-run-dev.md) | code-review run: missing required argument prUrl twice (raw commander + framed) and npm run dev recovery. |
| 349 | open | Medium | Errors / recovery | [ux-command-not-found-no-suggestions.md](./ux-command-not-found-no-suggestions.md) | confgure/skills/pipelne no suggestion. |
| 350 | open | Medium | Help / install | [ux-completion-command-missing.md](./ux-completion-command-missing.md) | completion / completion bash / --completion all unknown. No bash/zsh/fish completion install path. |
| 351 | open | Medium | Utils | [ux-config-edit-missing-editor-see-logs.md](./ux-config-edit-missing-editor-see-logs.md) | utils config edit without EDITOR: Set $EDITOR to use this command + See logs — clear message, system chrome. |
| 352 | open | Medium | Configure / security / credential exposure | [ux-configure-api-key-shell-history-risk.md](./ux-configure-api-key-shell-history-risk.md) | `poe-code configure --api-key <key>` accepts the Poe API key as a plaintext CLI flag. The key is then visib… |
| 353 | open | Medium | Dry-run | [ux-configure-codex-dry-run-full-config-flood.md](./ux-configure-codex-dry-run-full-config-flood.md) | configure codex --model openai/gpt-5.3-codex --yes --dry-run dumps large multi-profile config with migratio… |
| 354 | open | Medium | Dry-run | [ux-configure-codex-dry-run-still-floods-profiles.md](./ux-configure-codex-dry-run-still-floods-profiles.md) | configure codex --model openai/gpt-5.3-codex --yes --dry-run still dumps many profile/migration lines (gpt … |
| 355 | open | Medium | Configure / codex | [ux-configure-codex-reasoning-effort-medium-partial.md](./ux-configure-codex-reasoning-effort-medium-partial.md) | configure codex --reasoning-effort medium dry-run shows mixed model_reasoning_effort high and medium across… |
| 356 | open | Medium | Configure / cursor | [ux-configure-cursor-dry-run-no-filesystem-changes.md](./ux-configure-cursor-dry-run-no-filesystem-changes.md) | configure cursor --yes --dry-run: would configure Cursor; # no filesystem changes — success without showing… |
| 357 | open | Medium | Dry-run | [ux-configure-cursor-dry-run-too-quiet.md](./ux-configure-cursor-dry-run-too-quiet.md) | configure cursor and cursor-agent --yes --dry-run only print would configure Cursor / # no filesystem chang… |
| 358 | open | Medium | Configure | [ux-configure-cursor-model-flag-silent-noop.md](./ux-configure-cursor-model-flag-silent-noop.md) | configure cursor --model anthropic/claude-opus-4.7 --yes --dry-run still only says would configure / no fil… |
| 359 | open | Medium | Dry-run | [ux-configure-dry-run-floods-diff.md](./ux-configure-dry-run-floods-diff.md) | Huge settings diffs. |
| 360 | open | Medium | Configure / models | [ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md](./ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md) | configure with full catalog id rewrites via stripModelNamespace + replace dots with hyphens to claude-haiku… |
| 361 | open | Medium | Configure / kimi | [ux-configure-kimi-default-model-novitaai.md](./ux-configure-kimi-default-model-novitaai.md) | configure kimi --yes --dry-run defaults to novitaai/kimi-k2.5 — verify still in catalog; dry-run floods ful… |
| 362 | open | Medium | Configure / models | [ux-configure-kimi-ignores-explicit-novita-namespace.md](./ux-configure-kimi-ignores-explicit-novita-namespace.md) | Passing --model novitaai/kimi-k2.5 still dry-runs default_model = poe/kimi-k2.5 — explicit catalog-style id… |
| 363 | open | Medium | Configure | [ux-configure-provider-requires-model-without-listing-models.md](./ux-configure-provider-requires-model-without-listing-models.md) | When a provider requires an explicit model, configure errors Pass --model without listing available models,… |
| 364 | open | Medium | Configure | [ux-configure-yes-silent-default-agent.md](./ux-configure-yes-silent-default-agent.md) | Picks Claude without upfront line. |
| 365 | open | Medium | Dashboard / TUI | [ux-dashboard-keybindings-undocumented-on-cli-help.md](./ux-dashboard-keybindings-undocumented-on-cli-help.md) | Live dashboards support q quit and Ctrl+C forceQuit but --tui help only says Show a live dashboard without … |
| 366 | open | Medium | Help | [ux-doctor-and-completion-still-missing.md](./ux-doctor-and-completion-still-missing.md) | doctor and completion remain Unknown command — reconfirm doctor gap and completion gap. |
| 367 | open | Medium | Help | [ux-doctor-still-missing-reconfirmed.md](./ux-doctor-still-missing-reconfirmed.md) | doctor remains Unknown command with npm run dev help. |
| 368 | open | Medium | Editor | [ux-editor-error-still-system-chrome.md](./ux-editor-error-still-system-chrome.md) | Set $EDITOR + logs. |
| 369 | open | Medium | Auth | [ux-empty-api-key-flag-silently-ignored.md](./ux-empty-api-key-flag-silently-ignored.md) | --api-key '' falls back to stored key. |
| 370 | open | Medium | Plan list | [ux-empty-plan-kind-lists-still-draw-empty-tables.md](./ux-empty-plan-kind-lists-still-draw-empty-tables.md) | plan list --kind experiment/ralph/superintendent draws full empty table borders with no "No plans" message … |
| 371 | open | Medium | Spawn / flags | [ux-empty-resume-thread-id-silently-ignored.md](./ux-empty-resume-thread-id-silently-ignored.md) | spawn … --resume-thread-id "" succeeds as a fresh session — empty resume id not rejected (related empty-mod… |
| 372 | open | Medium | Eval | [ux-eval-empty-source-message-inconsistent-skins.md](./ux-eval-empty-source-message-inconsistent-skins.md) | eval check/lint print bare Eval source does not contain… lines; eval report uses design-system ■ Error for … |
| 373 | open | Medium | Help / identity | [ux-eval-help-npm-run-dev-identity.md](./ux-eval-help-npm-run-dev-identity.md) | eval and eval run help Usage: npm run dev -- eval … — identity leak; also toolcraft-style heading poe-code … |
| 374 | open | Medium | Eval | [ux-eval-init-bare-stdout-no-design-system.md](./ux-eval-init-bare-stdout-no-design-system.md) | eval init demo -C /tmp prints only: demo / next: poe-code eval check demo — no panel, no success glyph fram… |
| 375 | open | Medium | Help / identity | [ux-eval-init-help-npm-run-dev.md](./ux-eval-init-help-npm-run-dev.md) | eval init help Usage: npm run dev -- eval init — identity leak. |
| 376 | open | Medium | Eval | [ux-eval-init-name-validation-bare-text.md](./ux-eval-init-name-validation-bare-text.md) | eval init /tmp/ux-eval-test fails with bare Eval name must be kebab-case… without panel framing or examples… |
| 377 | open | Medium | Eval | [ux-eval-lint-check-empty-same-message.md](./ux-eval-lint-check-empty-same-message.md) | eval lint and eval check without evals: bare Eval source does not contain any first-level eval.yaml — no de… |
| 378 | open | Medium | Eval | [ux-eval-report-empty-debug-tease.md](./ux-eval-report-empty-debug-tease.md) | eval report with no evals: does not contain any first-level eval.yaml. Use --debug for a stack trace. |
| 379 | open | Medium | Eval / identity | [ux-eval-run-missing-params-npm-run-dev.md](./ux-eval-run-missing-params-npm-run-dev.md) | eval run without agent/model: 2 parameter errors … Run npm run dev -- eval run --help — toolcraft-style hel… |
| 380 | open | Medium | Eval / suggestions | [ux-eval-unknown-command-suggests-lint-for-list.md](./ux-eval-unknown-command-suggests-lint-for-list.md) | eval list is not a command; error Did you mean: lint? which is a poor suggestion for list (distance match w… |
| 381 | open | Medium | Experiment / journal / error message / discoverability | [ux-experiment-journal-error-when-no-doc-provided.md](./ux-experiment-journal-error-when-no-doc-provided.md) | `experiment journal [doc]` lists `[doc]` as an optional argument in `experiment --help`. However, running `… |
| 382 | open | Medium | Gaslight | [ux-gaslight-config-missing-enoent-system-chrome.md](./ux-gaslight-config-missing-enoent-system-chrome.md) | gaslight --config /tmp/no-gaslight.yaml: ENOENT open + See logs — should be ValidationError config not found. |
| 383 | open | Medium | Gaslight | [ux-gaslight-config-missing-enoent.md](./ux-gaslight-config-missing-enoent.md) | Raw ENOENT. |
| 384 | open | Medium | Gaslight | [ux-gaslight-install-force-dry-run-vs-already-exists.md](./ux-gaslight-install-force-dry-run-vs-already-exists.md) | gaslight install --local --force --dry-run says Would create gaslight.yaml; without --force dry-run says al… |
| 385 | open | Medium | Gaslight | [ux-gaslight-install-force-overwrites-without-diff.md](./ux-gaslight-install-force-overwrites-without-diff.md) | gaslight install --local --force overwrites gaslight.yaml and says Installed without dry-run of content cha… |
| 386 | open | Medium | Gaslight | [ux-gaslight-missing-plan-system-chrome-reconfirmed.md](./ux-gaslight-missing-plan-system-chrome-reconfirmed.md) | gaslight /tmp/missing.yaml: Plan file not found + See logs — reconfirm ValidationError gap. |
| 387 | open | Medium | Gaslight | [ux-gaslight-multi-plan-fails-fast-with-success-markers.md](./ux-gaslight-multi-plan-fails-fast-with-success-markers.md) | Multi-plan gaslight fails first plan with ✓ agent API error and message plan 1/2 … failed without summarizi… |
| 388 | open | Medium | Gaslight / safety | [ux-gaslight-no-activity-timeout-flag.md](./ux-gaslight-no-activity-timeout-flag.md) | Long gaslight runs cannot set activity timeout from CLI though spawn supports --activity-timeout-ms; users … |
| 389 | open | Medium | Naming | [ux-gaslight-opaque-naming.md](./ux-gaslight-opaque-naming.md) | Root gaslight no plain gloss. |
| 390 | open | Medium | Gaslight / Pipeline | [ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md](./ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md) | Both gaslight and pipeline have --archive and --no-archive but help does not state default archive behavior… |
| 391 | open | Medium | Gaslight / naming | [ux-gaslight-unknown-agent-says-service.md](./ux-gaslight-unknown-agent-says-service.md) | Says service not agent. |
| 392 | open | Medium | Gaslight / help / discoverability | [ux-gaslight-yes-not-in-options.md](./ux-gaslight-yes-not-in-options.md) | `gaslight --help` does not list `--yes` as a standalone option. Like `spawn`, it is referenced only indirec… |
| 393 | open | Medium | Dry-run | [ux-gemini-configure-dry-run-too-quiet.md](./ux-gemini-configure-dry-run-too-quiet.md) | configure gemini --yes --dry-run only shows Gemini model resolved line and would configure without listing … |
| 394 | open | Medium | GitHub workflows | [ux-gh-install-dry-run-lists-paths-without-panel.md](./ux-gh-install-dry-run-lists-paths-without-panel.md) | github-workflows install --dry-run prints bare workflow paths and would write messages without panel framin… |
| 395 | open | Medium | GitHub workflows | [ux-gh-install-preview-without-dry-run-flag.md](./ux-gh-install-preview-without-dry-run-flag.md) | gh install fix-vulnerabilities (with --dry-run passed) showed would be written paths and eject tip — previe… |
| 396 | open | Medium | GitHub workflows | [ux-gh-prompt-preview-dumps-long-unframed-prompt.md](./ux-gh-prompt-preview-dumps-long-unframed-prompt.md) | github-workflows prompt-preview prints multi-section prompt body without design-system framing or --json op… |
| 397 | open | Medium | Help | [ux-global-flags-hidden-on-subcommand-help.md](./ux-global-flags-hidden-on-subcommand-help.md) | --yes/--dry-run/--verbose missing on most help. |
| 398 | open | Medium | Help / product gaps | [ux-goal-chat-acp-commands-missing.md](./ux-goal-chat-acp-commands-missing.md) | goal, chat, acp are Unknown command — agent-goal plan documents goal CLI but commands not registered; chat/… |
| 399 | open | Medium | First-run | [ux-group-commands-print-help-only.md](./ux-group-commands-print-help-only.md) | pipeline bare help only. |
| 400 | open | Medium | Harness | [ux-harness-list-no-dir-flag.md](./ux-harness-list-no-dir-flag.md) | harness new supports --dir; harness list --dir is unknown — cannot list pairs created outside default searc… |
| 401 | open | Medium | Harness | [ux-harness-list-only-cwd-not-created-dir.md](./ux-harness-list-only-cwd-not-created-dir.md) | harness new … --dir /tmp/h4 creates pair successfully; harness list still says No harness pairs found becau… |
| 402 | open | Medium | Harness | [ux-harness-missing-file-system-chrome.md](./ux-harness-missing-file-system-chrome.md) | Good message + See logs. |
| 403 | open | Medium | Harness | [ux-harness-new-unknown-kind-no-list.md](./ux-harness-new-unknown-kind-no-list.md) | harness new not-a-kind foo: Unknown harness template "not-a-kind" — no list of valid kinds; harness new --h… |
| 404 | open | Medium | Harness | [ux-harness-new-unknown-template-no-kinds-reconfirmed.md](./ux-harness-new-unknown-template-no-kinds-reconfirmed.md) | harness new bogus-kind x: Unknown harness template "bogus-kind" — no list of valid kinds; help says Built-i… |
| 405 | open | Medium | Harness | [ux-harness-run-missing-file-system-chrome.md](./ux-harness-run-missing-file-system-chrome.md) | Missing harness md file: path + See logs — good message, unnecessary logs. |
| 406 | open | Medium | Harness | [ux-harness-run-success-opaque-result-object.md](./ux-harness-run-success-opaque-result-object.md) | Successful harness run prints Result: object · kind, version, message, numbers, branches, +1 more — interna… |
| 407 | open | Medium | Harness | [ux-harness-unknown-template-still-omits-kind-list.md](./ux-harness-unknown-template-still-omits-kind-list.md) | Unknown harness template "notakind" still prints only that message without listing ralph-demo, coverage-dem… |
| 408 | open | Medium | Help | [ux-help-command-not-registered.md](./ux-help-command-not-registered.md) | help not registered. |
| 409 | open | Medium | IA | [ux-hidden-and-orphan-commands.md](./ux-hidden-and-orphan-commands.md) | memory-mcp top-level; agent vs spawn poe-agent. |
| 410 | open | Medium | Hooks / spawn | [ux-hooks-bridge-refuse-user-authored-file-opaque.md](./ux-hooks-bridge-refuse-user-authored-file-opaque.md) | spawn with --hooks-from/--hooks-scope can fail with Refuse to replace user-authored hook file at …/settings… |
| 411 | open | Medium | Spawn / hooks | [ux-hooks-from-unsupported-system-chrome.md](./ux-hooks-from-unsupported-system-chrome.md) | Allow-list + See logs. |
| 412 | open | Medium | Hooks | [ux-hooks-scope-project-same-refuse-as-symlink.md](./ux-hooks-scope-project-same-refuse-as-symlink.md) | --hooks-from claude-code --hooks-scope project fails same Refuse to replace user-authored hook file — scope… |
| 413 | open | Medium | Help / IA | [ux-important-commands-absent-from-root-help.md](./ux-important-commands-absent-from-root-help.md) | skill/memory/provider missing no show-all. |
| 414 | open | Medium | Install | [ux-install-always-success-reconfirmed.md](./ux-install-always-success-reconfirmed.md) | install claude-code when already installed still says Installed Claude Code without version/already-present… |
| 415 | open | Medium | Install | [ux-install-help-missing-yes-and-list.md](./ux-install-help-missing-yes-and-list.md) | install --help only -h; no --yes documented though it works; --list unknown. Agent list only in argument de… |
| 416 | open | Medium | Install | [ux-install-help-no-force-or-options.md](./ux-install-help-no-force-or-options.md) | install help only agent arg and -h — no --force, --yes, dry-run notes; install opencode --yes works but und… |
| 417 | open | Medium | Install | [ux-install-yes-defaults-agent-silently.md](./ux-install-yes-defaults-agent-silently.md) | install --yes without agent installs Claude Code without stating default selection policy in the first line. |
| 418 | open | Medium | Scripting | [ux-json-flag-inconsistent-across-commands.md](./ux-json-flag-inconsistent-across-commands.md) | Some commands only. |
| 419 | open | Medium | Configure / models | [ux-kimi-default-model-id-mismatches-catalog-namespace.md](./ux-kimi-default-model-id-mismatches-catalog-namespace.md) | configure kimi dry-run plans default_model = poe/kimi-k2.5 while models catalog lists novita ai/kimi-k2.5. … |
| 420 | open | Medium | Launch / dev UX | [ux-launch-commands-trigger-full-turbo-rebuild.md](./ux-launch-commands-trigger-full-turbo-rebuild.md) | Invoking launch through npm run dev / predev runs turbo build across 68 packages before the command, adding… |
| 421 | open | Medium | Launch | [ux-launch-missing-process-system-chrome.md](./ux-launch-missing-process-system-chrome.md) | Managed process "missing" was not found + See logs for launch logs/restart. |
| 422 | open | Medium | Launch | [ux-launch-restart-missing-see-logs.md](./ux-launch-restart-missing-see-logs.md) | launch restart missing: Managed process was not found + See logs. |
| 423 | open | Medium | Launch | [ux-launch-rm-stale-state-removed-id-opaque.md](./ux-launch-rm-stale-state-removed-id-opaque.md) | launch rm - hits Invalid managed process specification for ".state-removed-foo-…" + See logs — leftover tom… |
| 424 | open | Medium | Launch | [ux-launch-start-opaque-failure.md](./ux-launch-start-opaque-failure.md) | Missing -- → failed to start. |
| 425 | open | Medium | Launch | [ux-launch-start-via-npm-run-dev-confuses-argv.md](./ux-launch-start-via-npm-run-dev-confuses-argv.md) | launch start can mis-parse process ids and commands when invoked through npm run dev (turbo predev noise, s… |
| 426 | open | Medium | Spawn / logging | [ux-log-content-flag-no-danger-warning.md](./ux-log-content-flag-no-danger-warning.md) | spawn --log-content help only says Include message and tool content in ACP JSONL spawn logs — no warning th… |
| 427 | open | Medium | Privacy | [ux-log-content-flags-underwarn-sensitive-data.md](./ux-log-content-flags-underwarn-sensitive-data.md) | --log-content no PII warning. |
| 428 | open | Medium | Spawn / security | [ux-log-content-help-underwarns-reconfirmed.md](./ux-log-content-help-underwarns-reconfirmed.md) | Help only says Include message and tool content in ACP JSONL spawn logs without security warning; default r… |
| 429 | open | Medium | Spawn / logging | [ux-log-file-name-no-path-feedback.md](./ux-log-file-name-no-path-feedback.md) | spawn … --log-file-name ux-probe.jsonl succeeds but file not at ~/.poe-code/logs/ux-probe.jsonl — no path f… |
| 430 | open | Medium | Auth / help | [ux-login-help-omits-interactive-and-yes.md](./ux-login-help-omits-interactive-and-yes.md) | login help only lists --api-key and -h; does not document interactive OAuth browser flow, non-TTY requireme… |
| 431 | open | Medium | Auth / help | [ux-login-help-omits-oauth-default.md](./ux-login-help-omits-oauth-default.md) | Only --api-key documented. |
| 432 | open | Medium | Auth | [ux-login-help-still-minimal.md](./ux-login-help-still-minimal.md) | login --help only --api-key and -h — no --yes, no note that non-TTY without key hangs/OAuth, no env POE_API… |
| 433 | open | Medium | Auth | [ux-login-rejected-no-recovery.md](./ux-login-rejected-no-recovery.md) | API key rejected only. |
| 434 | open | Medium | Maestro | [ux-maestro-config-vs-workflow-flags-duplicated.md](./ux-maestro-config-vs-workflow-flags-duplicated.md) | maestro tui accepts --config and --workflow for WORKFLOW.md and errors if both set — duplicate flags for on… |
| 435 | open | Medium | Maestro | [ux-maestro-tick-missing-task-raw-commander.md](./ux-maestro-tick-missing-task-raw-commander.md) | maestro tick --yes: error: required option --task not specified — raw commander; --yes ignored for required… |
| 436 | open | Medium | Maestro | [ux-maestro-tick-missing-transition-raw-commander.md](./ux-maestro-tick-missing-transition-raw-commander.md) | maestro tick --task foo fails error: required option --transition not specified without design-system framing. |
| 437 | open | Medium | Maestro | [ux-maestro-tui-duplicate-config-workflow-flags.md](./ux-maestro-tui-duplicate-config-workflow-flags.md) | maestro tui --help lists --config Path to WORKFLOW.md and --workflow Path to WORKFLOW.md — duplicate flags … |
| 438 | open | Medium | First-run | [ux-many-parent-groups-only-dump-help.md](./ux-many-parent-groups-only-dump-help.md) | Beyond pipeline/experiment/ralph, bare invocations of skill, memory, provider, runtime, launch, worktree, u… |
| 439 | open | Medium | Plan | [ux-markdown-read-depth-1-empty-for-h1-only-structure.md](./ux-markdown-read-depth-1-empty-for-h1-only-structure.md) | markdown-read --depth 1 on agent-goal plan shows sections (none) because headings may be ## only — depth se… |
| 440 | open | Medium | Memory | [ux-memory-cache-clear-help-omits-yes-reconfirmed.md](./ux-memory-cache-clear-help-omits-yes-reconfirmed.md) | memory cache clear help has --older-than and -h only; prior probe required --yes for clear. Help gap remains. |
| 441 | open | Medium | Destructive | [ux-memory-clear-help-still-no-force-or-yes.md](./ux-memory-clear-help-still-no-force-or-yes.md) | memory clear --help still only shows -h/--help despite being fully destructive when initialized. |
| 442 | open | Medium | Destructive | [ux-memory-clear-no-confirmation.md](./ux-memory-clear-no-confirmation.md) | Destructive no confirm. |
| 443 | open | Medium | Memory | [ux-memory-ingest-enoent-system-chrome.md](./ux-memory-ingest-enoent-system-chrome.md) | memory ingest /tmp/no-such-file: ENOENT open path + See logs — should be ValidationError source not found. |
| 444 | open | Medium | Memory / install | [ux-memory-install-already-exists-system-chrome.md](./ux-memory-install-already-exists-system-chrome.md) | memory install when skill exists fails with Skill already exists: path and See logs, without --force guidan… |
| 445 | open | Medium | Memory | [ux-memory-install-no-force-already-exists.md](./ux-memory-install-no-force-already-exists.md) | memory install --agent claude --skill-only fails Skill already exists … See logs; no --force on help; reins… |
| 446 | open | Medium | Memory | [ux-memory-install-requires-agent-raw-commander.md](./ux-memory-install-requires-agent-raw-commander.md) | memory install without --agent: error: required option '--agent <agent>' not specified — raw commander, not… |
| 447 | open | Medium | Memory | [ux-memory-ls-search-show-raw-unframed.md](./ux-memory-ls-search-show-raw-unframed.md) | memory ls/search/show/lint/write still dump raw text without design-system panels (except init) — reconfirm… |
| 448 | open | Medium | Memory | [ux-memory-mcp-print-config-command-missing.md](./ux-memory-mcp-print-config-command-missing.md) | memory mcp, mcp-print, print-config are unknown; if docs/README mention them they are stale. memory install… |
| 449 | open | Medium | Memory | [ux-memory-query-may-hang-or-stall.md](./ux-memory-query-may-hang-or-stall.md) | memory query "what is this" --yes after init did not return quickly in batch; may hang on agent spawn witho… |
| 450 | open | Medium | Memory | [ux-memory-query-no-model-flag.md](./ux-memory-query-no-model-flag.md) | memory query --help has --budget and --agent but no --model — cannot fix stale default model for memory age… |
| 451 | open | Medium | Memory | [ux-memory-write-requires-reason-before-path.md](./ux-memory-write-requires-reason-before-path.md) | memory write without args fails on required option --reason before missing path argument — wrong recovery o… |
| 452 | open | Medium | Memory | [ux-memory-write-requires-reason-raw-commander.md](./ux-memory-write-requires-reason-raw-commander.md) | memory write without --reason prints raw error: required option '--reason <text>' not specified instead of … |
| 453 | open | Medium | Memory | [ux-memory-write-success-is-raw-unframed.md](./ux-memory-write-success-is-raw-unframed.md) | After memory write, stdout dumps frontmatter/body and path:line snippets without design-system success pane… |
| 454 | open | Medium | Configure / models | [ux-model-id-namespace-stripping-surprises.md](./ux-model-id-namespace-stripping-surprises.md) | configure --model anthropic/claude-sonnet-4.6 dry-run writes model as claude-sonnet-4-6 (dots to hyphens / … |
| 455 | open | Medium | Models | [ux-models-dumps-full-catalog.md](./ux-models-dumps-full-catalog.md) | 300+ rows default. |
| 456 | open | Medium | Models | [ux-models-empty-search-returns-all.md](./ux-models-empty-search-returns-all.md) | Empty string filters are treated as no filter (341/341) rather than validation error — easy footgun in scri… |
| 457 | open | Medium | Models | [ux-models-feature-bogus-silent-empty.md](./ux-models-feature-bogus-silent-empty.md) | Invalid feature name returns 0 models / No models match rather than invalid feature error — reconfirm of si… |
| 458 | open | Medium | Models | [ux-models-feature-flag-not-repeatable.md](./ux-models-feature-flag-not-repeatable.md) | models --feature tools --feature reasoning does not AND features; Commander keeps a single string so the la… |
| 459 | open | Medium | Models | [ux-models-input-bogus-silent-empty.md](./ux-models-input-bogus-silent-empty.md) | Invalid input modality returns 0 models without listing valid modalities text/image/audio/video. |
| 460 | open | Medium | Models | [ux-models-invalid-feature-silent-empty-reconfirmed.md](./ux-models-invalid-feature-silent-empty-reconfirmed.md) | models --feature bogus → 0/341 No models match — no error that feature is invalid (related invalid modality… |
| 461 | open | Medium | Models | [ux-models-invalid-feature-silent-empty.md](./ux-models-invalid-feature-silent-empty.md) | --feature notreal → 0/341. |
| 462 | open | Medium | Models | [ux-models-invalid-modality-silent-empty.md](./ux-models-invalid-modality-silent-empty.md) | --input smell → 0/341. |
| 463 | open | Medium | Models | [ux-models-search-claude-slash-zero.md](./ux-models-search-claude-slash-zero.md) | models --search "claude/" → 0/341 while claude models exist — slash confuses substring match for namespaced… |
| 464 | open | Medium | Models | [ux-models-view-invalid-uses-raw-commander.md](./ux-models-view-invalid-uses-raw-commander.md) | Invalid --view value uses Commander option argument is invalid. Allowed choices… while other models validat… |
| 465 | open | Medium | Models | [ux-models-view-parameters-without-filter-floods.md](./ux-models-view-parameters-without-filter-floods.md) | models --view parameters without --model/--search dumps parameters for entire catalog (starts with random m… |
| 466 | open | Medium | First-run / diagnostics | [ux-no-doctor-or-health-overview-command.md](./ux-no-doctor-or-health-overview-command.md) | There is no poe-code doctor (or similar) that summarizes auth status, configured agents, stale models, prov… |
| 467 | open | Medium | Configure / models | [ux-opencode-model-flag-still-triple-namespace.md](./ux-opencode-model-flag-still-triple-namespace.md) | configure opencode --model anthropic/claude-opus-4.7 still plans poe/anthropic/claude-opus-4.7 — reconfirm … |
| 468 | open | Medium | Configure / models | [ux-opencode-model-triple-namespace.md](./ux-opencode-model-triple-namespace.md) | configure opencode dry-run plans model poe/anthropic/claude-opus-4.7 — a third namespace style (poe/owner/m… |
| 469 | open | Medium | Pipeline | [ux-pipeline-init-help-omits-yes.md](./ux-pipeline-init-help-omits-yes.md) | pipeline init help has agent/model/source/sources only — no --yes for non-TTY generator runs. |
| 470 | open | Medium | Pipeline | [ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md](./ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md) | Good validation Problems first. |
| 471 | open | Medium | Pipeline / install | [ux-pipeline-install-claims-success-when-all-skipped.md](./ux-pipeline-install-claims-success-when-all-skipped.md) | pipeline install when steps.yaml and skill already exist: Skip both; then Installed Pipeline skill… success… |
| 472 | open | Medium | Pipeline | [ux-pipeline-nothing-to-run-success-framing.md](./ux-pipeline-nothing-to-run-success-framing.md) | pipeline run on fully done plan prints Nothing to run, Pipeline run finished success, and Problems? footer … |
| 473 | open | Medium | Pipeline / TUI | [ux-pipeline-tui-flag-ignored-on-init-failure.md](./ux-pipeline-tui-flag-ignored-on-init-failure.md) | pipeline run --tui still shows non-dashboard failure path with success markers and Problems-before-error wh… |
| 474 | open | Medium | Pipeline | [ux-pipeline-validate-enoent-system-error.md](./ux-pipeline-validate-enoent-system-error.md) | System chrome. |
| 475 | open | Medium | Pipeline | [ux-pipeline-validate-no-json-flag.md](./ux-pipeline-validate-no-json-flag.md) | pipeline validate --json is unknown option — cannot machine-parse validation results. |
| 476 | open | Medium | Pipeline | [ux-pipeline-validate-wrong-kind-see-logs.md](./ux-pipeline-validate-wrong-kind-see-logs.md) | pipeline validate on plan kind: Invalid plan YAML: "kind" must be "pipeline" + See logs — kind-aware messag… |
| 477 | open | Medium | Pipeline | [ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md](./ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md) | pipeline validate on agent-goal plan: Invalid plan YAML: "kind" must be "pipeline" + See logs — kind-aware … |
| 478 | open | Medium | Pipeline | [ux-pipeline-validate-wrong-kind-system-chrome.md](./ux-pipeline-validate-wrong-kind-system-chrome.md) | kind must be pipeline + See logs. |
| 479 | open | Medium | Plan browser | [ux-plan-archive-allows-readme.md](./ux-plan-archive-allows-readme.md) | Would archive README.md. |
| 480 | open | Medium | Plan browser | [ux-plan-browse-non-tty-dumps-first-plan.md](./ux-plan-browse-non-tty-dumps-first-plan.md) | plan browse without a TTY prints a full rendered plan (first/selected) rather than an error, list, or expli… |
| 481 | open | Medium | Plan | [ux-plan-browse-rejects-path-argument.md](./ux-plan-browse-rejects-path-argument.md) | plan browse docs/plans/32-agent-goal.md fails error: too many arguments for browse. Expected 0 — users expe… |
| 482 | open | Medium | Docs / CLI sync | [ux-plan-docs-advertise-goal-and-chat-commands-missing.md](./ux-plan-docs-advertise-goal-and-chat-commands-missing.md) | Plan content (e.g. agent-goal plan) documents `poe-code goal …` and `poe-code chat` slash surfaces, but CLI… |
| 483 | open | Medium | Plan / editor | [ux-plan-edit-editor-true-claims-edited-without-change.md](./ux-plan-edit-editor-true-claims-edited-without-change.md) | EDITOR=true plan edit reports Edited path even when true is a no-op binary — success without change detection. |
| 484 | open | Medium | Plan / help / formatting / discoverability | [ux-plan-help-stacked-layout-and-internal-commands.md](./ux-plan-help-stacked-layout-and-internal-commands.md) | `plan --help` has two issues: |
| 485 | open | Medium | Plan install | [ux-plan-install-help-omits-yes-but-accepts-yes.md](./ux-plan-install-help-omits-yes-but-accepts-yes.md) | plan install --help has agent/local/global only; plan install --yes --local works and installs skill withou… |
| 486 | open | Medium | Plan / install | [ux-plan-install-no-force-flag.md](./ux-plan-install-no-force-flag.md) | plan install rejects --force as unknown option while experiment/pipeline have --force — inconsistent instal… |
| 487 | open | Medium | Plan install | [ux-plan-install-unsupported-agent-pi-kimi.md](./ux-plan-install-unsupported-agent-pi-kimi.md) | plan install --agent pi/kimi --local --yes: Unsupported agent — no capability matrix message; pi is spawn-o… |
| 488 | open | Medium | Plan / install | [ux-plan-install-yes-defaults-claude-writes-skill.md](./ux-plan-install-yes-defaults-claude-writes-skill.md) | plan install --yes (no agent) defaults to claude-code local and Creates SKILL.md — silent default; no --for… |
| 489 | open | Medium | Plan / list / table layout / visual | [ux-plan-list-broken-two-line-row-layout.md](./ux-plan-list-broken-two-line-row-layout.md) | `poe-code plan list` renders a table where each plan entry occupies two visual rows — the Kind value appear… |
| 490 | open | Medium | Plan list | [ux-plan-list-empty-experiment-table-reconfirmed.md](./ux-plan-list-empty-experiment-table-reconfirmed.md) | plan list --kind experiment draws empty table without No experiment plans message. |
| 491 | open | Medium | Plan list | [ux-plan-list-empty-kind-table-reconfirmed.md](./ux-plan-list-empty-kind-table-reconfirmed.md) | plan list --kind superintendent draws empty table chrome without No plans message — reconfirm. |
| 492 | open | Medium | Plan list | [ux-plan-list-empty-ralph-table-reconfirmed.md](./ux-plan-list-empty-ralph-table-reconfirmed.md) | plan list --kind ralph draws empty table borders without No ralph plans message. |
| 493 | open | Medium | Plan list | [ux-plan-list-empty-superintendent-base-table-reconfirmed.md](./ux-plan-list-empty-superintendent-base-table-reconfirmed.md) | plan list --kind superintendent-base draws empty table chrome without No plans message. |
| 494 | open | Medium | Plan list | [ux-plan-list-includes-exactly-one-readme.md](./ux-plan-list-includes-exactly-one-readme.md) | plan list --output json has 11 plans including 1 README.md — reconfirm noise file in list. |
| 495 | open | Medium | Plan browser | [ux-plan-list-includes-noise-files.md](./ux-plan-list-includes-noise-files.md) | README.md listed as plan. |
| 496 | open | Medium | Plan list | [ux-plan-list-includes-readme-reconfirmed.md](./ux-plan-list-includes-readme-reconfirmed.md) | plan list --kind plan shows README.md Active Plans among plans — reconfirm noise file in list. |
| 497 | open | Medium | Plan list | [ux-plan-list-json-includes-readme-reconfirmed.md](./ux-plan-list-json-includes-readme-reconfirmed.md) | plan list --output json has 11 entries including README.md — reconfirm noise. |
| 498 | open | Medium | Plan list | [ux-plan-list-md-includes-readme-noise.md](./ux-plan-list-md-includes-readme-noise.md) | plan list --kind plan --output md includes README.md Active Plans row — reconfirm plan-list-includes-noise-… |
| 499 | open | Medium | Plan list | [ux-plan-list-md-includes-readme-reconfirmed.md](./ux-plan-list-md-includes-readme-reconfirmed.md) | plan list --kind plan --output md includes README.md Active Plans among plans — noise file still present. |
| 500 | open | Medium | Plan | [ux-plan-markdown-read-depth-zero-shows-no-sections.md](./ux-plan-markdown-read-depth-zero-shows-no-sections.md) | plan markdown-read with --depth 1 on a plan whose headings start at depth 2-style numbering may print secti… |
| 501 | open | Medium | Plan | [ux-plan-markdown-read-section-wrong-command-hint.md](./ux-plan-markdown-read-section-wrong-command-hint.md) | When section match fails, error says try read-markdown to see TOC, but the actual command is plan markdown-… |
| 502 | open | Medium | Plan | [ux-plan-markdown-read-section-wrong-hint-reconfirmed.md](./ux-plan-markdown-read-section-wrong-hint-reconfirmed.md) | Reconfirmed: no section matching still says try read-markdown (wrong command name). |
| 503 | open | Medium | Plan | [ux-plan-markdown-read-system-chrome.md](./ux-plan-markdown-read-system-chrome.md) | file not found + logs. |
| 504 | open | Medium | Plan | [ux-plan-non-tty-unclear-failure.md](./ux-plan-non-tty-unclear-failure.md) | plan question bare 400. |
| 505 | open | Medium | Plan | [ux-plan-question-starts-session-without-mode.md](./ux-plan-question-starts-session-without-mode.md) | plan "test plan question only" --yes printed What do you want to build? and began session — multi-word with… |
| 506 | open | Medium | Plan | [ux-plan-view-json-dumps-full-content.md](./ux-plan-view-json-dumps-full-content.md) | plan view --output json includes entire content string of the plan body — huge payload for scripts that onl… |
| 507 | open | Medium | Plan | [ux-plan-view-vs-markdown-read-not-found-inconsistent.md](./ux-plan-view-vs-markdown-read-not-found-inconsistent.md) | plan view missing.md → Plan not found: missing.md (clean, no logs). plan markdown-read missing.md → file no… |
| 508 | open | Medium | Help | [ux-primary-commands-lack-examples-in-help.md](./ux-primary-commands-lack-examples-in-help.md) | models has Examples; configure/spawn do not. |
| 509 | open | Medium | Help | [ux-primary-commands-still-lack-examples.md](./ux-primary-commands-still-lack-examples.md) | spawn, configure, and gaslight --help still have no Examples section while models --help is best-in-class w… |
| 510 | open | Medium | Providers | [ux-provider-list-agents-column-incomplete.md](./ux-provider-list-agents-column-incomplete.md) | Omits spawn-only agents. |
| 511 | open | Medium | Providers | [ux-provider-list-agents-column-truncates.md](./ux-provider-list-agents-column-truncates.md) | provider list cloudflare Agents cell ends with poe-… truncation — full agent list not visible without wide … |
| 512 | open | Medium | Providers | [ux-provider-list-no-json-flag.md](./ux-provider-list-no-json-flag.md) | provider list --json is unknown; only design-system table available for scripting. |
| 513 | open | Medium | Provider auth / security | [ux-provider-login-api-key-flag-history-risk.md](./ux-provider-login-api-key-flag-history-risk.md) | `provider login --help` lists `--api-key <key>` as a first-class option. Passing secrets via CLI args leaks… |
| 514 | open | Medium | Provider auth | [ux-provider-login-missing-key-system-chrome.md](./ux-provider-login-missing-key-system-chrome.md) | Good message + logs. |
| 515 | open | Medium | Workflows | [ux-ralph-experiment-wrong-kind-says-not-found.md](./ux-ralph-experiment-wrong-kind-says-not-found.md) | Existing plan wrong kind. |
| 516 | open | Medium | Ralph | [ux-ralph-run-help-omits-yes.md](./ux-ralph-run-help-omits-yes.md) | ralph run help has agent/iterations/cwd/archive/tui/worktree/runtime/detach — no --yes for non-TTY. |
| 517 | open | Medium | Ralph | [ux-ralph-validate-command-missing.md](./ux-ralph-validate-command-missing.md) | ralph validate unknown command while experiment/superintendent/pipeline have validate. |
| 518 | open | Medium | Errors | [ux-raw-commander-invalid-option-choices.md](./ux-raw-commander-invalid-option-choices.md) | --view nope raw. |
| 519 | open | Medium | Errors | [ux-raw-commander-missing-args.md](./ux-raw-commander-missing-args.md) | unconfigure/wrap missing agent raw error. |
| 520 | open | Medium | Docs / CLI sync | [ux-readme-features-wrap-but-cli-missing.md](./ux-readme-features-wrap-but-cli-missing.md) | README wrap quickstart removed; wrap CLI residual (muscle memory / external docs) |
| 521 | open | Medium | Configure | [ux-reasoning-effort-flag-opaque.md](./ux-reasoning-effort-flag-opaque.md) | No validation/examples. |
| 522 | open | Medium | Spawn | [ux-resume-thread-errors-are-agent-raw.md](./ux-resume-thread-errors-are-agent-raw.md) | Long agent usage text. |
| 523 | open | Medium | Spawn | [ux-resume-thread-invalid-agent-raw-error.md](./ux-resume-thread-invalid-agent-raw-error.md) | spawn --resume-thread-id not-a-real-id fails with long Claude Code usage text about UUID/session title + Se… |
| 524 | open | Medium | Help | [ux-root-typo-confgure-spwn-no-suggestions-reconfirmed.md](./ux-root-typo-confgure-spwn-no-suggestions-reconfirmed.md) | confgure and spwn → Unknown command + npm run dev help — no Did you mean configure/spawn. |
| 525 | open | Medium | Help | [ux-root-typo-configuree-modell-no-suggestions-reconfirmed.md](./ux-root-typo-configuree-modell-no-suggestions-reconfirmed.md) | configuree and modell → Unknown command + npm run dev — no Did you mean configure/models. |
| 526 | open | Medium | Spawn | [ux-runner-sync-and-runtime-invalid-raw-commander.md](./ux-runner-sync-and-runtime-invalid-raw-commander.md) | Invalid --runner-sync bogus and --runtime bogus print Commander option argument is invalid. Allowed choices… |
| 527 | open | Medium | Spawn / runtime | [ux-runner-sync-without-runtime-silently-accepted.md](./ux-runner-sync-without-runtime-silently-accepted.md) | spawn with --runner-sync both but no runtime/detach runs inline successfully — flag appears no-op without w… |
| 528 | open | Medium | Runtime jobs | [ux-runtime-job-missing-see-logs.md](./ux-runtime-job-missing-see-logs.md) | runtime jobs stop/logs missing-id: No runtime job found + See logs — clear message, system chrome. |
| 529 | open | Medium | Runtime jobs | [ux-runtime-jobs-attach-missing-see-logs.md](./ux-runtime-jobs-attach-missing-see-logs.md) | runtime jobs attach missing: No runtime job found + See logs — same class as stop/logs. |
| 530 | open | Medium | Runtime | [ux-runtime-jobs-list-unbounded-opaque-statuses.md](./ux-runtime-jobs-list-unbounded-opaque-statuses.md) | History dump; lost unexplained. |
| 531 | open | Medium | Runtime jobs | [ux-runtime-jobs-logs-stop-missing-see-logs.md](./ux-runtime-jobs-logs-stop-missing-see-logs.md) | runtime jobs logs/stop missing: No runtime job found + See logs — clear message, system chrome residual. |
| 532 | open | Medium | Runtime jobs | [ux-runtime-jobs-ls-help-no-limit-reconfirmed.md](./ux-runtime-jobs-ls-help-no-limit-reconfirmed.md) | runtime jobs ls --help only -h — no --limit, --since, --status despite unbounded May-era list. |
| 533 | open | Medium | Runtime jobs | [ux-runtime-jobs-show-unknown-suggests-stop.md](./ux-runtime-jobs-show-unknown-suggests-stop.md) | runtime jobs show is not a command; Commander Did you mean: stop? — users expect show/get for job details. |
| 534 | open | Medium | Runtime / errors | [ux-runtime-missing-deps-good-message-system-chrome.md](./ux-runtime-missing-deps-good-message-system-chrome.md) | spawn --runtime docker/e2b missing engine/API key messages include install links and config paths (excellen… |
| 535 | open | Medium | Runtime | [ux-runtime-templates-ls-empty-rows.md](./ux-runtime-templates-ls-empty-rows.md) | runtime templates ls shows docker and e2b rows with Hash (empty) and blank artifact/Dockerfile/Built — look… |
| 536 | open | Medium | SDK | [ux-sdk-getpoeapikey-throws-generic-error.md](./ux-sdk-getpoeapikey-throws-generic-error.md) | SDK credential helper throws new Error("No API key found…") rather than a typed/user-facing error class, so… |
| 537 | open | Medium | Spawn / skills | [ux-skill-bridge-failure-system-chrome.md](./ux-skill-bridge-failure-system-chrome.md) | Paths listed + See logs. |
| 538 | open | Medium | Skill / configure / agent list / consistency | [ux-skill-configure-agent-list-differs-from-configure.md](./ux-skill-configure-agent-list-differs-from-configure.md) | `skill configure [agent]` lists supported agents as: ``` claude-code / codex / cursor / gemini-cli / openco… |
| 539 | open | Medium | Skills | [ux-skill-configure-agent-list-subset-reconfirmed.md](./ux-skill-configure-agent-list-subset-reconfirmed.md) | skill configure agents: claude-code, codex, cursor, gemini-cli, opencode, goose — omits kimi (configure inc… |
| 540 | open | Medium | Skills / agents | [ux-skill-configure-kimi-unsupported-abrupt.md](./ux-skill-configure-kimi-unsupported-abrupt.md) | Skills not supported for kimi. |
| 541 | open | Medium | Skills | [ux-skill-configure-yes-defaults-agent-silently.md](./ux-skill-configure-yes-defaults-agent-silently.md) | skill configure --yes --local without agent configures claude-code without stating default selection policy… |
| 542 | open | Medium | Skills | [ux-skill-configure-yes-defaults-to-claude-already-exists.md](./ux-skill-configure-yes-defaults-to-claude-already-exists.md) | skill configure --yes without agent targets claude-code and fails Skill already exists … See logs — silent … |
| 543 | open | Medium | Skills | [ux-skill-install-file-required-before-name.md](./ux-skill-install-file-required-before-name.md) | skill install claude-code --name onlyname fails required option --file first — both name and file required;… |
| 544 | open | Medium | Skills | [ux-skill-install-missing-file-enoent-see-logs.md](./ux-skill-install-missing-file-enoent-see-logs.md) | skill install with missing SKILL.md path: ENOENT open + See logs — should be ValidationError file not found. |
| 545 | open | Medium | Skills | [ux-skill-install-missing-file-enoent.md](./ux-skill-install-missing-file-enoent.md) | skill install --file /tmp/no-skill.md fails ENOENT: no such file… + See logs. |
| 546 | open | Medium | Skills | [ux-skill-install-name-and-file-both-required.md](./ux-skill-install-name-and-file-both-required.md) | Serial required options opaque. |
| 547 | open | Medium | Naming | [ux-skill-naming-collisions.md](./ux-skill-naming-collisions.md) | skills≠skill; dual /plan. |
| 548 | open | Medium | Skills / first-run | [ux-skill-parent-no-next-step-guidance.md](./ux-skill-parent-no-next-step-guidance.md) | poe-code skill with no subcommand prints a bare subcommand list without suggesting the common onboarding pa… |
| 549 | open | Medium | Skills | [ux-skill-unconfigure-defaults-agent-and-soft-blocks.md](./ux-skill-unconfigure-defaults-agent-and-soft-blocks.md) | skill unconfigure without agent defaults to claude-code and refuses non-empty skill dirs unless --force, bu… |
| 550 | open | Medium | Spawn / skills | [ux-skills-empty-string-silently-ignored.md](./ux-skills-empty-string-silently-ignored.md) | spawn with --skills "" succeeds without warning — empty skills flag ignored unlike --skill "" which fails m… |
| 551 | open | Medium | Spawn / skills | [ux-skills-flag-without-value-is-noop-or-unclear.md](./ux-skills-flag-without-value-is-noop-or-unclear.md) | spawn … --skills with no value still runs the agent successfully (boolean presence?) without error or warni… |
| 552 | open | Medium | Configure | [ux-skip-if-configured-still-writes-when-model-differs.md](./ux-skip-if-configured-still-writes-when-model-differs.md) | Passing --skip-if-configured with an explicit --model that differs from stored config still runs a full con… |
| 553 | open | Medium | Spawn help | [ux-spawn-advanced-flags-undifferentiated.md](./ux-spawn-advanced-flags-undifferentiated.md) | ~20 options ungrouped. |
| 554 | open | Medium | Spawn / codex | [ux-spawn-codex-reads-stdin-message-on-tty-less-success.md](./ux-spawn-codex-reads-stdin-message-on-tty-less-success.md) | Even when prompt is provided as an argument, successful codex spawn emits Reading additional input from std… |
| 555 | open | Medium | Spawn | [ux-spawn-cwd-file-not-directory-see-logs.md](./ux-spawn-cwd-file-not-directory-see-logs.md) | spawn --cwd /tmp/file: Workspace path is not a directory + See logs — clear message, system chrome. |
| 556 | open | Medium | Spawn | [ux-spawn-cwd-missing-see-logs.md](./ux-spawn-cwd-missing-see-logs.md) | spawn --cwd /tmp/does-not-exist: Workspace path does not exist + See logs — clear message, system chrome. |
| 557 | open | Medium | Spawn / paths | [ux-spawn-cwd-missing-system-chrome.md](./ux-spawn-cwd-missing-system-chrome.md) | spawn -C /missing says Workspace path does not exist (good) but still attaches errors.log system-failure fo… |
| 558 | open | Medium | Spawn / runtime | [ux-spawn-detach-ignored-on-failure-path.md](./ux-spawn-detach-ignored-on-failure-path.md) | With --detach, spawn still appears to run the agent path that fails on stale model in-foreground with succe… |
| 559 | open | Medium | Spawn | [ux-spawn-empty-at-file-see-logs.md](./ux-spawn-empty-at-file-see-logs.md) | spawn claude @/tmp/empty.txt: No prompt provided via argument or stdin + See logs — clear message, system c… |
| 560 | open | Medium | Spawn | [ux-spawn-interactive-bypasses-design-system-panel.md](./ux-spawn-interactive-bypasses-design-system-panel.md) | spawn … --interactive / -i in non-TTY still runs and prints bare agent text (ok / Hey!) without Poe - spawn… |
| 561 | open | Medium | Spawn / interactive | [ux-spawn-interactive-non-tty-still-runs.md](./ux-spawn-interactive-non-tty-still-runs.md) | spawn … --interactive without TTY still produces agent output (not a clear "requires TTY" failure) — flag i… |
| 562 | open | Medium | Spawn / security | [ux-spawn-log-content-help-underwarns-sensitive-data.md](./ux-spawn-log-content-help-underwarns-sensitive-data.md) | spawn --help: --log-content Include message and tool content in ACP JSONL spawn logs — no danger that logs … |
| 563 | open | Medium | Spawn | [ux-spawn-missing-agent-raw-commander.md](./ux-spawn-missing-agent-raw-commander.md) | spawn with no args: error: missing required argument agent — raw commander not design-system; no agent list. |
| 564 | open | Medium | Spawn | [ux-spawn-no-prompt-system-chrome.md](./ux-spawn-no-prompt-system-chrome.md) | No prompt provided via argument or stdin is correct message but still See logs system chrome. |
| 565 | open | Medium | Spawn / skills | [ux-spawn-skill-missing-lists-searched-paths-see-logs.md](./ux-spawn-skill-missing-lists-searched-paths-see-logs.md) | spawn --skill no-such-skill: Failed to bridge active skills… Not found skill references; searched paths lis… |
| 566 | open | Medium | Spawn | [ux-spawn-stdin-empty-see-logs.md](./ux-spawn-stdin-empty-see-logs.md) | spawn --stdin with empty stdin: No prompt provided via argument or stdin + See logs — good message, system … |
| 567 | open | Medium | Spawn | [ux-spawn-validates-mode-before-agent-reconfirmed.md](./ux-spawn-validates-mode-before-agent-reconfirmed.md) | spawn unknown-agent --mode foobar fails mode first; spawn unknown-agent --mode read fails Unknown agent wit… |
| 568 | open | Medium | Spawn / errors | [ux-spawn-validates-mode-before-agent.md](./ux-spawn-validates-mode-before-agent.md) | Invalid agent fails missing --mode first. |
| 569 | open | Medium | Spawn / help / discoverability | [ux-spawn-yes-not-in-options.md](./ux-spawn-yes-not-in-options.md) | `spawn --help` does not list `--yes` as its own option. The flag is mentioned only inside the `--mode` desc… |
| 570 | open | Medium | Visual language | [ux-successful-spawn-still-uses-checkmark-for-agent-text.md](./ux-successful-spawn-still-uses-checkmark-for-agent-text.md) | Even successful spawn pi output prefixes agent thinking/answer lines with ✓, same glyph as success status —… |
| 571 | open | Medium | Help / identity | [ux-superintendent-builder-inspector-npm-run-dev.md](./ux-superintendent-builder-inspector-npm-run-dev.md) | superintendent builder/inspector help Usage: npm run dev -- superintendent builder … — reconfirm identity. |
| 572 | open | Medium | Help / identity | [ux-superintendent-code-review-npm-run-dev-identity.md](./ux-superintendent-code-review-npm-run-dev-identity.md) | superintendent and code-review Usage: npm run dev -- … — identity leak class. |
| 573 | open | Medium | Superintendent | [ux-superintendent-complete-wrong-kind-debug-tease.md](./ux-superintendent-complete-wrong-kind-debug-tease.md) | superintendent complete on plan-kind file: frontmatter kind must be superintendent Use --debug for a stack … |
| 574 | open | Medium | Help / identity | [ux-superintendent-help-npm-run-dev-and-dense-run-options.md](./ux-superintendent-help-npm-run-dev-and-dense-run-options.md) | superintendent --help and superintendent run --help use npm run dev Usage and toolcraft-style dense OPTIONS… |
| 575 | open | Medium | Superintendent | [ux-superintendent-validate-unclosed-tag-opaque.md](./ux-superintendent-validate-unclosed-tag-opaque.md) | No location. |
| 576 | open | Medium | Tables | [ux-tables-ignore-terminal-width.md](./ux-tables-ignore-terminal-width.md) | Wide at COLUMNS=40. |
| 577 | open | Medium | Tasks / auth | [ux-tasks-github-auth-raw-error.md](./ux-tasks-github-auth-raw-error.md) | tasks get raw GraphQL 401. |
| 578 | open | Medium | Tasks | [ux-tasks-import-dry-run-still-requires-to.md](./ux-tasks-import-dry-run-still-requires-to.md) | tasks import --dry-run --from /tmp fails tasks import requires --to <workflow.md> — dry-run cannot preview … |
| 579 | open | Medium | Test / capability | [ux-test-help-omits-pi-poe-agent.md](./ux-test-help-omits-pi-poe-agent.md) | test agent list ends at opencode — no pi/poe-agent; spawn lists them; test pi would be unknown vs spawn-onl… |
| 580 | open | Medium | Spawn / timeouts | [ux-timeout-errors-use-system-chrome.md](./ux-timeout-errors-use-system-chrome.md) | 0.001s + See logs. |
| 581 | open | Medium | Errors / recovery | [ux-toolcraft-has-suggestions-poe-code-root-does-not.md](./ux-toolcraft-has-suggestions-poe-code-root-does-not.md) | suggest.ts exists; root unused. |
| 582 | open | Medium | Help / visual | [ux-toolcraft-heading-doubles-poe-code.md](./ux-toolcraft-heading-doubles-poe-code.md) | Double name heading. |
| 583 | open | Medium | Traces | [ux-traces-directory-path-eisdir-reconfirmed.md](./ux-traces-directory-path-eisdir-reconfirmed.md) | traces /tmp → EISDIR illegal operation on directory, read + See logs — reconfirm kind-aware path error. |
| 584 | open | Medium | Traces | [ux-traces-directory-path-eisdir.md](./ux-traces-directory-path-eisdir.md) | traces docs EISDIR. |
| 585 | open | Medium | Traces | [ux-traces-missing-file-enoent-system-chrome.md](./ux-traces-missing-file-enoent-system-chrome.md) | traces /tmp/no-trace.jsonl → ENOENT open + See logs. |
| 586 | open | Medium | Traces | [ux-traces-missing-file-system-error.md](./ux-traces-missing-file-system-error.md) | System chrome. |
| 587 | open | Medium | Traces | [ux-traces-poe-code-source-titles-are-agent-names.md](./ux-traces-poe-code-source-titles-are-agent-names.md) | poe-code source traces show title pi / claude-code / cursor without user prompt — less useful than claude s… |
| 588 | open | Medium | Dry-run | [ux-unconfigure-goose-dry-run-full-config-dump.md](./ux-unconfigure-goose-dry-run-full-config-dump.md) | unconfigure goose --dry-run creates large full config.yaml + dump rather than intentional-only removal summ… |
| 589 | open | Medium | Unconfigure | [ux-unconfigure-help-missing-dry-run-and-yes.md](./ux-unconfigure-help-missing-dry-run-and-yes.md) | unconfigure help only -h; no --dry-run/--yes though global flags may apply — destructive command underdocum… |
| 590 | open | Medium | Unconfigure | [ux-unconfigure-help-no-dry-run-or-yes.md](./ux-unconfigure-help-no-dry-run-or-yes.md) | unconfigure --help only lists agent and -h — no mention of global --dry-run, confirmation, or files affected. |
| 591 | open | Medium | Unconfigure | [ux-unconfigure-missing-agent-raw-commander.md](./ux-unconfigure-missing-agent-raw-commander.md) | unconfigure without agent: error: missing required argument agent — raw commander; unconfigure not-an-agent… |
| 592 | open | Medium | Destructive | [ux-unconfigure-no-confirmation.md](./ux-unconfigure-no-confirmation.md) | Immediate rewrite no --yes gate. |
| 593 | open | Medium | Unconfigure | [ux-unconfigure-nonconfigured-agent-still-plans-mutations.md](./ux-unconfigure-nonconfigured-agent-still-plans-mutations.md) | unconfigure gemini --dry-run still emits large settings diffs and backup deletes even when user mental mode… |
| 594 | open | Medium | Unconfigure | [ux-unconfigure-rejects-spawn-only-agents.md](./ux-unconfigure-rejects-spawn-only-agents.md) | unconfigure pi and unconfigure poe-agent: Unknown agent — correct that they are not configurable, but error… |
| 595 | open | Medium | Update | [ux-update-always-suggests-npm-install-g.md](./ux-update-always-suggests-npm-install-g.md) | Ignores install method. |
| 596 | open | Medium | Usage | [ux-usage-help-hides-default-balance-reconfirmed.md](./ux-usage-help-hides-default-balance-reconfirmed.md) | usage with no subcommand runs balance successfully, but usage --help only lists list subcommand — default b… |
| 597 | open | Medium | Usage | [ux-usage-list-no-json-flag.md](./ux-usage-list-no-json-flag.md) | usage list lacks --json/--output; scripts cannot machine-parse usage history without scraping tables. trace… |
| 598 | open | Medium | Usage | [ux-usage-pages-1-still-shows-20-entries.md](./ux-usage-pages-1-still-shows-20-entries.md) | usage list --pages 1 still fetches/displays 20 usage entries — --pages means number of pages not page size,… |
| 599 | open | Medium | Usage | [ux-usage-pages-invalid-raw-commander.md](./ux-usage-pages-invalid-raw-commander.md) | --pages 0/-1 prints error: option argument is invalid. Expected a positive integer without design-system fr… |
| 600 | open | Medium | Utils / editor | [ux-utils-config-edit-missing-editor-system-chrome.md](./ux-utils-config-edit-missing-editor-system-chrome.md) | utils config edit without EDITOR says Set $EDITOR to use this command + See logs — good message, unnecessar… |
| 601 | open | Medium | Utils / config | [ux-utils-config-path-subcommand-missing.md](./ux-utils-config-path-subcommand-missing.md) | utils config path fails with too many arguments; only show/init/edit exist. Users often need the path witho… |
| 602 | open | Medium | Utils / config | [ux-utils-config-show-dumps-large-json.md](./ux-utils-config-show-dumps-large-json.md) | utils config show prints full global config JSON including configured_services detail — useful but noisy; n… |
| 603 | open | Medium | Utils / config / visual | [ux-utils-config-show-unframed-raw-json.md](./ux-utils-config-show-unframed-raw-json.md) | `utils config show` outputs two sections (`--- Environment variable overrides ---` and `--- Resolved (merge… |
| 604 | open | Medium | Utils / symlink / visual | [ux-utils-symlink-help-missing-design-system-colors.md](./ux-utils-symlink-help-missing-design-system-colors.md) | `utils symlink --help` shows the panel title "Poe - utils symlink" in plain white/grey text rather than the… |
| 605 | open | Medium | Utils / symlink / help / design system / visual consistency | [ux-utils-symlink-help-unformatted-white-text.md](./ux-utils-symlink-help-unformatted-white-text.md) | `poe-code utils symlink --help` renders its entire output in white unstyled text. No design system colors a… |
| 606 | open | Medium | Version | [ux-version-nags-dev-to-major-jump.md](./ux-version-nags-dev-to-major-jump.md) | Local 0.0.0-dev build reports Update available to 4.0.0 and suggests npm install -g, which is noise for con… |
| 607 | open | Medium | Version | [ux-version-still-nags-dev-to-4.0.0.md](./ux-version-still-nags-dev-to-4.0.0.md) | Reconfirmed: --version shows Update available: 0.0.0-dev -> 4.0.0 and npm install -g suggestion. |
| 608 | open | Medium | Version | [ux-version-subcommand-missing-use-flag.md](./ux-version-subcommand-missing-use-flag.md) | poe-code version is Unknown command; version works via -V/--version. Users typing version as subcommand (co… |
| 609 | open | Medium | Version | [ux-version-update-nag-dev-to-4-0-1.md](./ux-version-update-nag-dev-to-4-0-1.md) | poe-code -V shows Update available: 0.0.0-dev -> 4.0.1 — noisy on monorepo/dev builds. |
| 610 | open | Medium | Auth / help | [ux-whoami-root-missing-auth-only.md](./ux-whoami-root-missing-auth-only.md) | whoami at root → Unknown command + npm run dev; auth whoami works as JSON. Users expect top-level whoami. |
| 611 | open | Medium | Tables | [ux-wide-tables-truncate-critical-cells.md](./ux-wide-tables-truncate-critical-cells.md) | Agents column ellipsis. |
| 612 | open | Medium | Worktree | [ux-worktree-reconcile-not-found-system-chrome.md](./ux-worktree-reconcile-not-found-system-chrome.md) | Worktree "missing" not found in registry + See logs — same as remove not-found. |
| 613 | open | Medium | Worktree | [ux-worktree-reconcile-requires-agent-raw-commander.md](./ux-worktree-reconcile-requires-agent-raw-commander.md) | worktree reconcile missing --yes: error: required option --agent not specified — raw commander; help may li… |
| 614 | open | Medium | Worktree | [ux-worktree-reconcile-requires-agent-raw.md](./ux-worktree-reconcile-requires-agent-raw.md) | worktree reconcile missing --yes fails required option --agent not specified (raw) before not-found; --yes … |
| 615 | open | Medium | Worktree | [ux-worktree-remove-help-no-yes.md](./ux-worktree-remove-help-no-yes.md) | worktree remove --help has --delete-branch but no --yes / confirmation notes for destructive remove. |
| 616 | open | Medium | Worktree | [ux-worktree-remove-help-omits-yes.md](./ux-worktree-remove-help-omits-yes.md) | worktree remove --help shows only --delete-branch; no --yes. worktree remove ghost-name --yes fails Worktre… |
| 617 | open | Medium | Worktree | [ux-worktree-remove-missing-see-logs.md](./ux-worktree-remove-missing-see-logs.md) | worktree remove no-such-wt --yes: Worktree not found in registry + See logs — clear message, system chrome … |
| 618 | open | Medium | Worktree | [ux-worktree-remove-no-confirmation.md](./ux-worktree-remove-no-confirmation.md) | Destructive no confirm. |
| 619 | open | Medium | Worktree | [ux-worktree-remove-not-found-system-chrome.md](./ux-worktree-remove-not-found-system-chrome.md) | worktree remove no-such → Worktree not found in registry + See logs. |
| 620 | open | Medium | Docs / CLI sync | [ux-wrap-command-still-missing.md](./ux-wrap-command-still-missing.md) | wrap remains Unknown command — residual after README wrap removal; muscle memory / external docs. |
| 621 | open | Medium | Dry-run | [ux-wrap-dry-run-forwards-flag.md](./ux-wrap-dry-run-forwards-flag.md) | would run goose --dry-run. |
| 622 | open | Medium | Dry-run | [ux-wrap-resolves-alias-but-dry-run-lies.md](./ux-wrap-resolves-alias-but-dry-run-lies.md) | kimi-cli --dry-run invented. |
| 623 | open | Low–Medium | Agent defaults | [ux-agent-default-model-hardcoded.md](./ux-agent-default-model-hardcoded.md) | default anthropic/claude-opus-4.7. |
| 624 | open | Low–Medium | Config / models | [ux-agent-default-opus-4-7-not-latest-opus-4-8.md](./ux-agent-default-opus-4-7-not-latest-opus-4-8.md) | agent --model default is anthropic/claude-opus-4.7; catalog has anthropic/claude-opus-4.8 (Date Added 2026-… |
| 625 | open | Low–Medium | Auth | [ux-auth-status-no-json-flag.md](./ux-auth-status-no-json-flag.md) | auth status --json unknown; whoami is JSON. Split is OK if documented; status --help does not mention whoam… |
| 626 | open | Low–Medium | Auth | [ux-auth-whoami-raw-json-vs-status-panel.md](./ux-auth-whoami-raw-json-vs-status-panel.md) | auth whoami dumps raw JSON identity; auth status uses design-system Logged in as. Dual presentation for sam… |
| 627 | open | Low–Medium | Auth polish | [ux-auth-whoami-raw-json.md](./ux-auth-whoami-raw-json.md) | JSON vs status design-system. |
| 628 | open | Low–Medium | Braintrust | [ux-braintrust-status-minimal-disabled.md](./ux-braintrust-status-minimal-disabled.md) | braintrust status prints disabled with Problems footer — no how to enable, env vars, or docs link (reaffirm… |
| 629 | open | Low–Medium | Spawn / telemetry | [ux-capture-otel-no-visible-output-change.md](./ux-capture-otel-no-visible-output-change.md) | spawn … --capture-otel succeeds like normal spawn without saying where OTEL was written or if capture was a… |
| 630 | open | Low–Medium | Code-review | [ux-code-review-profiles-raw-table.md](./ux-code-review-profiles-raw-table.md) | code-review profiles dumps a minimal ascii table of name/source without Poe panel framing used elsewhere. |
| 631 | open | Low–Medium | Code-review / visual | [ux-code-review-profiles-table-outside-design-system.md](./ux-code-review-profiles-table-outside-design-system.md) | No Poe framing. |
| 632 | open | Low–Medium | Help | [ux-command-aliases-undocumented-on-root-help.md](./ux-command-aliases-undocumented-on-root-help.md) | Work but not shown. |
| 633 | open | Low–Medium | Configure help | [ux-configure-shape-base-url-opaque.md](./ux-configure-shape-base-url-opaque.md) | Jargon no examples. |
| 634 | open | Low–Medium | Configure | [ux-configure-unknown-provider-see-logs-missing.md](./ux-configure-unknown-provider-see-logs-missing.md) | configure --provider bogus: Unknown provider "bogus" — clear; should list available providers (poe, anthrop… |
| 635 | open | Low–Medium | Help | [ux-dashboard-command-missing.md](./ux-dashboard-command-missing.md) | dashboard / dashboard --help → Unknown command. No TUI dashboard entry despite maestro tui existing. |
| 636 | open | Low–Medium | Help / discoverability | [ux-dashboard-ui-tui-missing.md](./ux-dashboard-ui-tui-missing.md) | dashboard, ui, tui are Unknown command with npm run dev help — no interactive dashboard entrypoint in CLI. |
| 637 | open | Low–Medium | Editor | [ux-editor-missing-raw-error.md](./ux-editor-missing-raw-error.md) | throw new Error Set $EDITOR. |
| 638 | open | Low–Medium | Eval | [ux-eval-errors-outside-design-system.md](./ux-eval-errors-outside-design-system.md) | Some eval plain text. |
| 639 | open | Low–Medium | Eval | [ux-eval-init-creates-in-cwd-with-bare-success.md](./ux-eval-init-creates-in-cwd-with-bare-success.md) | eval init ux-audit-eval-two creates files with bare name/next lines — reconfirm eval init success framing; … |
| 640 | open | Low–Medium | Eval | [ux-eval-init-success-is-bare-paths.md](./ux-eval-init-success-is-bare-paths.md) | eval init prints folder name and next: poe-code eval check … as bare lines; also next command may still be … |
| 641 | open | Low–Medium | Eval | [ux-eval-report-debug-flag-undocumented-in-error.md](./ux-eval-report-debug-flag-undocumented-in-error.md) | eval report with no eval folders says Use --debug for a stack trace while primary help may not surface --de… |
| 642 | open | Low–Medium | Experiment | [ux-experiment-journal-wrong-doc-type-message.md](./ux-experiment-journal-wrong-doc-type-message.md) | Doc not found for existing. |
| 643 | open | Low–Medium | Install / IA | [ux-extra-npm-bins-confusing.md](./ux-extra-npm-bins-confusing.md) | poe-code-configure + test servers. |
| 644 | open | Low–Medium | Gaslight | [ux-gaslight-archive-and-no-archive-both-accepted.md](./ux-gaslight-archive-and-no-archive-both-accepted.md) | Passing both --archive and --no-archive does not error; one silently wins (Commander negate) while help lis… |
| 645 | open | Low–Medium | GH workflows | [ux-gh-install-eject-flag-opaque.md](./ux-gh-install-eject-flag-opaque.md) | Description eject. |
| 646 | open | Low–Medium | Harness | [ux-harness-run-no-path-says-no-pairs.md](./ux-harness-run-no-path-says-no-pairs.md) | harness run --yes without md-path: No harness pairs found — OK if empty, but does not prompt to pick or sug… |
| 647 | open | Low–Medium | Hooks / spawn | [ux-hooks-from-pi-unsupported-lists-supported.md](./ux-hooks-from-pi-unsupported-lists-supported.md) | spawn --hooks-from pi: Unsupported source hook agent "pi". Supported hook agents: claude-code, codex — clea… |
| 648 | open | Low–Medium | Spawn / hooks | [ux-hooks-scope-invalid-raw-commander.md](./ux-hooks-scope-invalid-raw-commander.md) | spawn --hooks-scope bogus: raw commander Allowed choices are project, user, merged — same class as hooks-st… |
| 649 | open | Low–Medium | Spawn / hooks | [ux-hooks-strategy-invalid-raw-commander.md](./ux-hooks-strategy-invalid-raw-commander.md) | spawn --hooks-strategy bogus: error: option argument bogus is invalid. Allowed choices are auto, symlink, t… |
| 650 | open | Low–Medium | Install | [ux-install-always-claims-success.md](./ux-install-always-claims-success.md) | No already-present state. |
| 651 | open | Low–Medium | Launch | [ux-launch-status-shows-failed-experiment-leftovers.md](./ux-launch-status-shows-failed-experiment-leftovers.md) | stopped leftovers no cleanup hint. |
| 652 | open | Low–Medium | Spawn / logging | [ux-log-dir-relative-works-with-path-feedback-gap.md](./ux-log-dir-relative-works-with-path-feedback-gap.md) | spawn --log-dir ./tmp-ux-logs creates timestamped jsonl under relative dir successfully — works; still no p… |
| 653 | open | Low–Medium | Auth / help | [ux-login-help-omits-yes.md](./ux-login-help-omits-yes.md) | login help only --api-key and -h; --yes exists for non-TTY (login --yes without key message works) but undo… |
| 654 | open | Low–Medium | Auth / help | [ux-login-help-still-omits-yes-reconfirmed.md](./ux-login-help-still-omits-yes-reconfirmed.md) | login help only --api-key and -h — --yes works for non-TTY but undocumented (reconfirm). |
| 655 | open | Low–Medium | Plan | [ux-markdown-read-depth-zero-empty-sections.md](./ux-markdown-read-depth-zero-empty-sections.md) | markdown-read --depth 0 prints sections: (none) while file has content — depth 0 means no headings shown wi… |
| 656 | open | Low–Medium | Spawn | [ux-mcp-servers-empty-object-accepted.md](./ux-mcp-servers-empty-object-accepted.md) | spawn with --mcp-servers {} succeeds without warning that no servers were configured — empty object is vali… |
| 657 | open | Low–Medium | Errors / consistency | [ux-mcp-servers-missing-file-almost-good.md](./ux-mcp-servers-missing-file-almost-good.md) | Good message class vary. |
| 658 | open | Low–Medium | Memory | [ux-memory-cache-clear-requires-yes-see-logs.md](./ux-memory-cache-clear-requires-yes-see-logs.md) | memory cache clear without --yes: Refusing to clear cache without --yes + See logs — good policy, system ch… |
| 659 | open | Low–Medium | Memory / MCP | [ux-memory-mcp-print-config-raw-json.md](./ux-memory-mcp-print-config-raw-json.md) | Bare JSON no guidance. |
| 660 | open | Low–Medium | Memory | [ux-memory-status-after-write-is-terse.md](./ux-memory-status-after-write-is-terse.md) | memory status prints Pages/Bytes/Last write/Tokens as bare lines without panel framing or interpretation (h… |
| 661 | open | Low–Medium | Memory | [ux-memory-write-bare-stdout-path.md](./ux-memory-write-bare-stdout-path.md) | memory write pages/hello.md prints bare hello.md without design-system success panel — inconsistent with me… |
| 662 | open | Low–Medium | Memory | [ux-memory-write-success-bare-path-stdout.md](./ux-memory-write-success-bare-path-stdout.md) | memory write pages/hello.md --reason test succeeds then show works; write success appears as bare path "hel… |
| 663 | open | Low–Medium | Models | [ux-models-double-feature-flag-uses-last-or-and.md](./ux-models-double-feature-flag-uses-last-or-and.md) | models --feature tools --feature reasoning returns 44/341 — repeated --feature appears to AND (tools AND re… |
| 664 | open | Low–Medium | Models | [ux-models-empty-model-filter-returns-all.md](./ux-models-empty-model-filter-returns-all.md) | models --view pricing --model "" → 341/341 models — empty --model ignored (empty flag class). |
| 665 | open | Low–Medium | Models | [ux-models-raw-view-bypasses-design-system-reconfirmed.md](./ux-models-raw-view-bypasses-design-system-reconfirmed.md) | models --model claude-haiku-4.5 --view raw prints raw YAML without design-system panel — reconfirm models-r… |
| 666 | open | Low–Medium | Models | [ux-models-raw-view-bypasses-design-system.md](./ux-models-raw-view-bypasses-design-system.md) | No framing. |
| 667 | open | Low–Medium | Models | [ux-models-search-empty-returns-all.md](./ux-models-search-empty-returns-all.md) | models --search "" → 341/341 models — empty search ignored (empty flag class). |
| 668 | open | Low–Medium | Models | [ux-models-since-1d-empty-today.md](./ux-models-since-1d-empty-today.md) | models --since 1d returns 0/341 No models match — correct if no adds in 24h but message looks like filter f… |
| 669 | open | Low–Medium | Models | [ux-models-tools-and-feature-filter-semantics-undocumented.md](./ux-models-tools-and-feature-filter-semantics-undocumented.md) | --tools is documented as shorthand for --feature tools, but combining --tools with --feature web_search ret… |
| 670 | open | Low–Medium | Models | [ux-models-view-invalid-raw-commander.md](./ux-models-view-invalid-raw-commander.md) | models --view bogus: raw commander Allowed choices are capabilities, pricing, parameters, raw — contrast pl… |
| 671 | open | Low–Medium | Help / completion | [ux-no-shell-completion-command.md](./ux-no-shell-completion-command.md) | No poe-code completion (bash/zsh/fish) command to install tab completion, despite a large command surface w… |
| 672 | open | Low–Medium | Auth polish | [ux-oauth-url-dumps-full-query-string.md](./ux-oauth-url-dumps-full-query-string.md) | Long authorize URL line. |
| 673 | open | Low–Medium | Pipeline / Experiment / help / naming | [ux-pipeline-experiment-plan-path-as-subcommand.md](./ux-pipeline-experiment-plan-path-as-subcommand.md) | Both `pipeline --help` and `experiment --help` list `plan-path` as a sibling of action-verb subcommands (`r… |
| 674 | open | Low–Medium | Pipeline | [ux-pipeline-validate-success-still-problems-footer.md](./ux-pipeline-validate-success-still-problems-footer.md) | Valid pipeline validation ends with Problems? GitHub link after Plan is valid success. |
| 675 | open | Low–Medium | Plan list | [ux-plan-list-empty-table-no-message.md](./ux-plan-list-empty-table-no-message.md) | No no-plans message. |
| 676 | open | Low–Medium | Plan list | [ux-plan-list-output-json-unframed.md](./ux-plan-list-output-json-unframed.md) | plan list --output json prints a raw JSON array to stdout with no design-system intro; --output md prints a… |
| 677 | open | Low–Medium | Plan | [ux-plan-markdown-read-raw-yaml-ish-output.md](./ux-plan-markdown-read-raw-yaml-ish-output.md) | plan markdown-read prints raw file:/frontmatter:/sections: blocks without design-system framing used by pla… |
| 678 | open | Low–Medium | Plan / MCP | [ux-plan-markdown-reader-mcp-help-minimal.md](./ux-plan-markdown-reader-mcp-help-minimal.md) | plan markdown-reader-mcp --help only description Run the standalone markdown reader MCP server with -h — no… |
| 679 | open | Low–Medium | Plan view | [ux-plan-view-json-dumps-full-markdown-content.md](./ux-plan-view-json-dumps-full-markdown-content.md) | plan view --output json includes a huge content string of the full plan body, which is useful for tooling b… |
| 680 | open | Low–Medium | Design system | [ux-problems-footer-on-every-success.md](./ux-problems-footer-on-every-success.md) | finalize always. |
| 681 | open | Low–Medium | Providers / tables | [ux-provider-list-agents-column-truncated.md](./ux-provider-list-agents-column-truncated.md) | provider list Agents column ends with poe-… for cloudflare row — terminal width truncation without --wide o… |
| 682 | open | Low–Medium | Providers | [ux-provider-login-unknown-has-list-hint-and-see-logs.md](./ux-provider-login-unknown-has-list-hint-and-see-logs.md) | provider login not-a-provider: Unknown provider … Run provider list — good next step; still See logs system… |
| 683 | open | Low–Medium | Runtime | [ux-runtime-templates-ls-shows-empty-docker-row.md](./ux-runtime-templates-ls-shows-empty-docker-row.md) | runtime templates ls includes a docker row with (empty) hash and dashes, plus many old e2b artifacts — nois… |
| 684 | open | Low–Medium | Runtime | [ux-runtime-templates-ls-unbounded-noise.md](./ux-runtime-templates-ls-unbounded-noise.md) | Old e2b /tmp rows. |
| 685 | open | Low–Medium | Runtime | [ux-runtime-templates-parent-no-default-subcommand.md](./ux-runtime-templates-parent-no-default-subcommand.md) | runtime templates without subcommand prints help twice (Usage block duplicated) instead of defaulting to ls. |
| 686 | open | Low–Medium | Configure | [ux-shape-base-url-error-good-message-system-prefix.md](./ux-shape-base-url-error-good-message-system-prefix.md) | Good text system prefix. |
| 687 | open | Low–Medium | Spawn / skills | [ux-skill-and-skills-flags-undocumented-relationship.md](./ux-skill-and-skills-flags-undocumented-relationship.md) | Both merge; help silent. |
| 688 | open | Low–Medium | Skills | [ux-skill-configure-goose-writes-dot-agents-skills.md](./ux-skill-configure-goose-writes-dot-agents-skills.md) | skill configure goose --yes --local succeeds at ./.agents/skills while claude uses ./.claude/skills — path … |
| 689 | open | Low–Medium | Spawn / skills | [ux-skill-empty-string-malformed-reference.md](./ux-skill-empty-string-malformed-reference.md) | spawn --skill "" fails Malformed skill references: - (empty) Expected syntax name or agentId/name — empty s… |
| 690 | open | Low–Medium | Configure | [ux-skip-if-configured-still-noises-dry-run.md](./ux-skip-if-configured-still-noises-dry-run.md) | Still full would-configure. |
| 691 | open | Low–Medium | Spawn | [ux-spawn-mode-case-sensitive.md](./ux-spawn-mode-case-sensitive.md) | spawn --mode AUTO fails Invalid --mode "AUTO". Expected yolo, auto, edit, or read — case-sensitive; users t… |
| 692 | open | Low–Medium | Design system | [ux-spawn-success-still-problems-footer.md](./ux-spawn-success-still-problems-footer.md) | Even successful spawn pi/claude/goose runs end with Problems? GitHub issues link, training users to ignore … |
| 693 | open | Low–Medium | Visual language | [ux-success-and-info-share-magenta-glyphs.md](./ux-success-and-info-share-magenta-glyphs.md) | logger ◆ and ● magenta. |
| 694 | open | Low–Medium | Traces | [ux-traces-cwd-only-flag-removed-or-renamed.md](./ux-traces-cwd-only-flag-removed-or-renamed.md) | traces defaults to cwd-only listing; expansion is via --all-workspaces. The flag --cwd-only is unknown. Ear… |
| 695 | open | Low–Medium | Update | [ux-update-help-omits-dry-run.md](./ux-update-help-omits-dry-run.md) | update help lists --force, --no-version-check, --package-manager but not --dry-run though dry-run works via… |
| 696 | open | Low–Medium | Usage | [ux-usage-help-hides-default-balance.md](./ux-usage-help-hides-default-balance.md) | Bare usage balance; help omits. |
| 697 | open | Low–Medium | Usage | [ux-usage-list-empty-filter-returns-all.md](./ux-usage-list-empty-filter-returns-all.md) | usage list --filter "" still shows 20 entries — empty filter ignored (empty flag class). |
| 698 | open | Low–Medium | Utils | [ux-utils-config-no-path-subcommand.md](./ux-utils-config-no-path-subcommand.md) | utils config path fails too many arguments; only show/init/edit — users cannot print config file paths alone. |
| 699 | open | Low–Medium | Utils | [ux-utils-symlink-skills-is-nested-not-top-level.md](./ux-utils-symlink-skills-is-nested-not-top-level.md) | utils symlink-skills unknown; actual path is utils symlink skills — footgun for muscle memory / docs. |
| 700 | open | Low–Medium | Utils | [ux-utils-symlink-skills-scope-error-vs-agents.md](./ux-utils-symlink-skills-scope-error-vs-agents.md) | skills dry-run needs flags. |
| 701 | open | Low–Medium | Logging / verbose | [ux-verbose-prefixes-every-log-line.md](./ux-verbose-prefixes-every-log-line.md) | [models] on tables. |
| 702 | open | Low–Medium | Version | [ux-version-update-nag-on-dev-builds.md](./ux-version-update-nag-on-dev-builds.md) | Always update available. |
| 703 | open | Low–Medium | Worktree | [ux-worktree-reconcile-requires-agent-not-in-error-order.md](./ux-worktree-reconcile-requires-agent-not-in-error-order.md) | worktree reconcile without args hits required option --agent before missing name, similar to spawn mode-bef… |
| 704 | open | Low | Spawn / positive pattern | [ux-activity-timeout-1ms-works-but-chrome.md](./ux-activity-timeout-1ms-works-but-chrome.md) | Agent spawn timed out after 0.001s of inactivity — correct behavior for extreme timeout; still See logs. |
| 705 | open | Low | Spawn / positive pattern | [ux-activity-timeout-ms-zero-validation-good.md](./ux-activity-timeout-ms-zero-validation-good.md) | spawn --activity-timeout-ms 0: Invalid --activity-timeout-ms "0". Expected a positive integer — clear Valid… |
| 706 | open | Low | Errors / positive pattern | [ux-activity-timeout-zero-good-validation.md](./ux-activity-timeout-zero-good-validation.md) | Invalid --activity-timeout-ms "0" returns a clear ValidationError-style message without raw Commander text … |
| 707 | open | Low | Spawn / positive pattern | [ux-activity-timeout-zero-validation-good.md](./ux-activity-timeout-zero-validation-good.md) | Invalid activity timeout returns Expected a positive integer without stack. |
| 708 | open | Low | Agent / positive pattern | [ux-agent-default-model-is-opus-4-7-good.md](./ux-agent-default-model-is-opus-4-7-good.md) | agent --help default model anthropic/claude-opus-4.7 (live frontier); agent "say only: ping" works. |
| 709 | open | Low | Agent / positive pattern | [ux-agent-default-model-works-when-opus-valid.md](./ux-agent-default-model-works-when-opus-valid.md) | agent "say only: ok" without --model succeeds using default anthropic/claude-opus-4.7 — positive that DEFAU… |
| 710 | open | Low | Approvals / positive pattern | [ux-approvals-list-pending-empty-good.md](./ux-approvals-list-pending-empty-good.md) | approvals list --state pending: No approvals found — clear empty state. |
| 711 | open | Low | Auth / positive pattern | [ux-auth-status-logged-in-good.md](./ux-auth-status-logged-in-good.md) | auth status: Logged in as Name (@handle) — clear without secrets. |
| 712 | open | Low | Auth / positive pattern | [ux-auth-whoami-field-shape-good.md](./ux-auth-whoami-field-shape-good.md) | auth whoami JSON keys: handle, name, profile_picture, user_id — clean machine shape without secrets. |
| 713 | open | Low | Auth / positive pattern | [ux-auth-whoami-fields-documented-by-shape.md](./ux-auth-whoami-fields-documented-by-shape.md) | auth whoami JSON keys: handle, name, profile_picture, user_id — stable machine shape. |
| 714 | open | Low | Auth / positive pattern | [ux-auth-whoami-help-documents-json-good.md](./ux-auth-whoami-help-documents-json-good.md) | auth whoami help says Print Poe account identity as JSON (uses POE_API_KEY if set) — clear machine mode vs … |
| 715 | open | Low | Braintrust | [ux-braintrust-status-opaque.md](./ux-braintrust-status-opaque.md) | disabled only. |
| 716 | open | Low | Code-review | [ux-code-review-profiles-bare-table-good.md](./ux-code-review-profiles-bare-table-good.md) | code-review profiles shows simple name/source table with generic built-in — readable but no design-system p… |
| 717 | open | Low | Code-review / positive pattern | [ux-code-review-prompt-preview-good.md](./ux-code-review-prompt-preview-good.md) | code-review prompt-preview --spawn orchestrator prints Spawn/Profile/Prompt preview without side effects — … |
| 718 | open | Low | Utils / positive pattern | [ux-config-init-already-exists-good.md](./ux-config-init-already-exists-good.md) | utils config init: Project config already exists at path — clear idempotent message. |
| 719 | open | Low | Configure / positive pattern | [ux-configure-api-key-dry-run-redacts-bearer.md](./ux-configure-api-key-dry-run-redacts-bearer.md) | configure dry-run shows Authorization: Bearer <redacted> — good redaction in at least this path (contrast u… |
| 720 | open | Low | Configure / positive pattern | [ux-configure-cursor-dry-run-already-configured-clean.md](./ux-configure-cursor-dry-run-already-configured-clean.md) | configure cursor --yes --dry-run: would configure Cursor; # no filesystem changes — clean intentional dry-r… |
| 721 | open | Low | Configure / positive pattern | [ux-configure-gemini-dry-run-minimal-good.md](./ux-configure-gemini-dry-run-minimal-good.md) | configure gemini dry-run shows model gemini-2.5-pro and mkdir ensures without full settings flood when alre… |
| 722 | open | Low | Configure / positive pattern | [ux-configure-success-vscode-next-steps-good.md](./ux-configure-success-vscode-next-steps-good.md) | After configuring Claude Code, a Next steps note with vscode://settings/claudeCode.disableLoginPrompt deep … |
| 723 | open | Low | Configure / positive pattern | [ux-configure-unknown-api-shape-lists-exposed.md](./ux-configure-unknown-api-shape-lists-exposed.md) | configure --shape-base-url messages=… → Unknown API shape "messages" for provider poe. Exposed shapes: open… |
| 724 | open | Low | Configure / positive pattern | [ux-configure-unknown-provider-good-message.md](./ux-configure-unknown-provider-good-message.md) | configure --provider notaprovider returns Unknown provider "notaprovider" cleanly (could still list known p… |
| 725 | open | Low | Configure / positive pattern | [ux-configure-unknown-provider-validation-good.md](./ux-configure-unknown-provider-validation-good.md) | configure --provider not-a-provider → Unknown provider "not-a-provider" without See logs — good ValidationE… |
| 726 | open | Low | Agents / positive pattern | [ux-cursor-and-cursor-agent-aliases-both-work.md](./ux-cursor-and-cursor-agent-aliases-both-work.md) | spawn cursor and spawn cursor-agent both succeed; configure aliases map to same Cursor surface. Positive al… |
| 727 | open | Low | Spawn / positive pattern | [ux-cwd-file-path-not-directory-good.md](./ux-cwd-file-path-not-directory-good.md) | spawn --cwd package.json returns Workspace path … is not a directory clearly. |
| 728 | open | Low | Spawn / positive pattern | [ux-cwd-missing-path-good-message.md](./ux-cwd-missing-path-good-message.md) | spawn --cwd /no/such/dir returns Workspace path does not exist clearly (still See logs). |
| 729 | open | Low | Spawn / positive pattern | [ux-e2b-missing-key-error-good.md](./ux-e2b-missing-key-error-good.md) | No E2B API key message points to E2B_API_KEY and config.json paths — good recovery (still See logs). |
| 730 | open | Low | Spawn / positive pattern | [ux-empty-prompt-string-rejected.md](./ux-empty-prompt-string-rejected.md) | spawn claude "" and agent "" both reject empty prompts — good. spawn: No prompt provided; agent: Prompt mus… |
| 731 | open | Low | Eval / positive pattern | [ux-eval-lint-missing-eval-structured-table-good.md](./ux-eval-lint-missing-eval-structured-table-good.md) | eval lint no-such-eval shows Errors/Warnings tables E001–E005 missing eval.yaml/plan.md/oracle — structured… |
| 732 | open | Low | Eval / positive pattern | [ux-eval-lint-table-good.md](./ux-eval-lint-table-good.md) | eval lint shows Warnings table with Code W004, path, message about pinning target.ref to SHA — scannable. |
| 733 | open | Low | Experiment / positive pattern | [ux-experiment-install-force-help-exists.md](./ux-experiment-install-force-help-exists.md) | experiment install --help lists --force Overwrite existing files — better than pipeline install force opaci… |
| 734 | open | Low | Experiment / positive pattern | [ux-experiment-install-requires-agent-or-yes-good.md](./ux-experiment-install-requires-agent-or-yes-good.md) | experiment install --local --force without agent: Experiment install agent selection requires --agent or --… |
| 735 | open | Low | Experiment / positive pattern | [ux-experiment-validate-missing-path-good.md](./ux-experiment-validate-missing-path-good.md) | experiment validate /tmp/no-exp.md: Experiment doc not found — clear missing path (wrong-kind still says no… |
| 736 | open | Low | Gaslight / positive pattern | [ux-gaslight-ingest-has-limit-since-good.md](./ux-gaslight-ingest-has-limit-since-good.md) | gaslight ingest --help has --since 30d default and --limit 200 — good pagination pattern models/runtime lack. |
| 737 | open | Low | Gaslight / positive pattern | [ux-gaslight-ingest-limit-zero-validation-good.md](./ux-gaslight-ingest-limit-zero-validation-good.md) | --limit must be a positive integer for limit 0 — good ValidationError. |
| 738 | open | Low | Gaslight / positive pattern | [ux-gaslight-install-force-dry-run-clean.md](./ux-gaslight-install-force-dry-run-clean.md) | gaslight install --local --force --dry-run: Would create path; Would install; no filesystem changes — clean… |
| 739 | open | Low | Gaslight / positive pattern | [ux-gaslight-install-global-dry-run-clean.md](./ux-gaslight-install-global-dry-run-clean.md) | gaslight install --global --dry-run: Would create path; Would install; no filesystem changes — intentional … |
| 740 | open | Low | GitHub workflows / positive pattern | [ux-gh-uninstall-invalid-name-lists-choices-good.md](./ux-gh-uninstall-invalid-name-lists-choices-good.md) | Invalid uninstall name lists Expected one of: fix-vulnerabilities, … — good allow-list (still npm run dev h… |
| 741 | open | Low | GitHub workflows / positive pattern | [ux-gh-variables-list-good.md](./ux-gh-variables-list-good.md) | gh variables shows Name/Status/Source table for shared prompt variables — clear inventory. |
| 742 | open | Low | Harness / help / capitalisation | [ux-harness-help-command-lowercase-description.md](./ux-harness-help-command-lowercase-description.md) | `harness --help` lists `help [command]` as a subcommand with the description "display help for command" (lo… |
| 743 | open | Low | Harness / positive pattern | [ux-harness-list-empty-good.md](./ux-harness-list-empty-good.md) | harness list: No harness pairs found — clear empty state. |
| 744 | open | Low | Harness / positive pattern | [ux-harness-list-empty-message-good.md](./ux-harness-list-empty-message-good.md) | harness list: No harness pairs found — clear empty state (no empty table). |
| 745 | open | Low | Harness / positive pattern | [ux-harness-new-all-builtin-kinds-work.md](./ux-harness-new-all-builtin-kinds-work.md) | ralph-demo, experiment-demo, superintendent-demo, coverage-demo, pipeline-demo all scaffold successfully wi… |
| 746 | open | Low | Harness / positive pattern | [ux-harness-new-run-coverage-demo-works.md](./ux-harness-new-run-coverage-demo-works.md) | harness new coverage-demo + harness run succeeds with Result object — end-to-end harness path works. |
| 747 | open | Low | Harness / positive pattern | [ux-harness-new-success-good.md](./ux-harness-new-success-good.md) | harness new with --yes creates pair with clear Created harness pair at path success framing. |
| 748 | open | Low | Harness / positive pattern | [ux-harness-run-coverage-demo-works.md](./ux-harness-run-coverage-demo-works.md) | harness new coverage-demo + harness run succeeds with Result object summary and 0 spawns — demo path works … |
| 749 | open | Low | Harness / positive pattern | [ux-harness-run-fix-works.md](./ux-harness-run-fix-works.md) | harness run … --fix --yes succeeds with Result object — fix path works for demo. |
| 750 | open | Low | Harness / positive pattern | [ux-harness-run-no-pairs-clear.md](./ux-harness-run-no-pairs-clear.md) | harness run with no pairs: No harness pairs found — clear empty state. |
| 751 | open | Low | Harness | [ux-harness-unknown-template-no-kinds.md](./ux-harness-unknown-template-no-kinds.md) | No allow-list. |
| 752 | open | Low | Polish | [ux-help-subcommand-inconsistency.md](./ux-help-subcommand-inconsistency.md) | Some groups help [command]. |
| 753 | open | Low | Hooks / positive pattern | [ux-hooks-from-unknown-lists-supported-good.md](./ux-hooks-from-unknown-lists-supported-good.md) | Unsupported source hook agent lists Supported hook agents: claude-code, codex — good allow-list (still See … |
| 754 | open | Low | Install / positive pattern | [ux-install-opencode-success-good.md](./ux-install-opencode-success-good.md) | install opencode --yes: Installed OpenCode CLI — clear success (test still broken after install). |
| 755 | open | Low | Auth / positive pattern | [ux-login-api-key-rejected-good.md](./ux-login-api-key-rejected-good.md) | login --api-key sk-fake-not-real → API key rejected without overwriting session; auth status still logged in. |
| 756 | open | Low | Auth / positive pattern | [ux-login-fake-key-rejected-good.md](./ux-login-fake-key-rejected-good.md) | login --api-key sk-fake --yes: API key rejected — clear without writing fake key (when not logged in). |
| 757 | open | Low | Auth | [ux-login-yes-message-good-but-worth-aligning.md](./ux-login-yes-message-good-but-worth-aligning.md) | --yes fail-fast good; bare hangs. |
| 758 | open | Low | Auth / positive pattern | [ux-login-yes-without-key-message-good.md](./ux-login-yes-without-key-message-good.md) | login --yes without key: No API key found. Pass --api-key, set POE_API_KEY, or run without --yes to authent… |
| 759 | open | Low | Maestro | [ux-maestro-dual-invocation-shape.md](./ux-maestro-dual-invocation-shape.md) | Parent + run unclear. |
| 760 | open | Low | Maestro | [ux-maestro-duplicate-config-flags.md](./ux-maestro-duplicate-config-flags.md) | --config and --workflow same. |
| 761 | open | Low | Maestro / positive pattern | [ux-maestro-tui-mutual-exclusion-validation-good.md](./ux-maestro-tui-mutual-exclusion-validation-good.md) | Specifying both --config and --workflow fails with clear mutual exclusion message. |
| 762 | open | Low | Plan / positive pattern | [ux-markdown-read-depth-2-works-well.md](./ux-markdown-read-depth-2-works-well.md) | plan markdown-read --depth 2 prints numbered sections 1–6 for agent-goal plan; --output json includes depth… |
| 763 | open | Low | Plan / positive pattern | [ux-markdown-read-negative-depth-validation-good.md](./ux-markdown-read-negative-depth-validation-good.md) | markdown-read --depth -1: Invalid depth "-1". Expected a non-negative integer. |
| 764 | open | Low | Plan / positive pattern | [ux-markdown-read-section-by-number-works.md](./ux-markdown-read-section-by-number-works.md) | plan markdown-read-section … 1 prints section 1 body — section-by-number works (related wrong recovery comm… |
| 765 | open | Low | Plan / positive pattern | [ux-markdown-read-unlimited-depth-works.md](./ux-markdown-read-unlimited-depth-works.md) | plan markdown-read without --depth prints nested TOC 1–6 with subsections — good when depth unlimited. |
| 766 | open | Low | Spawn / positive pattern | [ux-mcp-servers-at-file-missing-validation-good.md](./ux-mcp-servers-at-file-missing-validation-good.md) | spawn --mcp-servers @/tmp/no-mcp.json: --mcp-servers could not read file path ENOENT — clear ValidationErro… |
| 767 | open | Low | Spawn / positive pattern | [ux-mcp-servers-file-and-json-validation-good.md](./ux-mcp-servers-file-and-json-validation-good.md) | Missing @file reports could not read file with path; invalid JSON reports required shape — good ValidationE… |
| 768 | open | Low | Spawn / positive pattern | [ux-mcp-servers-invalid-json-validation-good.md](./ux-mcp-servers-invalid-json-validation-good.md) | spawn --mcp-servers "{bad" → --mcp-servers must be valid JSON in this shape: {name: {command, args?, env?}}… |
| 769 | open | Low | Spawn / positive pattern | [ux-mcp-servers-validation-good.md](./ux-mcp-servers-validation-good.md) | Invalid MCP server JSON without command returns a clear field-level ValidationError without system chrome. |
| 770 | open | Low | Memory / positive pattern | [ux-memory-append-reason-defaults-to-append.md](./ux-memory-append-reason-defaults-to-append.md) | memory append --help: --reason default append — unlike write which requires reason; append has default so n… |
| 771 | open | Low | Memory / positive pattern | [ux-memory-cache-clear-requires-yes-good.md](./ux-memory-cache-clear-requires-yes-good.md) | memory cache clear without --yes refuses with Refusing to clear cache without --yes — good guard (still See… |
| 772 | open | Low | Memory / positive pattern | [ux-memory-cache-status-zero-good.md](./ux-memory-cache-status-zero-good.md) | memory cache status: 0 cache entries (0 bytes) — clear empty state. |
| 773 | open | Low | Memory / positive pattern | [ux-memory-clear-requires-yes-non-tty-good.md](./ux-memory-clear-requires-yes-non-tty-good.md) | memory clear without --yes: memory clear requires --yes when running without an interactive TTY — clear des… |
| 774 | open | Low | Memory / positive pattern | [ux-memory-clear-yes-reinitializes-index-log.md](./ux-memory-clear-yes-reinitializes-index-log.md) | memory clear --yes after init: Cleared memory; INDEX.md and LOG.md remain (re-initialized). Clear works wit… |
| 775 | open | Low | Memory / positive pattern | [ux-memory-clear-yes-works-when-initialized.md](./ux-memory-clear-yes-works-when-initialized.md) | memory clear --yes after init succeeds with Cleared memory design-system framing; without init points to me… |
| 776 | open | Low | Memory / explain / help / description quality | [ux-memory-explain-budget-token-internals.md](./ux-memory-explain-budget-token-internals.md) | `poe-code memory explain --help` shows `--budget <tokens> Token budget` in its Options section — the same L… |
| 777 | open | Low | Memory / positive pattern | [ux-memory-ingest-not-init-good.md](./ux-memory-ingest-not-init-good.md) | Memory is not initialized. Run poe-code memory init — clear recovery. |
| 778 | open | Low | Memory / positive pattern | [ux-memory-lint-empty-good.md](./ux-memory-lint-empty-good.md) | memory lint after init: No memory lint issues. |
| 779 | open | Low | Memory / positive pattern | [ux-memory-ls-empty-message-good.md](./ux-memory-ls-empty-message-good.md) | memory ls after init: No memory pages yet — clear empty state. |
| 780 | open | Low | Memory / query / help / description quality | [ux-memory-query-terse-description-and-budget-exposed.md](./ux-memory-query-terse-description-and-budget-exposed.md) | `memory query --help` has two issues: |
| 781 | open | Low | Memory / positive pattern | [ux-memory-search-empty-no-matches-good.md](./ux-memory-search-empty-no-matches-good.md) | memory search foo after init: No matches. — clear empty search (INDEX still not showable). |
| 782 | open | Low | Memory / positive pattern | [ux-memory-search-not-initialized-good.md](./ux-memory-search-not-initialized-good.md) | memory search without init: Memory is not initialized. Run poe-code memory init — clear recovery with binar… |
| 783 | open | Low | Memory / positive pattern | [ux-memory-status-not-initialized-good.md](./ux-memory-status-not-initialized-good.md) | memory status without init: Memory is not initialized. Run "poe-code memory init" — clear recovery with poe… |
| 784 | open | Low | Memory / status / visual | [ux-memory-status-title-not-pink.md](./ux-memory-status-title-not-pink.md) | `poe-code memory status` renders the panel title "Poe - memory status" in plain white/grey text rather than… |
| 785 | open | Low | Models / positive pattern | [ux-models-endpoint-messages-anthropic-good.md](./ux-models-endpoint-messages-anthropic-good.md) | models --endpoint /v1/messages --provider anthropic returns 8 anthropic models including sonnet-4.6 and opu… |
| 786 | open | Low | Models / positive pattern | [ux-models-endpoint-pricing-combo-works.md](./ux-models-endpoint-pricing-combo-works.md) | models --endpoint /v1/messages --view pricing returns multi-provider pricing table for messages-capable mod… |
| 787 | open | Low | Models / positive pattern | [ux-models-feature-reasoning-filter-works.md](./ux-models-feature-reasoning-filter-works.md) | models --feature reasoning --provider anthropic returns reasoning-capable models with ✓ in Reasoning column. |
| 788 | open | Low | Models / positive pattern | [ux-models-feature-tools-case-insensitive-good.md](./ux-models-feature-tools-case-insensitive-good.md) | models --feature TOOLS returns 139 tool models same as tools — case-insensitive feature filter. |
| 789 | open | Low | Models / positive pattern | [ux-models-feature-web-search-works.md](./ux-models-feature-web-search-works.md) | models --provider anthropic --feature web_search returns models with web_search ✓. |
| 790 | open | Low | Models / positive pattern | [ux-models-google-reasoning-filter-works.md](./ux-models-google-reasoning-filter-works.md) | models --provider google --feature reasoning returns 7 gemini models including 3.1-pro and 2.5-pro. |
| 791 | open | Low | Models / positive pattern | [ux-models-help-examples-are-excellent.md](./ux-models-help-examples-are-excellent.md) | models --help includes Filters, Views, and Examples sections — best-in-class help in the CLI; other primary… |
| 792 | open | Low | Help / positive pattern | [ux-models-help-examples-still-best-in-class.md](./ux-models-help-examples-still-best-in-class.md) | models --help Examples block shows provider, feature, endpoint, view, search, model, since — reconfirm best… |
| 793 | open | Low | Models / positive pattern | [ux-models-openai-tools-capabilities-good.md](./ux-models-openai-tools-capabilities-good.md) | models --view capabilities --provider openai --tools returns 41 tool-capable openai models. |
| 794 | open | Low | Models / positive pattern | [ux-models-openai-tools-filter-works.md](./ux-models-openai-tools-filter-works.md) | models --provider openai --tools returns tool-capable openai models cleanly. |
| 795 | open | Low | Models / positive pattern | [ux-models-parameters-view-good-for-filtered.md](./ux-models-parameters-view-good-for-filtered.md) | parameters view for anthropic shows output_effort enums including xhigh — useful for configuring reasoning-… |
| 796 | open | Low | Models / positive pattern | [ux-models-pricing-anthropic-sonnet-works.md](./ux-models-pricing-anthropic-sonnet-works.md) | models pricing + provider anthropic + search sonnet returns sonnet-4.6 and 4.5 with $/MTok — multi-filter p… |
| 797 | open | Low | Models / positive pattern | [ux-models-pricing-search-combo-good.md](./ux-models-pricing-search-combo-good.md) | models --search haiku --view pricing shows clean single-model pricing row. |
| 798 | open | Low | Models / positive pattern | [ux-models-pricing-search-works.md](./ux-models-pricing-search-works.md) | models --view pricing --search haiku and --model claude-haiku-4.5 show clear pricing table. |
| 799 | open | Low | Models / positive pattern | [ux-models-pricing-sonnet-4-6-good.md](./ux-models-pricing-sonnet-4-6-good.md) | models --view pricing --model claude-sonnet-4.6 shows $2.58/$12.88 per MTok cleanly. |
| 800 | open | Low | Models / positive pattern | [ux-models-provider-anthropic-tools-good.md](./ux-models-provider-anthropic-tools-good.md) | models --feature tools --provider anthropic returns 8 anthropic tool models including sonnet-4.6 and opus-4… |
| 801 | open | Low | Models / positive pattern | [ux-models-provider-case-insensitive-good.md](./ux-models-provider-case-insensitive-good.md) | models --provider Anthropic --search sonnet works same as anthropic — case-insensitive provider filter. |
| 802 | open | Low | Models / positive pattern | [ux-models-provider-xai-works.md](./ux-models-provider-xai-works.md) | models --provider xai lists grok models cleanly. |
| 803 | open | Low | Models / positive pattern | [ux-models-since-7d-works.md](./ux-models-since-7d-works.md) | models --since 7d returns 2 recent models; --since 1s returns 0 with No models match — duration filter works. |
| 804 | open | Low | Models / positive pattern | [ux-models-tools-and-feature-tools-redundant-ok.md](./ux-models-tools-and-feature-tools-redundant-ok.md) | models --tools --feature tools --provider anthropic returns same tool-capable set — redundant flags compose… |
| 805 | open | Low | Models | [ux-models-view-raw-bypasses-design-system-reconfirmed.md](./ux-models-view-raw-bypasses-design-system-reconfirmed.md) | models --view raw --search haiku prints bare YAML without design-system panel — reconfirm raw view escape h… |
| 806 | open | Low | Models / positive pattern | [ux-models-xai-reasoning-filter-works.md](./ux-models-xai-reasoning-filter-works.md) | models --feature reasoning --provider xai returns xai/grok-3-mini — multi-filter works. |
| 807 | open | Low | Spawn / positive pattern | [ux-pi-agent-alias-works.md](./ux-pi-agent-alias-works.md) | spawn pi-agent resolves to pi and succeeds — positive alias behavior (title shows spawn pi). |
| 808 | open | Low | Pipeline / positive pattern | [ux-pipeline-init-yes-requires-source-good.md](./ux-pipeline-init-yes-requires-source-good.md) | Provide --source or --sources when using --yes is clear non-TTY guidance. |
| 809 | open | Low | Pipeline / positive pattern | [ux-pipeline-max-runs-zero-good-validation.md](./ux-pipeline-max-runs-zero-good-validation.md) | Invalid max-runs "0" returns clear positive-integer validation without raw Commander text — positive patter… |
| 810 | open | Low | Pipeline / positive pattern | [ux-pipeline-max-runs-zero-validation-good.md](./ux-pipeline-max-runs-zero-validation-good.md) | pipeline run --max-runs 0: Invalid max-runs "0". Expected a positive integer — clear ValidationError. |
| 811 | open | Low | Pipeline / positive pattern | [ux-pipeline-run-model-override-shown-on-nothing-to-run.md](./ux-pipeline-run-model-override-shown-on-nothing-to-run.md) | pipeline run with --model shows Model: anthropic/claude-haiku-4.5 in Config even when 21/21 done and Nothin… |
| 812 | open | Low | Pipeline / positive pattern | [ux-pipeline-validate-good-plan-positive.md](./ux-pipeline-validate-good-plan-positive.md) | pipeline validate tiny-http… shows Plan path, 21 tasks done, steps list, Plan is valid — clear design-syste… |
| 813 | open | Low | Pipeline / positive pattern | [ux-pipeline-validate-valid-pipeline-good.md](./ux-pipeline-validate-valid-pipeline-good.md) | pipeline validate on valid pipeline shows Plan, Tasks 21 done, Steps, Plan is valid — clear success framing. |
| 814 | open | Low | Pipeline / positive pattern | [ux-pipeline-validate-wrong-kind-good-message.md](./ux-pipeline-validate-wrong-kind-good-message.md) | pipeline validate on plan-kind file: Invalid plan YAML: "kind" must be "pipeline" — clear kind check (still… |
| 815 | open | Low | Plan / positive pattern | [ux-plan-archive-json-output-good.md](./ux-plan-archive-json-output-good.md) | plan archive path --yes --output json returns action/path/archivedPath JSON — good machine contract (destru… |
| 816 | open | Low | Plan / positive pattern | [ux-plan-archive-requires-yes-non-tty-good.md](./ux-plan-archive-requires-yes-non-tty-good.md) | plan archive docs/plans/32-agent-goal.md --output md without --yes: plan archive requires --yes when runnin… |
| 817 | open | Low | Plan / positive pattern | [ux-plan-delete-json-output-good.md](./ux-plan-delete-json-output-good.md) | plan delete path --yes --output json returns action/path — good machine contract (restored file after audit). |
| 818 | open | Low | Plan | [ux-plan-edit-bare-edited-message.md](./ux-plan-edit-bare-edited-message.md) | EDITOR=true plan edit path prints Edited docs/plans/… without design-system panel. |
| 819 | open | Low | Plan / help / formatting | [ux-plan-help-keymap-hint-unframed.md](./ux-plan-help-keymap-hint-unframed.md) | `plan --help` ends with a bare line: |
| 820 | open | Low | Plan install / positive pattern | [ux-plan-install-dry-run-clean-good.md](./ux-plan-install-dry-run-clean-good.md) | plan install --agent claude --local --yes --dry-run: Would create SKILL.md; Would install; no filesystem ch… |
| 821 | open | Low | Plan install / positive pattern | [ux-plan-install-pi-clearer-than-unknown.md](./ux-plan-install-pi-clearer-than-unknown.md) | plan install pi: Unsupported agent: pi — better than install/test Unknown agent for capability gaps. |
| 822 | open | Low | Plan / positive pattern | [ux-plan-install-success-good.md](./ux-plan-install-success-good.md) | plan install shows Create path and Installed plan skill with design-system framing — positive pattern. |
| 823 | open | Low | Plan / positive pattern | [ux-plan-kind-invalid-validation-good.md](./ux-plan-kind-invalid-validation-good.md) | Invalid --kind bogus lists Expected plan, pipeline, experiment, ralph, superintendent, superintendent-base. |
| 824 | open | Low | Plan list / positive pattern | [ux-plan-list-invalid-kind-output-validation-good.md](./ux-plan-list-invalid-kind-output-validation-good.md) | plan list --kind bogus and --output bogus return clear Expected … lists without See logs. |
| 825 | open | Low | Plan list | [ux-plan-list-json-empty-is-bare-array.md](./ux-plan-list-json-empty-is-bare-array.md) | Empty plan list as JSON is bare [] without envelope — fine for scripts but inconsistent with design-system … |
| 826 | open | Low | Plan list / positive pattern | [ux-plan-list-output-md-is-markdown-table-good.md](./ux-plan-list-output-md-is-markdown-table-good.md) | plan list --output md prints GFM table with Kind/Type/Name/Detail/Updated — good export (still includes REA… |
| 827 | open | Low | Plan list / positive pattern | [ux-plan-list-pipeline-json-good.md](./ux-plan-list-pipeline-json-good.md) | JSON array with kind, path, detail 21/21 done — good machine-readable pipeline list. |
| 828 | open | Low | Plan / positive pattern | [ux-plan-markdown-read-section-by-number-works.md](./ux-plan-markdown-read-section-by-number-works.md) | plan markdown-read-section … "2" returns section 2 User-facing shape content correctly. |
| 829 | open | Low | Plan / positive pattern | [ux-plan-output-invalid-validation-good.md](./ux-plan-output-invalid-validation-good.md) | Invalid --output value "bad" returns Expected one of: terminal, md, json without raw Commander skin. |
| 830 | open | Low | Plan path | [ux-plan-path-commands-bare-stdout-reconfirmed.md](./ux-plan-path-commands-bare-stdout-reconfirmed.md) | pipeline/experiment/superintendent plan-path print absolute path as bare stdout — good for scripting, incon… |
| 831 | open | Low | Plan paths | [ux-plan-path-commands-bare-stdout.md](./ux-plan-path-commands-bare-stdout.md) | Path only. |
| 832 | open | Low | Plan / positive pattern | [ux-plan-view-missing-path-good.md](./ux-plan-view-missing-path-good.md) | plan view /tmp/no-plan.md: Plan not found: path — clear without See logs. |
| 833 | open | Low | Plan / positive pattern | [ux-plan-view-non-tty-requires-path-good.md](./ux-plan-view-non-tty-requires-path-good.md) | plan view without path: Plan selection requires a path or --yes when running without an interactive TTY — c… |
| 834 | open | Low | Plan / positive pattern | [ux-plan-view-pipeline-md-output-good.md](./ux-plan-view-pipeline-md-output-good.md) | plan view on pipeline plan with --output md produces markdown checklist Status 21/21 done with tasks — good… |
| 835 | open | Low | Configure / positive pattern | [ux-poe-no-prompt-works-for-configure-dry-run.md](./ux-poe-no-prompt-works-for-configure-dry-run.md) | POE_NO_PROMPT=1 configure claude --model haiku --dry-run proceeds without TTY — works but remains obscure v… |
| 836 | open | Low | Provider / Runtime / Harness / help / capitalisation | [ux-provider-help-command-lowercase-systemic.md](./ux-provider-help-command-lowercase-systemic.md) | Several commands expose a `help [command]` subcommand in their Commands list with a lowercase description "… |
| 837 | open | Low | Providers / positive pattern | [ux-provider-list-all-logged-out-clean.md](./ux-provider-list-all-logged-out-clean.md) | provider list when not logged in shows all providers Status [-] without secrets — clean empty auth state. |
| 838 | open | Low | Providers / positive pattern | [ux-provider-login-anthropic-dry-run-clean.md](./ux-provider-login-anthropic-dry-run-clean.md) | provider login anthropic --api-key sk-fake --dry-run: would save credential; no filesystem changes — clean … |
| 839 | open | Low | Providers / positive pattern | [ux-provider-login-anthropic-dry-run-good.md](./ux-provider-login-anthropic-dry-run-good.md) | provider login anthropic --api-key test --yes --dry-run says would save credential without dumping secrets … |
| 840 | open | Low | Providers / positive pattern | [ux-provider-login-cloudflare-requires-base-url-good.md](./ux-provider-login-cloudflare-requires-base-url-good.md) | Provider "cloudflare" requires a base URL. Pass --base-url or set CF_AIG_BASE_URL — clear recovery (still S… |
| 841 | open | Low | Providers / positive pattern | [ux-provider-logout-anthropic-dry-run-good.md](./ux-provider-logout-anthropic-dry-run-good.md) | provider logout anthropic --dry-run only shows would log out + rm credentials.anthropic.enc — good contrast… |
| 842 | open | Low | Providers / positive pattern | [ux-provider-logout-openai-dry-run-clean.md](./ux-provider-logout-openai-dry-run-clean.md) | provider logout openai --dry-run only would log out + rm credentials.openai.enc — clean credential-only dry… |
| 843 | open | Low | Ralph / positive pattern | [ux-ralph-init-missing-doc-not-found-good.md](./ux-ralph-init-missing-doc-not-found-good.md) | ralph init /tmp/no-ralph.md --yes: Ralph doc not found: path — clear (kind-aware enough). |
| 844 | open | Low | Brand | [ux-root-tagline-inconsistent.md](./ux-root-tagline-inconsistent.md) | Different one-liners. |
| 845 | open | Low | Runtime / positive pattern | [ux-runtime-build-host-message-good.md](./ux-runtime-build-host-message-good.md) | Host runtime has no template to build with pass --runtime e2b/docker or config hint — clear recovery. |
| 846 | open | Low | Runtime / positive pattern | [ux-runtime-init-docker-dry-run-clean.md](./ux-runtime-init-docker-dry-run-clean.md) | runtime init --type docker --yes --dry-run: would set runtime.type docker; would create Dockerfile — clean. |
| 847 | open | Low | Runtime / positive pattern | [ux-runtime-init-dry-run-clean.md](./ux-runtime-init-dry-run-clean.md) | runtime init --type host --yes --dry-run: would set runtime.type; would create Dockerfile if missing — inte… |
| 848 | open | Low | Runtime / jobs / memory / naming / consistency | [ux-runtime-jobs-ls-inconsistent-with-list.md](./ux-runtime-jobs-ls-inconsistent-with-list.md) | `poe-code runtime jobs ls` lists detached runtime jobs. Every other list-style command in the CLI uses `lis… |
| 849 | open | Low | Runtime / positive pattern | [ux-runtime-templates-clear-no-yes-needed-good.md](./ux-runtime-templates-clear-no-yes-needed-good.md) | runtime templates clear with empty cache: No local runtime template cache entries to clear — clear; --yes n… |
| 850 | open | Low | Configure / positive pattern | [ux-shape-base-url-invalid-format-validation-good.md](./ux-shape-base-url-invalid-format-validation-good.md) | configure --shape-base-url https://example.invalid: Invalid --shape-base-url value. Use <shape-id>=<url> — … |
| 851 | open | Low | Configure / positive pattern | [ux-shape-base-url-invalid-validation-good.md](./ux-shape-base-url-invalid-validation-good.md) | Invalid --shape-base-url value returns Use <shape-id>=<url> clearly. |
| 852 | open | Low | Configure / positive pattern | [ux-shape-base-url-unknown-shape-lists-exposed-good.md](./ux-shape-base-url-unknown-shape-lists-exposed-good.md) | Unknown API shape "messages" lists Exposed shapes: openai-chat-completions, openai-responses, anthropic-mes… |
| 853 | open | Low | Spawn / positive pattern | [ux-skill-bridge-failure-lists-paths-good.md](./ux-skill-bridge-failure-lists-paths-good.md) | Failed to bridge active skills lists Not found skill references and searched paths — good recovery content … |
| 854 | open | Low | Skills / positive pattern | [ux-skill-configure-goose-local-success.md](./ux-skill-configure-goose-local-success.md) | skill configure goose --yes --local succeeds at ./.agents/skills with clear path. |
| 855 | open | Low | Skills / positive pattern | [ux-skill-configure-pi-poe-agent-not-supported-clear.md](./ux-skill-configure-pi-poe-agent-not-supported-clear.md) | skill configure pi/poe-agent: Skills not supported for pi/poe-agent — clear capability message (contrast co… |
| 856 | open | Low | Skill / help / usage / consistency | [ux-skill-help-usage-says-options-not-command.md](./ux-skill-help-usage-says-options-not-command.md) | `poe-code skill --help` shows: |
| 857 | open | Low | Skills / positive pattern | [ux-skill-install-from-file-works-well.md](./ux-skill-install-from-file-works-well.md) | skill install with --file/--name/--yes/--local produces a clear design-system success naming agent and path… |
| 858 | open | Low | Skills / positive pattern | [ux-skill-unconfigure-goose-no-dir-good.md](./ux-skill-unconfigure-goose-no-dir-good.md) | skill unconfigure goose --local: No skill directory found for goose at .agents/skills — clear no-op without… |
| 859 | open | Low | Skills / positive pattern | [ux-skill-unconfigure-refuses-nonempty-without-force-good.md](./ux-skill-unconfigure-refuses-nonempty-without-force-good.md) | skill unconfigure claude: Skill directory … has files. Use --force to remove — clear safety (no --yes on he… |
| 860 | open | Low | Spawn / positive pattern | [ux-spawn-at-file-missing-validation-good.md](./ux-spawn-at-file-missing-validation-good.md) | spawn @/tmp/no-prompt.txt reports prompt could not read file with path and ENOENT — clear ValidationError s… |
| 861 | open | Low | Spawn / positive pattern | [ux-spawn-at-file-works.md](./ux-spawn-at-file-works.md) | spawn claude @/tmp/file with content succeeds — reconfirm @file prompt form works. |
| 862 | open | Low | Spawn / positive pattern | [ux-spawn-codex-works-with-frontier-model.md](./ux-spawn-codex-works-with-frontier-model.md) | spawn codex --model openai/gpt-5.3-codex succeeds (with stdin reading message residual). |
| 863 | open | Low | Spawn / positive pattern | [ux-spawn-cursor-with-model-works.md](./ux-spawn-cursor-with-model-works.md) | spawn cursor "say only: ok" --mode read --model anthropic/claude-haiku-4.5 succeeds. |
| 864 | open | Low | Spawn / positive pattern | [ux-spawn-cwd-tmp-works.md](./ux-spawn-cwd-tmp-works.md) | spawn with -C /tmp succeeds; Resume line shows cd /tmp && claude --resume — cwd override works. |
| 865 | open | Low | Spawn / positive pattern | [ux-spawn-invalid-mode-validation-good.md](./ux-spawn-invalid-mode-validation-good.md) | Invalid --mode "bogus" returns Expected yolo, auto, edit, or read without Commander raw skin. |
| 866 | open | Low | Spawn / positive pattern | [ux-spawn-log-default-redacts-agent-message-good.md](./ux-spawn-log-default-redacts-agent-message-good.md) | Default ACP JSONL log writes agent_message text as [redacted] — good privacy default. --log-content include… |
| 867 | open | Low | Spawn / positive pattern | [ux-spawn-pi-yes-works.md](./ux-spawn-pi-yes-works.md) | spawn pi "say only: ok" --yes succeeds without --mode (pi may not require mode like claude). |
| 868 | open | Low | Spawn / positive pattern | [ux-spawn-runtime-docker-error-good-install-hints.md](./ux-spawn-runtime-docker-error-good-install-hints.md) | No container engine found includes Docker Desktop / Colima / Podman install hints — good recovery copy (sti… |
| 869 | open | Low | Spawn / positive pattern | [ux-spawn-runtime-host-works.md](./ux-spawn-runtime-host-works.md) | spawn … --runtime host succeeds for claude with valid model — host runtime path works. |
| 870 | open | Low | Spawn / positive pattern | [ux-spawn-stdin-pipe-works.md](./ux-spawn-stdin-pipe-works.md) | echo "say only: ok" / spawn claude --mode read --model haiku --stdin succeeds. |
| 871 | open | Low | Spawn / positive pattern | [ux-spawn-test-cursor-works.md](./ux-spawn-test-cursor-works.md) | spawn cursor and test cursor with anthropic/claude-haiku-4.5 succeed. |
| 872 | open | Low | Spawn / positive pattern | [ux-spawn-test-goose-works.md](./ux-spawn-test-goose-works.md) | spawn goose and test goose with anthropic/claude-haiku-4.5 succeed. |
| 873 | open | Low | Configure / positive pattern | [ux-spawn-test-sonnet-4-6-works.md](./ux-spawn-test-sonnet-4-6-works.md) | spawn and test claude with anthropic/claude-sonnet-4.6 succeed — live model works when explicitly passed; d… |
| 874 | open | Low | Spawn / positive pattern | [ux-spawn-yes-with-explicit-mode-read-works.md](./ux-spawn-yes-with-explicit-mode-read-works.md) | spawn … --yes --mode read succeeds — explicit --mode overrides --yes yolo default as help implies. |
| 875 | open | Low | Superintendent / positive pattern | [ux-superintendent-complete-missing-doc-good.md](./ux-superintendent-complete-missing-doc-good.md) | superintendent complete /tmp/no.md: Superintendent document not found — clear (better than Unclosed tag on … |
| 876 | open | Low | Superintendent / positive pattern | [ux-superintendent-run-empty-good.md](./ux-superintendent-run-empty-good.md) | superintendent run --yes: No superintendent documents found — clear empty state. |
| 877 | open | Low | Tasks / positive pattern | [ux-tasks-verify-bad-list-format-good.md](./ux-tasks-verify-bad-list-format-good.md) | tasks verify some-list: Expected project to use "<owner>/<number>" format — clear ValidationError. |
| 878 | open | Low | Tasks / positive pattern | [ux-tasks-verify-format-error-good.md](./ux-tasks-verify-format-error-good.md) | Expected project to use owner/number format is clear (still [error] prefix odd). |
| 879 | open | Low | Test / positive pattern | [ux-test-codex-with-valid-model-succeeds.md](./ux-test-codex-with-valid-model-succeeds.md) | test codex --model openai/gpt-5.3-codex succeeds with design-system Tested Codex framing. |
| 880 | open | Low | Test / positive pattern | [ux-test-goose-with-valid-model-succeeds.md](./ux-test-goose-with-valid-model-succeeds.md) | test goose --model anthropic/claude-haiku-4.5 succeeds with Tested Goose framing. |
| 881 | open | Low | Test / positive pattern | [ux-test-with-valid-model-succeeds.md](./ux-test-with-valid-model-succeeds.md) | test claude --model anthropic/claude-haiku-4.5 succeeds with Tested Claude Code framing when model is valid… |
| 882 | open | Low | Traces / positive pattern | [ux-traces-invalid-source-validation-good.md](./ux-traces-invalid-source-validation-good.md) | traces --source bogus: Unsupported trace source "bogus". Expected one of: claude, codex, poe-code — clear V… |
| 883 | open | Low | Traces / positive pattern | [ux-traces-limit-3-works.md](./ux-traces-limit-3-works.md) | traces --limit 3 shows 3 recent traces table (claude/codex/pi) — --limit works on traces (models still lack… |
| 884 | open | Low | Traces / positive pattern | [ux-traces-since-and-source-limit-work.md](./ux-traces-since-and-source-limit-work.md) | traces --since 1d --limit 5 and traces --source claude --limit 2 return filtered tables — --since/--source/… |
| 885 | open | Low | Traces / positive pattern | [ux-traces-since-limit-works.md](./ux-traces-since-limit-works.md) | traces --since 1h --limit 3 returns 3 recent traces with sources — filters work. |
| 886 | open | Low | Traces / positive pattern | [ux-traces-source-invalid-validation-good.md](./ux-traces-source-invalid-validation-good.md) | Unsupported trace source lists Expected one of: claude, codex, poe-code without stack. |
| 887 | open | Low | Traces / positive pattern | [ux-traces-unsupported-source-validation-good.md](./ux-traces-unsupported-source-validation-good.md) | traces --source bogus: Unsupported trace source "bogus". Expected one of: claude, codex, pi, poe-code — cle… |
| 888 | open | Low | Update / positive pattern | [ux-update-dry-run-always-global-npm.md](./ux-update-dry-run-always-global-npm.md) | update --dry-run plans npm install -g poe-code@latest — clear dry-run (always -g; package-manager override … |
| 889 | open | Low | Update / positive pattern | [ux-update-dry-run-clean-good.md](./ux-update-dry-run-clean-good.md) | update --dry-run: would run npm install -g poe-code@latest — clean intentional dry-run. |
| 890 | open | Low | Update / positive pattern | [ux-update-package-manager-override-works.md](./ux-update-package-manager-override-works.md) | update --package-manager bun --dry-run correctly plans bun install -g poe-code@latest — positive package-ma… |
| 891 | open | Low | Update / positive pattern | [ux-update-package-manager-pnpm-dry-run-good.md](./ux-update-package-manager-pnpm-dry-run-good.md) | update --package-manager pnpm --dry-run: would run pnpm add -g poe-code@latest — clean package-manager over… |
| 892 | open | Low | Update / positive pattern | [ux-update-pnpm-package-manager-works.md](./ux-update-pnpm-package-manager-works.md) | update --package-manager pnpm --dry-run plans pnpm add -g poe-code@latest — positive package manager overri… |
| 893 | open | Low | Usage / positive pattern | [ux-usage-balance-default-good.md](./ux-usage-balance-default-good.md) | usage with no subcommand shows balance card with plan/add-on and next grant — strong positive. |
| 894 | open | Low | Usage / positive pattern | [ux-usage-balance-presentation-good.md](./ux-usage-balance-presentation-good.md) | usage balance shows Balance, Plan, Add-on, next grant with design-system framing and helpful next-points link. |
| 895 | open | Low | Usage / positive pattern | [ux-usage-list-filter-works-well.md](./ux-usage-list-filter-works-well.md) | usage list --filter Claude-Haiku returns filtered table with clear costs — good list UX (still no --json). |
| 896 | open | Low | Usage / positive pattern | [ux-usage-list-filter-works.md](./ux-usage-list-filter-works.md) | usage list --filter Claude-Sonnet shows filtered usage table with Sonnet-4.6 rows — filter works. |
| 897 | open | Low | Usage / positive pattern | [ux-usage-list-no-match-message-good.md](./ux-usage-list-no-match-message-good.md) | usage list --filter nonexistent-model-xyz → No entries match "…" — clear empty filter message. |
| 898 | open | Low | Usage / positive pattern | [ux-usage-list-table-works.md](./ux-usage-list-table-works.md) | usage list shows Date/Model/Cost/tokens table with 20 entries — design-system table works. |
| 899 | open | Low | Utils / positive pattern | [ux-utils-config-init-already-exists-is-info.md](./ux-utils-config-init-already-exists-is-info.md) | config init when project config exists prints Project config already exists at path without error exit dram… |
| 900 | open | Low | Utils / positive pattern | [ux-utils-config-show-logged-out-clean-no-secrets.md](./ux-utils-config-show-logged-out-clean-no-secrets.md) | utils config show with empty global and no env overrides shows project ralph/runtime config only — no secre… |
| 901 | open | Low | Utils / help / usage / consistency | [ux-utils-help-usage-says-options-not-command.md](./ux-utils-help-usage-says-options-not-command.md) | `poe-code utils --help` shows: |
| 902 | open | Low | Utils / positive pattern | [ux-utils-symlink-agents-already-linked-good.md](./ux-utils-symlink-agents-already-linked-good.md) | utils symlink agents --dry-run prints already linked without error — good idempotent message. |
| 903 | open | Low | Utils / positive pattern | [ux-utils-symlink-skills-both-exist-good-guidance.md](./ux-utils-symlink-skills-both-exist-good-guidance.md) | When both .claude/skills and .agents/skills exist, message explains resolve manually steps — good conflict … |
| 904 | open | Low | Utils / positive pattern | [ux-utils-symlink-skills-yes-local-dry-run-works.md](./ux-utils-symlink-skills-yes-local-dry-run-works.md) | With explicit scope flags, dry-run shows rename+symlink plan — positive once scope is provided (still subje… |
| 905 | open | Low | Spawn | [ux-verbose-spawn-prefix-minimal.md](./ux-verbose-spawn-prefix-minimal.md) | spawn --verbose adds [spawn:claude-code] line before Resume — relatively quiet (related verbose prefixes ev… |
| 906 | open | Low | Worktree / positive pattern | [ux-worktree-list-empty-good.md](./ux-worktree-list-empty-good.md) | worktree list: No managed worktrees — clear empty state. |
| 907 | open | Low | Worktree / list / empty state / visual consistency | [ux-worktree-list-empty-state-unframed.md](./ux-worktree-list-empty-state-unframed.md) | `poe-code worktree list` when no worktrees exist shows: |

## Platform fixes

1. **Secret redaction** (dry-run diffs + auth + logout + unconfigure) + danger help on auth api-key  
2. **One-line fix: sonnet-5 → sonnet-4.6 in constants.ts + goose map** (catalog 0 matches; goose.ts still has sonnet-5 context)  
3. Make `--skip-if-configured` truthful (including matching-model dry-run)  
4. **Validate configure --model against catalog** (reject any-string); refuse garbage ids like fable-5  
5. Intentional-only dry-run diffs (including base-url/shape-base-url visibility); **provider login credential-only**  
6. **Honor --reasoning-effort** (still ignored — always high after settings restore; was always xhigh)  
7. **Resolve model aliases** (sonnet/haiku) to full ids; show resolved id  
8. models filters: namespaced ids (all views); reject invalid filters; **no stacks**; **--limit**; **normalize provider display ids**; raw empty dumps all  
9. Reject empty/invalid explicit flags  
10. Unified permission mode enum; **--yes must not default spawn to yolo**  
11. **Unified skill-install scope flags + real --force overwrite policy**; **never wipe entire skills dir**; **experiment install --force must work**  
12. UserError classification; no success glyphs on failure; no JSONL flood on test  
13. displayBinaryName vs npm run dev / toolcraft  
14. **Agent capability matrix** (spawnable / configurable / installable); **pi/kimi/poe-agent** not Unknown agent  
15. Destructive policy + model catalog validation  
16. **Doctor overview** (would catch model sonnet + xhigh + fable corruption + auth loss) + shell completion  
17. Runtime/launch job GC + blank-ID rows; **detach requires runtime context** (not silent ignore)  
18. Parent-group next-step defaults  
19. Detach/runner-sync require runtime context  
20. **Slim published npm bins**  
21. Non-TTY fail-fast: honor **--yes** over POE_NO_PROMPT (test/configure/gaslight/ingest); **--interactive requires TTY**  
22. **Kind-aware** plan/experiment/ralph/superintendent doc errors (not not-found / Unclosed tag)  
23. Split auth logout vs full factory reset; danger help + --yes  
24. Ralph init bootstrap any markdown; ralph validate parity  
25. Root command typo suggestions  
26. Fail/warn on unwritable --log-dir; print log paths  
27. Eval scaffold runnable defaults; **eval init path under evals/**  
28. **Fix memory INDEX/LOG path contract** (init vs show/ls); user pages work  
29. **Surface all public commands on root help** (skill/memory/runtime/eval/provider/… — 13 still hidden)  
30. Fix **gemini/kimi/opencode/pi credential paths** + model id namespaces + gemini providerCredential  
31. Hooks source→target capability matrix; auto/symlink user-settings policy  
32. **Launch without turbo monorepo noise**; clear start failures; launch vs runtime error copy  
33. Opt-in postinstall skill sync  
34. plan browse / plan root non-TTY path/list contract; **plan view JSON without full content flood**  
35. Primary command Examples (spawn/configure)  
36. **Gaslight: no auto-Implement; help must not say implement; mode read must not mutate plans/**  
37. Unified --worktree on spawn (gaslight already has it)  
38. Document/list harness new template kinds  
39. Split provider logout credential-only vs agent unconfigure  

## Alphabetical index

| File | # |
| --- | ---: |
| [ux-acp-stream-uses-success-glyph-for-partial-text.md](./ux-acp-stream-uses-success-glyph-for-partial-text.md) | 317 |
| [ux-activity-timeout-1ms-works-but-chrome.md](./ux-activity-timeout-1ms-works-but-chrome.md) | 704 |
| [ux-activity-timeout-ms-uses-system-chrome.md](./ux-activity-timeout-ms-uses-system-chrome.md) | 318 |
| [ux-activity-timeout-ms-zero-validation-good.md](./ux-activity-timeout-ms-zero-validation-good.md) | 705 |
| [ux-activity-timeout-zero-good-validation.md](./ux-activity-timeout-zero-good-validation.md) | 706 |
| [ux-activity-timeout-zero-validation-good.md](./ux-activity-timeout-zero-validation-good.md) | 707 |
| [ux-agent-api-key-and-stale-default-model.md](./ux-agent-api-key-and-stale-default-model.md) | 319 |
| [ux-agent-api-key-flag-on-help.md](./ux-agent-api-key-flag-on-help.md) | 320 |
| [ux-agent-capability-matrix-spawn-vs-configure-vs-install.md](./ux-agent-capability-matrix-spawn-vs-configure-vs-install.md) | 29 |
| [ux-agent-default-model-hardcoded.md](./ux-agent-default-model-hardcoded.md) | 623 |
| [ux-agent-default-model-is-opus-4-7-good.md](./ux-agent-default-model-is-opus-4-7-good.md) | 708 |
| [ux-agent-default-model-works-when-opus-valid.md](./ux-agent-default-model-works-when-opus-valid.md) | 709 |
| [ux-agent-default-opus-4-7-not-latest-opus-4-8.md](./ux-agent-default-opus-4-7-not-latest-opus-4-8.md) | 624 |
| [ux-agent-empty-api-key-silently-uses-stored.md](./ux-agent-empty-api-key-silently-uses-stored.md) | 321 |
| [ux-agent-empty-model-see-logs.md](./ux-agent-empty-model-see-logs.md) | 322 |
| [ux-agent-empty-prompt-see-logs.md](./ux-agent-empty-prompt-see-logs.md) | 323 |
| [ux-agent-invalid-model-system-chrome.md](./ux-agent-invalid-model-system-chrome.md) | 324 |
| [ux-agent-missing-prompt-raw-commander.md](./ux-agent-missing-prompt-raw-commander.md) | 325 |
| [ux-agent-spawn-missing-args-raw-commander.md](./ux-agent-spawn-missing-args-raw-commander.md) | 326 |
| [ux-api-key-flags-encourage-shell-history-leaks.md](./ux-api-key-flags-encourage-shell-history-leaks.md) | 327 |
| [ux-approval-copy-hardcodes-toolcraft-in-source.md](./ux-approval-copy-hardcodes-toolcraft-in-source.md) | 30 |
| [ux-approval-queued-message-says-toolcraft.md](./ux-approval-queued-message-says-toolcraft.md) | 31 |
| [ux-approvals-invalid-state-silent-empty-reconfirmed.md](./ux-approvals-invalid-state-silent-empty-reconfirmed.md) | 328 |
| [ux-approvals-invalid-state-silent-empty.md](./ux-approvals-invalid-state-silent-empty.md) | 329 |
| [ux-approvals-list-pending-empty-good.md](./ux-approvals-list-pending-empty-good.md) | 710 |
| [ux-approvals-missing-id-says-task-not-found-double.md](./ux-approvals-missing-id-says-task-not-found-double.md) | 32 |
| [ux-approvals-show-missing-says-task-not-found.md](./ux-approvals-show-missing-says-task-not-found.md) | 33 |
| [ux-approvals-show-missing-task-debug-tease-reconfirmed.md](./ux-approvals-show-missing-task-debug-tease-reconfirmed.md) | 330 |
| [ux-auth-api-key-displays-secret-to-stdout.md](./ux-auth-api-key-displays-secret-to-stdout.md) | 34 |
| [ux-auth-api-key-dry-run-still-prints-secret-2026-07-08-reconfirm.md](./ux-auth-api-key-dry-run-still-prints-secret-2026-07-08-reconfirm.md) | 35 |
| [ux-auth-api-key-dry-run-still-prints-secret-live-reconfirm.md](./ux-auth-api-key-dry-run-still-prints-secret-live-reconfirm.md) | 36 |
| [ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md](./ux-auth-api-key-dry-run-still-prints-secret-reconfirmed.md) | 37 |
| [ux-auth-api-key-dry-run-still-prints-secret.md](./ux-auth-api-key-dry-run-still-prints-secret.md) | 4 |
| [ux-auth-api-key-help-no-danger-or-mask-flag.md](./ux-auth-api-key-help-no-danger-or-mask-flag.md) | 38 |
| [ux-auth-api-key-help-no-danger-warning.md](./ux-auth-api-key-help-no-danger-warning.md) | 39 |
| [ux-auth-api-key-help-still-no-danger-reconfirmed.md](./ux-auth-api-key-help-still-no-danger-reconfirmed.md) | 40 |
| [ux-auth-api-key-prints-secret.md](./ux-auth-api-key-prints-secret.md) | 3 |
| [ux-auth-help-api-key-no-danger.md](./ux-auth-help-api-key-no-danger.md) | 331 |
| [ux-auth-login-api-key-shell-history-risk.md](./ux-auth-login-api-key-shell-history-risk.md) | 332 |
| [ux-auth-logout-no-confirmation-removes-all-agents.md](./ux-auth-logout-no-confirmation-removes-all-agents.md) | 25 |
| [ux-auth-logout-same-as-logout-help.md](./ux-auth-logout-same-as-logout-help.md) | 41 |
| [ux-auth-status-became-not-logged-in-mid-session.md](./ux-auth-status-became-not-logged-in-mid-session.md) | 42 |
| [ux-auth-status-logged-in-good.md](./ux-auth-status-logged-in-good.md) | 711 |
| [ux-auth-status-no-json-flag.md](./ux-auth-status-no-json-flag.md) | 625 |
| [ux-auth-status-spinner-pre-panel.md](./ux-auth-status-spinner-pre-panel.md) | 333 |
| [ux-auth-whoami-field-shape-good.md](./ux-auth-whoami-field-shape-good.md) | 712 |
| [ux-auth-whoami-fields-documented-by-shape.md](./ux-auth-whoami-fields-documented-by-shape.md) | 713 |
| [ux-auth-whoami-help-documents-json-good.md](./ux-auth-whoami-help-documents-json-good.md) | 714 |
| [ux-auth-whoami-raw-json-vs-status-panel.md](./ux-auth-whoami-raw-json-vs-status-panel.md) | 626 |
| [ux-auth-whoami-raw-json.md](./ux-auth-whoami-raw-json.md) | 627 |
| [ux-binary-wrappers-undocumented.md](./ux-binary-wrappers-undocumented.md) | 334 |
| [ux-braintrust-only-status-no-enable.md](./ux-braintrust-only-status-no-enable.md) | 335 |
| [ux-braintrust-status-disabled-no-next-step.md](./ux-braintrust-status-disabled-no-next-step.md) | 336 |
| [ux-braintrust-status-minimal-disabled.md](./ux-braintrust-status-minimal-disabled.md) | 628 |
| [ux-braintrust-status-opaque.md](./ux-braintrust-status-opaque.md) | 715 |
| [ux-capture-otel-alone-silent-success.md](./ux-capture-otel-alone-silent-success.md) | 337 |
| [ux-capture-otel-content-without-capture-silent.md](./ux-capture-otel-content-without-capture-silent.md) | 338 |
| [ux-capture-otel-no-visible-output-change.md](./ux-capture-otel-no-visible-output-change.md) | 629 |
| [ux-claude-fable-appears-in-trace-fixtures-not-product-defaults.md](./ux-claude-fable-appears-in-trace-fixtures-not-product-defaults.md) | 43 |
| [ux-claude-settings-model-corrupted-to-fable-restored.md](./ux-claude-settings-model-corrupted-to-fable-restored.md) | 44 |
| [ux-code-review-double-error-skin.md](./ux-code-review-double-error-skin.md) | 339 |
| [ux-code-review-drafts-missing-arg-double-error.md](./ux-code-review-drafts-missing-arg-double-error.md) | 45 |
| [ux-code-review-drafts-missing-prurl-double-error-npm-run-dev.md](./ux-code-review-drafts-missing-prurl-double-error-npm-run-dev.md) | 340 |
| [ux-code-review-drafts-not-found-debug-tease.md](./ux-code-review-drafts-not-found-debug-tease.md) | 341 |
| [ux-code-review-install-no-dry-run-force-writes.md](./ux-code-review-install-no-dry-run-force-writes.md) | 342 |
| [ux-code-review-install-output-unframed-wrapped.md](./ux-code-review-install-output-unframed-wrapped.md) | 343 |
| [ux-code-review-install-unframed-and-npm-run-dev.md](./ux-code-review-install-unframed-and-npm-run-dev.md) | 46 |
| [ux-code-review-missing-prurl-npm-run-dev.md](./ux-code-review-missing-prurl-npm-run-dev.md) | 344 |
| [ux-code-review-profiles-bare-table-good.md](./ux-code-review-profiles-bare-table-good.md) | 716 |
| [ux-code-review-profiles-bare-table.md](./ux-code-review-profiles-bare-table.md) | 345 |
| [ux-code-review-profiles-raw-table.md](./ux-code-review-profiles-raw-table.md) | 630 |
| [ux-code-review-profiles-table-outside-design-system.md](./ux-code-review-profiles-table-outside-design-system.md) | 631 |
| [ux-code-review-prompt-preview-good.md](./ux-code-review-prompt-preview-good.md) | 717 |
| [ux-code-review-prompt-preview-missing-spawn-npm-run-dev.md](./ux-code-review-prompt-preview-missing-spawn-npm-run-dev.md) | 346 |
| [ux-code-review-prompt-preview-unframed.md](./ux-code-review-prompt-preview-unframed.md) | 347 |
| [ux-code-review-run-invalid-url-wrong-error.md](./ux-code-review-run-invalid-url-wrong-error.md) | 47 |
| [ux-code-review-run-missing-prurl-double-error-npm-run-dev.md](./ux-code-review-run-missing-prurl-double-error-npm-run-dev.md) | 348 |
| [ux-command-aliases-undocumented-on-root-help.md](./ux-command-aliases-undocumented-on-root-help.md) | 632 |
| [ux-command-not-found-no-suggestions.md](./ux-command-not-found-no-suggestions.md) | 349 |
| [ux-completion-command-missing.md](./ux-completion-command-missing.md) | 350 |
| [ux-config-edit-missing-editor-see-logs.md](./ux-config-edit-missing-editor-see-logs.md) | 351 |
| [ux-config-init-already-exists-good.md](./ux-config-init-already-exists-good.md) | 718 |
| [ux-configure-accepts-any-string-as-model-no-catalog-check.md](./ux-configure-accepts-any-string-as-model-no-catalog-check.md) | 9 |
| [ux-configure-accepts-invalid-model-without-validation.md](./ux-configure-accepts-invalid-model-without-validation.md) | 48 |
| [ux-configure-api-key-dry-run-redacts-bearer.md](./ux-configure-api-key-dry-run-redacts-bearer.md) | 719 |
| [ux-configure-api-key-shell-history-risk.md](./ux-configure-api-key-shell-history-risk.md) | 352 |
| [ux-configure-base-url-may-be-ignored.md](./ux-configure-base-url-may-be-ignored.md) | 49 |
| [ux-configure-base-url-not-visible-in-dry-run.md](./ux-configure-base-url-not-visible-in-dry-run.md) | 50 |
| [ux-configure-claude-ignores-reasoning-effort-always-xhigh.md](./ux-configure-claude-ignores-reasoning-effort-always-xhigh.md) | 14 |
| [ux-configure-codex-dry-run-full-config-flood.md](./ux-configure-codex-dry-run-full-config-flood.md) | 353 |
| [ux-configure-codex-dry-run-still-floods-profiles.md](./ux-configure-codex-dry-run-still-floods-profiles.md) | 354 |
| [ux-configure-codex-dry-run-still-leaks-and-noise.md](./ux-configure-codex-dry-run-still-leaks-and-noise.md) | 51 |
| [ux-configure-codex-reasoning-effort-medium-partial.md](./ux-configure-codex-reasoning-effort-medium-partial.md) | 355 |
| [ux-configure-cursor-dry-run-already-configured-clean.md](./ux-configure-cursor-dry-run-already-configured-clean.md) | 720 |
| [ux-configure-cursor-dry-run-no-filesystem-changes.md](./ux-configure-cursor-dry-run-no-filesystem-changes.md) | 356 |
| [ux-configure-cursor-dry-run-too-quiet.md](./ux-configure-cursor-dry-run-too-quiet.md) | 357 |
| [ux-configure-cursor-model-flag-silent-noop.md](./ux-configure-cursor-model-flag-silent-noop.md) | 358 |
| [ux-configure-dry-run-dumps-entire-existing-agent-config.md](./ux-configure-dry-run-dumps-entire-existing-agent-config.md) | 52 |
| [ux-configure-dry-run-floods-diff.md](./ux-configure-dry-run-floods-diff.md) | 359 |
| [ux-configure-dry-run-shows-full-existing-settings-as-create.md](./ux-configure-dry-run-shows-full-existing-settings-as-create.md) | 53 |
| [ux-configure-dry-run-writes-stale-model-id.md](./ux-configure-dry-run-writes-stale-model-id.md) | 54 |
| [ux-configure-empty-api-key-still-defaults-dead-sonnet-5.md](./ux-configure-empty-api-key-still-defaults-dead-sonnet-5.md) | 55 |
| [ux-configure-gemini-dry-run-minimal-good.md](./ux-configure-gemini-dry-run-minimal-good.md) | 721 |
| [ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md](./ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md) | 360 |
| [ux-configure-haiku-still-plans-effortlevel-xhigh.md](./ux-configure-haiku-still-plans-effortlevel-xhigh.md) | 56 |
| [ux-configure-help-missing-examples.md](./ux-configure-help-missing-examples.md) | 57 |
| [ux-configure-help-skip-if-configured-still-lies.md](./ux-configure-help-skip-if-configured-still-lies.md) | 58 |
| [ux-configure-kimi-default-model-novitaai.md](./ux-configure-kimi-default-model-novitaai.md) | 361 |
| [ux-configure-kimi-ignores-explicit-novita-namespace.md](./ux-configure-kimi-ignores-explicit-novita-namespace.md) | 362 |
| [ux-configure-model-alias-sonnet-haiku-written-literally.md](./ux-configure-model-alias-sonnet-haiku-written-literally.md) | 59 |
| [ux-configure-model-haiku-alias-writes-literal-reconfirmed.md](./ux-configure-model-haiku-alias-writes-literal-reconfirmed.md) | 60 |
| [ux-configure-model-sonnet-alias-writes-literal-reconfirmed.md](./ux-configure-model-sonnet-alias-writes-literal-reconfirmed.md) | 61 |
| [ux-configure-non-tty-demands-poe-no-prompt-not-yes.md](./ux-configure-non-tty-demands-poe-no-prompt-not-yes.md) | 62 |
| [ux-configure-provider-requires-model-without-listing-models.md](./ux-configure-provider-requires-model-without-listing-models.md) | 363 |
| [ux-configure-reasoning-effort-ignored-for-claude.md](./ux-configure-reasoning-effort-ignored-for-claude.md) | 63 |
| [ux-configure-reasoning-effort-still-ignored-always-high.md](./ux-configure-reasoning-effort-still-ignored-always-high.md) | 15 |
| [ux-configure-shape-base-url-not-visible-in-dry-run.md](./ux-configure-shape-base-url-not-visible-in-dry-run.md) | 64 |
| [ux-configure-shape-base-url-opaque.md](./ux-configure-shape-base-url-opaque.md) | 633 |
| [ux-configure-success-vscode-next-steps-good.md](./ux-configure-success-vscode-next-steps-good.md) | 722 |
| [ux-configure-unknown-api-shape-lists-exposed.md](./ux-configure-unknown-api-shape-lists-exposed.md) | 723 |
| [ux-configure-unknown-provider-good-message.md](./ux-configure-unknown-provider-good-message.md) | 724 |
| [ux-configure-unknown-provider-see-logs-missing.md](./ux-configure-unknown-provider-see-logs-missing.md) | 634 |
| [ux-configure-unknown-provider-validation-good.md](./ux-configure-unknown-provider-validation-good.md) | 725 |
| [ux-configure-yes-dry-run-always-defaults-dead-sonnet-5.md](./ux-configure-yes-dry-run-always-defaults-dead-sonnet-5.md) | 8 |
| [ux-configure-yes-silent-default-agent.md](./ux-configure-yes-silent-default-agent.md) | 364 |
| [ux-constants-source-of-dead-sonnet-5.md](./ux-constants-source-of-dead-sonnet-5.md) | 5 |
| [ux-constants-still-hardcodes-sonnet-5-source-reconfirm.md](./ux-constants-still-hardcodes-sonnet-5-source-reconfirm.md) | 65 |
| [ux-cursor-and-cursor-agent-aliases-both-work.md](./ux-cursor-and-cursor-agent-aliases-both-work.md) | 726 |
| [ux-cwd-file-path-not-directory-good.md](./ux-cwd-file-path-not-directory-good.md) | 727 |
| [ux-cwd-missing-path-good-message.md](./ux-cwd-missing-path-good-message.md) | 728 |
| [ux-dashboard-command-missing.md](./ux-dashboard-command-missing.md) | 635 |
| [ux-dashboard-keybindings-undocumented-on-cli-help.md](./ux-dashboard-keybindings-undocumented-on-cli-help.md) | 365 |
| [ux-dashboard-ui-tui-missing.md](./ux-dashboard-ui-tui-missing.md) | 636 |
| [ux-detach-runtime-host-still-inline.md](./ux-detach-runtime-host-still-inline.md) | 66 |
| [ux-detach-without-runtime-still-inline-reconfirmed.md](./ux-detach-without-runtime-still-inline-reconfirmed.md) | 67 |
| [ux-development-mode-usage-intentional-but-leaks.md](./ux-development-mode-usage-intentional-but-leaks.md) | 68 |
| [ux-doctor-and-completion-still-missing.md](./ux-doctor-and-completion-still-missing.md) | 366 |
| [ux-doctor-still-missing-reconfirmed-2026-07-08.md](./ux-doctor-still-missing-reconfirmed-2026-07-08.md) | 69 |
| [ux-doctor-still-missing-reconfirmed.md](./ux-doctor-still-missing-reconfirmed.md) | 367 |
| [ux-dry-run-diffs-print-secrets.md](./ux-dry-run-diffs-print-secrets.md) | 1 |
| [ux-dual-help-systems.md](./ux-dual-help-systems.md) | 70 |
| [ux-e2b-missing-key-error-good.md](./ux-e2b-missing-key-error-good.md) | 729 |
| [ux-editor-error-still-system-chrome.md](./ux-editor-error-still-system-chrome.md) | 368 |
| [ux-editor-missing-raw-error.md](./ux-editor-missing-raw-error.md) | 637 |
| [ux-effort-xhigh-valid-for-opus-not-sonnet.md](./ux-effort-xhigh-valid-for-opus-not-sonnet.md) | 71 |
| [ux-empty-api-key-flag-silently-ignored.md](./ux-empty-api-key-flag-silently-ignored.md) | 369 |
| [ux-empty-api-key-flag-still-silently-ignored.md](./ux-empty-api-key-flag-still-silently-ignored.md) | 72 |
| [ux-empty-api-key-login-good-but-configure-ignores.md](./ux-empty-api-key-login-good-but-configure-ignores.md) | 73 |
| [ux-empty-model-flag-behavior-inconsistent.md](./ux-empty-model-flag-behavior-inconsistent.md) | 74 |
| [ux-empty-plan-kind-lists-still-draw-empty-tables.md](./ux-empty-plan-kind-lists-still-draw-empty-tables.md) | 370 |
| [ux-empty-prompt-string-rejected.md](./ux-empty-prompt-string-rejected.md) | 730 |
| [ux-empty-resume-thread-id-silently-ignored.md](./ux-empty-resume-thread-id-silently-ignored.md) | 371 |
| [ux-error-panel-closes-before-error.md](./ux-error-panel-closes-before-error.md) | 75 |
| [ux-eval-check-fails-on-placeholder-target-git-remote.md](./ux-eval-check-fails-on-placeholder-target-git-remote.md) | 76 |
| [ux-eval-empty-source-message-inconsistent-skins.md](./ux-eval-empty-source-message-inconsistent-skins.md) | 372 |
| [ux-eval-errors-outside-design-system.md](./ux-eval-errors-outside-design-system.md) | 638 |
| [ux-eval-help-npm-run-dev-and-inline-flags.md](./ux-eval-help-npm-run-dev-and-inline-flags.md) | 26 |
| [ux-eval-help-npm-run-dev-identity.md](./ux-eval-help-npm-run-dev-identity.md) | 373 |
| [ux-eval-init-bare-stdout-no-design-system.md](./ux-eval-init-bare-stdout-no-design-system.md) | 374 |
| [ux-eval-init-creates-in-cwd-with-bare-success.md](./ux-eval-init-creates-in-cwd-with-bare-success.md) | 639 |
| [ux-eval-init-help-npm-run-dev.md](./ux-eval-init-help-npm-run-dev.md) | 375 |
| [ux-eval-init-name-validation-bare-text.md](./ux-eval-init-name-validation-bare-text.md) | 376 |
| [ux-eval-init-prints-bare-name-and-cwd-default-confusing.md](./ux-eval-init-prints-bare-name-and-cwd-default-confusing.md) | 77 |
| [ux-eval-init-success-is-bare-paths.md](./ux-eval-init-success-is-bare-paths.md) | 640 |
| [ux-eval-lint-check-empty-same-message.md](./ux-eval-lint-check-empty-same-message.md) | 377 |
| [ux-eval-lint-missing-eval-structured-table-good.md](./ux-eval-lint-missing-eval-structured-table-good.md) | 731 |
| [ux-eval-lint-table-good.md](./ux-eval-lint-table-good.md) | 732 |
| [ux-eval-report-debug-flag-undocumented-in-error.md](./ux-eval-report-debug-flag-undocumented-in-error.md) | 641 |
| [ux-eval-report-empty-debug-tease.md](./ux-eval-report-empty-debug-tease.md) | 378 |
| [ux-eval-report-invalid-format-npm-run-dev.md](./ux-eval-report-invalid-format-npm-run-dev.md) | 78 |
| [ux-eval-run-missing-params-npm-run-dev.md](./ux-eval-run-missing-params-npm-run-dev.md) | 379 |
| [ux-eval-unknown-command-suggests-lint-for-list.md](./ux-eval-unknown-command-suggests-lint-for-list.md) | 380 |
| [ux-experiment-install-already-exists-vs-pipeline-skip.md](./ux-experiment-install-already-exists-vs-pipeline-skip.md) | 79 |
| [ux-experiment-install-force-does-not-overwrite-skill.md](./ux-experiment-install-force-does-not-overwrite-skill.md) | 80 |
| [ux-experiment-install-force-does-not-overwrite.md](./ux-experiment-install-force-does-not-overwrite.md) | 81 |
| [ux-experiment-install-force-help-exists.md](./ux-experiment-install-force-help-exists.md) | 733 |
| [ux-experiment-install-force-still-fails-already-exists.md](./ux-experiment-install-force-still-fails-already-exists.md) | 82 |
| [ux-experiment-install-requires-agent-or-yes-good.md](./ux-experiment-install-requires-agent-or-yes-good.md) | 734 |
| [ux-experiment-journal-empty-kind-unaware.md](./ux-experiment-journal-empty-kind-unaware.md) | 83 |
| [ux-experiment-journal-error-when-no-doc-provided.md](./ux-experiment-journal-error-when-no-doc-provided.md) | 381 |
| [ux-experiment-journal-no-experiment-docs-message.md](./ux-experiment-journal-no-experiment-docs-message.md) | 84 |
| [ux-experiment-journal-wrong-doc-type-message.md](./ux-experiment-journal-wrong-doc-type-message.md) | 642 |
| [ux-experiment-journal-wrong-kind-says-not-found.md](./ux-experiment-journal-wrong-kind-says-not-found.md) | 85 |
| [ux-experiment-ralph-no-doc-wrong-message.md](./ux-experiment-ralph-no-doc-wrong-message.md) | 86 |
| [ux-experiment-run-empty-says-no-markdown-under-plans.md](./ux-experiment-run-empty-says-no-markdown-under-plans.md) | 87 |
| [ux-experiment-validate-missing-path-good.md](./ux-experiment-validate-missing-path-good.md) | 735 |
| [ux-experiment-validate-wrong-kind-says-not-found.md](./ux-experiment-validate-wrong-kind-says-not-found.md) | 88 |
| [ux-extra-npm-bins-confusing.md](./ux-extra-npm-bins-confusing.md) | 643 |
| [ux-extra-npm-bins-still-published-reconfirmed.md](./ux-extra-npm-bins-still-published-reconfirmed.md) | 89 |
| [ux-extra-npm-bins-still-shipped.md](./ux-extra-npm-bins-still-shipped.md) | 90 |
| [ux-failure-shown-as-success-markers.md](./ux-failure-shown-as-success-markers.md) | 91 |
| [ux-frontier-models-only-sonnet-5-is-dead.md](./ux-frontier-models-only-sonnet-5-is-dead.md) | 6 |
| [ux-gaslight-archive-and-no-archive-both-accepted.md](./ux-gaslight-archive-and-no-archive-both-accepted.md) | 644 |
| [ux-gaslight-config-missing-enoent-system-chrome.md](./ux-gaslight-config-missing-enoent-system-chrome.md) | 382 |
| [ux-gaslight-config-missing-enoent.md](./ux-gaslight-config-missing-enoent.md) | 383 |
| [ux-gaslight-empty-model-falls-back-to-dead-sonnet-5.md](./ux-gaslight-empty-model-falls-back-to-dead-sonnet-5.md) | 18 |
| [ux-gaslight-has-worktree-spawn-does-not.md](./ux-gaslight-has-worktree-spawn-does-not.md) | 92 |
| [ux-gaslight-help-says-plan-to-implement.md](./ux-gaslight-help-says-plan-to-implement.md) | 93 |
| [ux-gaslight-help-still-says-implement-reconfirmed.md](./ux-gaslight-help-still-says-implement-reconfirmed.md) | 94 |
| [ux-gaslight-ingest-failure-dumps-jsonl.md](./ux-gaslight-ingest-failure-dumps-jsonl.md) | 95 |
| [ux-gaslight-ingest-has-limit-since-good.md](./ux-gaslight-ingest-has-limit-since-good.md) | 736 |
| [ux-gaslight-ingest-limit-zero-validation-good.md](./ux-gaslight-ingest-limit-zero-validation-good.md) | 737 |
| [ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md](./ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md) | 96 |
| [ux-gaslight-ingest-nontty-demands-poe-no-prompt.md](./ux-gaslight-ingest-nontty-demands-poe-no-prompt.md) | 97 |
| [ux-gaslight-install-force-dry-run-clean.md](./ux-gaslight-install-force-dry-run-clean.md) | 738 |
| [ux-gaslight-install-force-dry-run-vs-already-exists.md](./ux-gaslight-install-force-dry-run-vs-already-exists.md) | 384 |
| [ux-gaslight-install-force-overwrites-without-diff.md](./ux-gaslight-install-force-overwrites-without-diff.md) | 385 |
| [ux-gaslight-install-global-dry-run-clean.md](./ux-gaslight-install-global-dry-run-clean.md) | 739 |
| [ux-gaslight-missing-plan-system-chrome-reconfirmed.md](./ux-gaslight-missing-plan-system-chrome-reconfirmed.md) | 386 |
| [ux-gaslight-mode-read-still-mutated-plans-dir.md](./ux-gaslight-mode-read-still-mutated-plans-dir.md) | 19 |
| [ux-gaslight-multi-plan-fails-fast-with-success-markers.md](./ux-gaslight-multi-plan-fails-fast-with-success-markers.md) | 387 |
| [ux-gaslight-no-activity-timeout-flag.md](./ux-gaslight-no-activity-timeout-flag.md) | 388 |
| [ux-gaslight-no-plan-autopicks-and-hits-stale-model.md](./ux-gaslight-no-plan-autopicks-and-hits-stale-model.md) | 98 |
| [ux-gaslight-opaque-naming.md](./ux-gaslight-opaque-naming.md) | 389 |
| [ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md](./ux-gaslight-pipeline-archive-defaults-undocumented-interaction.md) | 390 |
| [ux-gaslight-plan-path-starts-implement-without-confirm.md](./ux-gaslight-plan-path-starts-implement-without-confirm.md) | 99 |
| [ux-gaslight-plans-flag-still-auto-implement.md](./ux-gaslight-plans-flag-still-auto-implement.md) | 100 |
| [ux-gaslight-unknown-agent-says-service.md](./ux-gaslight-unknown-agent-says-service.md) | 391 |
| [ux-gaslight-yes-not-in-options.md](./ux-gaslight-yes-not-in-options.md) | 392 |
| [ux-gaslight-yes-without-plan-hangs-or-stalls.md](./ux-gaslight-yes-without-plan-hangs-or-stalls.md) | 101 |
| [ux-gemini-configure-dry-run-too-quiet.md](./ux-gemini-configure-dry-run-too-quiet.md) | 393 |
| [ux-gemini-default-model-unnamespaced-and-stale-vs-frontier.md](./ux-gemini-default-model-unnamespaced-and-stale-vs-frontier.md) | 102 |
| [ux-gemini-still-provider-credential-after-configure-dry-run.md](./ux-gemini-still-provider-credential-after-configure-dry-run.md) | 103 |
| [ux-gh-install-dry-run-lists-paths-without-panel.md](./ux-gh-install-dry-run-lists-paths-without-panel.md) | 394 |
| [ux-gh-install-eject-flag-opaque.md](./ux-gh-install-eject-flag-opaque.md) | 645 |
| [ux-gh-install-preview-without-dry-run-flag.md](./ux-gh-install-preview-without-dry-run-flag.md) | 395 |
| [ux-gh-prompt-preview-dumps-long-unframed-prompt.md](./ux-gh-prompt-preview-dumps-long-unframed-prompt.md) | 396 |
| [ux-gh-uninstall-invalid-name-lists-choices-good.md](./ux-gh-uninstall-invalid-name-lists-choices-good.md) | 740 |
| [ux-gh-variables-list-good.md](./ux-gh-variables-list-good.md) | 741 |
| [ux-github-cwd-clone-errors-still-raw-git.md](./ux-github-cwd-clone-errors-still-raw-git.md) | 104 |
| [ux-github-cwd-clone-errors-unframed.md](./ux-github-cwd-clone-errors-unframed.md) | 311 |
| [ux-global-flags-hidden-on-subcommand-help.md](./ux-global-flags-hidden-on-subcommand-help.md) | 397 |
| [ux-global-yes-not-listed-on-spawn-gaslight-help.md](./ux-global-yes-not-listed-on-spawn-gaslight-help.md) | 105 |
| [ux-goal-chat-acp-commands-missing.md](./ux-goal-chat-acp-commands-missing.md) | 398 |
| [ux-goose-configure-haiku-still-embeds-sonnet-5-in-models-list-reconfirm.md](./ux-goose-configure-haiku-still-embeds-sonnet-5-in-models-list-reconfirm.md) | 106 |
| [ux-goose-configure-still-embeds-sonnet-5-in-models-list.md](./ux-goose-configure-still-embeds-sonnet-5-in-models-list.md) | 10 |
| [ux-goose-provider-map-still-has-sonnet-5-context.md](./ux-goose-provider-map-still-has-sonnet-5-context.md) | 107 |
| [ux-group-commands-print-help-only.md](./ux-group-commands-print-help-only.md) | 399 |
| [ux-hardcoded-stale-sonnet-5-in-product-defaults.md](./ux-hardcoded-stale-sonnet-5-in-product-defaults.md) | 7 |
| [ux-harness-help-command-lowercase-description.md](./ux-harness-help-command-lowercase-description.md) | 742 |
| [ux-harness-list-empty-good.md](./ux-harness-list-empty-good.md) | 743 |
| [ux-harness-list-empty-message-good.md](./ux-harness-list-empty-message-good.md) | 744 |
| [ux-harness-list-no-dir-flag.md](./ux-harness-list-no-dir-flag.md) | 400 |
| [ux-harness-list-only-cwd-not-created-dir.md](./ux-harness-list-only-cwd-not-created-dir.md) | 401 |
| [ux-harness-missing-file-system-chrome.md](./ux-harness-missing-file-system-chrome.md) | 402 |
| [ux-harness-new-all-builtin-kinds-work.md](./ux-harness-new-all-builtin-kinds-work.md) | 745 |
| [ux-harness-new-kinds-undocumented-must-guess-demo-names.md](./ux-harness-new-kinds-undocumented-must-guess-demo-names.md) | 108 |
| [ux-harness-new-kinds-undocumented-only-coverage-demo-works.md](./ux-harness-new-kinds-undocumented-only-coverage-demo-works.md) | 109 |
| [ux-harness-new-run-coverage-demo-works.md](./ux-harness-new-run-coverage-demo-works.md) | 746 |
| [ux-harness-new-success-good.md](./ux-harness-new-success-good.md) | 747 |
| [ux-harness-new-unknown-kind-no-list.md](./ux-harness-new-unknown-kind-no-list.md) | 403 |
| [ux-harness-new-unknown-template-no-kinds-reconfirmed.md](./ux-harness-new-unknown-template-no-kinds-reconfirmed.md) | 404 |
| [ux-harness-run-coverage-demo-works.md](./ux-harness-run-coverage-demo-works.md) | 748 |
| [ux-harness-run-fix-works.md](./ux-harness-run-fix-works.md) | 749 |
| [ux-harness-run-missing-file-system-chrome.md](./ux-harness-run-missing-file-system-chrome.md) | 405 |
| [ux-harness-run-no-pairs-clear.md](./ux-harness-run-no-pairs-clear.md) | 750 |
| [ux-harness-run-no-path-says-no-pairs.md](./ux-harness-run-no-path-says-no-pairs.md) | 646 |
| [ux-harness-run-success-opaque-result-object.md](./ux-harness-run-success-opaque-result-object.md) | 406 |
| [ux-harness-unknown-template-no-kinds.md](./ux-harness-unknown-template-no-kinds.md) | 751 |
| [ux-harness-unknown-template-still-omits-kind-list.md](./ux-harness-unknown-template-still-omits-kind-list.md) | 407 |
| [ux-help-command-not-registered.md](./ux-help-command-not-registered.md) | 408 |
| [ux-help-subcommand-inconsistency.md](./ux-help-subcommand-inconsistency.md) | 752 |
| [ux-hidden-and-orphan-commands.md](./ux-hidden-and-orphan-commands.md) | 409 |
| [ux-hooks-auto-strategy-still-refuses-user-settings.md](./ux-hooks-auto-strategy-still-refuses-user-settings.md) | 110 |
| [ux-hooks-bridge-refuse-user-authored-file-opaque.md](./ux-hooks-bridge-refuse-user-authored-file-opaque.md) | 410 |
| [ux-hooks-from-codex-to-claude-not-supported-yet.md](./ux-hooks-from-codex-to-claude-not-supported-yet.md) | 111 |
| [ux-hooks-from-codex-to-claude-transform-unsupported.md](./ux-hooks-from-codex-to-claude-transform-unsupported.md) | 112 |
| [ux-hooks-from-pi-unsupported-lists-supported.md](./ux-hooks-from-pi-unsupported-lists-supported.md) | 647 |
| [ux-hooks-from-spawn-poe-code-enoent.md](./ux-hooks-from-spawn-poe-code-enoent.md) | 113 |
| [ux-hooks-from-unknown-lists-supported-good.md](./ux-hooks-from-unknown-lists-supported-good.md) | 753 |
| [ux-hooks-from-unsupported-system-chrome.md](./ux-hooks-from-unsupported-system-chrome.md) | 411 |
| [ux-hooks-scope-invalid-raw-commander.md](./ux-hooks-scope-invalid-raw-commander.md) | 648 |
| [ux-hooks-scope-project-same-refuse-as-symlink.md](./ux-hooks-scope-project-same-refuse-as-symlink.md) | 412 |
| [ux-hooks-strategy-invalid-raw-commander.md](./ux-hooks-strategy-invalid-raw-commander.md) | 649 |
| [ux-hooks-strategy-symlink-refuses-user-settings.md](./ux-hooks-strategy-symlink-refuses-user-settings.md) | 114 |
| [ux-hooks-strategy-transform-unsupported-opaque.md](./ux-hooks-strategy-transform-unsupported-opaque.md) | 115 |
| [ux-hooks-symlink-refuses-user-settings-reconfirmed.md](./ux-hooks-symlink-refuses-user-settings-reconfirmed.md) | 116 |
| [ux-hooks-transform-to-claude-not-supported-yet.md](./ux-hooks-transform-to-claude-not-supported-yet.md) | 117 |
| [ux-important-commands-absent-from-root-help.md](./ux-important-commands-absent-from-root-help.md) | 413 |
| [ux-inconsistent-agent-surface-across-commands.md](./ux-inconsistent-agent-surface-across-commands.md) | 118 |
| [ux-install-always-claims-success.md](./ux-install-always-claims-success.md) | 650 |
| [ux-install-always-success-reconfirmed.md](./ux-install-always-success-reconfirmed.md) | 414 |
| [ux-install-help-missing-yes-and-list.md](./ux-install-help-missing-yes-and-list.md) | 415 |
| [ux-install-help-no-force-or-options.md](./ux-install-help-no-force-or-options.md) | 416 |
| [ux-install-non-tty-demands-poe-no-prompt-not-yes.md](./ux-install-non-tty-demands-poe-no-prompt-not-yes.md) | 119 |
| [ux-install-opencode-success-good.md](./ux-install-opencode-success-good.md) | 754 |
| [ux-install-pi-unknown-not-in-installable-list.md](./ux-install-pi-unknown-not-in-installable-list.md) | 120 |
| [ux-install-skill-flags-inconsistent-across-commands.md](./ux-install-skill-flags-inconsistent-across-commands.md) | 121 |
| [ux-install-test-pi-unknown-not-spawn-only.md](./ux-install-test-pi-unknown-not-spawn-only.md) | 122 |
| [ux-install-unconfigure-help-still-sparse-reconfirmed.md](./ux-install-unconfigure-help-still-sparse-reconfirmed.md) | 123 |
| [ux-install-yes-defaults-agent-silently.md](./ux-install-yes-defaults-agent-silently.md) | 417 |
| [ux-install-yes-silently-defaults-to-claude.md](./ux-install-yes-silently-defaults-to-claude.md) | 124 |
| [ux-json-flag-inconsistent-across-commands.md](./ux-json-flag-inconsistent-across-commands.md) | 418 |
| [ux-kimi-default-model-id-mismatches-catalog-namespace.md](./ux-kimi-default-model-id-mismatches-catalog-namespace.md) | 419 |
| [ux-kimi-default-model-id-namespace-mismatch.md](./ux-kimi-default-model-id-namespace-mismatch.md) | 125 |
| [ux-launch-commands-trigger-full-turbo-rebuild.md](./ux-launch-commands-trigger-full-turbo-rebuild.md) | 420 |
| [ux-launch-logs-missing-says-runtime-job.md](./ux-launch-logs-missing-says-runtime-job.md) | 126 |
| [ux-launch-missing-process-system-chrome.md](./ux-launch-missing-process-system-chrome.md) | 421 |
| [ux-launch-restart-missing-see-logs.md](./ux-launch-restart-missing-see-logs.md) | 422 |
| [ux-launch-rm-stale-state-removed-id-opaque.md](./ux-launch-rm-stale-state-removed-id-opaque.md) | 423 |
| [ux-launch-start-claims-running-then-status-stopped.md](./ux-launch-start-claims-running-then-status-stopped.md) | 127 |
| [ux-launch-start-dumps-turbo-build.md](./ux-launch-start-dumps-turbo-build.md) | 128 |
| [ux-launch-start-opaque-failure.md](./ux-launch-start-opaque-failure.md) | 424 |
| [ux-launch-start-success-then-status-shows-stopped.md](./ux-launch-start-success-then-status-shows-stopped.md) | 129 |
| [ux-launch-start-triggers-turbo-monorepo-build.md](./ux-launch-start-triggers-turbo-monorepo-build.md) | 130 |
| [ux-launch-start-triggers-turbo-noise-and-opaque-failure.md](./ux-launch-start-triggers-turbo-noise-and-opaque-failure.md) | 131 |
| [ux-launch-start-via-npm-run-dev-confuses-argv.md](./ux-launch-start-via-npm-run-dev-confuses-argv.md) | 425 |
| [ux-launch-status-blank-id-rows-reconfirmed.md](./ux-launch-status-blank-id-rows-reconfirmed.md) | 132 |
| [ux-launch-status-blank-id-zombie-rows.md](./ux-launch-status-blank-id-zombie-rows.md) | 133 |
| [ux-launch-status-crashes-on-tombstone-dirs.md](./ux-launch-status-crashes-on-tombstone-dirs.md) | 134 |
| [ux-launch-status-shows-dash-id-ghost-rows.md](./ux-launch-status-shows-dash-id-ghost-rows.md) | 135 |
| [ux-launch-status-shows-failed-experiment-leftovers.md](./ux-launch-status-shows-failed-experiment-leftovers.md) | 651 |
| [ux-live-claude-settings-had-sonnet-alias-and-xhigh-restored.md](./ux-live-claude-settings-had-sonnet-alias-and-xhigh-restored.md) | 136 |
| [ux-log-content-flag-no-danger-warning.md](./ux-log-content-flag-no-danger-warning.md) | 426 |
| [ux-log-content-flags-underwarn-sensitive-data.md](./ux-log-content-flags-underwarn-sensitive-data.md) | 427 |
| [ux-log-content-help-underwarns-reconfirmed.md](./ux-log-content-help-underwarns-reconfirmed.md) | 428 |
| [ux-log-dir-relative-works-with-path-feedback-gap.md](./ux-log-dir-relative-works-with-path-feedback-gap.md) | 652 |
| [ux-log-dir-unwritable-silently-ignored.md](./ux-log-dir-unwritable-silently-ignored.md) | 137 |
| [ux-log-file-name-no-path-feedback.md](./ux-log-file-name-no-path-feedback.md) | 429 |
| [ux-login-api-key-rejected-good.md](./ux-login-api-key-rejected-good.md) | 755 |
| [ux-login-fake-key-rejected-good.md](./ux-login-fake-key-rejected-good.md) | 756 |
| [ux-login-help-omits-interactive-and-yes.md](./ux-login-help-omits-interactive-and-yes.md) | 430 |
| [ux-login-help-omits-oauth-default.md](./ux-login-help-omits-oauth-default.md) | 431 |
| [ux-login-help-omits-yes.md](./ux-login-help-omits-yes.md) | 653 |
| [ux-login-help-still-minimal.md](./ux-login-help-still-minimal.md) | 432 |
| [ux-login-help-still-omits-yes-reconfirmed.md](./ux-login-help-still-omits-yes-reconfirmed.md) | 654 |
| [ux-login-non-tty-hangs-on-oauth.md](./ux-login-non-tty-hangs-on-oauth.md) | 138 |
| [ux-login-non-tty-hangs-reconfirmed.md](./ux-login-non-tty-hangs-reconfirmed.md) | 139 |
| [ux-login-rejected-no-recovery.md](./ux-login-rejected-no-recovery.md) | 433 |
| [ux-login-yes-message-good-but-worth-aligning.md](./ux-login-yes-message-good-but-worth-aligning.md) | 757 |
| [ux-login-yes-without-key-message-good.md](./ux-login-yes-without-key-message-good.md) | 758 |
| [ux-logout-dry-run-multi-panel-noise.md](./ux-logout-dry-run-multi-panel-noise.md) | 140 |
| [ux-logout-dry-run-still-multi-panel-unconfigure.md](./ux-logout-dry-run-still-multi-panel-unconfigure.md) | 141 |
| [ux-logout-dry-run-still-prints-secrets-reconfirmed.md](./ux-logout-dry-run-still-prints-secrets-reconfirmed.md) | 2 |
| [ux-logout-help-no-danger-or-scope-detail.md](./ux-logout-help-no-danger-or-scope-detail.md) | 142 |
| [ux-logout-help-no-danger-or-yes.md](./ux-logout-help-no-danger-or-yes.md) | 143 |
| [ux-logout-overclaims-scope.md](./ux-logout-overclaims-scope.md) | 22 |
| [ux-maestro-config-vs-workflow-flags-duplicated.md](./ux-maestro-config-vs-workflow-flags-duplicated.md) | 434 |
| [ux-maestro-dry-run-github-401-without-workflow.md](./ux-maestro-dry-run-github-401-without-workflow.md) | 144 |
| [ux-maestro-dry-run-hits-github-401-reconfirmed.md](./ux-maestro-dry-run-hits-github-401-reconfirmed.md) | 145 |
| [ux-maestro-dry-run-hits-github-without-workflow.md](./ux-maestro-dry-run-hits-github-without-workflow.md) | 312 |
| [ux-maestro-dry-run-path-vs-flag-confusion.md](./ux-maestro-dry-run-path-vs-flag-confusion.md) | 146 |
| [ux-maestro-dual-invocation-shape.md](./ux-maestro-dual-invocation-shape.md) | 759 |
| [ux-maestro-duplicate-config-flags.md](./ux-maestro-duplicate-config-flags.md) | 760 |
| [ux-maestro-run-dry-run-still-hits-github-401.md](./ux-maestro-run-dry-run-still-hits-github-401.md) | 147 |
| [ux-maestro-tick-missing-task-raw-commander.md](./ux-maestro-tick-missing-task-raw-commander.md) | 435 |
| [ux-maestro-tick-missing-transition-raw-commander.md](./ux-maestro-tick-missing-transition-raw-commander.md) | 436 |
| [ux-maestro-tui-duplicate-config-workflow-flags.md](./ux-maestro-tui-duplicate-config-workflow-flags.md) | 437 |
| [ux-maestro-tui-mutual-exclusion-validation-good.md](./ux-maestro-tui-mutual-exclusion-validation-good.md) | 761 |
| [ux-many-parent-groups-only-dump-help.md](./ux-many-parent-groups-only-dump-help.md) | 438 |
| [ux-markdown-read-depth-1-empty-for-h1-only-structure.md](./ux-markdown-read-depth-1-empty-for-h1-only-structure.md) | 439 |
| [ux-markdown-read-depth-2-works-well.md](./ux-markdown-read-depth-2-works-well.md) | 762 |
| [ux-markdown-read-depth-zero-empty-sections.md](./ux-markdown-read-depth-zero-empty-sections.md) | 655 |
| [ux-markdown-read-negative-depth-validation-good.md](./ux-markdown-read-negative-depth-validation-good.md) | 763 |
| [ux-markdown-read-section-by-number-works.md](./ux-markdown-read-section-by-number-works.md) | 764 |
| [ux-markdown-read-section-wrong-recovery-command.md](./ux-markdown-read-section-wrong-recovery-command.md) | 148 |
| [ux-markdown-read-unlimited-depth-works.md](./ux-markdown-read-unlimited-depth-works.md) | 765 |
| [ux-mcp-servers-at-file-missing-validation-good.md](./ux-mcp-servers-at-file-missing-validation-good.md) | 766 |
| [ux-mcp-servers-empty-object-accepted.md](./ux-mcp-servers-empty-object-accepted.md) | 656 |
| [ux-mcp-servers-file-and-json-validation-good.md](./ux-mcp-servers-file-and-json-validation-good.md) | 767 |
| [ux-mcp-servers-invalid-json-validation-good.md](./ux-mcp-servers-invalid-json-validation-good.md) | 768 |
| [ux-mcp-servers-missing-file-almost-good.md](./ux-mcp-servers-missing-file-almost-good.md) | 657 |
| [ux-mcp-servers-validation-good.md](./ux-mcp-servers-validation-good.md) | 769 |
| [ux-memory-agent-commands-invalid-json-opaque.md](./ux-memory-agent-commands-invalid-json-opaque.md) | 149 |
| [ux-memory-append-reason-defaults-to-append.md](./ux-memory-append-reason-defaults-to-append.md) | 770 |
| [ux-memory-cache-clear-help-omits-yes-reconfirmed.md](./ux-memory-cache-clear-help-omits-yes-reconfirmed.md) | 440 |
| [ux-memory-cache-clear-requires-yes-good.md](./ux-memory-cache-clear-requires-yes-good.md) | 771 |
| [ux-memory-cache-clear-requires-yes-see-logs.md](./ux-memory-cache-clear-requires-yes-see-logs.md) | 658 |
| [ux-memory-cache-status-zero-good.md](./ux-memory-cache-status-zero-good.md) | 772 |
| [ux-memory-clear-help-still-no-force-or-yes.md](./ux-memory-clear-help-still-no-force-or-yes.md) | 441 |
| [ux-memory-clear-no-confirmation.md](./ux-memory-clear-no-confirmation.md) | 442 |
| [ux-memory-clear-no-yes-no-dry-run.md](./ux-memory-clear-no-yes-no-dry-run.md) | 150 |
| [ux-memory-clear-requires-yes-help-omits-yes.md](./ux-memory-clear-requires-yes-help-omits-yes.md) | 151 |
| [ux-memory-clear-requires-yes-non-tty-good.md](./ux-memory-clear-requires-yes-non-tty-good.md) | 773 |
| [ux-memory-clear-yes-reinitializes-index-log.md](./ux-memory-clear-yes-reinitializes-index-log.md) | 774 |
| [ux-memory-clear-yes-works-when-initialized.md](./ux-memory-clear-yes-works-when-initialized.md) | 775 |
| [ux-memory-explain-budget-token-internals.md](./ux-memory-explain-budget-token-internals.md) | 776 |
| [ux-memory-explain-invalid-json-system-chrome.md](./ux-memory-explain-invalid-json-system-chrome.md) | 152 |
| [ux-memory-ingest-enoent-system-chrome.md](./ux-memory-ingest-enoent-system-chrome.md) | 443 |
| [ux-memory-ingest-not-init-good.md](./ux-memory-ingest-not-init-good.md) | 777 |
| [ux-memory-install-already-exists-system-chrome.md](./ux-memory-install-already-exists-system-chrome.md) | 444 |
| [ux-memory-install-no-force-already-exists.md](./ux-memory-install-no-force-already-exists.md) | 445 |
| [ux-memory-install-requires-agent-raw-commander.md](./ux-memory-install-requires-agent-raw-commander.md) | 446 |
| [ux-memory-lint-empty-good.md](./ux-memory-lint-empty-good.md) | 778 |
| [ux-memory-ls-empty-message-good.md](./ux-memory-ls-empty-message-good.md) | 779 |
| [ux-memory-ls-search-show-raw-unframed.md](./ux-memory-ls-search-show-raw-unframed.md) | 447 |
| [ux-memory-mcp-print-config-command-missing.md](./ux-memory-mcp-print-config-command-missing.md) | 448 |
| [ux-memory-mcp-print-config-raw-json.md](./ux-memory-mcp-print-config-raw-json.md) | 659 |
| [ux-memory-query-may-hang-or-stall.md](./ux-memory-query-may-hang-or-stall.md) | 449 |
| [ux-memory-query-no-model-flag.md](./ux-memory-query-no-model-flag.md) | 450 |
| [ux-memory-query-terse-description-and-budget-exposed.md](./ux-memory-query-terse-description-and-budget-exposed.md) | 780 |
| [ux-memory-search-empty-no-matches-good.md](./ux-memory-search-empty-no-matches-good.md) | 781 |
| [ux-memory-search-not-initialized-good.md](./ux-memory-search-not-initialized-good.md) | 782 |
| [ux-memory-show-cannot-open-root-index-file.md](./ux-memory-show-cannot-open-root-index-file.md) | 23 |
| [ux-memory-show-index-md-still-not-found-after-init.md](./ux-memory-show-index-md-still-not-found-after-init.md) | 153 |
| [ux-memory-show-index-not-found-after-init.md](./ux-memory-show-index-not-found-after-init.md) | 154 |
| [ux-memory-status-after-write-is-terse.md](./ux-memory-status-after-write-is-terse.md) | 660 |
| [ux-memory-status-not-initialized-good.md](./ux-memory-status-not-initialized-good.md) | 783 |
| [ux-memory-status-title-not-pink.md](./ux-memory-status-title-not-pink.md) | 784 |
| [ux-memory-user-page-show-works-index-does-not.md](./ux-memory-user-page-show-works-index-does-not.md) | 155 |
| [ux-memory-write-bare-stdout-path.md](./ux-memory-write-bare-stdout-path.md) | 661 |
| [ux-memory-write-requires-reason-before-path.md](./ux-memory-write-requires-reason-before-path.md) | 451 |
| [ux-memory-write-requires-reason-raw-commander.md](./ux-memory-write-requires-reason-raw-commander.md) | 452 |
| [ux-memory-write-success-bare-path-stdout.md](./ux-memory-write-success-bare-path-stdout.md) | 662 |
| [ux-memory-write-success-is-raw-unframed.md](./ux-memory-write-success-is-raw-unframed.md) | 453 |
| [ux-model-id-namespace-stripping-surprises.md](./ux-model-id-namespace-stripping-surprises.md) | 454 |
| [ux-models-double-feature-flag-uses-last-or-and.md](./ux-models-double-feature-flag-uses-last-or-and.md) | 663 |
| [ux-models-dumps-full-catalog.md](./ux-models-dumps-full-catalog.md) | 455 |
| [ux-models-empty-model-filter-returns-all.md](./ux-models-empty-model-filter-returns-all.md) | 664 |
| [ux-models-empty-search-returns-all.md](./ux-models-empty-search-returns-all.md) | 456 |
| [ux-models-endpoint-bogus-double-error-and-stack.md](./ux-models-endpoint-bogus-double-error-and-stack.md) | 156 |
| [ux-models-endpoint-invalid-good-list-but-stack.md](./ux-models-endpoint-invalid-good-list-but-stack.md) | 157 |
| [ux-models-endpoint-messages-anthropic-good.md](./ux-models-endpoint-messages-anthropic-good.md) | 785 |
| [ux-models-endpoint-pricing-combo-works.md](./ux-models-endpoint-pricing-combo-works.md) | 786 |
| [ux-models-exact-id-filter-rejects-namespaced-ids.md](./ux-models-exact-id-filter-rejects-namespaced-ids.md) | 158 |
| [ux-models-feature-bogus-silent-empty.md](./ux-models-feature-bogus-silent-empty.md) | 457 |
| [ux-models-feature-flag-not-repeatable.md](./ux-models-feature-flag-not-repeatable.md) | 458 |
| [ux-models-feature-reasoning-filter-works.md](./ux-models-feature-reasoning-filter-works.md) | 787 |
| [ux-models-feature-tools-case-insensitive-good.md](./ux-models-feature-tools-case-insensitive-good.md) | 788 |
| [ux-models-feature-web-search-works.md](./ux-models-feature-web-search-works.md) | 789 |
| [ux-models-google-reasoning-filter-works.md](./ux-models-google-reasoning-filter-works.md) | 790 |
| [ux-models-help-examples-are-excellent.md](./ux-models-help-examples-are-excellent.md) | 791 |
| [ux-models-help-examples-still-best-in-class.md](./ux-models-help-examples-still-best-in-class.md) | 792 |
| [ux-models-input-bogus-silent-empty.md](./ux-models-input-bogus-silent-empty.md) | 459 |
| [ux-models-invalid-endpoint-prints-stack.md](./ux-models-invalid-endpoint-prints-stack.md) | 159 |
| [ux-models-invalid-feature-silent-empty-reconfirmed.md](./ux-models-invalid-feature-silent-empty-reconfirmed.md) | 460 |
| [ux-models-invalid-feature-silent-empty.md](./ux-models-invalid-feature-silent-empty.md) | 461 |
| [ux-models-invalid-input-output-modality-silent-empty.md](./ux-models-invalid-input-output-modality-silent-empty.md) | 160 |
| [ux-models-invalid-modality-silent-empty.md](./ux-models-invalid-modality-silent-empty.md) | 462 |
| [ux-models-invalid-provider-silent-empty.md](./ux-models-invalid-provider-silent-empty.md) | 161 |
| [ux-models-model-flag-rejects-namespaced-ids.md](./ux-models-model-flag-rejects-namespaced-ids.md) | 162 |
| [ux-models-no-limit-flag-confirmed.md](./ux-models-no-limit-flag-confirmed.md) | 163 |
| [ux-models-no-limit-flag.md](./ux-models-no-limit-flag.md) | 164 |
| [ux-models-openai-tools-capabilities-good.md](./ux-models-openai-tools-capabilities-good.md) | 793 |
| [ux-models-openai-tools-filter-works.md](./ux-models-openai-tools-filter-works.md) | 794 |
| [ux-models-output-json-search-returns-empty-inconsistently.md](./ux-models-output-json-search-returns-empty-inconsistently.md) | 165 |
| [ux-models-parameters-namespaced-id-empty.md](./ux-models-parameters-namespaced-id-empty.md) | 166 |
| [ux-models-parameters-view-good-for-filtered.md](./ux-models-parameters-view-good-for-filtered.md) | 795 |
| [ux-models-pricing-anthropic-sonnet-works.md](./ux-models-pricing-anthropic-sonnet-works.md) | 796 |
| [ux-models-pricing-capabilities-namespaced-id-empty.md](./ux-models-pricing-capabilities-namespaced-id-empty.md) | 167 |
| [ux-models-pricing-search-combo-good.md](./ux-models-pricing-search-combo-good.md) | 797 |
| [ux-models-pricing-search-works.md](./ux-models-pricing-search-works.md) | 798 |
| [ux-models-pricing-sonnet-4-6-good.md](./ux-models-pricing-sonnet-4-6-good.md) | 799 |
| [ux-models-provider-anthropic-tools-good.md](./ux-models-provider-anthropic-tools-good.md) | 800 |
| [ux-models-provider-case-insensitive-good.md](./ux-models-provider-case-insensitive-good.md) | 801 |
| [ux-models-provider-xai-works.md](./ux-models-provider-xai-works.md) | 802 |
| [ux-models-raw-empty-model-dumps-all-yaml.md](./ux-models-raw-empty-model-dumps-all-yaml.md) | 168 |
| [ux-models-raw-view-bypasses-design-system-reconfirmed.md](./ux-models-raw-view-bypasses-design-system-reconfirmed.md) | 665 |
| [ux-models-raw-view-bypasses-design-system.md](./ux-models-raw-view-bypasses-design-system.md) | 666 |
| [ux-models-search-claude-slash-zero.md](./ux-models-search-claude-slash-zero.md) | 463 |
| [ux-models-search-confirms-sonnet-5-absent-from-catalog.md](./ux-models-search-confirms-sonnet-5-absent-from-catalog.md) | 169 |
| [ux-models-search-empty-returns-all.md](./ux-models-search-empty-returns-all.md) | 667 |
| [ux-models-search-quoted-catalog-display-name-fails.md](./ux-models-search-quoted-catalog-display-name-fails.md) | 170 |
| [ux-models-search-sonnet-5-zero-proves-dead-id.md](./ux-models-search-sonnet-5-zero-proves-dead-id.md) | 171 |
| [ux-models-since-1d-empty-today.md](./ux-models-since-1d-empty-today.md) | 668 |
| [ux-models-since-7d-works.md](./ux-models-since-7d-works.md) | 803 |
| [ux-models-since-invalid-prints-stack.md](./ux-models-since-invalid-prints-stack.md) | 172 |
| [ux-models-since-validation-still-prints-stack.md](./ux-models-since-validation-still-prints-stack.md) | 173 |
| [ux-models-tools-and-feature-filter-semantics-undocumented.md](./ux-models-tools-and-feature-filter-semantics-undocumented.md) | 669 |
| [ux-models-tools-and-feature-tools-redundant-ok.md](./ux-models-tools-and-feature-tools-redundant-ok.md) | 804 |
| [ux-models-view-invalid-raw-commander.md](./ux-models-view-invalid-raw-commander.md) | 670 |
| [ux-models-view-invalid-uses-raw-commander.md](./ux-models-view-invalid-uses-raw-commander.md) | 464 |
| [ux-models-view-parameters-without-filter-floods.md](./ux-models-view-parameters-without-filter-floods.md) | 465 |
| [ux-models-view-raw-bypasses-design-system-reconfirmed.md](./ux-models-view-raw-bypasses-design-system-reconfirmed.md) | 805 |
| [ux-models-view-raw-namespaced-id-returns-empty-array.md](./ux-models-view-raw-namespaced-id-returns-empty-array.md) | 174 |
| [ux-models-xai-reasoning-filter-works.md](./ux-models-xai-reasoning-filter-works.md) | 806 |
| [ux-no-doctor-or-health-overview-command.md](./ux-no-doctor-or-health-overview-command.md) | 466 |
| [ux-no-shell-completion-command.md](./ux-no-shell-completion-command.md) | 671 |
| [ux-non-tty-prompt-wrong-guidance.md](./ux-non-tty-prompt-wrong-guidance.md) | 175 |
| [ux-oauth-url-dumps-full-query-string.md](./ux-oauth-url-dumps-full-query-string.md) | 672 |
| [ux-opencode-model-flag-still-triple-namespace.md](./ux-opencode-model-flag-still-triple-namespace.md) | 467 |
| [ux-opencode-model-triple-namespace.md](./ux-opencode-model-triple-namespace.md) | 468 |
| [ux-opus-4-7-catalog-supports-xhigh-sonnet-does-not.md](./ux-opus-4-7-catalog-supports-xhigh-sonnet-does-not.md) | 176 |
| [ux-package-json-extra-bins-still-present-reconfirmed.md](./ux-package-json-extra-bins-still-present-reconfirmed.md) | 177 |
| [ux-package-json-extra-npm-bins-reconfirmed.md](./ux-package-json-extra-npm-bins-reconfirmed.md) | 178 |
| [ux-permission-mode-sets-differ-across-commands.md](./ux-permission-mode-sets-differ-across-commands.md) | 179 |
| [ux-pi-agent-alias-works.md](./ux-pi-agent-alias-works.md) | 807 |
| [ux-pi-spawnable-but-not-configurable.md](./ux-pi-spawnable-but-not-configurable.md) | 180 |
| [ux-pipeline-experiment-plan-path-as-subcommand.md](./ux-pipeline-experiment-plan-path-as-subcommand.md) | 673 |
| [ux-pipeline-init-help-omits-yes.md](./ux-pipeline-init-help-omits-yes.md) | 469 |
| [ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md](./ux-pipeline-init-yes-error-ok-but-panel-lifecycle.md) | 470 |
| [ux-pipeline-init-yes-requires-source-good.md](./ux-pipeline-init-yes-requires-source-good.md) | 808 |
| [ux-pipeline-install-claims-success-when-all-skipped.md](./ux-pipeline-install-claims-success-when-all-skipped.md) | 471 |
| [ux-pipeline-install-force-skips-skill-overwrites-steps.md](./ux-pipeline-install-force-skips-skill-overwrites-steps.md) | 181 |
| [ux-pipeline-install-force-skips-skill-still.md](./ux-pipeline-install-force-skips-skill-still.md) | 182 |
| [ux-pipeline-max-runs-zero-good-validation.md](./ux-pipeline-max-runs-zero-good-validation.md) | 809 |
| [ux-pipeline-max-runs-zero-validation-good.md](./ux-pipeline-max-runs-zero-validation-good.md) | 810 |
| [ux-pipeline-nothing-to-run-success-framing.md](./ux-pipeline-nothing-to-run-success-framing.md) | 472 |
| [ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md](./ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md) | 183 |
| [ux-pipeline-run-help-omits-yes-and-mode.md](./ux-pipeline-run-help-omits-yes-and-mode.md) | 184 |
| [ux-pipeline-run-model-override-shown-on-nothing-to-run.md](./ux-pipeline-run-model-override-shown-on-nothing-to-run.md) | 811 |
| [ux-pipeline-run-yes-autopicks-completed-plan-nothing-to-run.md](./ux-pipeline-run-yes-autopicks-completed-plan-nothing-to-run.md) | 185 |
| [ux-pipeline-tui-flag-ignored-on-init-failure.md](./ux-pipeline-tui-flag-ignored-on-init-failure.md) | 473 |
| [ux-pipeline-validate-enoent-system-error.md](./ux-pipeline-validate-enoent-system-error.md) | 474 |
| [ux-pipeline-validate-good-plan-positive.md](./ux-pipeline-validate-good-plan-positive.md) | 812 |
| [ux-pipeline-validate-no-json-flag.md](./ux-pipeline-validate-no-json-flag.md) | 475 |
| [ux-pipeline-validate-success-still-problems-footer.md](./ux-pipeline-validate-success-still-problems-footer.md) | 674 |
| [ux-pipeline-validate-valid-pipeline-good.md](./ux-pipeline-validate-valid-pipeline-good.md) | 813 |
| [ux-pipeline-validate-wrong-kind-good-message.md](./ux-pipeline-validate-wrong-kind-good-message.md) | 814 |
| [ux-pipeline-validate-wrong-kind-see-logs.md](./ux-pipeline-validate-wrong-kind-see-logs.md) | 476 |
| [ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md](./ux-pipeline-validate-wrong-kind-system-chrome-reconfirmed.md) | 477 |
| [ux-pipeline-validate-wrong-kind-system-chrome.md](./ux-pipeline-validate-wrong-kind-system-chrome.md) | 478 |
| [ux-plan-archive-allows-readme.md](./ux-plan-archive-allows-readme.md) | 479 |
| [ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md](./ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md) | 186 |
| [ux-plan-archive-delete-yes-picks-arbitrary-plan.md](./ux-plan-archive-delete-yes-picks-arbitrary-plan.md) | 21 |
| [ux-plan-archive-help-omits-yes-behavior.md](./ux-plan-archive-help-omits-yes-behavior.md) | 187 |
| [ux-plan-archive-help-still-omits-yes.md](./ux-plan-archive-help-still-omits-yes.md) | 188 |
| [ux-plan-archive-json-output-good.md](./ux-plan-archive-json-output-good.md) | 815 |
| [ux-plan-archive-json-skips-without-explaining-why.md](./ux-plan-archive-json-skips-without-explaining-why.md) | 189 |
| [ux-plan-archive-requires-yes-non-tty-good.md](./ux-plan-archive-requires-yes-non-tty-good.md) | 816 |
| [ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md](./ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md) | 190 |
| [ux-plan-browse-non-tty-dumps-first-plan.md](./ux-plan-browse-non-tty-dumps-first-plan.md) | 480 |
| [ux-plan-browse-non-tty-dumps-plan-body.md](./ux-plan-browse-non-tty-dumps-plan-body.md) | 191 |
| [ux-plan-browse-rejects-path-argument.md](./ux-plan-browse-rejects-path-argument.md) | 481 |
| [ux-plan-delete-allows-readme.md](./ux-plan-delete-allows-readme.md) | 192 |
| [ux-plan-delete-help-still-omits-yes.md](./ux-plan-delete-help-still-omits-yes.md) | 193 |
| [ux-plan-delete-json-output-good.md](./ux-plan-delete-json-output-good.md) | 817 |
| [ux-plan-delete-json-skips-without-reason.md](./ux-plan-delete-json-skips-without-reason.md) | 194 |
| [ux-plan-docs-advertise-goal-and-chat-commands-missing.md](./ux-plan-docs-advertise-goal-and-chat-commands-missing.md) | 482 |
| [ux-plan-edit-bare-edited-message.md](./ux-plan-edit-bare-edited-message.md) | 818 |
| [ux-plan-edit-editor-true-claims-edited-without-change.md](./ux-plan-edit-editor-true-claims-edited-without-change.md) | 483 |
| [ux-plan-edit-hangs-without-editor.md](./ux-plan-edit-hangs-without-editor.md) | 195 |
| [ux-plan-help-keymap-hint-unframed.md](./ux-plan-help-keymap-hint-unframed.md) | 819 |
| [ux-plan-help-omits-yes-on-destructive-subcommands.md](./ux-plan-help-omits-yes-on-destructive-subcommands.md) | 196 |
| [ux-plan-help-stacked-layout-and-internal-commands.md](./ux-plan-help-stacked-layout-and-internal-commands.md) | 484 |
| [ux-plan-install-dry-run-clean-good.md](./ux-plan-install-dry-run-clean-good.md) | 820 |
| [ux-plan-install-help-omits-yes-but-accepts-yes.md](./ux-plan-install-help-omits-yes-but-accepts-yes.md) | 485 |
| [ux-plan-install-no-force-flag.md](./ux-plan-install-no-force-flag.md) | 486 |
| [ux-plan-install-pi-clearer-than-unknown.md](./ux-plan-install-pi-clearer-than-unknown.md) | 821 |
| [ux-plan-install-success-good.md](./ux-plan-install-success-good.md) | 822 |
| [ux-plan-install-unsupported-agent-pi-kimi.md](./ux-plan-install-unsupported-agent-pi-kimi.md) | 487 |
| [ux-plan-install-yes-defaults-claude-writes-skill.md](./ux-plan-install-yes-defaults-claude-writes-skill.md) | 488 |
| [ux-plan-kind-invalid-validation-good.md](./ux-plan-kind-invalid-validation-good.md) | 823 |
| [ux-plan-list-broken-two-line-row-layout.md](./ux-plan-list-broken-two-line-row-layout.md) | 489 |
| [ux-plan-list-empty-experiment-table-reconfirmed.md](./ux-plan-list-empty-experiment-table-reconfirmed.md) | 490 |
| [ux-plan-list-empty-kind-table-reconfirmed.md](./ux-plan-list-empty-kind-table-reconfirmed.md) | 491 |
| [ux-plan-list-empty-ralph-table-reconfirmed.md](./ux-plan-list-empty-ralph-table-reconfirmed.md) | 492 |
| [ux-plan-list-empty-superintendent-base-table-reconfirmed.md](./ux-plan-list-empty-superintendent-base-table-reconfirmed.md) | 493 |
| [ux-plan-list-empty-table-no-message.md](./ux-plan-list-empty-table-no-message.md) | 675 |
| [ux-plan-list-includes-exactly-one-readme.md](./ux-plan-list-includes-exactly-one-readme.md) | 494 |
| [ux-plan-list-includes-noise-files.md](./ux-plan-list-includes-noise-files.md) | 495 |
| [ux-plan-list-includes-readme-reconfirmed.md](./ux-plan-list-includes-readme-reconfirmed.md) | 496 |
| [ux-plan-list-invalid-kind-output-validation-good.md](./ux-plan-list-invalid-kind-output-validation-good.md) | 824 |
| [ux-plan-list-json-empty-is-bare-array.md](./ux-plan-list-json-empty-is-bare-array.md) | 825 |
| [ux-plan-list-json-includes-readme-reconfirmed.md](./ux-plan-list-json-includes-readme-reconfirmed.md) | 497 |
| [ux-plan-list-md-includes-readme-noise.md](./ux-plan-list-md-includes-readme-noise.md) | 498 |
| [ux-plan-list-md-includes-readme-reconfirmed.md](./ux-plan-list-md-includes-readme-reconfirmed.md) | 499 |
| [ux-plan-list-output-json-unframed.md](./ux-plan-list-output-json-unframed.md) | 676 |
| [ux-plan-list-output-md-is-markdown-table-good.md](./ux-plan-list-output-md-is-markdown-table-good.md) | 826 |
| [ux-plan-list-pipeline-json-good.md](./ux-plan-list-pipeline-json-good.md) | 827 |
| [ux-plan-markdown-read-depth-zero-shows-no-sections.md](./ux-plan-markdown-read-depth-zero-shows-no-sections.md) | 500 |
| [ux-plan-markdown-read-raw-yaml-ish-output.md](./ux-plan-markdown-read-raw-yaml-ish-output.md) | 677 |
| [ux-plan-markdown-read-section-by-number-works.md](./ux-plan-markdown-read-section-by-number-works.md) | 828 |
| [ux-plan-markdown-read-section-wrong-command-hint.md](./ux-plan-markdown-read-section-wrong-command-hint.md) | 501 |
| [ux-plan-markdown-read-section-wrong-hint-reconfirmed.md](./ux-plan-markdown-read-section-wrong-hint-reconfirmed.md) | 502 |
| [ux-plan-markdown-read-system-chrome.md](./ux-plan-markdown-read-system-chrome.md) | 503 |
| [ux-plan-markdown-reader-mcp-help-minimal.md](./ux-plan-markdown-reader-mcp-help-minimal.md) | 678 |
| [ux-plan-non-tty-unclear-failure.md](./ux-plan-non-tty-unclear-failure.md) | 504 |
| [ux-plan-output-invalid-validation-good.md](./ux-plan-output-invalid-validation-good.md) | 829 |
| [ux-plan-path-commands-bare-stdout-reconfirmed.md](./ux-plan-path-commands-bare-stdout-reconfirmed.md) | 830 |
| [ux-plan-path-commands-bare-stdout.md](./ux-plan-path-commands-bare-stdout.md) | 831 |
| [ux-plan-question-non-tty-may-hang.md](./ux-plan-question-non-tty-may-hang.md) | 197 |
| [ux-plan-question-starts-session-without-mode.md](./ux-plan-question-starts-session-without-mode.md) | 505 |
| [ux-plan-root-non-tty-dumps-arbitrary-body.md](./ux-plan-root-non-tty-dumps-arbitrary-body.md) | 198 |
| [ux-plan-root-nontty-dumps-arbitrary-plan-body.md](./ux-plan-root-nontty-dumps-arbitrary-plan-body.md) | 199 |
| [ux-plan-view-json-dumps-full-content.md](./ux-plan-view-json-dumps-full-content.md) | 506 |
| [ux-plan-view-json-dumps-full-markdown-content.md](./ux-plan-view-json-dumps-full-markdown-content.md) | 679 |
| [ux-plan-view-json-embeds-full-content-flood.md](./ux-plan-view-json-embeds-full-content-flood.md) | 200 |
| [ux-plan-view-missing-path-good.md](./ux-plan-view-missing-path-good.md) | 832 |
| [ux-plan-view-non-tty-requires-path-good.md](./ux-plan-view-non-tty-requires-path-good.md) | 833 |
| [ux-plan-view-pipeline-md-output-good.md](./ux-plan-view-pipeline-md-output-good.md) | 834 |
| [ux-plan-view-vs-markdown-read-not-found-inconsistent.md](./ux-plan-view-vs-markdown-read-not-found-inconsistent.md) | 507 |
| [ux-poe-no-prompt-works-for-configure-dry-run.md](./ux-poe-no-prompt-works-for-configure-dry-run.md) | 835 |
| [ux-postinstall-sync-skills-can-run-on-user-install.md](./ux-postinstall-sync-skills-can-run-on-user-install.md) | 313 |
| [ux-primary-commands-lack-examples-in-help.md](./ux-primary-commands-lack-examples-in-help.md) | 508 |
| [ux-primary-commands-still-lack-examples.md](./ux-primary-commands-still-lack-examples.md) | 509 |
| [ux-problems-footer-on-every-success.md](./ux-problems-footer-on-every-success.md) | 680 |
| [ux-provider-help-command-lowercase-systemic.md](./ux-provider-help-command-lowercase-systemic.md) | 836 |
| [ux-provider-list-agents-column-incomplete.md](./ux-provider-list-agents-column-incomplete.md) | 510 |
| [ux-provider-list-agents-column-truncated.md](./ux-provider-list-agents-column-truncated.md) | 681 |
| [ux-provider-list-agents-column-truncates.md](./ux-provider-list-agents-column-truncates.md) | 511 |
| [ux-provider-list-all-logged-out-clean.md](./ux-provider-list-all-logged-out-clean.md) | 837 |
| [ux-provider-list-no-json-flag.md](./ux-provider-list-no-json-flag.md) | 512 |
| [ux-provider-list-table-layout-broken.md](./ux-provider-list-table-layout-broken.md) | 314 |
| [ux-provider-login-anthropic-dry-run-clean.md](./ux-provider-login-anthropic-dry-run-clean.md) | 838 |
| [ux-provider-login-anthropic-dry-run-good.md](./ux-provider-login-anthropic-dry-run-good.md) | 839 |
| [ux-provider-login-api-key-flag-history-risk.md](./ux-provider-login-api-key-flag-history-risk.md) | 513 |
| [ux-provider-login-cloudflare-requires-base-url-good.md](./ux-provider-login-cloudflare-requires-base-url-good.md) | 840 |
| [ux-provider-login-missing-key-system-chrome.md](./ux-provider-login-missing-key-system-chrome.md) | 514 |
| [ux-provider-login-poe-dry-run-rewrites-claude-settings-xhigh.md](./ux-provider-login-poe-dry-run-rewrites-claude-settings-xhigh.md) | 201 |
| [ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md](./ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md) | 202 |
| [ux-provider-login-unknown-has-list-hint-and-see-logs.md](./ux-provider-login-unknown-has-list-hint-and-see-logs.md) | 682 |
| [ux-provider-logout-anthropic-dry-run-good.md](./ux-provider-logout-anthropic-dry-run-good.md) | 841 |
| [ux-provider-logout-dry-run-unconfigures-agents.md](./ux-provider-logout-dry-run-unconfigures-agents.md) | 203 |
| [ux-provider-logout-help-no-danger-or-yes.md](./ux-provider-logout-help-no-danger-or-yes.md) | 204 |
| [ux-provider-logout-openai-dry-run-clean.md](./ux-provider-logout-openai-dry-run-clean.md) | 842 |
| [ux-provider-logout-poe-dry-run-still-agent-diffs.md](./ux-provider-logout-poe-dry-run-still-agent-diffs.md) | 205 |
| [ux-provider-logout-poe-dry-run-unconfigures-agents.md](./ux-provider-logout-poe-dry-run-unconfigures-agents.md) | 206 |
| [ux-ralph-experiment-wrong-kind-says-not-found.md](./ux-ralph-experiment-wrong-kind-says-not-found.md) | 515 |
| [ux-ralph-init-missing-doc-not-found-good.md](./ux-ralph-init-missing-doc-not-found-good.md) | 843 |
| [ux-ralph-init-plan-says-not-found.md](./ux-ralph-init-plan-says-not-found.md) | 207 |
| [ux-ralph-init-requires-existing-ralph-doc-circular.md](./ux-ralph-init-requires-existing-ralph-doc-circular.md) | 208 |
| [ux-ralph-run-empty-kind-unaware-reconfirmed.md](./ux-ralph-run-empty-kind-unaware-reconfirmed.md) | 209 |
| [ux-ralph-run-help-omits-yes.md](./ux-ralph-run-help-omits-yes.md) | 516 |
| [ux-ralph-run-plan-kind-says-ralph-doc-not-found.md](./ux-ralph-run-plan-kind-says-ralph-doc-not-found.md) | 210 |
| [ux-ralph-run-plan-says-not-found-reconfirmed.md](./ux-ralph-run-plan-says-not-found-reconfirmed.md) | 211 |
| [ux-ralph-validate-command-missing.md](./ux-ralph-validate-command-missing.md) | 517 |
| [ux-raw-commander-invalid-option-choices.md](./ux-raw-commander-invalid-option-choices.md) | 518 |
| [ux-raw-commander-missing-args.md](./ux-raw-commander-missing-args.md) | 519 |
| [ux-readme-features-wrap-but-cli-missing.md](./ux-readme-features-wrap-but-cli-missing.md) | 520 |
| [ux-readme-spawn-omits-mode-for-ci.md](./ux-readme-spawn-omits-mode-for-ci.md) | 212 |
| [ux-reasoning-effort-bogus-silently-ignored.md](./ux-reasoning-effort-bogus-silently-ignored.md) | 213 |
| [ux-reasoning-effort-flag-opaque.md](./ux-reasoning-effort-flag-opaque.md) | 521 |
| [ux-reasoning-effort-flag-silently-ignored-for-some-agents.md](./ux-reasoning-effort-flag-silently-ignored-for-some-agents.md) | 214 |
| [ux-reasoning-effort-high-still-writes-xhigh.md](./ux-reasoning-effort-high-still-writes-xhigh.md) | 215 |
| [ux-resume-thread-errors-are-agent-raw.md](./ux-resume-thread-errors-are-agent-raw.md) | 522 |
| [ux-resume-thread-invalid-agent-raw-error.md](./ux-resume-thread-invalid-agent-raw-error.md) | 523 |
| [ux-resume-thread-invalid-id-agent-raw-error.md](./ux-resume-thread-invalid-id-agent-raw-error.md) | 216 |
| [ux-root-help-footer-npm-run-dev-for-options.md](./ux-root-help-footer-npm-run-dev-for-options.md) | 217 |
| [ux-root-help-footer-npm-run-dev-reconfirmed.md](./ux-root-help-footer-npm-run-dev-reconfirmed.md) | 218 |
| [ux-root-help-footer-still-npm-run-dev.md](./ux-root-help-footer-still-npm-run-dev.md) | 219 |
| [ux-root-help-hides-skill-memory-runtime-eval-and-more.md](./ux-root-help-hides-skill-memory-runtime-eval-and-more.md) | 24 |
| [ux-root-help-lists-19-commands-hides-more.md](./ux-root-help-lists-19-commands-hides-more.md) | 220 |
| [ux-root-help-still-hides-13-working-commands-reconfirmed.md](./ux-root-help-still-hides-13-working-commands-reconfirmed.md) | 221 |
| [ux-root-help-still-hides-skill-memory.md](./ux-root-help-still-hides-skill-memory.md) | 222 |
| [ux-root-help-usage-line-is-npm-run-dev.md](./ux-root-help-usage-line-is-npm-run-dev.md) | 223 |
| [ux-root-help-usage-npm-run-dev-reconfirmed.md](./ux-root-help-usage-npm-run-dev-reconfirmed.md) | 224 |
| [ux-root-help-usage-still-npm-run-dev-reconfirmed.md](./ux-root-help-usage-still-npm-run-dev-reconfirmed.md) | 225 |
| [ux-root-tagline-inconsistent.md](./ux-root-tagline-inconsistent.md) | 844 |
| [ux-root-typo-confgure-spwn-no-suggestions-reconfirmed.md](./ux-root-typo-confgure-spwn-no-suggestions-reconfirmed.md) | 524 |
| [ux-root-typo-configuree-modell-no-suggestions-reconfirmed.md](./ux-root-typo-configuree-modell-no-suggestions-reconfirmed.md) | 525 |
| [ux-root-typo-still-no-suggestions-reconfirmed.md](./ux-root-typo-still-no-suggestions-reconfirmed.md) | 226 |
| [ux-root-typos-no-did-you-mean-configure-spawn.md](./ux-root-typos-no-did-you-mean-configure-spawn.md) | 227 |
| [ux-runner-sync-and-runtime-invalid-raw-commander.md](./ux-runner-sync-and-runtime-invalid-raw-commander.md) | 526 |
| [ux-runner-sync-without-detach-silently-ignored.md](./ux-runner-sync-without-detach-silently-ignored.md) | 228 |
| [ux-runner-sync-without-runtime-silently-accepted.md](./ux-runner-sync-without-runtime-silently-accepted.md) | 527 |
| [ux-runtime-build-host-message-good.md](./ux-runtime-build-host-message-good.md) | 845 |
| [ux-runtime-init-docker-dry-run-clean.md](./ux-runtime-init-docker-dry-run-clean.md) | 846 |
| [ux-runtime-init-dry-run-clean.md](./ux-runtime-init-dry-run-clean.md) | 847 |
| [ux-runtime-init-non-tty-poe-no-prompt.md](./ux-runtime-init-non-tty-poe-no-prompt.md) | 229 |
| [ux-runtime-job-missing-see-logs.md](./ux-runtime-job-missing-see-logs.md) | 528 |
| [ux-runtime-jobs-attach-missing-see-logs.md](./ux-runtime-jobs-attach-missing-see-logs.md) | 529 |
| [ux-runtime-jobs-list-unbounded-opaque-statuses.md](./ux-runtime-jobs-list-unbounded-opaque-statuses.md) | 530 |
| [ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md](./ux-runtime-jobs-logs-ambiguous-lists-many-including-running.md) | 230 |
| [ux-runtime-jobs-logs-stop-missing-see-logs.md](./ux-runtime-jobs-logs-stop-missing-see-logs.md) | 531 |
| [ux-runtime-jobs-ls-help-no-limit-reconfirmed.md](./ux-runtime-jobs-ls-help-no-limit-reconfirmed.md) | 532 |
| [ux-runtime-jobs-ls-inconsistent-with-list.md](./ux-runtime-jobs-ls-inconsistent-with-list.md) | 848 |
| [ux-runtime-jobs-ls-unbounded-may-era-reconfirmed.md](./ux-runtime-jobs-ls-unbounded-may-era-reconfirmed.md) | 231 |
| [ux-runtime-jobs-ls-unbounded-stale-from-may.md](./ux-runtime-jobs-ls-unbounded-stale-from-may.md) | 232 |
| [ux-runtime-jobs-show-unknown-suggests-stop.md](./ux-runtime-jobs-show-unknown-suggests-stop.md) | 533 |
| [ux-runtime-jobs-stale-running-zombies.md](./ux-runtime-jobs-stale-running-zombies.md) | 315 |
| [ux-runtime-jobs-stop-lists-many-stale-running.md](./ux-runtime-jobs-stop-lists-many-stale-running.md) | 233 |
| [ux-runtime-missing-deps-good-message-system-chrome.md](./ux-runtime-missing-deps-good-message-system-chrome.md) | 534 |
| [ux-runtime-templates-clear-no-yes-needed-good.md](./ux-runtime-templates-clear-no-yes-needed-good.md) | 849 |
| [ux-runtime-templates-clear-no-yes-or-dry-run.md](./ux-runtime-templates-clear-no-yes-or-dry-run.md) | 234 |
| [ux-runtime-templates-clear-poe-no-prompt-not-yes.md](./ux-runtime-templates-clear-poe-no-prompt-not-yes.md) | 235 |
| [ux-runtime-templates-ls-empty-rows.md](./ux-runtime-templates-ls-empty-rows.md) | 535 |
| [ux-runtime-templates-ls-shows-empty-docker-row.md](./ux-runtime-templates-ls-shows-empty-docker-row.md) | 683 |
| [ux-runtime-templates-ls-unbounded-noise.md](./ux-runtime-templates-ls-unbounded-noise.md) | 684 |
| [ux-runtime-templates-ls-unbounded-stale.md](./ux-runtime-templates-ls-unbounded-stale.md) | 236 |
| [ux-runtime-templates-parent-no-default-subcommand.md](./ux-runtime-templates-parent-no-default-subcommand.md) | 685 |
| [ux-sdk-cli-mode-default-mismatch.md](./ux-sdk-cli-mode-default-mismatch.md) | 237 |
| [ux-sdk-getpoeapikey-throws-generic-error.md](./ux-sdk-getpoeapikey-throws-generic-error.md) | 536 |
| [ux-shape-base-url-error-good-message-system-prefix.md](./ux-shape-base-url-error-good-message-system-prefix.md) | 686 |
| [ux-shape-base-url-invalid-format-validation-good.md](./ux-shape-base-url-invalid-format-validation-good.md) | 850 |
| [ux-shape-base-url-invalid-validation-good.md](./ux-shape-base-url-invalid-validation-good.md) | 851 |
| [ux-shape-base-url-unknown-shape-lists-exposed-good.md](./ux-shape-base-url-unknown-shape-lists-exposed-good.md) | 852 |
| [ux-skill-and-skills-flags-undocumented-relationship.md](./ux-skill-and-skills-flags-undocumented-relationship.md) | 687 |
| [ux-skill-bridge-failure-lists-paths-good.md](./ux-skill-bridge-failure-lists-paths-good.md) | 853 |
| [ux-skill-bridge-failure-system-chrome.md](./ux-skill-bridge-failure-system-chrome.md) | 537 |
| [ux-skill-configure-agent-list-differs-from-configure.md](./ux-skill-configure-agent-list-differs-from-configure.md) | 538 |
| [ux-skill-configure-agent-list-subset-reconfirmed.md](./ux-skill-configure-agent-list-subset-reconfirmed.md) | 539 |
| [ux-skill-configure-exists-system-chrome.md](./ux-skill-configure-exists-system-chrome.md) | 238 |
| [ux-skill-configure-goose-local-success.md](./ux-skill-configure-goose-local-success.md) | 854 |
| [ux-skill-configure-goose-writes-dot-agents-skills.md](./ux-skill-configure-goose-writes-dot-agents-skills.md) | 688 |
| [ux-skill-configure-kimi-unsupported-abrupt.md](./ux-skill-configure-kimi-unsupported-abrupt.md) | 540 |
| [ux-skill-configure-pi-poe-agent-not-supported-clear.md](./ux-skill-configure-pi-poe-agent-not-supported-clear.md) | 855 |
| [ux-skill-configure-yes-defaults-agent-silently.md](./ux-skill-configure-yes-defaults-agent-silently.md) | 541 |
| [ux-skill-configure-yes-defaults-to-claude-already-exists.md](./ux-skill-configure-yes-defaults-to-claude-already-exists.md) | 542 |
| [ux-skill-configure-yes-silent-default-agent.md](./ux-skill-configure-yes-silent-default-agent.md) | 239 |
| [ux-skill-empty-string-malformed-reference.md](./ux-skill-empty-string-malformed-reference.md) | 689 |
| [ux-skill-help-hides-from-root-reconfirmed.md](./ux-skill-help-hides-from-root-reconfirmed.md) | 240 |
| [ux-skill-help-usage-says-options-not-command.md](./ux-skill-help-usage-says-options-not-command.md) | 856 |
| [ux-skill-install-file-required-before-name.md](./ux-skill-install-file-required-before-name.md) | 543 |
| [ux-skill-install-from-file-works-well.md](./ux-skill-install-from-file-works-well.md) | 857 |
| [ux-skill-install-help-omits-force.md](./ux-skill-install-help-omits-force.md) | 241 |
| [ux-skill-install-missing-file-enoent-see-logs.md](./ux-skill-install-missing-file-enoent-see-logs.md) | 544 |
| [ux-skill-install-missing-file-enoent.md](./ux-skill-install-missing-file-enoent.md) | 545 |
| [ux-skill-install-name-and-file-both-required-reconfirmed.md](./ux-skill-install-name-and-file-both-required-reconfirmed.md) | 242 |
| [ux-skill-install-name-and-file-both-required.md](./ux-skill-install-name-and-file-both-required.md) | 546 |
| [ux-skill-list-command-missing.md](./ux-skill-list-command-missing.md) | 243 |
| [ux-skill-memory-absent-from-root-help.md](./ux-skill-memory-absent-from-root-help.md) | 244 |
| [ux-skill-naming-collisions.md](./ux-skill-naming-collisions.md) | 547 |
| [ux-skill-no-list-or-bridge-subcommands.md](./ux-skill-no-list-or-bridge-subcommands.md) | 245 |
| [ux-skill-parent-no-next-step-guidance.md](./ux-skill-parent-no-next-step-guidance.md) | 548 |
| [ux-skill-unconfigure-defaults-agent-and-soft-blocks.md](./ux-skill-unconfigure-defaults-agent-and-soft-blocks.md) | 549 |
| [ux-skill-unconfigure-dry-run-path-inconsistent.md](./ux-skill-unconfigure-dry-run-path-inconsistent.md) | 246 |
| [ux-skill-unconfigure-force-deletes-entire-skills-dir.md](./ux-skill-unconfigure-force-deletes-entire-skills-dir.md) | 17 |
| [ux-skill-unconfigure-goose-no-dir-good.md](./ux-skill-unconfigure-goose-no-dir-good.md) | 858 |
| [ux-skill-unconfigure-refuses-nonempty-without-force-good.md](./ux-skill-unconfigure-refuses-nonempty-without-force-good.md) | 859 |
| [ux-skills-empty-string-silently-ignored.md](./ux-skills-empty-string-silently-ignored.md) | 550 |
| [ux-skills-flag-without-value-is-noop-or-unclear.md](./ux-skills-flag-without-value-is-noop-or-unclear.md) | 551 |
| [ux-skip-if-configured-dry-run-shows-dead-sonnet-5-default.md](./ux-skip-if-configured-dry-run-shows-dead-sonnet-5-default.md) | 13 |
| [ux-skip-if-configured-dry-run-still-plans-full-rewrite.md](./ux-skip-if-configured-dry-run-still-plans-full-rewrite.md) | 247 |
| [ux-skip-if-configured-help-text-lies.md](./ux-skip-if-configured-help-text-lies.md) | 12 |
| [ux-skip-if-configured-matching-model-still-plans-full-rewrite.md](./ux-skip-if-configured-matching-model-still-plans-full-rewrite.md) | 248 |
| [ux-skip-if-configured-matching-sonnet-4-6-still-full-rewrite-reconfirm.md](./ux-skip-if-configured-matching-sonnet-4-6-still-full-rewrite-reconfirm.md) | 249 |
| [ux-skip-if-configured-shows-stale-default-model.md](./ux-skip-if-configured-shows-stale-default-model.md) | 250 |
| [ux-skip-if-configured-still-noises-dry-run.md](./ux-skip-if-configured-still-noises-dry-run.md) | 690 |
| [ux-skip-if-configured-still-writes-when-model-differs.md](./ux-skip-if-configured-still-writes-when-model-differs.md) | 552 |
| [ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md](./ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md) | 11 |
| [ux-sonnet-4-6-output-effort-has-no-xhigh.md](./ux-sonnet-4-6-output-effort-has-no-xhigh.md) | 251 |
| [ux-sonnet-5-still-absent-from-catalog.md](./ux-sonnet-5-still-absent-from-catalog.md) | 252 |
| [ux-spawn-advanced-flags-undifferentiated.md](./ux-spawn-advanced-flags-undifferentiated.md) | 553 |
| [ux-spawn-at-file-missing-validation-good.md](./ux-spawn-at-file-missing-validation-good.md) | 860 |
| [ux-spawn-at-file-works.md](./ux-spawn-at-file-works.md) | 861 |
| [ux-spawn-codex-reads-stdin-message-on-tty-less-success.md](./ux-spawn-codex-reads-stdin-message-on-tty-less-success.md) | 554 |
| [ux-spawn-codex-works-with-frontier-model.md](./ux-spawn-codex-works-with-frontier-model.md) | 862 |
| [ux-spawn-configure-help-still-no-examples-reconfirmed.md](./ux-spawn-configure-help-still-no-examples-reconfirmed.md) | 253 |
| [ux-spawn-cursor-with-model-works.md](./ux-spawn-cursor-with-model-works.md) | 863 |
| [ux-spawn-cwd-file-not-directory-see-logs.md](./ux-spawn-cwd-file-not-directory-see-logs.md) | 555 |
| [ux-spawn-cwd-missing-see-logs.md](./ux-spawn-cwd-missing-see-logs.md) | 556 |
| [ux-spawn-cwd-missing-system-chrome.md](./ux-spawn-cwd-missing-system-chrome.md) | 557 |
| [ux-spawn-cwd-tmp-works.md](./ux-spawn-cwd-tmp-works.md) | 864 |
| [ux-spawn-detach-ignored-on-failure-path.md](./ux-spawn-detach-ignored-on-failure-path.md) | 558 |
| [ux-spawn-detach-silently-ignored-without-runtime.md](./ux-spawn-detach-silently-ignored-without-runtime.md) | 254 |
| [ux-spawn-empty-agent-validates-mode-first.md](./ux-spawn-empty-agent-validates-mode-first.md) | 255 |
| [ux-spawn-empty-at-file-see-logs.md](./ux-spawn-empty-at-file-see-logs.md) | 559 |
| [ux-spawn-gemini-provider-credential-missing.md](./ux-spawn-gemini-provider-credential-missing.md) | 256 |
| [ux-spawn-gemini-provider-credential-opaque-error.md](./ux-spawn-gemini-provider-credential-opaque-error.md) | 257 |
| [ux-spawn-help-still-no-examples.md](./ux-spawn-help-still-no-examples.md) | 258 |
| [ux-spawn-hooks-auto-demands-yes-when-not-poe-configured-message.md](./ux-spawn-hooks-auto-demands-yes-when-not-poe-configured-message.md) | 259 |
| [ux-spawn-interactive-bypasses-design-system-panel.md](./ux-spawn-interactive-bypasses-design-system-panel.md) | 560 |
| [ux-spawn-interactive-non-tty-launches-agent-tui-copy.md](./ux-spawn-interactive-non-tty-launches-agent-tui-copy.md) | 260 |
| [ux-spawn-interactive-non-tty-still-runs.md](./ux-spawn-interactive-non-tty-still-runs.md) | 561 |
| [ux-spawn-interactive-raw-agent-error.md](./ux-spawn-interactive-raw-agent-error.md) | 261 |
| [ux-spawn-interactive-still-uses-stale-model-bare-error.md](./ux-spawn-interactive-still-uses-stale-model-bare-error.md) | 262 |
| [ux-spawn-invalid-mode-validation-good.md](./ux-spawn-invalid-mode-validation-good.md) | 865 |
| [ux-spawn-invalid-model-shows-success-then-failure.md](./ux-spawn-invalid-model-shows-success-then-failure.md) | 263 |
| [ux-spawn-kimi-acp-internal-error-stack.md](./ux-spawn-kimi-acp-internal-error-stack.md) | 264 |
| [ux-spawn-kimi-not-configured-yes-message.md](./ux-spawn-kimi-not-configured-yes-message.md) | 265 |
| [ux-spawn-log-content-help-underwarns-sensitive-data.md](./ux-spawn-log-content-help-underwarns-sensitive-data.md) | 562 |
| [ux-spawn-log-default-redacts-agent-message-good.md](./ux-spawn-log-default-redacts-agent-message-good.md) | 866 |
| [ux-spawn-missing-agent-raw-commander.md](./ux-spawn-missing-agent-raw-commander.md) | 563 |
| [ux-spawn-missing-reasoning-effort-flag.md](./ux-spawn-missing-reasoning-effort-flag.md) | 266 |
| [ux-spawn-missing-worktree-flag-reconfirmed.md](./ux-spawn-missing-worktree-flag-reconfirmed.md) | 267 |
| [ux-spawn-mode-and-permission-copy.md](./ux-spawn-mode-and-permission-copy.md) | 268 |
| [ux-spawn-mode-case-sensitive.md](./ux-spawn-mode-case-sensitive.md) | 691 |
| [ux-spawn-no-prompt-system-chrome.md](./ux-spawn-no-prompt-system-chrome.md) | 564 |
| [ux-spawn-pi-demands-openrouter-not-poe.md](./ux-spawn-pi-demands-openrouter-not-poe.md) | 269 |
| [ux-spawn-pi-yes-works.md](./ux-spawn-pi-yes-works.md) | 867 |
| [ux-spawn-poe-agent-crashes-fs-lstat.md](./ux-spawn-poe-agent-crashes-fs-lstat.md) | 20 |
| [ux-spawn-poe-agent-lstat-reconfirmed-2026-07-08.md](./ux-spawn-poe-agent-lstat-reconfirmed-2026-07-08.md) | 270 |
| [ux-spawn-poe-agent-lstat-reconfirmed.md](./ux-spawn-poe-agent-lstat-reconfirmed.md) | 271 |
| [ux-spawn-runtime-docker-error-good-install-hints.md](./ux-spawn-runtime-docker-error-good-install-hints.md) | 868 |
| [ux-spawn-runtime-host-works.md](./ux-spawn-runtime-host-works.md) | 869 |
| [ux-spawn-skill-missing-lists-searched-paths-see-logs.md](./ux-spawn-skill-missing-lists-searched-paths-see-logs.md) | 565 |
| [ux-spawn-stdin-empty-see-logs.md](./ux-spawn-stdin-empty-see-logs.md) | 566 |
| [ux-spawn-stdin-pipe-works.md](./ux-spawn-stdin-pipe-works.md) | 870 |
| [ux-spawn-success-still-problems-footer.md](./ux-spawn-success-still-problems-footer.md) | 692 |
| [ux-spawn-test-cursor-works.md](./ux-spawn-test-cursor-works.md) | 871 |
| [ux-spawn-test-goose-works.md](./ux-spawn-test-goose-works.md) | 872 |
| [ux-spawn-test-sonnet-4-6-works.md](./ux-spawn-test-sonnet-4-6-works.md) | 873 |
| [ux-spawn-validates-mode-before-agent-reconfirmed.md](./ux-spawn-validates-mode-before-agent-reconfirmed.md) | 567 |
| [ux-spawn-validates-mode-before-agent.md](./ux-spawn-validates-mode-before-agent.md) | 568 |
| [ux-spawn-worktree-flag-missing-on-spawn.md](./ux-spawn-worktree-flag-missing-on-spawn.md) | 272 |
| [ux-spawn-yes-defaults-mode-to-yolo.md](./ux-spawn-yes-defaults-mode-to-yolo.md) | 16 |
| [ux-spawn-yes-defaults-to-yolo-mode.md](./ux-spawn-yes-defaults-to-yolo-mode.md) | 273 |
| [ux-spawn-yes-not-in-options.md](./ux-spawn-yes-not-in-options.md) | 569 |
| [ux-spawn-yes-with-explicit-mode-read-works.md](./ux-spawn-yes-with-explicit-mode-read-works.md) | 874 |
| [ux-stale-configured-model-fails-late.md](./ux-stale-configured-model-fails-late.md) | 274 |
| [ux-success-and-info-share-magenta-glyphs.md](./ux-success-and-info-share-magenta-glyphs.md) | 693 |
| [ux-successful-spawn-still-uses-checkmark-for-agent-text.md](./ux-successful-spawn-still-uses-checkmark-for-agent-text.md) | 570 |
| [ux-superintendent-builder-inspector-npm-run-dev.md](./ux-superintendent-builder-inspector-npm-run-dev.md) | 571 |
| [ux-superintendent-builder-inspector-toolcraft-help.md](./ux-superintendent-builder-inspector-toolcraft-help.md) | 275 |
| [ux-superintendent-code-review-npm-run-dev-identity.md](./ux-superintendent-code-review-npm-run-dev-identity.md) | 572 |
| [ux-superintendent-complete-missing-doc-good.md](./ux-superintendent-complete-missing-doc-good.md) | 875 |
| [ux-superintendent-complete-wrong-kind-debug-tease.md](./ux-superintendent-complete-wrong-kind-debug-tease.md) | 573 |
| [ux-superintendent-help-format-inconsistencies.md](./ux-superintendent-help-format-inconsistencies.md) | 276 |
| [ux-superintendent-help-npm-run-dev-and-dense-run-options.md](./ux-superintendent-help-npm-run-dev-and-dense-run-options.md) | 574 |
| [ux-superintendent-help-npm-run-dev-reconfirmed.md](./ux-superintendent-help-npm-run-dev-reconfirmed.md) | 277 |
| [ux-superintendent-install-already-exists-debug-tease.md](./ux-superintendent-install-already-exists-debug-tease.md) | 278 |
| [ux-superintendent-install-scope-vs-local-global.md](./ux-superintendent-install-scope-vs-local-global.md) | 279 |
| [ux-superintendent-missing-path-double-error.md](./ux-superintendent-missing-path-double-error.md) | 280 |
| [ux-superintendent-run-empty-good.md](./ux-superintendent-run-empty-good.md) | 876 |
| [ux-superintendent-run-help-options-split.md](./ux-superintendent-run-help-options-split.md) | 281 |
| [ux-superintendent-usage-shows-npm-run-dev.md](./ux-superintendent-usage-shows-npm-run-dev.md) | 27 |
| [ux-superintendent-validate-unclosed-tag-opaque.md](./ux-superintendent-validate-unclosed-tag-opaque.md) | 575 |
| [ux-superintendent-validate-unclosed-tag.md](./ux-superintendent-validate-unclosed-tag.md) | 282 |
| [ux-superintendent-validate-wrong-kind-unclosed-tag.md](./ux-superintendent-validate-wrong-kind-unclosed-tag.md) | 283 |
| [ux-tables-ignore-terminal-width.md](./ux-tables-ignore-terminal-width.md) | 576 |
| [ux-tasks-get-github-401-raw-json-reconfirmed.md](./ux-tasks-get-github-401-raw-json-reconfirmed.md) | 284 |
| [ux-tasks-get-github-401-raw-json.md](./ux-tasks-get-github-401-raw-json.md) | 285 |
| [ux-tasks-github-401-raw-json-reconfirmed.md](./ux-tasks-github-401-raw-json-reconfirmed.md) | 286 |
| [ux-tasks-github-auth-raw-error.md](./ux-tasks-github-auth-raw-error.md) | 577 |
| [ux-tasks-import-delete-source-dangerous.md](./ux-tasks-import-delete-source-dangerous.md) | 287 |
| [ux-tasks-import-dry-run-still-requires-to.md](./ux-tasks-import-dry-run-still-requires-to.md) | 578 |
| [ux-tasks-move-delete-source-dangerous.md](./ux-tasks-move-delete-source-dangerous.md) | 288 |
| [ux-tasks-next-github-401-raw-json.md](./ux-tasks-next-github-401-raw-json.md) | 289 |
| [ux-tasks-verify-bad-list-format-good.md](./ux-tasks-verify-bad-list-format-good.md) | 877 |
| [ux-tasks-verify-format-error-good.md](./ux-tasks-verify-format-error-good.md) | 878 |
| [ux-test-and-install-reject-spawn-only-agents-as-unknown.md](./ux-test-and-install-reject-spawn-only-agents-as-unknown.md) | 290 |
| [ux-test-codex-with-valid-model-succeeds.md](./ux-test-codex-with-valid-model-succeeds.md) | 879 |
| [ux-test-failure-dumps-jsonl.md](./ux-test-failure-dumps-jsonl.md) | 291 |
| [ux-test-gemini-requires-native-api-key-not-poe.md](./ux-test-gemini-requires-native-api-key-not-poe.md) | 292 |
| [ux-test-goose-with-valid-model-succeeds.md](./ux-test-goose-with-valid-model-succeeds.md) | 880 |
| [ux-test-help-omits-pi-poe-agent.md](./ux-test-help-omits-pi-poe-agent.md) | 579 |
| [ux-test-kimi-invalid-config-provider-poe-not-found.md](./ux-test-kimi-invalid-config-provider-poe-not-found.md) | 293 |
| [ux-test-kimi-provider-poe-not-found-reconfirmed.md](./ux-test-kimi-provider-poe-not-found-reconfirmed.md) | 294 |
| [ux-test-kimi-yes-still-provider-poe-not-found.md](./ux-test-kimi-yes-still-provider-poe-not-found.md) | 295 |
| [ux-test-nontty-demands-poe-no-prompt-not-yes.md](./ux-test-nontty-demands-poe-no-prompt-not-yes.md) | 296 |
| [ux-test-opencode-model-mapping-still-broken.md](./ux-test-opencode-model-mapping-still-broken.md) | 297 |
| [ux-test-opencode-model-not-found-dumps-stack.md](./ux-test-opencode-model-not-found-dumps-stack.md) | 298 |
| [ux-test-with-valid-model-succeeds.md](./ux-test-with-valid-model-succeeds.md) | 881 |
| [ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md](./ux-test-yes-defaults-claude-dumps-jsonl-on-failure.md) | 299 |
| [ux-timeout-errors-use-system-chrome.md](./ux-timeout-errors-use-system-chrome.md) | 580 |
| [ux-toolcraft-has-suggestions-poe-code-root-does-not.md](./ux-toolcraft-has-suggestions-poe-code-root-does-not.md) | 581 |
| [ux-toolcraft-heading-doubles-poe-code.md](./ux-toolcraft-heading-doubles-poe-code.md) | 582 |
| [ux-toolcraft-help-points-at-npm-run-dev.md](./ux-toolcraft-help-points-at-npm-run-dev.md) | 300 |
| [ux-toolcraft-suggests-options-but-still-npm-run-dev.md](./ux-toolcraft-suggests-options-but-still-npm-run-dev.md) | 301 |
| [ux-traces-cwd-only-flag-removed-or-renamed.md](./ux-traces-cwd-only-flag-removed-or-renamed.md) | 694 |
| [ux-traces-directory-path-eisdir-reconfirmed.md](./ux-traces-directory-path-eisdir-reconfirmed.md) | 583 |
| [ux-traces-directory-path-eisdir.md](./ux-traces-directory-path-eisdir.md) | 584 |
| [ux-traces-enoent-eisdir-still-system-errors.md](./ux-traces-enoent-eisdir-still-system-errors.md) | 302 |
| [ux-traces-invalid-source-validation-good.md](./ux-traces-invalid-source-validation-good.md) | 882 |
| [ux-traces-json-includes-full-prompt-titles.md](./ux-traces-json-includes-full-prompt-titles.md) | 316 |
| [ux-traces-limit-3-works.md](./ux-traces-limit-3-works.md) | 883 |
| [ux-traces-missing-file-enoent-system-chrome.md](./ux-traces-missing-file-enoent-system-chrome.md) | 585 |
| [ux-traces-missing-file-system-error.md](./ux-traces-missing-file-system-error.md) | 586 |
| [ux-traces-poe-code-source-titles-are-agent-names.md](./ux-traces-poe-code-source-titles-are-agent-names.md) | 587 |
| [ux-traces-since-and-source-limit-work.md](./ux-traces-since-and-source-limit-work.md) | 884 |
| [ux-traces-since-limit-works.md](./ux-traces-since-limit-works.md) | 885 |
| [ux-traces-since-validation-cleaner-than-models.md](./ux-traces-since-validation-cleaner-than-models.md) | 303 |
| [ux-traces-source-invalid-validation-good.md](./ux-traces-source-invalid-validation-good.md) | 886 |
| [ux-traces-unsupported-source-validation-good.md](./ux-traces-unsupported-source-validation-good.md) | 887 |
| [ux-unconfigure-claude-dry-run-full-settings-dump.md](./ux-unconfigure-claude-dry-run-full-settings-dump.md) | 304 |
| [ux-unconfigure-goose-dry-run-full-config-dump.md](./ux-unconfigure-goose-dry-run-full-config-dump.md) | 588 |
| [ux-unconfigure-goose-dry-run-still-prints-secrets.md](./ux-unconfigure-goose-dry-run-still-prints-secrets.md) | 305 |
| [ux-unconfigure-help-missing-dry-run-and-yes.md](./ux-unconfigure-help-missing-dry-run-and-yes.md) | 589 |
| [ux-unconfigure-help-no-dry-run-or-yes.md](./ux-unconfigure-help-no-dry-run-or-yes.md) | 590 |
| [ux-unconfigure-help-omits-yes-and-dry-run.md](./ux-unconfigure-help-omits-yes-and-dry-run.md) | 306 |
| [ux-unconfigure-missing-agent-raw-commander.md](./ux-unconfigure-missing-agent-raw-commander.md) | 591 |
| [ux-unconfigure-no-confirmation.md](./ux-unconfigure-no-confirmation.md) | 592 |
| [ux-unconfigure-nonconfigured-agent-still-plans-mutations.md](./ux-unconfigure-nonconfigured-agent-still-plans-mutations.md) | 593 |
| [ux-unconfigure-pi-unknown-not-spawn-only.md](./ux-unconfigure-pi-unknown-not-spawn-only.md) | 307 |
| [ux-unconfigure-rejects-spawn-only-agents.md](./ux-unconfigure-rejects-spawn-only-agents.md) | 594 |
| [ux-unknown-agent-no-allow-list-or-suggestions.md](./ux-unknown-agent-no-allow-list-or-suggestions.md) | 308 |
| [ux-unknown-command-error-suggests-npm-run-dev.md](./ux-unknown-command-error-suggests-npm-run-dev.md) | 28 |
| [ux-update-always-suggests-npm-install-g.md](./ux-update-always-suggests-npm-install-g.md) | 595 |
| [ux-update-dry-run-always-global-npm.md](./ux-update-dry-run-always-global-npm.md) | 888 |
| [ux-update-dry-run-clean-good.md](./ux-update-dry-run-clean-good.md) | 889 |
| [ux-update-help-omits-dry-run.md](./ux-update-help-omits-dry-run.md) | 695 |
| [ux-update-package-manager-override-works.md](./ux-update-package-manager-override-works.md) | 890 |
| [ux-update-package-manager-pnpm-dry-run-good.md](./ux-update-package-manager-pnpm-dry-run-good.md) | 891 |
| [ux-update-pnpm-package-manager-works.md](./ux-update-pnpm-package-manager-works.md) | 892 |
| [ux-usage-balance-default-good.md](./ux-usage-balance-default-good.md) | 893 |
| [ux-usage-balance-presentation-good.md](./ux-usage-balance-presentation-good.md) | 894 |
| [ux-usage-help-hides-default-balance-reconfirmed.md](./ux-usage-help-hides-default-balance-reconfirmed.md) | 596 |
| [ux-usage-help-hides-default-balance.md](./ux-usage-help-hides-default-balance.md) | 696 |
| [ux-usage-list-empty-filter-returns-all.md](./ux-usage-list-empty-filter-returns-all.md) | 697 |
| [ux-usage-list-filter-works-well.md](./ux-usage-list-filter-works-well.md) | 895 |
| [ux-usage-list-filter-works.md](./ux-usage-list-filter-works.md) | 896 |
| [ux-usage-list-no-json-flag.md](./ux-usage-list-no-json-flag.md) | 597 |
| [ux-usage-list-no-match-message-good.md](./ux-usage-list-no-match-message-good.md) | 897 |
| [ux-usage-list-table-works.md](./ux-usage-list-table-works.md) | 898 |
| [ux-usage-pages-1-still-shows-20-entries.md](./ux-usage-pages-1-still-shows-20-entries.md) | 598 |
| [ux-usage-pages-invalid-raw-commander.md](./ux-usage-pages-invalid-raw-commander.md) | 599 |
| [ux-user-errors-look-like-system-failures.md](./ux-user-errors-look-like-system-failures.md) | 309 |
| [ux-utils-config-edit-missing-editor-system-chrome.md](./ux-utils-config-edit-missing-editor-system-chrome.md) | 600 |
| [ux-utils-config-init-already-exists-is-info.md](./ux-utils-config-init-already-exists-is-info.md) | 899 |
| [ux-utils-config-no-path-subcommand.md](./ux-utils-config-no-path-subcommand.md) | 698 |
| [ux-utils-config-path-subcommand-missing.md](./ux-utils-config-path-subcommand-missing.md) | 601 |
| [ux-utils-config-show-dumps-large-json.md](./ux-utils-config-show-dumps-large-json.md) | 602 |
| [ux-utils-config-show-logged-out-clean-no-secrets.md](./ux-utils-config-show-logged-out-clean-no-secrets.md) | 900 |
| [ux-utils-config-show-unframed-raw-json.md](./ux-utils-config-show-unframed-raw-json.md) | 603 |
| [ux-utils-help-usage-says-options-not-command.md](./ux-utils-help-usage-says-options-not-command.md) | 901 |
| [ux-utils-symlink-agents-already-linked-good.md](./ux-utils-symlink-agents-already-linked-good.md) | 902 |
| [ux-utils-symlink-help-missing-design-system-colors.md](./ux-utils-symlink-help-missing-design-system-colors.md) | 604 |
| [ux-utils-symlink-help-unformatted-white-text.md](./ux-utils-symlink-help-unformatted-white-text.md) | 605 |
| [ux-utils-symlink-skills-both-exist-good-guidance.md](./ux-utils-symlink-skills-both-exist-good-guidance.md) | 903 |
| [ux-utils-symlink-skills-is-nested-not-top-level.md](./ux-utils-symlink-skills-is-nested-not-top-level.md) | 699 |
| [ux-utils-symlink-skills-scope-error-vs-agents.md](./ux-utils-symlink-skills-scope-error-vs-agents.md) | 700 |
| [ux-utils-symlink-skills-yes-local-dry-run-works.md](./ux-utils-symlink-skills-yes-local-dry-run-works.md) | 904 |
| [ux-validation-error-still-prints-stack.md](./ux-validation-error-still-prints-stack.md) | 310 |
| [ux-verbose-prefixes-every-log-line.md](./ux-verbose-prefixes-every-log-line.md) | 701 |
| [ux-verbose-spawn-prefix-minimal.md](./ux-verbose-spawn-prefix-minimal.md) | 905 |
| [ux-version-nags-dev-to-major-jump.md](./ux-version-nags-dev-to-major-jump.md) | 606 |
| [ux-version-still-nags-dev-to-4.0.0.md](./ux-version-still-nags-dev-to-4.0.0.md) | 607 |
| [ux-version-subcommand-missing-use-flag.md](./ux-version-subcommand-missing-use-flag.md) | 608 |
| [ux-version-update-nag-dev-to-4-0-1.md](./ux-version-update-nag-dev-to-4-0-1.md) | 609 |
| [ux-version-update-nag-on-dev-builds.md](./ux-version-update-nag-on-dev-builds.md) | 702 |
| [ux-whoami-root-missing-auth-only.md](./ux-whoami-root-missing-auth-only.md) | 610 |
| [ux-wide-tables-truncate-critical-cells.md](./ux-wide-tables-truncate-critical-cells.md) | 611 |
| [ux-worktree-list-empty-good.md](./ux-worktree-list-empty-good.md) | 906 |
| [ux-worktree-list-empty-state-unframed.md](./ux-worktree-list-empty-state-unframed.md) | 907 |
| [ux-worktree-reconcile-not-found-system-chrome.md](./ux-worktree-reconcile-not-found-system-chrome.md) | 612 |
| [ux-worktree-reconcile-requires-agent-not-in-error-order.md](./ux-worktree-reconcile-requires-agent-not-in-error-order.md) | 703 |
| [ux-worktree-reconcile-requires-agent-raw-commander.md](./ux-worktree-reconcile-requires-agent-raw-commander.md) | 613 |
| [ux-worktree-reconcile-requires-agent-raw.md](./ux-worktree-reconcile-requires-agent-raw.md) | 614 |
| [ux-worktree-remove-help-no-yes.md](./ux-worktree-remove-help-no-yes.md) | 615 |
| [ux-worktree-remove-help-omits-yes.md](./ux-worktree-remove-help-omits-yes.md) | 616 |
| [ux-worktree-remove-missing-see-logs.md](./ux-worktree-remove-missing-see-logs.md) | 617 |
| [ux-worktree-remove-no-confirmation.md](./ux-worktree-remove-no-confirmation.md) | 618 |
| [ux-worktree-remove-not-found-system-chrome.md](./ux-worktree-remove-not-found-system-chrome.md) | 619 |
| [ux-wrap-command-still-missing.md](./ux-wrap-command-still-missing.md) | 620 |
| [ux-wrap-dry-run-forwards-flag.md](./ux-wrap-dry-run-forwards-flag.md) | 621 |
| [ux-wrap-resolves-alias-but-dry-run-lies.md](./ux-wrap-resolves-alias-but-dry-run-lies.md) | 622 |

See [AUDIT_STATUS.md](./AUDIT_STATUS.md).
